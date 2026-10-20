(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const loginScreen = $("#login-screen");
  const appShell = $("#admin-app");
  const gateStatus = $("#gate-status");
  const loginForm = $("#login-form");
  const screen = $("#admin-screen");
  const screenTitle = $("#screen-title");
  const toast = $("#admin-toast");
  const dialog = $("#content-dialog");
  const contentForm = $("#content-form");
  let currentView = "dashboard";
  let currentContentFilter = "all";
  let currentStatusFilter = "all";
  let toastTimer = null;
  let contentCache = [];
  let currentEditingItem = null;

  const viewTitles = { dashboard: "Обзор", leads: "Заявки", content: "Публикации", projects: "Портфолио", services: "Услуги", forms: "Формы", settings: "Настройки" };
  const contentTypeLabels = { article: "Публикация", project: "Кейс портфолио", service: "Услуга" };
  const statusLabels = { new: "Новая", in_progress: "В работе", qualified: "Квалифицирована", won: "Успешная", lost: "Не актуальна", archived: "Архив", draft: "Черновик", published: "Опубликовано" };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }
  function date(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "—";
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
  }
  function shortDate(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "—";
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(parsed);
  }
  function statusBadge(status) {
    return '<span class="status-pill ' + esc(status) + '">' + esc(statusLabels[status] || status || "—") + "</span>";
  }
  function showToast(message, isError = false) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("visible");
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 4200);
  }
  async function api(path, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options, headers });
    } catch {
      throw new Error("Сервер недоступен. Панель нужно запускать через серверную версию сайта.");
    }
    const contentType = response.headers.get("content-type") || "";
    let data;
    if (contentType.includes("application/json")) {
      data = await response.json().catch(() => ({}));
    } else {
      throw new Error("API не подключён или вернул HTML вместо данных. Статического хостинга для админки недостаточно.");
    }
    if (!response.ok) {
      if (response.status === 401) {
        if (!appShell.hidden) showGate("Сессия завершилась. Войдите снова.");
        throw new Error(data.error || "Требуется вход администратора.");
      }
      throw new Error(data.error || "Не удалось выполнить запрос.");
    }
    return data;
  }
  function showGate(message) {
    loginScreen.hidden = false;
    appShell.hidden = true;
    if (message && gateStatus) gateStatus.textContent = message;
  }
  async function checkServer() {
    try {
      const data = await api("/api/health");
      if (gateStatus) gateStatus.textContent = data.ok
        ? "Сервер и PostgreSQL доступны. Используйте учётные данные, заданные на сервере."
        : "API доступно, но PostgreSQL не подключён. Проверьте DATABASE_URL в настройках Vercel.";
      return Boolean(data.ok);
    } catch {
      if (gateStatus) gateStatus.textContent = "Серверная часть не подключена. Для сохранения данных нужны API и настроенная PostgreSQL-база; статический HTML сам по себе не принимает заявки и не публикует изменения.";
      return false;
    }
  }
  function openApp(username) {
    loginScreen.hidden = true;
    appShell.hidden = false;
    const label = username || "Администратор";
    $("#admin-username").textContent = label;
    $("#admin-avatar").textContent = label.slice(0, 1).toUpperCase();
    switchView("dashboard");
  }
  async function bootstrap() {
    await checkServer();
    try {
      const session = await api("/api/auth/me");
      if (session.authenticated) openApp(session.username);
    } catch {
      // A 401 simply means that the administrator must sign in.
    }
  }

  loginForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $('button[type="submit"]', loginForm);
    const user = $("#login-username").value.trim();
    const password = $("#login-password").value;
    button.disabled = true;
    if (gateStatus) gateStatus.textContent = "Проверяем учётные данные…";
    try {
      const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: user, password }) });
      $("#login-password").value = "";
      openApp(result.username);
    } catch (error) {
      if (gateStatus) gateStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  $("#logout-button")?.addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST", body: "{}" }); }
    catch (error) { showToast(error.message, true); }
    showGate("Вы вышли из панели управления.");
    loginForm?.reset();
  });

  function setActiveView(view) {
    currentView = view;
    $$(".admin-nav [data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === view));
    screenTitle.textContent = viewTitles[view] || "Обзор";
  }
  function switchView(view) {
    if (!viewTitles[view]) view = "dashboard";
    setActiveView(view);
    screen.innerHTML = '<div class="loading-state"><span class="spinner"></span> Загружаем раздел…</div>';
    if (view === "dashboard") loadDashboard();
    else if (view === "leads") loadLeads();
    else if (view === "content" || view === "projects" || view === "services") loadContentView(view);
    else if (view === "forms") loadForms();
    else if (view === "settings") loadSettings();
  }
  $$(".admin-nav [data-view]").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));

  async function loadDashboard() {
    try {
      const data = await api("/api/admin/dashboard");
      const counts = data.counts || {};
      const leadCounts = counts.leads || {};
      const contentCounts = counts.content || {};
      const totalContent = Object.values(contentCounts).reduce((sum, value) => sum + Number(value || 0), 0);
      const recentLeadRows = (data.recentLeads || []).length
        ? data.recentLeads.map(lead => '<div class="activity-item"><div><strong>' + esc(lead.name) + ' · ' + esc(lead.contact) + '</strong><small>' + esc(lead.service || "Направление не выбрано") + ' · ' + date(lead.createdAt) + '</small></div>' + statusBadge(lead.status) + '</div>').join("")
        : emptyMarkup("Входящих заявок пока нет", "Когда форма сайта будет отправлена через сервер, обращения появятся здесь.", "");
      const recentContentRows = (data.recentContent || []).length
        ? data.recentContent.map(item => '<div class="activity-item"><div><strong>' + esc(item.title) + '</strong><small>' + esc(contentTypeLabels[item.type] || item.type) + ' · Изменено ' + shortDate(item.updatedAt) + '</small></div>' + statusBadge(item.status) + '</div>').join("")
        : emptyMarkup("Материалов пока нет", "Создайте первую публикацию, услугу или кейс портфолио.", "content");
      screen.innerHTML =
        '<div class="screen-heading"><div><p class="eyebrow">РАБОЧАЯ СВОДКА / 01</p><h3>Состояние сайта.</h3><p>Контент, обращения и форма сайта собраны в одном месте. Публикации сохраняются в базе только после успешного ответа API.</p></div><div class="screen-heading-actions"><button class="admin-button admin-button-primary" data-action="new-content" type="button"><span>Создать материал</span><b>＋</b></button></div></div>' +
        '<div class="metric-grid">' +
          metric("Новые заявки", Number(leadCounts.new || 0), "Ожидают обработки", "↙") +
          metric("Всего материалов", totalContent, "Публикации, услуги и кейсы", "▤") +
          metric("Опубликовано", Number(counts.published || 0), "Доступны через публичный API", "↗") +
          metric("Черновики", Number(counts.drafts || 0), "Не видны посетителям", "✎") +
        '</div><div class="dashboard-grid">' +
          '<section class="panel-card"><div class="panel-card-head"><div><h4>Последние заявки</h4><p>Новые обращения с сайта</p></div><button class="panel-card-link" data-go="leads" type="button">Все заявки ↗</button></div><div class="activity-list">' + recentLeadRows + '</div></section>' +
          '<section class="panel-card"><div class="panel-card-head"><div><h4>Недавно изменено</h4><p>Последние материалы</p></div><button class="panel-card-link" data-go="content" type="button">Все материалы ↗</button></div><div class="activity-list">' + recentContentRows + '</div></section>' +
        '</div>';
      $("#nav-new-leads").textContent = String(leadCounts.new || 0);
    } catch (error) {
      screen.innerHTML = errorState(error.message, "dashboard");
    }
  }
  function metric(label, value, note, icon) {
    return '<article class="metric-card"><div class="metric-top"><span>' + esc(label) + '</span><span class="metric-icon">' + esc(icon) + '</span></div><strong class="metric-number">' + esc(value) + '</strong><span class="metric-foot">' + esc(note) + '</span></article>';
  }
  function emptyMarkup(title, text, action) {
    return '<div class="empty-state"><div class="empty-state-symbol">↗</div><h4>' + esc(title) + '</h4><p>' + esc(text) + '</p>' +
      (action ? '<button class="admin-small-button" type="button" data-action="new-content">Создать материал ＋</button>' : "") + '</div>';
  }
  function errorState(message, retryView) {
    return '<section class="section-card"><div class="empty-state"><div class="empty-state-symbol">!</div><h4>Не удалось загрузить данные</h4><p>' + esc(message) + '</p><button type="button" class="admin-small-button" data-action="retry" data-retry-view="' + esc(retryView) + '">Повторить ↻</button></div></section>';
  }

  function typeForView(view) {
    if (view === "projects") return "project";
    if (view === "services") return "service";
    return "all";
  }
  function contentHeading(view) {
    const map = {
      content: ["Публикации", "Статьи и заметки компании. Черновик можно редактировать, а публикация появляется на публичной странице после сохранения статуса."],
      projects: ["Портфолио", "Кейсы объектов, медиа-ссылки и описание выполненных работ. Не публикуйте тестовые тексты как реальные результаты."],
      services: ["Услуги", "Описания направлений и их публикационный статус. Для интеграции со статическими страницами требуется подключённый серверный API."]
    };
    return map[view] || map.content;
  }
  async function loadContentView(view, filters = {}) {
    const heading = contentHeading(view);
    const type = filters.type || typeForView(view);
    const status = filters.status || currentStatusFilter;
    const query = filters.q ?? "";
    try {
      const params = new URLSearchParams();
      params.set("type", type);
      params.set("status", status);
      if (query) params.set("q", query);
      const data = await api("/api/admin/content?" + params.toString());
      contentCache = data.items || [];
      currentContentFilter = type;
      renderContentList(view, heading, contentCache, query, status);
    } catch (error) { screen.innerHTML = errorState(error.message, view); }
  }
  function renderContentList(view, heading, items, query, status) {
    const rows = items.length ? items.map(item =>
      '<tr><td><div class="table-title">' + esc(item.title) + '</div><div class="table-subtitle">/' + esc(item.slug) + (item.category ? ' · ' + esc(item.category) : "") + '</div></td>' +
      '<td>' + esc(contentTypeLabels[item.type] || item.type) + '</td><td>' + statusBadge(item.status) + '</td><td>' + esc(shortDate(item.updatedAt)) + '</td>' +
      '<td><div class="table-actions"><button class="table-icon-button" type="button" aria-label="Редактировать ' + esc(item.title) + '" title="Редактировать" data-edit-content="' + item.id + '">✎</button>' +
      (item.status === "published" ? '<a class="table-icon-button" href="' + publicContentUrl(item) + '" aria-label="Открыть публичный материал" title="Открыть" target="_blank" rel="noopener noreferrer">↗</a>' : "") +
      '<button class="table-icon-button" type="button" aria-label="Удалить ' + esc(item.title) + '" title="Удалить" data-delete-content="' + item.id + '">×</button></div></td></tr>'
    ).join("") : '<tr><td colspan="5">' + emptyMarkup("Материалы не найдены", "Создайте новую публикацию или измените фильтры.", "content") + '</td></tr>';
    screen.innerHTML =
      '<div class="screen-heading"><div><p class="eyebrow">CONTENT STUDIO / ' + esc(view.toUpperCase()) + '</p><h3>' + esc(heading[0]) + '.</h3><p>' + esc(heading[1]) + '</p></div><div class="screen-heading-actions"><button class="admin-button admin-button-primary" data-action="new-content" type="button"><span>Новый материал</span><b>＋</b></button></div></div>' +
      '<section class="section-card"><div class="card-toolbar"><div class="toolbar-left"><input class="admin-search" id="content-search" type="search" placeholder="Поиск по заголовку или категории…" value="' + esc(query) + '" aria-label="Поиск материалов"><select id="content-status-filter" class="admin-select" aria-label="Статус">' +
        option("all", "Все статусы", status) + option("draft", "Черновики", status) + option("published", "Опубликовано", status) + option("archived", "Архив", status) +
      '</select></div><div class="toolbar-right"><span class="table-subtitle">Найдено: ' + items.length + '</span></div></div>' +
      '<div class="data-table-wrap"><table class="admin-table"><thead><tr><th>Материал</th><th>Тип</th><th>Статус</th><th>Обновлено</th><th>Действия</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
    $("#content-status-filter").addEventListener("change", event => {
      currentStatusFilter = event.target.value;
      loadContentView(view, { status: currentStatusFilter, q: $("#content-search").value, type: typeForView(view) });
    });
    let searchTimer = null;
    $("#content-search").addEventListener("input", event => {
      window.clearTimeout(searchTimer);
      const value = event.target.value;
      searchTimer = window.setTimeout(() => loadContentView(view, { status: currentStatusFilter, q: value, type: typeForView(view) }), 220);
    });
  }
  function option(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (selected === value ? " selected" : "") + '>' + esc(label) + '</option>';
  }
  function publicContentUrl(item) {
    if (item.type === "project") return "portfolio.html#portfolio-feed";
    if (item.type === "service") return "services.html";
    return "publication.html?slug=" + encodeURIComponent(item.slug);
  }
  function titleSlug(value) {
    const table = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
    return String(value || "").toLowerCase().split("").map(char => table[char] ?? char).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function openContentEditor(item = null, type = "article") {
    currentEditingItem = item;
    contentForm.reset();
    $("#content-form-error").textContent = "";
    $("#content-dialog-title").textContent = item ? "Редактировать материал" : "Новый материал";
    $("#content-id").value = item?.id || "";
    $("#content-type").value = item?.type || type;
    $("#content-status").value = item?.status || "draft";
    $("#content-title").value = item?.title || "";
    $("#content-slug").value = item?.slug || "";
    $("#content-excerpt").value = item?.excerpt || "";
    $("#content-body").value = item?.body || "";
    $("#content-category").value = item?.category || "";
    $("#content-featured").checked = Boolean(item?.featured);
    $("#content-cover").value = item?.coverImage || "";
    $("#content-cover-alt").value = item?.coverAlt || "";
    $("#content-video").value = item?.videoUrl || "";
    dialog.showModal();
    $("#content-title").focus();
  }
  $("#content-title")?.addEventListener("input", () => {
    if (!$("#content-id").value && !$("#content-slug").dataset.userEdited) $("#content-slug").value = titleSlug($("#content-title").value);
  });
  $("#content-slug")?.addEventListener("input", () => { $("#content-slug").dataset.userEdited = "true"; });
  $("#content-slug")?.addEventListener("focus", () => { $("#content-slug").dataset.userEdited = "true"; });
  function closeContentEditor() {
    dialog.close();
    $("#content-slug").dataset.userEdited = "";
    currentEditingItem = null;
  }
  $("#close-content-dialog")?.addEventListener("click", closeContentEditor);
  $("#cancel-content")?.addEventListener("click", closeContentEditor);
  dialog?.addEventListener("click", event => { if (event.target === dialog) closeContentEditor(); });
  contentForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $('button[type="submit"]', contentForm);
    button.disabled = true;
    $("#content-form-error").textContent = "";
    const body = {
      type: $("#content-type").value, status: $("#content-status").value,
      title: $("#content-title").value, slug: $("#content-slug").value,
      excerpt: $("#content-excerpt").value, body: $("#content-body").value,
      category: $("#content-category").value, featured: $("#content-featured").checked,
      coverImage: $("#content-cover").value, coverAlt: $("#content-cover-alt").value,
      videoUrl: $("#content-video").value
    };
    try {
      const id = $("#content-id").value;
      const path = id ? "/api/admin/content/" + encodeURIComponent(id) : "/api/admin/content";
      await api(path, { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
      closeContentEditor();
      showToast(body.status === "published" ? "Материал сохранён и опубликован." : "Материал сохранён.");
      if (currentView === "dashboard") loadDashboard();
      else loadContentView(currentView, { status: currentStatusFilter, type: typeForView(currentView), q: $("#content-search")?.value || "" });
    } catch (error) {
      $("#content-form-error").textContent = error.message;
    } finally { button.disabled = false; }
  });

  async function deleteContent(id) {
    const item = contentCache.find(record => String(record.id) === String(id));
    if (!window.confirm('Удалить материал «' + (item?.title || "без названия") + '»? Это действие нельзя отменить.')) return;
    try {
      await api("/api/admin/content/" + encodeURIComponent(id), { method: "DELETE" });
      showToast("Материал удалён.");
      loadContentView(currentView, { status: currentStatusFilter, type: typeForView(currentView), q: $("#content-search")?.value || "" });
    } catch (error) { showToast(error.message, true); }
  }
  async function loadLeads(filters = {}) {
    const status = filters.status || "all";
    const query = filters.q || "";
    try {
      const params = new URLSearchParams({ status });
      if (query) params.set("q", query);
      const data = await api("/api/admin/leads?" + params.toString());
      const items = data.items || [];
      const rows = items.length ? items.map(lead =>
        '<tr><td><div class="table-title">' + esc(lead.name) + '</div><div class="table-subtitle">№ ' + esc(lead.id) + ' · ' + date(lead.createdAt) + '</div></td>' +
        '<td><div class="table-title">' + esc(lead.contact) + '</div><div class="table-subtitle">' + esc(lead.source) + '</div></td>' +
        '<td><div class="table-title">' + esc(lead.service || "Не указано") + '</div><div class="table-subtitle">' + esc(lead.area ? lead.area + " м²" : "Площадь не указана") + (lead.timeline ? " · " + esc(lead.timeline) : "") + '</div></td>' +
        '<td><div class="lead-message">' + esc(lead.message || "Без комментария") + '</div></td>' +
        '<td><select class="status-select admin-select" data-lead-status="' + lead.id + '" aria-label="Статус заявки ' + lead.id + '">' +
          option("new","Новая",lead.status) + option("in_progress","В работе",lead.status) + option("qualified","Квалифицирована",lead.status) + option("won","Успешная",lead.status) + option("lost","Не актуальна",lead.status) + option("archived","Архив",lead.status) +
        '</select></td></tr>'
      ).join("") : '<tr><td colspan="5">' + emptyMarkup("Заявок пока нет", "Когда сайт запущен через сервер и посетитель отправит форму, обращение сохранится здесь.", "") + '</td></tr>';
      screen.innerHTML =
        '<div class="screen-heading"><div><p class="eyebrow">LEAD CENTER / 02</p><h3>Входящие заявки.</h3><p>Обращения сохраняются в SQLite на сервере. Меняйте статус, ищите по контактам и ведите первичную квалификацию.</p></div></div>' +
        '<section class="section-card"><div class="card-toolbar"><div class="toolbar-left"><input class="admin-search" id="lead-search" type="search" placeholder="Имя, контакт, направление…" value="' + esc(query) + '" aria-label="Поиск заявок"><select class="admin-select" id="lead-status-filter" aria-label="Фильтр статуса">' +
          option("all","Все статусы",status) + option("new","Новые",status) + option("in_progress","В работе",status) + option("qualified","Квалифицированы",status) + option("won","Успешные",status) + option("lost","Не актуальны",status) + option("archived","Архив",status) +
        '</select></div><div class="toolbar-right"><span class="table-subtitle">Заявок: ' + items.length + '</span></div></div>' +
        '<div class="data-table-wrap"><table class="admin-table"><thead><tr><th>Заявитель</th><th>Контакт</th><th>Объект</th><th>Комментарий</th><th>Статус</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
      $("#lead-status-filter").addEventListener("change", event => loadLeads({ status: event.target.value, q: $("#lead-search").value }));
      let timer = null;
      $("#lead-search").addEventListener("input", event => {
        window.clearTimeout(timer);
        const value = event.target.value;
        timer = window.setTimeout(() => loadLeads({ status: $("#lead-status-filter").value, q: value }), 220);
      });
      $$("[data-lead-status]").forEach(select => select.addEventListener("change", async event => {
        const target = event.target;
        try {
          await api("/api/admin/leads/" + encodeURIComponent(target.dataset.leadStatus), { method: "PATCH", body: JSON.stringify({ status: target.value }) });
          showToast("Статус заявки обновлён.");
          updateNewLeadBadge();
        } catch (error) { showToast(error.message, true); }
      }));
      updateNewLeadBadge(items);
    } catch (error) { screen.innerHTML = errorState(error.message, "leads"); }
  }
  function updateNewLeadBadge(items = null) {
    const badge = $("#nav-new-leads");
    if (!badge) return;
    if (items) {
      badge.textContent = String(items.filter(item => item.status === "new").length);
    } else {
      api("/api/admin/dashboard").then(data => { badge.textContent = String(data.counts?.leads?.new || 0); }).catch(() => {});
    }
  }

  async function loadForms() {
    try {
      const data = await api("/api/admin/forms");
      const forms = data.items || [];
      screen.innerHTML =
        '<div class="screen-heading"><div><p class="eyebrow">FORM CONTROL / 06</p><h3>Активные формы.</h3><p>Включайте и отключайте приём обращений, редактируйте текст кнопки и подтверждение. Сервер проверяет статус формы при каждой отправке.</p></div></div>' +
        '<div class="management-grid">' + forms.map(form =>
          '<section class="section-card"><div class="form-section-title"><div><h4>' + esc(form.title) + '</h4><p>ID: ' + esc(form.id) + '</p></div>' + '<span class="form-state ' + (form.enabled ? "is-enabled" : "is-disabled") + '">' + (form.enabled ? "АКТИВНА" : "ОТКЛЮЧЕНА") + '</span></div>' +
          '<form class="management-form" data-form-id="' + esc(form.id) + '">' +
          '<label class="switch-row"><span class="switch-copy"><strong>Принимать заявки</strong><small>Если отключить, сервер не примет новые отправки этой формы.</small></span><span class="admin-switch"><input type="checkbox" name="enabled" ' + (form.enabled ? "checked" : "") + '><span class="switch-track"></span></span></label>' +
          '<label>Название формы<input name="title" maxlength="150" required value="' + esc(form.title) + '"></label>' +
          '<label>Текст кнопки<input name="submitLabel" maxlength="80" required value="' + esc(form.submitLabel) + '"></label>' +
          '<label>Текст после успешной отправки<textarea name="successMessage" rows="3" maxlength="500" required>' + esc(form.successMessage) + '</textarea></label>' +
          '<button class="admin-button admin-button-primary" type="submit"><span>Сохранить форму</span><b>↗</b></button></form></section>'
        ).join("") + '</div>';
      $$("form[data-form-id]").forEach(form => form.addEventListener("submit", async event => {
        event.preventDefault();
        const button = $('button[type="submit"]', form);
        button.disabled = true;
        const fields = new FormData(form);
        const payload = {
          enabled: fields.get("enabled") === "on",
          title: fields.get("title"), submitLabel: fields.get("submitLabel"), successMessage: fields.get("successMessage")
        };
        try {
          await api("/api/admin/forms/" + encodeURIComponent(form.dataset.formId), { method: "PUT", body: JSON.stringify(payload) });
          showToast("Настройки формы сохранены.");
          loadForms();
        } catch (error) { showToast(error.message, true); }
        finally { button.disabled = false; }
      }));
    } catch (error) { screen.innerHTML = errorState(error.message, "forms"); }
  }

  async function loadSettings() {
    try {
      const settings = await api("/api/admin/settings");
      screen.innerHTML =
        '<div class="screen-heading"><div><p class="eyebrow">SITE CONFIGURATION / 07</p><h3>Настройки сайта.</h3><p>Контактные данные хранятся на сервере. Публичные страницы могут получать актуальные значения через API без правки исходного кода.</p></div></div>' +
        '<section class="section-card" style="max-width:760px"><div class="form-section-title"><div><h4>Основные данные</h4><p>Эти поля не содержат паролей и отображаются публично.</p></div></div>' +
        '<form class="settings-section" id="settings-form">' +
        '<label>Название компании<input name="company_name" required maxlength="100" value="' + esc(settings.company_name || "") + '"></label>' +
        '<label>Email для обращений<input type="email" name="contact_email" required maxlength="180" value="' + esc(settings.contact_email || "") + '"></label>' +
        '<label>Telegram URL<input name="telegram_url" maxlength="200" value="' + esc(settings.telegram_url || "") + '" placeholder="https://t.me/username"></label>' +
        '<label>Регион работы<input name="region" maxlength="180" value="' + esc(settings.region || "") + '"></label>' +
        '<p class="inline-hint">Изменения сохраняются в базе. Для автоматического обновления всех публичных ссылок страницы должны быть запущены через этот сервер.</p>' +
        '<button class="admin-button admin-button-primary" type="submit"><span>Сохранить настройки</span><b>↗</b></button></form></section>';
      $("#settings-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = $('button[type="submit"]', form);
        button.disabled = true;
        const fields = new FormData(form);
        const payload = Object.fromEntries(["company_name", "contact_email", "telegram_url", "region"].map(key => [key, fields.get(key)]));
        try {
          await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(payload) });
          showToast("Настройки сохранены.");
        } catch (error) { showToast(error.message, true); }
        finally { button.disabled = false; }
      });
    } catch (error) { screen.innerHTML = errorState(error.message, "settings"); }
  }

  screen?.addEventListener("click", event => {
    const go = event.target.closest("[data-go]");
    if (go) { switchView(go.dataset.go); return; }
    const action = event.target.closest("[data-action]");
    if (action) {
      if (action.dataset.action === "new-content") {
        const viewType = typeForView(currentView);
        openContentEditor(null, viewType === "all" ? "article" : viewType);
        return;
      }
      if (action.dataset.action === "retry") { switchView(action.dataset.retryView || currentView); return; }
    }
    const edit = event.target.closest("[data-edit-content]");
    if (edit) {
      const item = contentCache.find(record => String(record.id) === edit.dataset.editContent);
      if (item) openContentEditor(item, item.type);
      return;
    }
    const remove = event.target.closest("[data-delete-content]");
    if (remove) deleteContent(remove.dataset.deleteContent);
  });

  // Do not copy or persist admin credentials in the browser. Only an HTTP-only session cookie is retained.
  bootstrap();
})();