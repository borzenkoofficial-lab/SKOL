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
  let contactFormEnabled = true;
  const getJsonResponse = async response => {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const error = new Error('Серверная форма не подключена');
      error.code = 'SKOL_API_UNAVAILABLE';
      throw error;
    }
    return response.json();
  };

  // Public contact details and form configuration are read from the server when available.
  let contactEmail = 'borzenko.official@yandex.ru';
  fetch('/api/public/settings', { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' })
    .then(getJsonResponse)
    .then(settings => {
      const email = String(settings.contact_email || '').trim();
      const telegram = String(settings.telegram_url || '').trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        contactEmail = email;
        document.querySelectorAll('a[href^="mailto:"]').forEach(link => {
          const previous = link.getAttribute('href') || '';
          const query = previous.includes('?') ? previous.slice(previous.indexOf('?')) : '';
          link.setAttribute('href', 'mailto:' + email + query);
        });
      }
      if (/^https:\/\/t\.me\/[A-Za-z0-9_]+\/?$/.test(telegram)) {
        document.querySelectorAll('a[href^="https://t.me/"]').forEach(link => link.setAttribute('href', telegram));
      }
    })
    .catch(() => { /* Static fallback retains the contact data authored in the HTML. */ });

  if (form) {
    const submitButton = form.querySelector('button[type="submit"]');
    const submitLabel = submitButton?.querySelector('span');
    const formNote = form.querySelector('.form-note');
    fetch('/api/public/forms/main-contact', { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' })
      .then(getJsonResponse)
      .then(config => {
        if (config.error) throw new Error(config.error);
        contactFormEnabled = config.enabled !== false;
        if (submitButton) submitButton.disabled = !contactFormEnabled;
        if (submitLabel && config.submitLabel) submitLabel.textContent = config.submitLabel;
        if (formNote) formNote.textContent = contactFormEnabled
          ? 'После отправки заявка сохранится в системе СКОЛ. Не указывайте лишние персональные данные.'
          : 'Приём заявок через эту форму временно отключён.';
        if (!contactFormEnabled && status) status.textContent = 'Форма временно недоступна. Напишите нам в Telegram или на email.';
      })
      .catch(() => {
        // Keep the form usable: when the API/database is not configured, submit opens a prefilled email instead.
        contactFormEnabled = true;
        if (submitButton) submitButton.disabled = false;
        if (formNote) formNote.textContent = 'Сохранение заявки на сайте временно недоступно. При отправке откроется почтовая программа с подготовленным обращением.';
      });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!contactFormEnabled) {
        if (status) status.textContent = 'Приём заявок через эту форму временно отключён. Используйте контакты рядом с формой.';
        return;
      }
      const data = new FormData(form);
      const name = String(data.get('name') || '').trim();
      const contact = String(data.get('contact') || '').trim();
      const message = String(data.get('message') || '').trim();
      const service = String(data.get('service') || '').trim();
      const area = String(data.get('area') || '').trim();
      const timeline = String(data.get('timeline') || '').trim();
      const subject = encodeURIComponent('Обсуждение объекта — СКОЛ');
      const emailBody = encodeURIComponent(
        'Здравствуйте! Хочу обсудить объект с командой СКОЛ.\n\n' +
        'Имя: ' + name + '\n' +
        'Контакт: ' + contact + '\n' +
        'Направление работ: ' + (service || 'Не выбрано') + '\n' +
        'Площадь: ' + (area ? area + ' м²' : 'Не указана') + '\n' +
        'Желаемый старт: ' + (timeline || 'Не определён') + '\n' +
        'Описание объекта: ' + (message || 'Не указано') + '\n'
      );
      if (submitButton) submitButton.disabled = true;
      if (status) status.textContent = 'Отправляем обращение…';
      try {
        const response = await fetch('/api/public/leads', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ formId: 'main-contact', name, contact, service, area, timeline, message })
        });
        let result;
        try { result = await getJsonResponse(response); }
        catch (error) { throw error; }
        if (!response.ok || result?.error) {
          const apiError = String(result?.error || '');
          if (/база данных|DATABASE_URL|серверная форма не подключена|внутренняя ошибка сервера/i.test(apiError)) {
            if (status) status.textContent = 'Сохранение на сайте пока недоступно. Открываем почтовую программу с подготовленным обращением.';
            window.location.href = 'mailto:' + encodeURIComponent(contactEmail) + '?subject=' + subject + '&body=' + emailBody;
          } else if (status) {
            status.textContent = apiError || 'Не удалось отправить обращение. Проверьте данные и попробуйте ещё раз.';
          }
          return;
        }
        if (status) status.textContent = (result.message || 'Заявка сохранена.') + (result.reference ? ' Номер обращения: ' + result.reference + '.' : '');
        form.reset();
      } catch (error) {
        if (error.code === 'SKOL_API_UNAVAILABLE' || error instanceof TypeError) {
          if (status) status.textContent = 'Серверная форма не отвечает. Открываем почтовую программу как резервный способ отправки.';
          window.location.href = 'mailto:' + encodeURIComponent(contactEmail) + '?subject=' + subject + '&body=' + emailBody;
        } else if (status) {
          status.textContent = error.message || 'Не удалось отправить обращение. Попробуйте ещё раз.';
        }
      } finally {
        if (submitButton) submitButton.disabled = !contactFormEnabled;
      }
    });
  }


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

  // Restrained pointer response for cards: decorative geometry moves, content stays stable.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduceMotion.matches) {
    const interactiveCards = document.querySelectorAll('.audience-card, .project-graphic');
    interactiveCards.forEach(card => {
      let frame = 0;
      card.addEventListener('pointermove', event => {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width - .5;
          const y = (event.clientY - rect.top) / rect.height - .5;
          card.style.setProperty('--art-x', (x * 10).toFixed(2) + 'px');
          card.style.setProperty('--art-y', (y * 10).toFixed(2) + 'px');
          frame = 0;
        });
      }, { passive: true });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--art-x', '0px');
        card.style.setProperty('--art-y', '0px');
      }, { passive: true });
    });
  }


  // Premium cursor light for portfolio panels only; content remains still and touch is unaffected.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduceMotion.matches) {
    document.querySelectorAll('.project-graphic').forEach(card => {
      let lightFrame = 0;
      card.addEventListener('pointermove', event => {
        if (lightFrame) return;
        lightFrame = window.requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          card.style.setProperty('--art-light-x', ((event.clientX - rect.left) / rect.width * 100).toFixed(1) + '%');
          card.style.setProperty('--art-light-y', ((event.clientY - rect.top) / rect.height * 100).toFixed(1) + '%');
          lightFrame = 0;
        });
      }, { passive: true });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--art-light-x', '50%');
        card.style.setProperty('--art-light-y', '50%');
      }, { passive: true });
    });
  }

  // 3D portfolio carousel: explicit controls, keyboard support, and no auto-advance.
  const portfolioCarousel = document.querySelector('#portfolio-carousel');
  if (portfolioCarousel) {
    const slides = [...portfolioCarousel.querySelectorAll('[data-slide]')];
    const dots = [...portfolioCarousel.querySelectorAll('[data-carousel-go]')];
    const currentLabel = portfolioCarousel.querySelector('[data-carousel-current]');
    let activeSlide = 0;
    const paintCarousel = nextIndex => {
      activeSlide = (nextIndex + slides.length) % slides.length;
      slides.forEach((slide, index) => {
        const offset = (index - activeSlide + slides.length) % slides.length;
        slide.classList.toggle('is-active', offset === 0);
        slide.classList.toggle('is-next', offset === 1);
        slide.classList.toggle('is-prev', offset === slides.length - 1);
        slide.setAttribute('aria-hidden', offset === 0 ? 'false' : 'true');
        slide.inert = offset !== 0;
      });
      dots.forEach((dot, index) => {
        if (index === activeSlide) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });
      if (currentLabel) currentLabel.textContent = String(activeSlide + 1).padStart(2, '0');
      portfolioCarousel.dataset.active = String(activeSlide);
    };
    portfolioCarousel.querySelector('[data-carousel-prev]')?.addEventListener('click', () => paintCarousel(activeSlide - 1));
    portfolioCarousel.querySelector('[data-carousel-next]')?.addEventListener('click', () => paintCarousel(activeSlide + 1));
    dots.forEach(dot => dot.addEventListener('click', () => paintCarousel(Number(dot.dataset.carouselGo))));
    portfolioCarousel.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); paintCarousel(activeSlide - 1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); paintCarousel(activeSlide + 1); }
    });
    let touchStartX = null;
    portfolioCarousel.addEventListener('touchstart', event => {
      touchStartX = event.changedTouches[0]?.clientX ?? null;
    }, { passive: true });
    portfolioCarousel.addEventListener('touchend', event => {
      if (touchStartX === null) return;
      const delta = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
      if (Math.abs(delta) > 45) paintCarousel(activeSlide + (delta < 0 ? 1 : -1));
      touchStartX = null;
    }, { passive: true });
    paintCarousel(0);
  }

  const year = document.querySelector('#year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="industrial-redesign.css">');
