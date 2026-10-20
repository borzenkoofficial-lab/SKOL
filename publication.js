(() => {
  const title = document.querySelector("#article-title");
  const excerpt = document.querySelector("#article-excerpt");
  const body = document.querySelector("#article-body");
  const category = document.querySelector("#article-category");
  const published = document.querySelector("#article-date");
  const hero = document.querySelector(".article-hero-copy");
  if (!body || !title) return;

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const formatDate = value => {
    if (!value) return "СКОЛ / МАТЕРИАЛ";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "СКОЛ / МАТЕРИАЛ";
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(date);
  };
  const paragraph = text => "<p>" + escapeHtml(text).replace(/\n/g, "<br>") + "</p>";
  const renderBody = value => {
    const blocks = String(value || "").trim().split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
    if (!blocks.length) return "<p>Текст материала готовится.</p>";
    return blocks.map(block => {
      if (block.startsWith("### ")) return "<h3>" + escapeHtml(block.slice(4)) + "</h3>";
      if (block.startsWith("## ")) return "<h2>" + escapeHtml(block.slice(3)) + "</h2>";
      const lines = block.split("\n");
      if (lines.every(line => /^[-*]\s+/.test(line))) {
        return "<ul>" + lines.map(line => "<li>" + escapeHtml(line.replace(/^[-*]\s+/, "")) + "</li>").join("") + "</ul>";
      }
      return paragraph(block);
    }).join("");
  };
  const showError = message => {
    title.textContent = "Материал недоступен.";
    excerpt.textContent = "";
    body.innerHTML = '<div class="article-body-error"><h2>Не удалось открыть публикацию.</h2><p>' + escapeHtml(message) + '</p><p>Материал должен быть опубликован в панели управления СКОЛ и доступен через серверный API.</p><a class="article-video-link" href="publications.html">Вернуться ко всем публикациям <span>↗</span></a></div>';
  };
  async function load() {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("slug") || "";
    if (!slug) { showError("В адресе страницы отсутствует slug публикации."); return; }
    try {
      const response = await fetch("/api/public/content/" + encodeURIComponent(slug) + "?type=article", {
        headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store"
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) throw new Error("Сервер публикаций не подключён к этому хостингу.");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Публикация не найдена.");
      title.textContent = data.title || "Публикация";
      excerpt.textContent = data.excerpt || "";
      category.textContent = (data.category || "СКОЛ / МАТЕРИАЛ").toUpperCase();
      published.textContent = formatDate(data.publishedAt);
      document.title = (data.title || "Публикация") + " — СКОЛ";
      const description = document.querySelector('meta[name="description"]');
      if (description && data.excerpt) description.setAttribute("content", String(data.excerpt).slice(0, 280));
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.setAttribute("content", (data.title || "Публикация") + " — СКОЛ");
      const ogDescription = document.querySelector('meta[property="og:description"]');
      if (ogDescription && data.excerpt) ogDescription.setAttribute("content", String(data.excerpt).slice(0, 280));
      body.innerHTML = renderBody(data.body);
      if (data.coverImage) {
        const image = document.createElement("img");
        image.src = data.coverImage;
        image.alt = data.coverAlt || data.title || "Изображение к публикации";
        image.className = "article-cover";
        image.loading = "eager";
        hero?.appendChild(image);
      }
      if (data.videoUrl) {
        const link = document.createElement("a");
        link.href = data.videoUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "article-video-link";
        link.textContent = "Открыть видео к материалу ↗";
        const wrapper = document.createElement("p");
        wrapper.appendChild(link);
        body.appendChild(wrapper);
      }
    } catch (error) {
      showError(error.message || "Не удалось загрузить публикацию.");
    }
  }
  load();
})();