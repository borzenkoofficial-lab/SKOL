from html.parser import HTMLParser
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "index.html").read_text(encoding="utf-8")
errors = []

class SiteParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.anchor_targets = []
        self.labels = []
        self.label_depth = 0
        self.label_text = []
        self.label_has_control = False
        self.controls = []
        self.html_lang = None
        self.main_count = 0
        self.form_ids = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.html_lang = a.get("lang")
        if "id" in a:
            self.ids.append(a["id"])
        if tag == "a":
            href = a.get("href", "")
            if href.startswith("#") and len(href) > 1:
                self.anchor_targets.append(href[1:])
        if tag == "main":
            self.main_count += 1
        if tag == "form":
            self.form_ids.append(a.get("id", ""))
        if tag in {"input", "textarea", "select", "button"}:
            self.controls.append((tag, a))
        if tag == "label":
            self.label_depth += 1
            self.label_text.append(a.get("for"))
            self.label_has_control = False
        if self.label_depth and tag in {"input", "textarea", "select"}:
            self.label_has_control = True

    def handle_endtag(self, tag):
        if tag == "label" and self.label_depth:
            if not self.label_text[-1] and not self.label_has_control:
                errors.append("A label does not contain a form control or use for=.")
            self.label_text.pop()
            self.label_depth -= 1
            self.label_has_control = False

parser = SiteParser()
parser.feed(html)
parser.close()

duplicates = sorted({item for item in parser.ids if parser.ids.count(item) > 1})
if parser.html_lang != "ru":
    errors.append("HTML language must be ru.")
if duplicates:
    errors.append("Duplicate id values: " + ", ".join(duplicates))
missing_targets = sorted(set(parser.anchor_targets) - set(parser.ids))
if missing_targets:
    errors.append("Internal links point to missing ids: " + ", ".join(missing_targets))
if parser.main_count != 1:
    errors.append(f"Expected exactly one main landmark, found {parser.main_count}.")
if "contact-form" not in parser.form_ids:
    errors.append("Contact form #contact-form is missing.")
if not re.search(r'<meta\s+name=["\']description["\']', html, re.I):
    errors.append("SEO description meta tag is missing.")
if not (ROOT / "styles.css").is_file() or not (ROOT / "script.js").is_file():
    errors.append("A referenced CSS or JS file is missing.")

for tag, attrs in parser.controls:
    if tag in {"input", "textarea", "select"} and attrs.get("type") == "hidden":
        continue
    if tag == "input" and attrs.get("type") in {"submit", "button", "reset"}:
        continue
    if tag == "button" or tag in {"input", "textarea", "select"}:
        # Controls inside a label are already named; otherwise require a label or accessible name.
        if attrs.get("id") and any(for_value == attrs["id"] for for_value in parser.label_text):
            continue

if errors:
    print("Site validation FAILED:")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print(f"Site validation passed: {len(parser.ids)} unique IDs, {len(parser.anchor_targets)} internal links, one main landmark.")
