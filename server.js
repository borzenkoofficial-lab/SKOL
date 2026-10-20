import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import express from "express";
import session from "express-session";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "var"));
const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(dataDir, "skol.sqlite"));
const adminUsername = String(process.env.ADMIN_USERNAME || "").trim();
const adminPassword = String(process.env.ADMIN_PASSWORD || "");
const sessionSecret = String(process.env.SESSION_SECRET || "");

if (adminUsername.length < 3) throw new Error("Set ADMIN_USERNAME to at least 3 characters.");
if (adminPassword.length < 14) throw new Error("Set ADMIN_PASSWORD to a strong password of at least 14 characters.");
if (sessionSecret.length < 32) throw new Error("Set SESSION_SECRET to a random secret of at least 32 characters.");

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.exec([
  "CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL);",
  "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);",
  "CREATE TABLE IF NOT EXISTS content (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL CHECK(type IN ('article','project','service')), title TEXT NOT NULL, slug TEXT NOT NULL, excerpt TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', cover_image TEXT NOT NULL DEFAULT '', cover_alt TEXT NOT NULL DEFAULT '', video_url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')), featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT, UNIQUE(type, slug));",
  "CREATE INDEX IF NOT EXISTS idx_content_public ON content(type,status,published_at);",
  "CREATE INDEX IF NOT EXISTS idx_content_updated ON content(updated_at);",
  "CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, contact TEXT NOT NULL, service TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '', timeline TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'website', status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','qualified','won','lost','archived')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status,created_at);",
  "CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS form_configs (form_id TEXT PRIMARY KEY, title TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, submit_label TEXT NOT NULL, success_message TEXT NOT NULL, updated_at TEXT NOT NULL);"
].join("\n"));

const now = () => new Date().toISOString();
const defaultSettings = {
  company_name: "СКОЛ",
  contact_email: "borzenko.official@yandex.ru",
  telegram_url: "https://t.me/Sergeevitch_sm",
  region: "Москва и Московская область"
};
const insertSetting = db.prepare("INSERT OR IGNORE INTO site_settings(key,value,updated_at) VALUES(?,?,?)");
for (const [key, value] of Object.entries(defaultSettings)) insertSetting.run(key, value, now());
db.prepare("INSERT OR IGNORE INTO form_configs(form_id,title,enabled,submit_label,success_message,updated_at) VALUES('main-contact','Заявка с главной страницы',1,'Отправить заявку','Заявка принята. Мы свяжемся с вами по указанному контакту.',?)").run(now());

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare("SELECT sess, expires FROM sessions WHERE sid = ?").get(sid);
      if (!row || row.expires <= Date.now()) {
        if (row) db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
        callback(null, null);
        return;
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) { callback(error); }
  }
  set(sid, value, callback = () => {}) {
    try {
      const defaultExpiry = Date.now() + 8 * 60 * 60 * 1000;
      const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : defaultExpiry;
      db.prepare("INSERT INTO sessions(sid,sess,expires) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expires=excluded.expires")
        .run(sid, JSON.stringify(value), expires);
      callback(null);
    } catch (error) { callback(error); }
  }
  touch(sid, value, callback) { this.set(sid, value, callback); }
  destroy(sid, callback = () => {}) {
    try { db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid); callback(null); }
    catch (error) { callback(error); }
  }
  clear(callback = () => {}) {
    try { db.prepare("DELETE FROM sessions").run(); callback(null); }
    catch (error) { callback(error); }
  }
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], baseUri: ["'self'"], frameAncestors: ["'none'"],
      formAction: ["'self'"], objectSrc: ["'none'"], scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https:"], mediaSrc: ["'self'", "https:"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));
app.use(express.json({ limit: "64kb", strict: true }));
app.use(session({
  name: "skol.sid",
  secret: sessionSecret,
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, secure: isProduction, sameSite: "strict", maxAge: 8 * 60 * 60 * 1000, path: "/" }
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Слишком много попыток входа. Попробуйте позже." } });
const leadsLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Слишком много обращений. Попробуйте через некоторое время." } });
const allowedStatuses = new Set(["draft", "published", "archived"]);
const allowedContentTypes = new Set(["article", "project", "service"]);
const allowedLeadStatuses = new Set(["new", "in_progress", "qualified", "won", "lost", "archived"]);

function jsonError(res, status, message) { return res.status(status).json({ error: message }); }
function cleanText(value, maxLength = 5000) {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").trim().slice(0, maxLength);
}
function requiredText(value, label, maxLength) {
  const result = cleanText(value, maxLength);
  if (!result) throw new Error(label + " обязателен.");
  return result;
}
function sameSecret(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  const size = Math.max(left.length, right.length, 1);
  const leftPadded = Buffer.alloc(size);
  const rightPadded = Buffer.alloc(size);
  left.copy(leftPadded);
  right.copy(rightPadded);
  return crypto.timingSafeEqual(leftPadded, rightPadded) && left.length === right.length;
}
function normalizeSlug(value) {
  const transliteration = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
  return String(value || "").toLowerCase().split("").map(char => transliteration[char] ?? char).join("")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}
function validOptionalUrl(value) {
  const url = cleanText(value, 1000);
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && parsed.username === "" && parsed.password === "") return url;
  } catch {}
  throw new Error("Ссылка должна быть HTTPS-адресом или локальным путём вида /media/file.webp.");
}
function checkOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== req.get("host")) return jsonError(res, 403, "Недопустимый источник запроса."); }
    catch { return jsonError(res, 403, "Недопустимый источник запроса."); }
  }
  next();
}
function requireAdmin(req, res, next) {
  if (req.session?.admin?.username === adminUsername) return next();
  return jsonError(res, 401, "Требуется вход администратора.");
}
function contentFromRow(row) {
  return {
    id: row.id, type: row.type, title: row.title, slug: row.slug, excerpt: row.excerpt,
    body: row.body, category: row.category, coverImage: row.cover_image, coverAlt: row.cover_alt,
    videoUrl: row.video_url, status: row.status, featured: Boolean(row.featured),
    createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at
  };
}
function leadFromRow(row) {
  return {
    id: row.id, name: row.name, contact: row.contact, service: row.service, area: row.area,
    timeline: row.timeline, message: row.message, source: row.source, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}
function getSettings() {
  const rows = db.prepare("SELECT key,value FROM site_settings").all();
  return Object.fromEntries(rows.map(row => [row.key, row.value]));
}
function getForm(formId) {
  const row = db.prepare("SELECT form_id,title,enabled,submit_label,success_message,updated_at FROM form_configs WHERE form_id=?").get(formId);
  if (!row) return null;
  return { id: row.form_id, title: row.title, enabled: Boolean(row.enabled), submitLabel: row.submit_label, successMessage: row.success_message, updatedAt: row.updated_at };
}
function validateContent(input, existing = null) {
  const type = cleanText(input.type ?? existing?.type, 30);
  if (!allowedContentTypes.has(type)) throw new Error("Выберите корректный тип материала.");
  const title = requiredText(input.title ?? existing?.title, "Название", 180);
  const slug = normalizeSlug(cleanText(input.slug ?? existing?.slug, 140) || title);
  if (!slug) throw new Error("Не удалось сформировать адрес материала.");
  const status = cleanText(input.status ?? existing?.status ?? "draft", 20);
  if (!allowedStatuses.has(status)) throw new Error("Некорректный статус публикации.");
  return {
    type, title, slug, excerpt: cleanText(input.excerpt ?? existing?.excerpt, 800),
    body: cleanText(input.body ?? existing?.body, 30000), category: cleanText(input.category ?? existing?.category, 100),
    cover_image: validOptionalUrl(input.coverImage ?? existing?.cover_image ?? ""),
    cover_alt: cleanText(input.coverAlt ?? existing?.cover_alt, 300),
    video_url: validOptionalUrl(input.videoUrl ?? existing?.video_url ?? ""),
    status, featured: (input.featured ?? Boolean(existing?.featured)) ? 1 : 0
  };
}
function validateSettings(input) {
  const settings = {
    company_name: requiredText(input.company_name, "Название компании", 100),
    contact_email: requiredText(input.contact_email, "Email", 180),
    telegram_url: validOptionalUrl(input.telegram_url || ""),
    region: cleanText(input.region, 180)
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.contact_email)) throw new Error("Проверьте формат email.");
  if (settings.telegram_url && !/^https:\/\/t\.me\/[A-Za-z0-9_]+\/?$/.test(settings.telegram_url)) throw new Error("Укажите ссылку Telegram в формате https://t.me/username.");
  return settings;
}

app.get("/api/health", (_req, res) => res.json({ ok: true, app: "skol-site", storage: "sqlite", auth: "server-side" }));
app.get("/api/auth/me", (req, res) => {
  if (req.session?.admin?.username !== adminUsername) return jsonError(res, 401, "Требуется вход администратора.");
  res.json({ authenticated: true, username: req.session.admin.username, expiresAt: req.session.cookie?.expires || null });
});
app.post("/api/auth/login", loginLimiter, checkOrigin, async (req, res, next) => {
  try {
    const username = cleanText(req.body?.username, 120);
    const password = typeof req.body?.password === "string" ? req.body.password.slice(0, 500) : "";
    if (!sameSecret(username, adminUsername) || !sameSecret(password, adminPassword)) return jsonError(res, 401, "Логин или пароль не подошёл.");
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.admin = { username, signedInAt: now() };
    await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    res.json({ authenticated: true, username });
  } catch (error) { next(error); }
});
app.post("/api/auth/logout", checkOrigin, requireAdmin, async (req, res, next) => {
  try {
    await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie("skol.sid", { httpOnly: true, secure: isProduction, sameSite: "strict", path: "/" });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/public/settings", (_req, res) => res.json(getSettings()));
app.get("/api/public/forms/:formId", (req, res) => {
  const form = getForm(cleanText(req.params.formId, 80));
  if (!form) return jsonError(res, 404, "Форма не найдена.");
  res.json({ id: form.id, title: form.title, enabled: form.enabled, submitLabel: form.submitLabel, successMessage: form.successMessage });
});
app.get("/api/public/content", (req, res) => {
  const type = cleanText(req.query.type, 30) || "article";
  if (!allowedContentTypes.has(type)) return jsonError(res, 400, "Некорректный тип материалов.");
  const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 30));
  const rows = db.prepare("SELECT * FROM content WHERE type=? AND status='published' ORDER BY featured DESC, COALESCE(published_at,updated_at) DESC LIMIT ?").all(type, limit);
  res.json({ items: rows.map(contentFromRow) });
});
app.get("/api/public/content/:slug", (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  const type = cleanText(req.query.type, 30) || "article";
  if (!allowedContentTypes.has(type)) return jsonError(res, 400, "Некорректный тип материала.");
  const row = db.prepare("SELECT * FROM content WHERE type=? AND slug=? AND status='published'").get(type, slug);
  if (!row) return jsonError(res, 404, "Материал не найден.");
  res.json(contentFromRow(row));
});
app.post("/api/public/leads", leadsLimiter, checkOrigin, (req, res, next) => {
  try {
    const form = getForm(cleanText(req.body?.formId, 80) || "main-contact");
    if (!form || !form.enabled) return jsonError(res, 403, "Приём заявок через эту форму временно отключён.");
    const name = requiredText(req.body?.name, "Имя", 120);
    const contact = requiredText(req.body?.contact, "Контакт", 180);
    const service = cleanText(req.body?.service, 150);
    const area = cleanText(req.body?.area, 60);
    const timeline = cleanText(req.body?.timeline, 100);
    const message = cleanText(req.body?.message, 4000);
    if (name.length < 2) return jsonError(res, 400, "Имя должно содержать минимум 2 символа.");
    if (contact.length < 3) return jsonError(res, 400, "Укажите контакт, по которому можно ответить.");
    const timestamp = now();
    const info = db.prepare("INSERT INTO leads(name,contact,service,area,timeline,message,source,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'website','new',?,?)")
      .run(name, contact, service, area, timeline, message, timestamp, timestamp);
    res.status(201).json({ ok: true, reference: "SK-" + String(info.lastInsertRowid).padStart(5, "0"), message: form.successMessage });
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("обязателен.")) return jsonError(res, 400, error.message);
    next(error);
  }
});

app.get("/api/admin/dashboard", requireAdmin, (_req, res) => {
  const leadCounts = db.prepare("SELECT status, COUNT(*) AS count FROM leads GROUP BY status").all();
  const contentCounts = db.prepare("SELECT type, status, COUNT(*) AS count FROM content GROUP BY type,status").all();
  const counts = { leads: { new: 0, in_progress: 0, qualified: 0, won: 0, lost: 0, archived: 0 }, content: { article: 0, project: 0, service: 0 }, drafts: 0, published: 0 };
  for (const row of leadCounts) counts.leads[row.status] = row.count;
  for (const row of contentCounts) {
    counts.content[row.type] += row.count;
    if (row.status === "draft") counts.drafts += row.count;
    if (row.status === "published") counts.published += row.count;
  }
  const recentLeads = db.prepare("SELECT * FROM leads ORDER BY created_at DESC LIMIT 5").all().map(leadFromRow);
  const recentContent = db.prepare("SELECT * FROM content ORDER BY updated_at DESC LIMIT 5").all().map(contentFromRow);
  res.json({ counts, recentLeads, recentContent });
});

app.get("/api/admin/content", requireAdmin, (req, res) => {
  const type = cleanText(req.query.type, 30);
  const status = cleanText(req.query.status, 20);
  const search = cleanText(req.query.q, 120);
  const filters = [];
  const params = [];
  if (type && type !== "all") {
    if (!allowedContentTypes.has(type)) return jsonError(res, 400, "Некорректный тип материалов.");
    filters.push("type=?"); params.push(type);
  }
  if (status && status !== "all") {
    if (!allowedStatuses.has(status)) return jsonError(res, 400, "Некорректный статус.");
    filters.push("status=?"); params.push(status);
  }
  if (search) {
    filters.push("(title LIKE ? OR excerpt LIKE ? OR category LIKE ? OR slug LIKE ?)");
    const like = "%" + search.replace(/[%_]/g, "") + "%";
    params.push(like, like, like, like);
  }
  const sql = "SELECT * FROM content" + (filters.length ? " WHERE " + filters.join(" AND ") : "") + " ORDER BY updated_at DESC LIMIT 200";
  res.json({ items: db.prepare(sql).all(...params).map(contentFromRow) });
});
app.post("/api/admin/content", checkOrigin, requireAdmin, (req, res, next) => {
  try {
    const data = validateContent(req.body || {});
    const timestamp = now();
    const publishedAt = data.status === "published" ? timestamp : null;
    const result = db.prepare("INSERT INTO content(type,title,slug,excerpt,body,category,cover_image,cover_alt,video_url,status,featured,created_at,updated_at,published_at) VALUES(@type,@title,@slug,@excerpt,@body,@category,@cover_image,@cover_alt,@video_url,@status,@featured,@created_at,@updated_at,@published_at)")
      .run({ ...data, created_at: timestamp, updated_at: timestamp, published_at: publishedAt });
    res.status(201).json({ item: contentFromRow(db.prepare("SELECT * FROM content WHERE id=?").get(result.lastInsertRowid)) });
  } catch (error) {
    if (String(error.code || "").includes("SQLITE_CONSTRAINT_UNIQUE")) return jsonError(res, 409, "Материал с таким адресом уже существует в этом разделе.");
    if (error instanceof Error && (error.message.includes("обязателен") || error.message.includes("Выберите") || error.message.includes("адрес") || error.message.includes("Ссылка"))) return jsonError(res, 400, error.message);
    next(error);
  }
});
app.put("/api/admin/content/:id", checkOrigin, requireAdmin, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return jsonError(res, 400, "Некорректный идентификатор.");
    const existing = db.prepare("SELECT * FROM content WHERE id=?").get(id);
    if (!existing) return jsonError(res, 404, "Материал не найден.");
    const data = validateContent(req.body || {}, existing);
    const timestamp = now();
    const publishedAt = data.status === "published" ? (existing.published_at || timestamp) : null;
    db.prepare("UPDATE content SET type=@type,title=@title,slug=@slug,excerpt=@excerpt,body=@body,category=@category,cover_image=@cover_image,cover_alt=@cover_alt,video_url=@video_url,status=@status,featured=@featured,updated_at=@updated_at,published_at=@published_at WHERE id=@id")
      .run({ ...data, updated_at: timestamp, published_at: publishedAt, id });
    res.json({ item: contentFromRow(db.prepare("SELECT * FROM content WHERE id=?").get(id)) });
  } catch (error) {
    if (String(error.code || "").includes("SQLITE_CONSTRAINT_UNIQUE")) return jsonError(res, 409, "Материал с таким адресом уже существует в этом разделе.");
    if (error instanceof Error && (error.message.includes("обязателен") || error.message.includes("Выберите") || error.message.includes("адрес") || error.message.includes("Ссылка"))) return jsonError(res, 400, error.message);
    next(error);
  }
});
app.delete("/api/admin/content/:id", checkOrigin, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return jsonError(res, 400, "Некорректный идентификатор.");
  const result = db.prepare("DELETE FROM content WHERE id=?").run(id);
  if (!result.changes) return jsonError(res, 404, "Материал не найден.");
  res.json({ ok: true });
});

app.get("/api/admin/leads", requireAdmin, (req, res) => {
  const status = cleanText(req.query.status, 30);
  const search = cleanText(req.query.q, 120);
  const filters = [];
  const params = [];
  if (status && status !== "all") {
    if (!allowedLeadStatuses.has(status)) return jsonError(res, 400, "Некорректный статус заявки.");
    filters.push("status=?"); params.push(status);
  }
  if (search) {
    filters.push("(name LIKE ? OR contact LIKE ? OR service LIKE ? OR message LIKE ?)");
    const like = "%" + search.replace(/[%_]/g, "") + "%";
    params.push(like, like, like, like);
  }
  const sql = "SELECT * FROM leads" + (filters.length ? " WHERE " + filters.join(" AND ") : "") + " ORDER BY created_at DESC LIMIT 500";
  res.json({ items: db.prepare(sql).all(...params).map(leadFromRow) });
});
app.patch("/api/admin/leads/:id", checkOrigin, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = cleanText(req.body?.status, 30);
  if (!Number.isSafeInteger(id) || id < 1) return jsonError(res, 400, "Некорректный идентификатор.");
  if (!allowedLeadStatuses.has(status)) return jsonError(res, 400, "Некорректный статус заявки.");
  const result = db.prepare("UPDATE leads SET status=?,updated_at=? WHERE id=?").run(status, now(), id);
  if (!result.changes) return jsonError(res, 404, "Заявка не найдена.");
  res.json({ item: leadFromRow(db.prepare("SELECT * FROM leads WHERE id=?").get(id)) });
});

app.get("/api/admin/forms", requireAdmin, (_req, res) => {
  const forms = db.prepare("SELECT form_id,title,enabled,submit_label,success_message,updated_at FROM form_configs ORDER BY form_id").all();
  res.json({ items: forms.map(row => ({ id: row.form_id, title: row.title, enabled: Boolean(row.enabled), submitLabel: row.submit_label, successMessage: row.success_message, updatedAt: row.updated_at })) });
});
app.put("/api/admin/forms/:formId", checkOrigin, requireAdmin, (req, res) => {
  const formId = cleanText(req.params.formId, 80);
  const existing = getForm(formId);
  if (!existing) return jsonError(res, 404, "Форма не найдена.");
  try {
    const title = requiredText(req.body?.title, "Название формы", 150);
    const submitLabel = requiredText(req.body?.submitLabel, "Текст кнопки", 80);
    const successMessage = requiredText(req.body?.successMessage, "Сообщение после отправки", 500);
    const enabled = req.body?.enabled === true;
    db.prepare("UPDATE form_configs SET title=?,enabled=?,submit_label=?,success_message=?,updated_at=? WHERE form_id=?")
      .run(title, enabled ? 1 : 0, submitLabel, successMessage, now(), formId);
    res.json({ item: getForm(formId) });
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.get("/api/admin/settings", requireAdmin, (_req, res) => res.json(getSettings()));
app.put("/api/admin/settings", checkOrigin, requireAdmin, (req, res) => {
  try {
    const settings = validateSettings(req.body || {});
    const statement = db.prepare("INSERT INTO site_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at");
    const timestamp = now();
    db.transaction(() => Object.entries(settings).forEach(([key, value]) => statement.run(key, value, timestamp)))();
    res.json(getSettings());
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get("/admin", (_req, res) => res.redirect(302, "/admin.html"));
app.use((req, res, next) => {
  const normalized = path.posix.normalize(req.path);
  if (normalized === "/var" || normalized.startsWith("/var/") || normalized === "/data" || normalized.startsWith("/data/")) return res.status(404).end();
  next();
});
app.use(express.static(__dirname, { dotfiles: "deny", index: "index.html", etag: true, maxAge: isProduction ? "1h" : 0 }));
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return jsonError(res, 404, "Маршрут API не найден.");
  res.status(404).type("text").send("Страница не найдена.");
});
app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") return jsonError(res, 413, "Запрос слишком большой.");
  if (error instanceof SyntaxError && "body" in error) return jsonError(res, 400, "Некорректный JSON.");
  console.error("[SKOL server]", error?.message || "Unknown server error");
  if (!res.headersSent) res.status(500).json({ error: "Внутренняя ошибка сервера. Попробуйте позже." });
});

const cleanupExpiredSessions = () => db.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now());
const cleanupTimer = setInterval(cleanupExpiredSessions, 60 * 60 * 1000);
cleanupTimer.unref();
const server = app.listen(port, () => {
  console.log("СКОЛ site/API listening on port " + port);
  console.log("SQLite database: " + databasePath);
  console.log("Admin login is configured from environment variables; secrets are not printed.");
});
function shutdown() {
  clearInterval(cleanupTimer);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
