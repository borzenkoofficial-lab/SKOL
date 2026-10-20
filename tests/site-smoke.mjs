import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../script.js', import.meta.url), 'utf8');

test('HTML declares Russian language and responsive viewport', () => {
  assert.match(html, /<html lang="ru">/i);
  assert.match(html, /name="viewport"[^>]*width=device-width/i);
});

test('all local stylesheet and script references exist', () => {
  assert.ok(existsSync(new URL('../styles.css', import.meta.url)));
  assert.ok(existsSync(new URL('../script.js', import.meta.url)));
  assert.match(html, /href="styles\.css"/);
  assert.match(html, /src="script\.js"/);
});

test('IDs are unique and every in-page anchor has a target', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'Duplicate HTML id found');
  const targets = new Set(ids);
  const links = [...html.matchAll(/href="#([^"]+)"/g)].map(match => match[1]);
  const missing = links.filter(id => !targets.has(id));
  assert.deepEqual(missing, [], `Missing in-page targets: ${missing.join(', ')}`);
});

test('contact form has required fields and explicit mailto delivery behavior', () => {
  assert.match(html, /id="contact-form"/);
  assert.match(html, /name="name"[^>]*required/);
  assert.match(html, /name="contact"[^>]*required/);
  assert.match(js, /mailto:borzenko\.official@yandex\.ru/);
  assert.match(html, /серверная отправка пока не подключена/i);
});

test('motion preferences and mobile navigation are supported', () => {
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.nav\.open/);
  assert.match(js, /aria-expanded/);
});

test('no obvious corrupted characters in asset URLs', () => {
  const urls = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map(match => match[1]);
  assert.ok(urls.every(url => !/[\uFFFD\u4E00-\u9FFF]/u.test(url)), 'Corrupted character found in URL');
});
