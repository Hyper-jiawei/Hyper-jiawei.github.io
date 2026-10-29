import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('../src/lib/client.ts', import.meta.url), 'utf8');
const resize = source.slice(source.indexOf('  if (!printedResize) {'), source.indexOf('  festiveMark();', source.indexOf('  if (!printedResize) {')));
function harness() {
  const frames = [];
  let listener;
  let layouts = 0;
  const context = vm.createContext({
    printedResize: false, innerWidth: 1440, devicePixelRatio: 2,
    addEventListener: (type, fn) => { assert.equal(type, 'resize'); listener = fn; },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    applySizeScale() {}, layoutPrinted: () => layouts++,
  });
  vm.runInContext(resize, context);
  return {
    resize(width, density = 2) { context.innerWidth = width; context.devicePixelRatio = density; listener(); },
    paint() { frames.splice(0).forEach(fn => fn()); },
    get pending() { return frames.length; }, get layouts() { return layouts; },
  };
}

test('resize bursts update at the next paint and keep updating throughout a drag', () => {
  const page = harness();
  page.resize(1400); page.resize(1350); page.resize(1300);
  assert.equal(page.pending, 1);
  page.paint();
  assert.equal(page.layouts, 1);
  page.resize(1200); page.paint();
  page.resize(1100); page.paint();
  assert.equal(page.layouts, 3, 'a continuous drag must not defer layout until it ends');
});

test('height-only resize does no work, while a pixel density change does', () => {
  const page = harness();
  page.resize(1440);
  assert.equal(page.pending, 0);
  page.resize(1440, 1.5); page.paint();
  assert.equal(page.layouts, 1);
});

test('returning to the previous width before painting skips redundant layout', () => {
  const page = harness();
  page.resize(1300); page.resize(1440); page.paint();
  assert.equal(page.layouts, 0);
});
