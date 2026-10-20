(() => {
  const filters = [...document.querySelectorAll('.pf-filter[data-filter]')];
  const cards = [...document.querySelectorAll('.pf-case[data-category]')];
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

  const searchableText = new Map(cards.map(card => [
    card,
    normalize(card.textContent + ' ' + (card.dataset.category || '').replace(/\s+/g, ' '))
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
  document.querySelectorAll('.pf-case-details').forEach(details => {
    details.addEventListener('toggle', () => {
      const marker = details.querySelector('summary span');
      if (marker) marker.textContent = details.open ? '−' : '+';
    });
  });

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

  // Ctrl/Cmd + K focuses search, mirroring a familiar quick-search interaction.
  render();
})();