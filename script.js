(() => {
  const loader = document.querySelector('.loader');
  window.addEventListener('load', () => {
    window.setTimeout(() => loader?.classList.add('done'), 650);
  });

  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav');
  const closeMenu = () => {
    nav?.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.setAttribute('aria-label', 'Открыть меню');
    document.body.classList.remove('menu-open');
  };
  menuButton?.addEventListener('click', () => {
    const expanded = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!expanded));
    menuButton.setAttribute('aria-label', expanded ? 'Открыть меню' : 'Закрыть меню');
    nav?.classList.toggle('open', !expanded);
    document.body.classList.toggle('menu-open', !expanded);
  });
  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });
  window.addEventListener('resize', () => { if (window.innerWidth > 760) closeMenu(); });

  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -35px 0px' });
    revealItems.forEach(item => observer.observe(item));
  } else {
    revealItems.forEach(item => item.classList.add('visible'));
  }

  const form = document.querySelector('#contact-form');
  const status = document.querySelector('.form-status');
  form?.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const contact = String(data.get('contact') || '').trim();
    const message = String(data.get('message') || '').trim();
    const service = String(data.get('service') || '').trim();
    const area = String(data.get('area') || '').trim();
    const timeline = String(data.get('timeline') || '').trim();
    const subject = encodeURIComponent('Обсуждение объекта — СКОЛ');
    const body = encodeURIComponent(
      'Здравствуйте! Хочу обсудить объект с командой СКОЛ.\n\n' +
      'Имя: ' + name + '\n' +
      'Контакт: ' + contact + '\n' +
      'Направление работ: ' + (service || 'Не выбрано') + '\n' +
      'Площадь: ' + (area ? area + ' м²' : 'Не указана') + '\n' +
      'Желаемый старт: ' + (timeline || 'Не определён') + '\n' +
      'Описание объекта: ' + (message || 'Не указано') + '\n'
    );
    status.textContent = 'Откроется почтовая программа. Для реального приёма заявок нужно подключить серверную отправку.';
    window.location.href = 'mailto:borzenko.official@yandex.ru?subject=' + subject + '&body=' + body;
  });


  // Header state: the fixed navigation becomes a compact, frosted bar after scrolling.
  const header = document.querySelector('.header');
  const progressBar = document.querySelector('.scroll-progress span');
  const navLinks = [...document.querySelectorAll('.nav a[href^="#"]')];
  const trackedSections = navLinks
    .map(link => ({ link, section: document.querySelector(link.getAttribute('href')) }))
    .filter(item => item.section);
  let scrollTicking = false;
  const updateHeader = () => {
    header?.classList.toggle('is-scrolled', window.scrollY > 24);
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
    if (progressBar) progressBar.style.transform = 'scaleX(' + progress.toFixed(4) + ')';
    scrollTicking = false;
  };
  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      window.requestAnimationFrame(updateHeader);
      scrollTicking = true;
    }
  }, { passive: true });
  updateHeader();

  // Keep the desktop navigation in sync with the section currently in view.
  if ('IntersectionObserver' in window && trackedSections.length) {
    const activeSections = new Set();
    const sectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) activeSections.add(entry.target.id);
        else activeSections.delete(entry.target.id);
      });
      const current = trackedSections.find(item => activeSections.has(item.section.id));
      navLinks.forEach(link => {
        if (current && link === current.link) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }, { rootMargin: '-22% 0px -58% 0px', threshold: 0 });
    trackedSections.forEach(item => sectionObserver.observe(item.section));
  }

  // Subtle pointer parallax for the abstract hero geometry; never runs on touch devices.
  const hero = document.querySelector('.hero-premium');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (hero && window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduceMotion.matches) {
    let pointerFrame = 0;
    hero.addEventListener('pointermove', event => {
      if (pointerFrame) return;
      pointerFrame = window.requestAnimationFrame(() => {
        const rect = hero.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width - .5) * 18;
        const y = ((event.clientY - rect.top) / rect.height - .5) * 18;
        hero.style.setProperty('--hero-pointer-x', x.toFixed(2) + 'px');
        hero.style.setProperty('--hero-pointer-y', y.toFixed(2) + 'px');
        pointerFrame = 0;
      });
    }, { passive: true });
    hero.addEventListener('pointerleave', () => {
      hero.style.setProperty('--hero-pointer-x', '0px');
      hero.style.setProperty('--hero-pointer-y', '0px');
    }, { passive: true });
  }

  // Stagger groups of reveal elements for a more deliberate editorial rhythm.
  if (!reduceMotion.matches) {
    document.querySelectorAll('.service-list, .process-grid, .audience-grid, .project-editorial').forEach(group => {
      [...group.children].forEach((item, index) => {
        item.style.transitionDelay = Math.min(index * 85, 340) + 'ms';
      });
    });
  }

  const year = document.querySelector('#year');
  if (year) year.textContent = String(new Date().getFullYear());
})();