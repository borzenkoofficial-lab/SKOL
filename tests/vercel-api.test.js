import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

test("Vercel API health reports database configuration accurately", { timeout: 10000 }, async t => {
  const { default: app } = await import("../api/[...path].js");
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => server.close(() => resolve())));

  const address = server.address();
  const response = await fetch("http://127.0.0.1:" + address.port + "/api/health");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.app, "skol-site");
  assert.equal(body.auth, "server-side");
  assert.equal(typeof body.databaseConfigured, "boolean");
  assert.equal(body.ok, body.databaseConfigured);
  assert.ok(["postgres", "unconfigured"].includes(body.storage));
});
