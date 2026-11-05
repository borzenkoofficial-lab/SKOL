import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsPath = path.join(root, 'skol-motion.js');
const cssPath = path.join(root, 'skol-motion.css');
const htmlPath = path.join(root, 'index.html');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  contains(value) { return this.values.has(value); }
}
class FakeElement {
  constructor() {
    this.classList = new FakeClassList();
    this.attributes = {};
    this.listeners = {};
    this.styleValues = {};
    this.children = [];
    this.style = { setProperty: (name, value) => { this.styleValues[name] = value; } };
  }
  querySelector() { return null; }
  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  getBoundingClientRect() { return { left: 10, top: 20, width: 200, height: 100 }; }
}
function runMotion({ isHome = true, reducedMotion = false, finePointer = true } = {}) {
  const body = new FakeElement();
  const head = new FakeElement();
  const hero = isHome ? new FakeElement() : null;
  const sections = [new FakeElement(), new FakeElement()];
  const artCards = [new FakeElement()];
  let observerInstance = null;
  const rafCallbacks = [];
  const document = {
    body, head, baseURI: 'https://example.test/',
    querySelector(selector) { return selector === '.hero-premium' ? hero : null; },
    querySelectorAll(selector) {
      if (selector === '#main > section:not(.hero-premium)') return sections;
      if (selector === '.portfolio-slide-art') return artCards;
      return [];
    },
    createElement(tag) { const element = new FakeElement(); element.tagName = tag.toUpperCase(); return element; }
  };
  class FakeIntersectionObserver {
    constructor(callback, options) { this.callback = callback; this.options = options; this.observed = []; this.unobserved = []; observerInstance = this; }
    observe(element) { this.observed.push(element); }
    unobserve(element) { this.unobserved.push(element); }
    disconnect() {}
  }
  const window = {
    matchMedia(query) { return { matches: query.includes('prefers-reduced-motion') ? reducedMotion : query.includes('pointer: fine') && finePointer }; },
    requestAnimationFrame(callback) { rafCallbacks.push(callback); return rafCallbacks.length; }
  };
  vm.runInNewContext(fs.readFileSync(jsPath, 'utf8'), { document, window, IntersectionObserver: FakeIntersectionObserver, URL, console }, { filename: jsPath });
  return { body, head, hero, sections, artCards, observer: observerInstance, flushFrames() { while (rafCallbacks.length) rafCallbacks.shift()(); } };
}

test('homepage adds scoped motion styles and technical details', () => {
  const result = runMotion();
  assert.equal(result.body.classList.contains('skol-motion-home'), true);
  assert.equal(result.head.children.length, 1);
  assert.equal(result.head.children[0].href, 'https://example.test/skol-motion.css');
  assert.equal(result.hero.children.length, 1);
  assert.ok(result.sections.every(section => section.children.length === 1));
});
test('non-home pages are not modified', () => {
  const result = runMotion({ isHome: false });
  assert.equal(result.body.classList.contains('skol-motion-home'), false);
  assert.equal(result.head.children.length, 0);
  assert.equal(result.observer, null);
});
test('reduced-motion disables observer and pointer interactions', () => {
  const result = runMotion({ reducedMotion: true });
  assert.ok(result.sections.every(section => section.classList.contains('is-in-view')));
  assert.equal(result.observer, null);
  assert.equal(result.artCards[0].listeners.pointermove, undefined);
});
test('normal mode observes sections and uses pointer tracking only on portfolio artwork', () => {
  const result = runMotion();
  assert.deepEqual(result.observer.observed, result.sections);
  assert.equal(typeof result.artCards[0].listeners.pointermove, 'function');
  result.observer.callback([{ target: result.sections[0], isIntersecting: true }]);
  assert.equal(result.sections[0].classList.contains('is-in-view'), true);
  assert.deepEqual(result.observer.unobserved, [result.sections[0]]);
  result.artCards[0].listeners.pointermove({ clientX: 110, clientY: 70 });
  result.flushFrames();
  assert.equal(result.artCards[0].styleValues['--skol-focus-x'], '50.0%');
});
test('CSS respects reduced motion, touch boundaries and native view timelines', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /prefers-reduced-motion\s*:\s*reduce/);
  assert.match(css, /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/);
  assert.match(css, /@supports\s*\(animation-timeline:\s*view\(\)\)/);
  assert.match(css, /animation-timeline\s*:\s*view\(/);
});
test('homepage loads its motion script after the existing site script', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const base = html.indexOf('<script src="script.js" defer></script>');
  const motion = html.indexOf('<script src="skol-motion.js" defer></script>');
  assert.notEqual(base, -1);
  assert.ok(motion > base);
});