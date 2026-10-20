(() => {
  const catalog = document.querySelector(".svc-cards");
  if (!catalog) return;
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const categoryArt = category => {
    const key = String(category || "").toLowerCase();
    if (key.includes("demol") || key.includes("демон")) return "demolition";
    if (key.includes("prep") || key.includes("подготов")) return "prep";
    if (key.includes("finish") || key.includes("отдел")) return "finish";
    if (key.includes("floor") || key.includes("пол") || key.includes("фальш")) return "floor";
    return "other";
  };
  const artMarkup = (type, image, alt, number) => {
    if (image) return '<div class="svc-art svc-art-' + type + '" aria-hidden="true"><img class="svc-art-cover" src="' + escapeHtml(image) + '" alt="' + escapeHtml(alt || "") + '" loading="lazy"></div>';
    if (type === "demolition") return '<div class="svc-art svc-art-demolition" aria-hidden="true"><i></i><i></i><b></b><span>' + String(number).padStart(2,"0") + '</span></div>';
    if (type === "prep") return '<div class="svc-art svc-art-prep" aria-hidden="true"><i></i><i></i><b></b></div>';
    if (type === "finish") return '<div class="svc-art svc-art-finish" aria-hidden="true"><i></i><i></i><b></b></div>';
    if (type === "floor") return '<div class="svc-art svc-art-floor" aria-hidden="true"><i></i><i></i><i></i></div>';
    return '<div class="svc-art svc-art-other" aria-hidden="true"><i></i><i></i><b></b></div>';
  };
  const render = (item, index) => {
    const art = categoryArt(item.category);
    const number = String(index + 1).padStart(2, "0");
    return '<a class="svc-card reveal visible' + (item.featured ? " svc-card-featured" : "") + '" href="service-entry.html?slug=' + encodeURIComponent(item.slug) + '">' +
      '<span class="svc-card-no">' + number + ' / ' + escapeHtml(String(item.category || "УСЛУГА").toLocaleUpperCase("ru-RU")) + '</span>' +
      artMarkup(art, item.coverImage, item.coverAlt || item.title, index + 1) +
      '<div class="svc-card-copy"><span class="svc-status">' + (item.featured ? "ОСНОВНОЕ НАПРАВЛЕНИЕ" : "СОСТАВ ПО ЗАДАЧЕ") + '</span>' +
      '<h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(item.excerpt || "") + '</p>' +
      '<span class="svc-card-bottom">Подробнее об услуге <b>↗</b></span></div></a>';
  };
  fetch("/api/public/content?type=service&limit=60", {
    headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store"
  }).then(async response => {
    const type = response.headers.get("content-type") || "";
    if (!type.includes("application/json")) throw new Error("API not available");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Cannot load service catalog");
    const items = data.items || [];
    if (!items.length) {
      catalog.innerHTML = '<div class="svc-empty"><strong>Каталог обновляется.</strong><p>Опубликованные направления появятся здесь после добавления в панели управления.</p></div>';
      return;
    }
    catalog.innerHTML = items.map(render).join("");
    const featured = items.find(item => item.featured);
    const featuredLabel = catalog.querySelector(".svc-card-featured .svc-status");
    if (featured && featuredLabel) featuredLabel.textContent = "ОСНОВНОЕ НАПРАВЛЕНИЕ";
  }).catch(() => {
    // Keep the hand-authored catalog intact on static hosting where the CMS API is not running.
  });
})();