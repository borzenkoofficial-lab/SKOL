(() => {
  const $ = selector => document.querySelector(selector);
  const title = $("#service-title");
  const excerpt = $("#service-excerpt");
  const summary = $("#service-summary");
  const body = $("#service-body");
  const crumb = $("#service-breadcrumb");
  const extra = $("#service-extra");
  const specialLink = $("#service-special-link");
  const kicker = $("#service-kicker");
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const renderBody = value => {
    const blocks = String(value || "").trim().split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
    if (!blocks.length) return "<p>Описание услуги уточняется по конкретному объекту.</p>";
    return blocks.map(block => {
      if (block.startsWith("### ")) return "<h3>" + escapeHtml(block.slice(4)) + "</h3>";
      if (block.startsWith("## ")) return "<h2>" + escapeHtml(block.slice(3)) + "</h2>";
      const lines = block.split("\n");
      if (lines.every(line => /^[-*]\s+/.test(line))) return "<ul>" + lines.map(line => "<li>" + escapeHtml(line.replace(/^[-*]\s+/, "")) + "</li>").join("") + "</ul>";
      return "<p>" + escapeHtml(block).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  };
  async function load() {
    const slug = new URLSearchParams(window.location.search).get("slug");
    if (!slug) { showError("В адресе страницы отсутствует код услуги."); return; }
    try {
      const response = await fetch("/api/public/content/" + encodeURIComponent(slug) + "?type=service", {
        headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store"
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) throw new Error("Серверная система публикаций пока не подключена.");
      const item = await response.json();
      if (!response.ok) throw new Error(item.error || "Услуга не найдена или не опубликована.");
      if (title) {
        title.textContent = String(item.title || "Услуга").toLocaleUpperCase("ru-RU");
        const dot = document.createElement("span");
        dot.textContent = ".";
        title.appendChild(dot);
      }
      if (excerpt) excerpt.textContent = item.excerpt || "Состав работ определяется по параметрам объекта.";
      if (summary) summary.textContent = item.excerpt || "Состав работ и условия согласуются по параметрам объекта.";
      if (crumb) crumb.textContent = item.title || "Услуга СКОЛ";
      if (kicker) kicker.textContent = "НАПРАВЛЕНИЕ / " + String(item.category || "СКОЛ").toLocaleUpperCase("ru-RU");
      if (body) body.innerHTML = renderBody(item.body);
      document.title = (item.title || "Услуга") + " — СКОЛ";
      const meta = document.querySelector('meta[name="description"]');
      if (meta && item.excerpt) meta.setAttribute("content", String(item.excerpt).slice(0, 260));
      if (item.slug === "demolition" && extra && specialLink) {
        specialLink.href = "demolition.html#demolition-calculator";
        extra.hidden = false;
      }
      if (item.coverImage) {
        const image = document.createElement("img");
        image.src = item.coverImage;
        image.alt = item.coverAlt || item.title || "Изображение услуги";
        image.className = "service-entry-cover";
        image.loading = "eager";
        $(".sd-hero-copy")?.appendChild(image);
      }
      document.querySelectorAll(".reveal").forEach(element => element.classList.add("visible"));
    } catch (error) { showError(error.message || "Не удалось загрузить услугу."); }
  }
  function showError(message) {
    if (title) title.textContent = "УСЛУГА НЕДОСТУПНА.";
    if (excerpt) excerpt.textContent = message;
    if (summary) summary.textContent = "Проверьте статус публикации и доступность сервера.";
    if (body) body.innerHTML = "<p>" + escapeHtml(message) + "</p><p>Откройте каталог услуг или обратитесь к команде СКОЛ.</p>";
  }
  load();
})();