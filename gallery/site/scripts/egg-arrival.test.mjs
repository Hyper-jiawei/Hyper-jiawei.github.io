import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const source = await fs.readFile(new URL('../src/lib/egg-arrival.js', import.meta.url), 'utf8');
function arrival({ pending = true, reduced = false } = {}) {
  const classes = new Set(pending ? ['is-celebrating'] : []);
  const layers = [];
  const timers = new Map();
  let clock = 0, next = 0;
  const root = { classList: {
    contains: (name) => classes.has(name),
    add: (...names) => names.forEach((name) => classes.add(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name)),
  } };
  const element = () => ({
    children: [], style: { setProperty() {} }, setAttribute() {},
    append(child) { this.children.push(child); },
    remove() { const index = layers.indexOf(this); if (index >= 0) layers.splice(index, 1); },
  });
  const document = Object.assign(new EventTarget(), {
    documentElement: root,
    createElement: element,
    body: { append: (node) => layers.push(node) },
    querySelector: () => layers[0],
  });
  // There is deliberately no router, client module, or DOMContentLoaded event.
  vm.runInNewContext(source, {
    document, innerWidth: 1440, innerHeight: 1000,
    matchMedia: () => ({ matches: reduced }),
    setTimeout: (fn, delay) => { timers.set(++next, { fn, at: clock + delay }); return next; },
    clearTimeout: (id) => timers.delete(id),
  });
  return {
    classes, layers, timers,
    async advance(ms) {
      clock += ms;
      for (const [id, timer] of timers) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
      await Promise.resolve();
    },
    leave() { document.dispatchEvent(new Event('astro:before-swap')); },
  };
}

test('egg arrival plays all original particles before any external module loads', async () => {
  const page = arrival();
  assert.equal(page.layers.length, 1);
  const particles = page.layers[0].children;
  assert.equal(particles.filter((p) => p.className === 'egg-burst-ribbon').length, 26);
  assert.equal(particles.filter((p) => p.className === 'egg-burst-confetti').length, 22);
  assert.equal(particles.filter((p) => p.className === 'egg-burst-glow').length, 1);
  await page.advance(1499);
  assert.ok(page.classes.has('is-celebrating'));
  await page.advance(1);
  assert.equal(page.layers.length, 0);
  assert.ok(!page.classes.has('is-celebrating'));
  assert.ok(page.classes.has('is-revealing'));
  await page.advance(1600);
  assert.ok(!page.classes.has('is-revealing'));
});

test('direct visits do not celebrate and reduced motion still reveals the page', async () => {
  const direct = arrival({ pending: false });
  assert.equal(direct.layers.length, 0);
  assert.equal(direct.timers.size, 0);
  const reduced = arrival({ reduced: true });
  await reduced.advance(0);
  assert.equal(reduced.layers.length, 0);
  assert.ok(!reduced.classes.has('is-celebrating'));
  await reduced.advance(1600);
  assert.ok(!reduced.classes.has('is-revealing'));
});

test('leaving during a burst or reveal cannot affect the next page', async () => {
  for (const duringReveal of [false, true]) {
    const page = arrival();
    if (duringReveal) await page.advance(1500);
    page.leave();
    assert.equal(page.layers.length, 0);
    assert.equal(page.classes.size, 0);
    await page.advance(10000);
    assert.equal(page.classes.size, 0);
  }
});
