import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test("SKOL CMS protects admin routes and stores public leads/content", { timeout: 45000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skol-cms-test-"));
  const port = await getFreePort();
  const base = "http://127.0.0.1:" + port;
  const username = "cms-test-admin";
  const password = "test-password-longer-than-fourteen";
  const sessionSecret = "test-session-secret-long-enough-for-automated-check";
  let stderr = "";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      ADMIN_USERNAME: username,
      ADMIN_PASSWORD: password,
      SESSION_SECRET: sessionSecret,
      DATA_DIR: directory
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  let cookie = "";
  const request = (url, options = {}) => fetch(base + url, options);
  const adminRequest = (url, options = {}) => {
    const headers = { ...(options.headers || {}), Cookie: cookie };
    return request(url, { ...options, headers });
  };
  const jsonBody = body => ({ "Content-Type": "application/json", Origin: base, ...body });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null) throw new Error("Server exited before ready. " + stderr);
      try {
        const response = await request("/api/health");
        if (response.ok && (await response.json()).ok) { ready = true; break; }
      } catch {}
      await pause(100);
    }
    assert.equal(ready, true, "Server did not start. " + stderr);

    const protectedResponse = await request("/api/admin/dashboard");
    assert.equal(protectedResponse.status, 401, "Admin API must reject anonymous requests");

    const wrongLogin = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ username, password: "wrong-password" })
    });
    assert.equal(wrongLogin.status, 401, "Wrong credentials must not create a session");

    const login = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ username, password })
    });
    assert.equal(login.status, 200, "Valid administrator credentials should create a session");
    cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    assert.match(cookie, /^skol\.sid=/, "Session cookie should be issued");
    assert.equal((await adminRequest("/api/admin/dashboard")).status, 200);

    const services = await (await request("/api/public/content?type=service")).json();
    assert.equal(services.items.length, 4, "Initial service catalog should be seeded once");
    assert.ok(services.items.some(item => item.slug === "demolition"));

    const badOrigin = await request("/api/public/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.invalid" },
      body: JSON.stringify({ name: "Тест", contact: "@test", formId: "main-contact" })
    });
    assert.equal(badOrigin.status, 403, "Cross-origin lead submissions should be rejected");

    const leadResponse = await request("/api/public/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({
        formId: "main-contact", name: "Тестовая заявка", contact: "test@example.com",
        service: "Демонтаж", area: "120", timeline: "В течение месяца", message: "Интеграционный тест"
      })
    });
    assert.equal(leadResponse.status, 201, "Valid public lead should be stored");
    const leadResult = await leadResponse.json();
    assert.match(leadResult.reference, /^SK-/);
    const leads = await (await adminRequest("/api/admin/leads")).json();
    assert.ok(leads.items.some(item => item.contact === "test@example.com"));

    const disableForm = await adminRequest("/api/admin/forms/main-contact", {
      method: "PUT",
      headers: jsonBody({}),
      body: JSON.stringify({
        enabled: false, title: "Заявка с главной страницы",
        submitLabel: "Отправить заявку", successMessage: "Тест"
      })
    });
    assert.equal(disableForm.status, 200);
    const disabledSubmission = await request("/api/public/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ formId: "main-contact", name: "Тестовая заявка", contact: "test@example.com" })
    });
    assert.equal(disabledSubmission.status, 403, "Disabled forms must reject server-side submissions");

    const restoreForm = await adminRequest("/api/admin/forms/main-contact", {
      method: "PUT",
      headers: jsonBody({}),
      body: JSON.stringify({
        enabled: true, title: "Заявка с главной страницы",
        submitLabel: "Отправить заявку", successMessage: "Заявка получена"
      })
    });
    assert.equal(restoreForm.status, 200);

    const createArticle = await adminRequest("/api/admin/content", {
      method: "POST",
      headers: jsonBody({}),
      body: JSON.stringify({
        type: "article", title: "Тестовая публикация", slug: "test-publication",
        excerpt: "Краткое тестовое описание", body: "Первый абзац.\\n\\nВторой абзац.",
        category: "Практика", status: "published", featured: false
      })
    });
    assert.equal(createArticle.status, 201, "Admin should publish content");
    const publicArticles = await (await request("/api/public/content?type=article")).json();
    assert.ok(publicArticles.items.some(item => item.slug === "test-publication"));
    const publicArticle = await request("/api/public/content/test-publication?type=article");
    assert.equal(publicArticle.status, 200);
    assert.equal((await publicArticle.json()).title, "Тестовая публикация");

    const invalidMedia = await adminRequest("/api/admin/content", {
      method: "POST",
      headers: jsonBody({}),
      body: JSON.stringify({
        type: "project", title: "Unsafe URL sample", slug: "unsafe-url",
        coverImage: "javascript:alert(1)", status: "draft"
      })
    });
    assert.equal(invalidMedia.status, 400, "Unsafe media URL protocols must be rejected");

    for (const privatePath of ["/server.js", "/package.json", "/node_modules/better-sqlite3/package.json"]) {
      const response = await request(privatePath);
      assert.equal(response.status, 404, "Private runtime path should not be statically served: " + privatePath);
    }

    const logout = await adminRequest("/api/auth/logout", {
      method: "POST",
      headers: { Origin: base }
    });
    assert.equal(logout.status, 200);
    const afterLogout = await adminRequest("/api/admin/dashboard");
    assert.equal(afterLogout.status, 401, "Admin session should be revoked after logout");
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise(resolve => child.once("exit", resolve)),
      pause(3000)
    ]);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});