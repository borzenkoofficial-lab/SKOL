(() => {
  const filters = [...document.querySelectorAll('.pf-filter[data-filter]')];
  const cards = [...document.querySelectorAll('.pf-case[data-category]')];
  const result = document.querySelector('.pf-filter-result');
  if (!filters.length || !cards.length) return;

  const updateCount = visible => {
    if (!result) return;
    result.textContent = visible === cards.length
      ? visible + ' форматов кейса'
      : visible + ' ' + (visible === 1 ? 'формат кейса' : visible >= 2 && visible <= 4 ? 'формата кейса' : 'форматов кейса');
  };

  const applyFilter = value => {
    let visible = 0;
    cards.forEach(card => {
      const categories = (card.dataset.category || '').split(/\s+/).filter(Boolean);
      const show = value === 'all' || categories.includes(value);
      card.hidden = !show;
      if (show) {
        visible += 1;
        // A card hidden during the first viewport scan must still be visible when revealed by filtering.
        card.classList.add('visible');
      }
    });
    filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === value)));
    updateCount(visible);
  };

  filters.forEach(button => {
    button.addEventListener('click', () => applyFilter(button.dataset.filter || 'all'));
  });

  // Keep the plus indicator and native disclosure state in sync with keyboard and pointer use.
  document.querySelectorAll('.pf-case-details').forEach(details => {
    details.addEventListener('toggle', () => {
      const marker = details.querySelector('summary span');
      if (marker) marker.textContent = details.open ? '−' : '+';
    });
  });

  updateCount(cards.length);
})();