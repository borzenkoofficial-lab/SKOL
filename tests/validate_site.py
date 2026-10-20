from html.parser import HTMLParser
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "index.html").read_text(encoding="utf-8")
errors = []

class SiteParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.anchor_targets = []
        self.html_lang = None
        self.main_count = 0
        self.form_ids = []
        self.controls = []
        self.label_stack = []
        self.labelled_names = set()

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
        if tag == "label":
            self.label_stack.append(False)
        if tag in {"input", "textarea", "select"}:
            self.controls.append((tag, a))
            if self.label_stack:
                self.label_stack[-1] = True
                if a.get("name"):
                    self.labelled_names.add(a["name"])

    def handle_endtag(self, tag):
        if tag == "label" and self.label_stack:
            if not self.label_stack.pop():
                errors.append("A label does not contain a form control.")

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
if 'name="description"' not in html:
    errors.append("SEO description meta tag is missing.")
for path in ("styles.css", "script.js", "favicon.svg"):
    if not (ROOT / path).is_file():
        errors.append(f"Required asset is missing: {path}")

for tag, attrs in parser.controls:
    if attrs.get("type") == "hidden":
        continue
    if not (attrs.get("name") in parser.labelled_names or attrs.get("aria-label") or attrs.get("aria-labelledby")):
        errors.append(f"Form control <{tag}> is missing an accessible label (name={attrs.get('name', '')}).")

if errors:
    print("Site validation FAILED:")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print(f"Site validation passed: {len(parser.ids)} unique IDs, {len(parser.anchor_targets)} internal links, one main landmark.")
