/* SKOL motion system: editorial, construction-led and deliberately restrained. */
(() => {
  const hero = document.querySelector('.hero-premium');
  if (!hero || !document.body || document.body.classList.contains('skol-motion-home')) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  document.body.classList.add('skol-motion-home');

  // script.js appends industrial-redesign.css first; this stylesheet is intentionally last.
  const motionStyles = document.createElement('link');
  motionStyles.rel = 'stylesheet';
  motionStyles.href = new URL('skol-motion.css', document.baseURI).href;
  document.head.appendChild(motionStyles);

  const makeElement = (tag, className) => {
    const element = document.createElement(tag);
    element.className = className;
    element.setAttribute('aria-hidden', 'true');
    return element;
  };

  // A single measuring datum gives the hero a construction-documentation signature.
  if (!hero.querySelector('.skol-hero-calibration')) {
    const calibration = makeElement('div', 'skol-hero-calibration');
    const label = makeElement('span', 'skol-calibration-label');
    label.textContent = 'FIELD / 01';
    const track = makeElement('span', 'skol-calibration-track');
    const fill = makeElement('span', 'skol-calibration-fill');
    track.appendChild(fill);
    const value = makeElement('span', 'skol-calibration-value');
    value.textContent = '± 00.0';
    calibration.append(label, track, value);
    hero.appendChild(calibration);
  }

  const sections = [...document.querySelectorAll('#main > section:not(.hero-premium)')];
  sections.forEach(section => {
    section.classList.add('skol-motion-section');
    if (!section.querySelector('.skol-section-trace')) {
      section.appendChild(makeElement('span', 'skol-section-trace'));
    }
  });

  // Scan/crosshair overlays are limited to the schematic portfolio artwork.
  const artwork = [...document.querySelectorAll('.portfolio-slide-art')];
  artwork.forEach(card => {
    card.classList.add('skol-motion-art');
    if (!card.querySelector('.skol-motion-scan')) {
      card.appendChild(makeElement('span', 'skol-motion-scan'));
    }
    if (!card.querySelector('.skol-motion-crosshair')) {
      card.appendChild(makeElement('span', 'skol-motion-crosshair'));
    }
  });

  if (reduceMotion.matches) {
    sections.forEach(section => section.classList.add('is-in-view'));
    return;
  }

  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in-view');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -12% 0px' });
    sections.forEach(section => observer.observe(section));
  } else {
    sections.forEach(section => section.classList.add('is-in-view'));
  }

  // Pointer feedback is an engineering reticle, not a cursor-following glow.
  // It runs only on fine-pointer devices and never moves the underlying artwork.
  if (!finePointer.matches) return;
  artwork.forEach(card => {
    let frame = 0;
    card.addEventListener('pointermove', event => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        const rect = card.getBoundingClientRect();
        const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100));
        const y = Math.min(100, Math.max(0, ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100));
        card.style.setProperty('--skol-focus-x', `${x.toFixed(1)}%`);
        card.style.setProperty('--skol-focus-y', `${y.toFixed(1)}%`);
        frame = 0;
      });
    }, { passive: true });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--skol-focus-x', '50%');
      card.style.setProperty('--skol-focus-y', '50%');
    }, { passive: true });
  });
})();
