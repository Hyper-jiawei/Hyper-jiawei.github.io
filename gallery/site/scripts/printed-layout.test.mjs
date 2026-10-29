import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composePrinted } from '../src/lib/printed-layout.ts';

const landscape = { width: 557, height: 376, caption: 32 };
const portrait = { width: 376, height: 557, caption: 48 };
function check(items, available, scale) {
  const plan = composePrinted(items, available, scale);
  assert.equal(plan.items.length, items.length);
  for (let i = 0; i < plan.items.length; i++) {
    const placed = plan.items[i];
    assert.ok(placed.x >= -.01, `negative x at ${i}`);
    assert.ok(placed.x + placed.width <= available + .01, `overflow at ${i}, width ${available}`);
    assert.ok(placed.width > 0 && placed.height > 0);
    assert.ok(Math.abs(placed.width / items[i].width - plan.scale) < .0001, 'every card uses the same scale');
    assert.ok(placed.width <= items[i].width * scale + .01, 'prints never enlarge to fill gaps');
    assert.ok(placed.y + placed.height <= plan.height + .01, 'sheet includes captions');
    for (const other of plan.items.slice(0, i)) {
      const intersects = placed.x < other.x + other.width - .01 && placed.x + placed.width > other.x + .01 &&
        placed.y < other.y + other.height - .01 && placed.y + placed.height > other.y + .01;
      assert.equal(intersects, false, `overlap at ${i}`);
    }
    if (i) assert.ok(placed.row >= plan.items[i - 1].row, 'source/reading order is preserved');
  }
  return plan;
}

test('two landscape prints share a row when their actual widths fit', () => {
  const plan = check([landscape, landscape], 1200, 1);
  assert.equal(plan.rows, 1);
  assert.equal(plan.items[0].width, 557);
  assert.notEqual(plan.items[0].y, plan.items[1].y);
});

test('narrow windows keep horizontal/vertical relative sizes and do not overflow', () => {
  for (const width of [180, 284, 339, 400, 600, 768, 900]) {
    const plan = check([landscape, portrait, portrait, landscape], width, 1.15);
    assert.ok(Math.abs(plan.items[0].width / plan.items[1].width - 557 / 376) < .0001);
  }
});

test('single-card rows alternate positions rather than repeating one rigid column', () => {
  const plan = check([portrait, portrait, landscape, portrait], 600, 1);
  assert.ok(new Set(plan.items.map(item => item.x)).size > 1);
});

test('layout is deterministic, bounded, and handles unusual paper sizes', () => {
  const sizes = [
    { width: 940, height: 220, caption: 70 },
    { width: 190, height: 820, caption: 90 },
    { width: 300, height: 300, caption: 30 },
    { width: 610, height: 430, caption: 120 },
  ];
  for (const width of [284, 700, 1000, 1600, 2300]) {
    const plan = check(sizes, width, 1.5);
    assert.deepEqual(plan, composePrinted(sizes, width, 1.5));
  }
  assert.deepEqual(composePrinted([], 1000).items, []);
  assert.deepEqual(composePrinted([landscape], 0).items, []);
});

test('134 mixed-size prints fit across phones, breakpoint edges, monitors, and density scales', () => {
  // Same large-sheet regression without importing the previous author's photographs.
  const sizes = Array.from({ length: 134 }, (_, i) => ({
    width: i % 3 === 0 ? 376 : 557,
    height: i % 3 === 0 ? 557 : 376,
    caption: i % 3 === 0 ? 70 : 32,
  }));
  for (const viewport of [320, 360, 375, 440, 600, 768, 899, 900, 901, 960, 1024, 1280, 1440, 1920, 2560]) {
    const gutter = Math.min(72, Math.max(18, viewport * .045));
    const width = Math.min(2000, viewport) - 2 * gutter;
    for (const scale of [.85, 1, 1.145, 1.5]) check(sizes, width, scale);
  }
});
