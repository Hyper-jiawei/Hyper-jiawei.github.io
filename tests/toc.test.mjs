import test from 'node:test';
import assert from 'node:assert/strict';
import { numberHeadings, activeHeadingIndex } from '../src/lib/toc.ts';

const heading = (depth, text) => ({ depth, text, slug: text });

test('major chapters and children have separate stable numbers', () => {
  const entries = numberHeadings([
    heading(2, 'Introduction#'), heading(3, 'Context'), heading(3, 'Scope'),
    heading(2, 'Build'), heading(3, 'Install'), heading(2, 'Finish'),
  ]);
  assert.deepEqual(entries.map(e => e.number), ['01', '01.1', '01.2', '02', '02.1', '03']);
  assert.deepEqual(entries.map(e => e.section), [1, 1, 1, 2, 2, 3]);
  assert.equal(entries[0].text, 'Introduction');
  assert.equal(entries[1].nested, true);
});

test('an outline with only h3 headings still has top-level chapters', () => {
  assert.deepEqual(numberHeadings([heading(3, 'A'), heading(3, 'B')]).map(e => e.number), ['01', '02']);
  assert.deepEqual(numberHeadings([]), []);
  assert.deepEqual(numberHeadings([heading(3, 'Preface'), heading(2, 'Main')]).map(e => e.number), ['01', '02']);
});

test('reading position covers boundaries, fast jumps and reverse scrolling', () => {
  const offsets = [200, 600, 900, 1800];
  assert.equal(activeHeadingIndex(offsets, 0), 0);
  assert.equal(activeHeadingIndex(offsets, 599), 0);
  assert.equal(activeHeadingIndex(offsets, 600), 1);
  assert.equal(activeHeadingIndex(offsets, 2500), 3);
  assert.equal(activeHeadingIndex(offsets, 700), 1);
  assert.equal(activeHeadingIndex([], 700), -1);
});

test('adjacent headings at the same position use the last heading passed', () => {
  assert.equal(activeHeadingIndex([100, 100, 200], 100), 1);
});
