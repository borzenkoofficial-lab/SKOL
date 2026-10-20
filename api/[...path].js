import crypto from "node:crypto";
import { Pool } from "pg";
import express from "express";
import session from "express-session";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

const isProduction = process.env.NODE_ENV === "production";
const adminUsername = String(process.env.ADMIN_USERNAME || "").trim();
const adminPassword = String(process.env.ADMIN_PASSWORD || "");
const sessionSecret = String(process.env.SESSION_SECRET || "");
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || "";
const pool = connectionString
  ? new Pool({ connectionString, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000 })
  : null;
let schemaPromise = null;

const now = () => new Date().toISOString();
const jsonError = (res, status, message) => res.status(status).json({ error: message });
const cleanText = (value, maxLength = 5000) => typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maxLength) : "";
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
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
function checkOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) return jsonError(res, 403, "Недопустимый источник запроса.");
    } catch { return jsonError(res, 403, "Недопустимый источник запроса."); }
  }
  next();
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin && req.session.admin.username === adminUsername) return next();
  return jsonError(res, 401, "Требуется вход администратора.");
}
const allowedStatuses = new Set(["draft", "published", "archived"]);
const allowedContentTypes = new Set(["article", "project", "service"]);
const allowedLeadStatuses = new Set(["new", "in_progress", "qualified", "won", "lost", "archived"]);

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
async function getSettings() {
  const result = await pool.query("SELECT key,value FROM site_settings");
  return Object.fromEntries(result.rows.map(row => [row.key, row.value]));
}
async function getForm(formId) {
  const result = await pool.query("SELECT form_id,title,enabled,submit_label,success_message,updated_at FROM form_configs WHERE form_id=$1", [formId]);
  const row = result.rows[0];
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

async function ensureSchema() {
  if (!pool) throw new Error("Не настроена база данных. Добавьте DATABASE_URL в переменные окружения Vercel.");
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const statements = [
        "CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess JSONB NOT NULL, expires BIGINT NOT NULL)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)",
        "CREATE TABLE IF NOT EXISTS content (id BIGSERIAL PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('article','project','service')), title TEXT NOT NULL, slug TEXT NOT NULL, excerpt TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', cover_image TEXT NOT NULL DEFAULT '', cover_alt TEXT NOT NULL DEFAULT '', video_url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')), featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT, UNIQUE(type, slug))",
        "CREATE INDEX IF NOT EXISTS idx_content_public ON content(type,status,published_at)",
        "CREATE INDEX IF NOT EXISTS idx_content_updated ON content(updated_at)",
        "CREATE TABLE IF NOT EXISTS leads (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL, service TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '', timeline TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'website', status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','qualified','won','lost','archived')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
        "CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status,created_at)",
        "CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS system_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS form_configs (form_id TEXT PRIMARY KEY, title TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, submit_label TEXT NOT NULL, success_message TEXT NOT NULL, updated_at TEXT NOT NULL)"
      ];
      for (const statement of statements) await pool.query(statement);
      const timestamp = now();
      const defaults = {
        company_name: "СКОЛ", contact_email: "borzenko.official@yandex.ru",
        telegram_url: "https://t.me/Sergeevitch_sm", region: "Москва и Московская область"
      };
      for (const [key, value] of Object.entries(defaults)) {
        await pool.query("INSERT INTO site_settings(key,value,updated_at) VALUES($1,$2,$3) ON CONFLICT(key) DO NOTHING", [key, value, timestamp]);
      }
      await pool.query("INSERT INTO form_configs(form_id,title,enabled,submit_label,success_message,updated_at) VALUES('main-contact','Заявка с главной страницы',1,'Отправить заявку','Заявка принята. Мы свяжемся с вами по указанному контакту.',$1) ON CONFLICT(form_id) DO NOTHING", [timestamp]);
      const seeded = await pool.query("SELECT value FROM system_meta WHERE key='core_services_seeded'");
      if (!seeded.rows.length) {
        const services = [
          ["demolition", "Демонтаж", "demolition", "Стены и перегородки, стяжка пола, покрытия, потолки, старая отделка и комплексный демонтаж.", "Демонтажные работы для коммерческих и частных объектов.\n\nУточняем состав конструкций, материалы, доступ, ограничения площадки и логистику отходов до начала работ. Несущие конструкции требуют отдельной технической оценки и необходимых разрешений.", 1],
          ["preparation", "Подготовка помещений", "preparation", "Очистка и подготовка поверхностей, оснований и помещений к следующему этапу работ.", "Подготовительные операции определяются фактическим состоянием объекта.\n\nСогласуем требуемое состояние поверхности, последовательность операций и условия передачи следующему исполнителю. Дополнительные операции фиксируются отдельно.", 0],
          ["finishing", "Отделочные работы", "finishing", "Штукатурные, шпаклёвочные и малярные операции по согласованному объёму.", "Отделочные работы начинаются с оценки основания и согласования требований к результату.\n\nСостав, материалы и границы ответственности фиксируются в техническом задании. Конкретный результат оценивается по заранее согласованным критериям.", 0],
          ["technical-floors", "Фальшполы и технические полы", "floors", "Обследование системы, демонтаж, подготовка основания и монтаж в рамках проекта.", "Работы с фальшполами и техническими полами требуют понимания состава системы, нагрузки, высоты конструкции и доступа к коммуникациям.\n\nПараметры монтажа и комплектность определяются по проекту и спецификации объекта.", 0]
        ];
        for (const item of services) {
          await pool.query("INSERT INTO content(type,slug,title,category,excerpt,body,status,featured,created_at,updated_at,published_at) VALUES('service',$1,$2,$3,$4,$5,'published',$6,$7,$7,$7) ON CONFLICT(type,slug) DO NOTHING", [item[0], item[1], item[2], item[3], item[4], item[5], timestamp]);
        }
        await pool.query("INSERT INTO system_meta(key,value) VALUES('core_services_seeded','true') ON CONFLICT(key) DO NOTHING");
      }
    })().catch(error => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

class PgSessionStore extends session.Store {
  get(sid, callback) {
    if (!pool) return callback(new Error("Database is not configured"));
    pool.query("SELECT sess,expires FROM sessions WHERE sid=$1", [sid]).then(result => {
      const row = result.rows[0];
      if (!row || Number(row.expires) <= Date.now()) {
        if (row) pool.query("DELETE FROM sessions WHERE sid=$1", [sid]).catch(() => {});
        callback(null, null);
        return;
      }
      callback(null, typeof row.sess === "string" ? JSON.parse(row.sess) : row.sess);
    }).catch(callback);
  }
  set(sid, value, callback = () => {}) {
    if (!pool) return callback(new Error("Database is not configured"));
    const fallbackExpiry = Date.now() + 8 * 60 * 60 * 1000;
    const expires = value.cookie?.expires ? Date.parse(value.cookie.expires) : fallbackExpiry;
    pool.query("INSERT INTO sessions(sid,sess,expires) VALUES($1,$2::jsonb,$3) ON CONFLICT(sid) DO UPDATE SET sess=EXCLUDED.sess,expires=EXCLUDED.expires", [sid, JSON.stringify(value), Number.isFinite(expires) ? expires : fallbackExpiry])
      .then(() => callback(null)).catch(callback);
  }
  touch(sid, value, callback) { this.set(sid, value, callback); }
  destroy(sid, callback = () => {}) {
    if (!pool) return callback(new Error("Database is not configured"));
    pool.query("DELETE FROM sessions WHERE sid=$1", [sid]).then(() => callback(null)).catch(callback);
  }
  clear(callback = () => {}) {
    if (!pool) return callback(new Error("Database is not configured"));
    pool.query("DELETE FROM sessions").then(() => callback(null)).catch(callback);
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
      imgSrc: ["'self'", "data:", "https:"], mediaSrc: ["'self'", "https:"], connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));
app.use(express.json({ limit: "64kb", strict: true }));

app.get("/api/health", asyncRoute(async (_req, res) => {
  if (!pool) {
    return res.json({
      ok: false, app: "skol-site", storage: "unconfigured",
      databaseConfigured: false, databaseConnected: false, auth: "server-side"
    });
  }
  try {
    await pool.query("SELECT 1");
    return res.json({
      ok: true, app: "skol-site", storage: "postgres",
      databaseConfigured: true, databaseConnected: true, auth: "server-side"
    });
  } catch (error) {
    console.error("[SKOL health]", error?.message || "Database health check failed");
    return res.status(503).json({
      ok: false, app: "skol-site", storage: "postgres",
      databaseConfigured: true, databaseConnected: false, auth: "server-side"
    });
  }
}));

app.use((req, res, next) => {
  if (req.path === "/api/health") return next();
  ensureSchema().then(() => next()).catch(next);
});
app.use(session({
  name: "skol.sid", secret: sessionSecret || "missing-secret-configured-in-environment",
  store: new PgSessionStore(), resave: false, saveUninitialized: false, rolling: true,
  cookie: { httpOnly: true, secure: isProduction, sameSite: "strict", maxAge: 8 * 60 * 60 * 1000, path: "/" }
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Слишком много попыток входа. Попробуйте позже." } });
const leadsLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Слишком много обращений. Попробуйте через некоторое время." } });

app.get("/api/auth/me", (req, res) => {
  if (!adminUsername || req.session?.admin?.username !== adminUsername) return jsonError(res, 401, "Требуется вход администратора.");
  res.json({ authenticated: true, username: req.session.admin.username, expiresAt: req.session.cookie?.expires || null });
});
app.post("/api/auth/login", loginLimiter, checkOrigin, asyncRoute(async (req, res) => {
  if (!adminUsername || adminUsername.length < 3 || adminPassword.length < 14 || sessionSecret.length < 32) {
    return jsonError(res, 503, "Администратор не настроен. Проверьте ADMIN_USERNAME, ADMIN_PASSWORD и SESSION_SECRET в настройках Vercel.");
  }
  const username = cleanText(req.body?.username, 120);
  const password = typeof req.body?.password === "string" ? req.body.password.slice(0, 500) : "";
  if (!sameSecret(username, adminUsername) || !sameSecret(password, adminPassword)) return jsonError(res, 401, "Логин или пароль не подошёл.");
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.admin = { username, signedInAt: now() };
  await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
  res.json({ authenticated: true, username });
}));
app.post("/api/auth/logout", checkOrigin, requireAdmin, asyncRoute(async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
  res.clearCookie("skol.sid", { httpOnly: true, secure: isProduction, sameSite: "strict", path: "/" });
  res.json({ ok: true });
}));

app.get("/api/public/settings", asyncRoute(async (_req, res) => res.json(await getSettings())));
app.get("/api/public/forms/:formId", asyncRoute(async (req, res) => {
  const form = await getForm(cleanText(req.params.formId, 80));
  if (!form) return jsonError(res, 404, "Форма не найдена.");
  res.json({ id: form.id, title: form.title, enabled: form.enabled, submitLabel: form.submitLabel, successMessage: form.successMessage });
}));
app.get("/api/public/content", asyncRoute(async (req, res) => {
  const type = cleanText(req.query.type, 30) || "article";
  if (!allowedContentTypes.has(type)) return jsonError(res, 400, "Некорректный тип материалов.");
  const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 30));
  const result = await pool.query("SELECT * FROM content WHERE type=$1 AND status='published' ORDER BY featured DESC, COALESCE(published_at,updated_at) DESC LIMIT $2", [type, limit]);
  res.json({ items: result.rows.map(contentFromRow) });
}));
app.get("/api/public/content/:slug", asyncRoute(async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  const type = cleanText(req.query.type, 30) || "article";
  if (!allowedContentTypes.has(type)) return jsonError(res, 400, "Некорректный тип материалов.");
  const result = await pool.query("SELECT * FROM content WHERE type=$1 AND slug=$2 AND status='published'", [type, slug]);
  if (!result.rows[0]) return jsonError(res, 404, "Материал не найден.");
  res.json(contentFromRow(result.rows[0]));
}));
app.post("/api/public/leads", leadsLimiter, checkOrigin, asyncRoute(async (req, res) => {
  const form = await getForm(cleanText(req.body?.formId, 80) || "main-contact");
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
  const result = await pool.query("INSERT INTO leads(name,contact,service,area,timeline,message,source,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'website','new',$7,$7) RETURNING id", [name, contact, service, area, timeline, message, timestamp]);
  res.status(201).json({ ok: true, reference: "SK-" + String(result.rows[0].id).padStart(5, "0"), message: form.successMessage });
}));

app.get("/api/admin/dashboard", requireAdmin, asyncRoute(async (_req, res) => {
  const leadCounts = await pool.query("SELECT status,COUNT(*)::int AS count FROM leads GROUP BY status");
  const contentCounts = await pool.query("SELECT type,status,COUNT(*)::int AS count FROM content GROUP BY type,status");
  const counts = { leads: { new: 0, in_progress: 0, qualified: 0, won: 0, lost: 0, archived: 0 }, content: { article: 0, project: 0, service: 0 }, drafts: 0, published: 0 };
  for (const row of leadCounts.rows) counts.leads[row.status] = row.count;
  for (const row of contentCounts.rows) {
    counts.content[row.type] += row.count;
    if (row.status === "draft") counts.drafts += row.count;
    if (row.status === "published") counts.published += row.count;
  }
  const recentLeads = await pool.query("SELECT * FROM leads ORDER BY created_at DESC LIMIT 5");
  const recentContent = await pool.query("SELECT * FROM content ORDER BY updated_at DESC LIMIT 5");
  res.json({ counts, recentLeads: recentLeads.rows.map(leadFromRow), recentContent: recentContent.rows.map(contentFromRow) });
}));
app.get("/api/admin/content", requireAdmin, asyncRoute(async (req, res) => {
  const type = cleanText(req.query.type, 30), status = cleanText(req.query.status, 20), search = cleanText(req.query.q, 120);
  const filters = [], params = [];
  if (type && type !== "all") {
    if (!allowedContentTypes.has(type)) return jsonError(res, 400, "Некорректный тип материалов.");
    params.push(type); filters.push("type=$" + params.length);
  }
  if (status && status !== "all") {
    if (!allowedStatuses.has(status)) return jsonError(res, 400, "Некорректный статус.");
    params.push(status); filters.push("status=$" + params.length);
  }
  if (search) {
    params.push("%" + search.replace(/[%_]/g, "") + "%");
    const index = params.length;
    filters.push("(title ILIKE $" + index + " OR excerpt ILIKE $" + index + " OR category ILIKE $" + index + " OR slug ILIKE $" + index + ")");
  }
  const sql = "SELECT * FROM content" + (filters.length ? " WHERE " + filters.join(" AND ") : "") + " ORDER BY updated_at DESC LIMIT 200";
  const result = await pool.query(sql, params);
  res.json({ items: result.rows.map(contentFromRow) });
}));
app.post("/api/admin/content", checkOrigin, requireAdmin, asyncRoute(async (req, res) => {
  try {
    const data = validateContent(req.body || {}), timestamp = now();
    const publishedAt = data.status === "published" ? timestamp : null;
    const result = await pool.query("INSERT INTO content(type,title,slug,excerpt,body,category,cover_image,cover_alt,video_url,status,featured,created_at,updated_at,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13) RETURNING *",
      [data.type,data.title,data.slug,data.excerpt,data.body,data.category,data.cover_image,data.cover_alt,data.video_url,data.status,data.featured,timestamp,publishedAt]);
    res.status(201).json({ item: contentFromRow(result.rows[0]) });
  } catch (error) {
    if (error.code === "23505") return jsonError(res, 409, "Материал с таким адресом уже существует в этом разделе.");
    if (error instanceof Error && ["обязателен", "Выберите", "адрес", "Ссылка"].some(part => error.message.includes(part))) return jsonError(res, 400, error.message);
    throw error;
  }
}));
app.put("/api/admin/content/:id", checkOrigin, requireAdmin, asyncRoute(async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return jsonError(res, 400, "Некорректный идентификатор.");
    const lookup = await pool.query("SELECT * FROM content WHERE id=$1", [id]);
    const existing = lookup.rows[0];
    if (!existing) return jsonError(res, 404, "Материал не найден.");
    const data = validateContent(req.body || {}, existing), timestamp = now();
    const publishedAt = data.status === "published" ? (existing.published_at || timestamp) : null;
    const result = await pool.query("UPDATE content SET type=$1,title=$2,slug=$3,excerpt=$4,body=$5,category=$6,cover_image=$7,cover_alt=$8,video_url=$9,status=$10,featured=$11,updated_at=$12,published_at=$13 WHERE id=$14 RETURNING *",
      [data.type,data.title,data.slug,data.excerpt,data.body,data.category,data.cover_image,data.cover_alt,data.video_url,data.status,data.featured,timestamp,publishedAt,id]);
    res.json({ item: contentFromRow(result.rows[0]) });
  } catch (error) {
    if (error.code === "23505") return jsonError(res, 409, "Материал с таким адресом уже существует в этом разделе.");
    if (error instanceof Error && ["обязателен", "Выберите", "адрес", "Ссылка"].some(part => error.message.includes(part))) return jsonError(res, 400, error.message);
    throw error;
  }
}));
app.delete("/api/admin/content/:id", checkOrigin, requireAdmin, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return jsonError(res, 400, "Некорректный идентификатор.");
  const result = await pool.query("DELETE FROM content WHERE id=$1", [id]);
  if (!result.rowCount) return jsonError(res, 404, "Материал не найден.");
  res.json({ ok: true });
}));

app.get("/api/admin/leads", requireAdmin, asyncRoute(async (req, res) => {
  const status = cleanText(req.query.status, 30), search = cleanText(req.query.q, 120);
  const filters = [], params = [];
  if (status && status !== "all") {
    if (!allowedLeadStatuses.has(status)) return jsonError(res, 400, "Некорректный статус заявки.");
    params.push(status); filters.push("status=$" + params.length);
  }
  if (search) {
    params.push("%" + search.replace(/[%_]/g, "") + "%");
    const index = params.length;
    filters.push("(name ILIKE $" + index + " OR contact ILIKE $" + index + " OR service ILIKE $" + index + " OR message ILIKE $" + index + ")");
  }
  const result = await pool.query("SELECT * FROM leads" + (filters.length ? " WHERE " + filters.join(" AND ") : "") + " ORDER BY created_at DESC LIMIT 500", params);
  res.json({ items: result.rows.map(leadFromRow) });
}));
app.patch("/api/admin/leads/:id", checkOrigin, requireAdmin, asyncRoute(async (req, res) => {
  const id = Number(req.params.id), status = cleanText(req.body?.status, 30);
  if (!Number.isSafeInteger(id) || id < 1) return jsonError(res, 400, "Некорректный идентификатор.");
  if (!allowedLeadStatuses.has(status)) return jsonError(res, 400, "Некорректный статус заявки.");
  const result = await pool.query("UPDATE leads SET status=$1,updated_at=$2 WHERE id=$3 RETURNING *", [status, now(), id]);
  if (!result.rows[0]) return jsonError(res, 404, "Заявка не найдена.");
  res.json({ item: leadFromRow(result.rows[0]) });
}));

app.get("/api/admin/forms", requireAdmin, asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT form_id,title,enabled,submit_label,success_message,updated_at FROM form_configs ORDER BY form_id");
  res.json({ items: result.rows.map(row => ({ id: row.form_id, title: row.title, enabled: Boolean(row.enabled), submitLabel: row.submit_label, successMessage: row.success_message, updatedAt: row.updated_at })) });
}));
app.put("/api/admin/forms/:formId", checkOrigin, requireAdmin, asyncRoute(async (req, res) => {
  const formId = cleanText(req.params.formId, 80), existing = await getForm(formId);
  if (!existing) return jsonError(res, 404, "Форма не найдена.");
  try {
    const title = requiredText(req.body?.title, "Название формы", 150);
    const submitLabel = requiredText(req.body?.submitLabel, "Текст кнопки", 80);
    const successMessage = requiredText(req.body?.successMessage, "Сообщение после отправки", 500);
    const enabled = req.body?.enabled === true ? 1 : 0;
    await pool.query("UPDATE form_configs SET title=$1,enabled=$2,submit_label=$3,success_message=$4,updated_at=$5 WHERE form_id=$6",
      [title, enabled, submitLabel, successMessage, now(), formId]);
    res.json({ item: await getForm(formId) });
  } catch (error) { res.status(400).json({ error: error.message }); }
}));
app.get("/api/admin/settings", requireAdmin, asyncRoute(async (_req, res) => res.json(await getSettings())));
app.put("/api/admin/settings", checkOrigin, requireAdmin, asyncRoute(async (req, res) => {
  try {
    const settings = validateSettings(req.body || {}), timestamp = now();
    for (const [key, value] of Object.entries(settings)) {
      await pool.query("INSERT INTO site_settings(key,value,updated_at) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at", [key, value, timestamp]);
    }
    res.json(await getSettings());
  } catch (error) { res.status(400).json({ error: error.message }); }
}));

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") return jsonError(res, 413, "Запрос слишком большой.");
  if (error instanceof SyntaxError && "body" in error) return jsonError(res, 400, "Некорректный JSON.");
  console.error("[SKOL Vercel API]", error?.message || "Unknown server error");
  if (!res.headersSent) res.status(500).json({ error: error.message && error.message.startsWith("Не настроена база") ? error.message : "Внутренняя ошибка сервера. Проверьте настройки базы данных и переменные окружения." });
});

export default app;
