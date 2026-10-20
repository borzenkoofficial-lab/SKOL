(() => {
  const list = document.querySelector("#publications-list");
  const note = document.querySelector("#publications-note");
  if (!list) return;
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const formatDate = value => {
    if (!value) return "СКОЛ / МАТЕРИАЛ";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "СКОЛ / МАТЕРИАЛ";
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(date);
  };
  const card = (item, index) => {
    const image = item.coverImage
      ? '<img src="' + escapeHtml(item.coverImage) + '" alt="' + escapeHtml(item.coverAlt || item.title) + '" loading="lazy">'
      : '<div class="pub-card-placeholder" aria-hidden="true"><span>' + String(index + 1).padStart(2, "0") + '</span></div>';
    return '<article class="pub-card reveal' + (item.featured ? " pub-card-featured" : "") + '">' +
      '<div class="pub-card-media">' + image + '<span class="pub-card-image-label">' + escapeHtml(item.category || "ПУБЛИКАЦИЯ") + '</span></div>' +
      '<div class="pub-card-content"><div class="pub-card-meta"><span>' + escapeHtml(formatDate(item.publishedAt)) + '</span><span>СКОЛ / ARTICLE</span></div>' +
      '<h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(item.excerpt || "") + '</p>' +
      '<a class="pub-card-link" href="publication.html?slug=' + encodeURIComponent(item.slug) + '">Читать материал <span>↗</span></a></div></article>';
  };
  async function load() {
    try {
      const response = await fetch("/api/public/content?type=article&limit=60", {
        headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store"
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) throw new Error("Сервер публикаций пока не подключён к этому хостингу.");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить публикации.");
      const items = data.items || [];
      if (!items.length) {
        list.innerHTML = '<div class="pub-empty"><span class="pub-empty-code">CONTENT / 000</span><h3>Публикации появятся здесь.</h3><p>Добавьте материал в панели управления СКОЛ и установите статус «Опубликовано». Черновики посетителям не показываются.</p></div>';
        if (note) note.textContent = "Публичная лента подключена к серверу. Сейчас нет опубликованных статей.";
        return;
      }
      list.innerHTML = items.map(card).join("");
      if (note) note.textContent = "Опубликовано материалов: " + items.length + ".";
      if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const observer = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.classList.add("visible");
              observer.unobserve(entry.target);
            }
          });
        }, { threshold: 0.08 });
        list.querySelectorAll(".reveal").forEach(element => observer.observe(element));
      } else {
        list.querySelectorAll(".reveal").forEach(element => element.classList.add("visible"));
      }
    } catch (error) {
      list.innerHTML = '<div class="pub-empty"><span class="pub-empty-code">API / OFFLINE</span><h3>Лента ждёт сервер.</h3><p>' + escapeHtml(error.message) + ' После запуска серверной версии СКОЛ опубликованные материалы будут появляться здесь автоматически.</p></div>';
      if (note) note.textContent = "Публикации загружаются из API, а не из локального браузера.";
    }
  }
  load();
})();