(() => {
  const filters = [...document.querySelectorAll('.pf-filter[data-filter]')];
  let cards = [...document.querySelectorAll('.pf-case[data-category]')];
  const result = document.querySelector('.pf-filter-result');
  const searchInput = document.querySelector('#pf-search');
  const clearSearch = document.querySelector('.pf-search-clear');
  const emptyState = document.querySelector('.pf-empty-state');
  const feed = document.querySelector('.pf-case-feed');
  const viewButtons = [...document.querySelectorAll('[data-view]')];
  const backTop = document.querySelector('.pf-back-top');
  const lightbox = document.querySelector('.pf-lightbox');
  const lightboxStage = lightbox?.querySelector('.pf-lightbox-stage');
  const lightboxCaption = lightbox?.querySelector('.pf-lightbox-caption');

  if (!filters.length || !cards.length) return;

  let activeFilter = 'all';
  let searchTerm = '';

  const normalize = value => String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[ё]/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

  let searchableText = new Map(cards.map(card => [
    card,
    normalize(card.textContent + ' ' + (card.dataset.category || '').replace(/\s+/g, ' ') + ' ' + (card.dataset.keywords || ''))
  ]));

  const categoryCounts = () => {
    const matchingSearch = cards.filter(card => !searchTerm || searchableText.get(card).includes(searchTerm));
    const counts = { all: matchingSearch.length };
    ['demolition', 'preparation', 'finishing', 'floors'].forEach(category => {
      counts[category] = matchingSearch.filter(card =>
        (card.dataset.category || '').split(/\s+/).includes(category)
      ).length;
    });
    return counts;
  };

  const updateCountLabels = counts => {
    document.querySelectorAll('[data-count-for]').forEach(label => {
      const value = counts[label.dataset.countFor] ?? 0;
      label.textContent = String(value).padStart(2, '0');
    });
  };

  const render = () => {
    let visible = 0;
    cards.forEach(card => {
      const categories = (card.dataset.category || '').split(/\s+/).filter(Boolean);
      const categoryMatch = activeFilter === 'all' || categories.includes(activeFilter);
      const searchMatch = !searchTerm || searchableText.get(card).includes(searchTerm);
      const show = categoryMatch && searchMatch;
      card.hidden = !show;
      if (show) {
        visible += 1;
        // Filtered-out cards may have been skipped by the initial reveal observer.
        card.classList.add('visible');
      }
    });

    filters.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.filter === activeFilter));
    });

    const counts = categoryCounts();
    updateCountLabels(counts);
    if (result) result.textContent = 'Показано ' + visible + ' из ' + cards.length;
    if (emptyState) emptyState.hidden = visible !== 0;
    if (clearSearch) clearSearch.hidden = !searchTerm;
  };

  filters.forEach(button => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter || 'all';
      render();
    });
  });

  searchInput?.addEventListener('input', () => {
    searchTerm = normalize(searchInput.value);
    render();
  });

  const resetFilters = () => {
    activeFilter = 'all';
    searchTerm = '';
    if (searchInput) searchInput.value = '';
    render();
    searchInput?.focus();
  };
  clearSearch?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    searchTerm = '';
    render();
    searchInput?.focus();
  });
  document.querySelector('.pf-empty-reset')?.addEventListener('click', resetFilters);

  // Switch between the designed editorial feed and a denser overview grid.
  viewButtons.forEach(button => {
    button.addEventListener('click', () => {
      const view = button.dataset.view === 'grid' ? 'grid' : 'editorial';
      feed?.classList.toggle('pf-view-grid', view === 'grid');
      viewButtons.forEach(option => option.setAttribute('aria-pressed', String(option === button)));
    });
  });

  // Keep the disclosure indicator in sync for mouse, touch and keyboard interaction.
  const bindDetails = root => {
    root.querySelectorAll('.pf-case-details').forEach(details => {
      if (details.dataset.markerBound) return;
      details.dataset.markerBound = 'true';
      details.addEventListener('toggle', () => {
        const marker = details.querySelector('summary span');
        if (marker) marker.textContent = details.open ? '−' : '+';
      });
    });
  };
  bindDetails(document);

  // Real images become keyboard-accessible and can be opened in a native modal viewer.
  // Placeholder artwork is intentionally not clickable and never pretends to be a completed job.
  const makeImageAccessible = image => {
    if (image.dataset.viewerReady) return;
    image.dataset.viewerReady = 'true';
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', 'Открыть изображение: ' + (image.alt || 'фото объекта'));
    image.title = 'Открыть изображение';
  };
  document.querySelectorAll('.pf-case-media img.pf-real-media').forEach(makeImageAccessible);

  const openImage = image => {
    if (!lightbox || !lightboxStage || typeof lightbox.showModal !== 'function') return;
    const clone = document.createElement('img');
    clone.src = image.currentSrc || image.src;
    clone.alt = image.alt || 'Фотография объекта СКОЛ';
    clone.className = 'pf-lightbox-image';
    const card = image.closest('.pf-case');
    const title = card?.querySelector('h3')?.innerText.replace(/\s+/g, ' ').trim();
    lightboxStage.replaceChildren(clone);
    if (lightboxCaption) lightboxCaption.textContent = [title, clone.alt].filter(Boolean).join(' — ');
    lightbox.showModal();
    lightbox.querySelector('.pf-lightbox-close')?.focus();
  };

  document.addEventListener('click', event => {
    const image = event.target.closest?.('.pf-case-media img.pf-real-media');
    if (image) openImage(image);
  });
  document.addEventListener('keydown', event => {
    const image = event.target.closest?.('.pf-case-media img.pf-real-media');
    if (image && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openImage(image);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      if (searchInput) {
        event.preventDefault();
        searchInput.focus();
        searchInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  });
  lightbox?.addEventListener('close', () => {
    lightboxStage?.replaceChildren();
    if (lightboxCaption) lightboxCaption.textContent = '';
  });
  lightbox?.addEventListener('click', event => {
    if (event.target === lightbox) lightbox.close();
  });

  // A small jump-to-top control appears only after the visitor has moved into the long page.
  let scrollFrame = false;
  window.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = true;
    window.requestAnimationFrame(() => {
      backTop?.classList.toggle('is-visible', window.scrollY > 700);
      scrollFrame = false;
    });
  }, { passive: true });
  backTop?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });

  // If published projects exist in the CMS, replace the demo layout with those records.
  // With no server or no published projects, the clearly labelled demo cards stay in place.
  const projectCategory = item => {
    const value = normalize((item.category || "") + " " + (item.slug || ""));
    if (value.includes("demol") || value.includes("демонтаж")) return "demolition";
    if (value.includes("preparation") || value.includes("подготов")) return "preparation";
    if (value.includes("finish") || value.includes("отдел")) return "finishing";
    if (value.includes("floor") || value.includes("фальш") || value.includes("техническ")) return "floors";
    return "other";
  };
  const projectCategoryLabel = key => ({
    demolition: "ДЕМОНТАЖ", preparation: "ПОДГОТОВКА", finishing: "ОТДЕЛКА",
    floors: "ТЕХНИЧЕСКИЕ ПОЛЫ", other: "ОБЪЕКТ"
  })[key] || "ОБЪЕКТ";
  const projectParagraphs = value => {
    const parts = String(value || "").trim().split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
    return (parts.length ? parts : ["Описание объекта пока не добавлено."])
      .map(part => "<p>" + escapeHtml(part).replace(/\n/g, "<br>") + "</p>").join("");
  };
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const renderProjectCard = (item, index) => {
    const category = projectCategory(item);
    const number = String(index + 1).padStart(2, "0");
    const isWide = Boolean(item.featured) && index === 0;
    const cover = item.coverImage
      ? '<img class="pf-real-media" src="' + escapeHtml(item.coverImage) + '" alt="' + escapeHtml(item.coverAlt || item.title) + '" loading="lazy">'
      : '<div class="pf-project-art pf-project-art-' + category + '" aria-hidden="true"><i></i><i></i><b></b><span>' + number + '</span></div>';
    const mediaCaption = item.coverImage ? "ФОТО ОБЪЕКТА" : "МЕДИА НЕ ДОБАВЛЕНО";
    const video = item.videoUrl
      ? '<p><a class="pf-project-video" href="' + escapeHtml(item.videoUrl) + '" target="_blank" rel="noopener noreferrer">Открыть видео процесса ↗</a></p>'
      : "";
    return '<article class="pf-case reveal visible' + (isWide ? ' pf-case-featured' : '') + '" data-category="' + category + '" data-keywords="' + escapeHtml(item.title + " " + item.category + " " + item.excerpt) + '">' +
      '<div class="pf-case-media pf-media-' + category + '" data-media-slot="published-project-' + item.id + '">' +
      '<div class="pf-media-topline"><span>ОБЪЕКТ / ' + number + '</span><span>' + projectCategoryLabel(category) + '</span></div>' + cover +
      '<div class="pf-media-bottom"><span class="pf-slot-stamp">' + mediaCaption + '</span><span>' + (item.coverImage ? "ОБЛОЖКА" : "ЗАГЛУШКА") + '</span></div></div>' +
      '<div class="pf-case-content"><div class="pf-case-meta"><span>' + number + ' / ' + projectCategoryLabel(category) + '</span><span class="pf-case-state">ОПУБЛИКОВАНО</span></div>' +
      '<h3>' + escapeHtml(item.title) + '</h3><p class="pf-case-summary">' + escapeHtml(item.excerpt || "") + '</p>' +
      '<div class="pf-case-spec"><div><span>КАТЕГОРИЯ</span><strong>' + projectCategoryLabel(category) + '</strong></div><div><span>МЕДИА</span><strong>' + (item.coverImage ? "Обложка добавлена" : "Фото нужно добавить") + '</strong></div></div>' +
      '<details class="pf-case-details"><summary>Описание кейса <span>+</span></summary><div>' + projectParagraphs(item.body) + video + '<p class="pf-demo-footnote">Проверяйте фактический состав работ и разрешение на публикацию медиа.</p></div></details></div></article>';
  };
  const loadPublishedProjects = async () => {
    try {
      const response = await fetch("/api/public/content?type=project&limit=60", {
        headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store"
      });
      if (!(response.headers.get("content-type") || "").includes("application/json")) return;
      if (!response.ok) return;
      const data = await response.json();
      const items = data.items || [];
      if (!items.length || !feed) return;
      feed.innerHTML = items.map(renderProjectCard).join("");
      cards = [...feed.querySelectorAll(".pf-case[data-category]")];
      searchableText = new Map(cards.map(card => [
        card,
        normalize(card.textContent + " " + (card.dataset.category || "") + " " + (card.dataset.keywords || ""))
      ]));
      const demoNotice = document.querySelector(".pf-demo-notice");
      if (demoNotice) demoNotice.hidden = true;
      const integrityNote = document.querySelector(".pf-integrity p");
      if (integrityNote) integrityNote.textContent = "Карточки загружены из опубликованных материалов CMS. Если у кейса нет обложки, показана схематичная заглушка. Указывайте только фактически выполненные работы и используйте медиа, разрешённые для публикации.";
      bindDetails(feed);
      feed.querySelectorAll(".pf-case-media img.pf-real-media").forEach(makeImageAccessible);
      render();
    } catch {
      // API is optional on static-only previews; keep the hand-authored demo cards visible.
    }
  };

  // Ctrl/Cmd + K focuses search, mirroring a familiar quick-search interaction.
  render();
  loadPublishedProjects();
})();