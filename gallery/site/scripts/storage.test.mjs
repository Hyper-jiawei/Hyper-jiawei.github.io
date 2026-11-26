import test from 'node:test';
import assert from 'node:assert/strict';
import { load, dump, CORE_SCHEMA } from 'js-yaml';
import { listAlbums, loadAlbum, editConfig, publishAlbum, updateAlbum, deleteAlbum, readPhotoBlob, SETTINGS } from '../public/publish/storage.mjs';
import { FakeBucket, server } from './r2-harness.mjs';

const yaml = text => load(text, { schema: CORE_SCHEMA });
const config = (metadata, body = '\n\nOriginal **Markdown**.\n') => '---\n' + dump(metadata) + '---' + body;
const metadata = {
  title: 'Trip', date: '2026-11-02', categories: ['Travel'], description: 'Original', layout: 'actual', featured: true, private: true, showPalette: true,
  custom: { nested: ['x', false] }, params: { size: '10cm', secret: 12 },
  resources: [{ src: 'a.jpg', name: 'original name', customResource: 7, params: { cover: true, featured: 3, description: 'First', captureDate: '2020-02-03', size: '12cm', hidden: false, extra: { a: 1 } } }, { src: 'b.jpg', params: { featured: false, hidden: true, description: 'Second' } }],
};
const albumFiles = extra => ({
  'albums/trip/index.md': config(metadata), 'albums/trip/a.jpg': 'original A', 'albums/trip/b.jpg': 'original B',
  'albums/trip/feature 中文 photo.jpg': 'original C', 'albums/trip/notes.txt': 'keep notes', 'albums/trip/nested/keep.txt': 'unrelated album file',
  'albums/trip-other/index.md': config({ title: 'Sibling', date: '2026-11-03' }), ...extra,
});
function mainBucket(extra = {}) { const bucket = new FakeBucket(); bucket.seed(albumFiles(extra)); return bucket; }
async function editingFor(bucket, slug = 'trip') {
  const s = server(bucket);
  const list = await listAlbums(s.api, yaml);
  const editing = await loadAlbum(s.api, list.albums.find(a => a.slug === slug), yaml);
  return { s, list, editing };
}
const parseConfig = text => yaml(text.match(/^---\n([\s\S]*?)\n---/)[1]);
const newPhoto = (file = 'new photo 中文.jpg') => ({ file, blob: new Blob(['NEW ORIGINAL']), date: '2026-11-01', description: 'New', cover: false, featured: true, params: { size: '6cm' } });

test('listing preserves dates and titles, skips drafts and nested configs, orders date then title', async () => {
  const bucket = mainBucket({ 'albums/z/index.md': config({ title: 'Zed', date: '2026-11-03' }), 'albums/missing/index.md': config({ title: 'Missing' }), 'albums/draft/index.md': config({ title: 'Draft', draft: true }), 'albums/trip/nested/index.md': config({ title: 'Not an album' }) });
  const s = server(bucket);
  const list = await listAlbums(s.api, yaml);
  assert.deepEqual(list.albums.map(a => [a.slug, a.title, a.date]), [['trip-other', 'Sibling', '2026-11-03'], ['z', 'Zed', '2026-11-03'], ['trip', 'Trip', '2026-11-02'], ['missing', 'Missing', '']]);
  assert.equal(list.settings, SETTINGS);
  assert.ok(list.albums.every(a => /^"[a-f0-9]{32}"$/.test(a.etag)));
  await s.settle();
});

test('loading includes unlisted Unicode photos without downloading originals', async () => {
  const bucket = mainBucket(), { s, editing } = await editingFor(bucket);
  assert.deepEqual(editing.photos.map(p => p.file), ['a.jpg', 'b.jpg', 'feature 中文 photo.jpg']);
  assert.equal(editing.photos.filter(p => p.cover).length, 1);
  assert.equal(editing.photos[0].featured, 3); assert.equal(editing.photos[1].featured, false);
  assert.equal(editing.photos[1].params.hidden, true);
  assert.equal(editing.album.dateSource, 'published');
  assert.equal(editing.body, '\n\nOriginal **Markdown**.\n');
  assert.ok(bucket.calls.every(c => c.method !== 'GET' || !/\.jpg$/.test(c.key)));
  await s.settle();
});

test('config edits preserve body, unknown metadata, resource extras and params without mutation', async () => {
  const { s, editing } = await editingFor(mainBucket()), before = structuredClone(editing.metadata);
  const album = { ...editing.album, categories: ['Changed'], description: 'Edited', showPalette: false };
  const result = editConfig(editing, album, editing.photos, dump), parsed = parseConfig(result);
  assert.equal(parsed.layout, 'actual'); assert.equal(parsed.featured, true); assert.equal(parsed.private, true);
  assert.deepEqual(parsed.custom, metadata.custom); assert.deepEqual(parsed.params, metadata.params);
  assert.deepEqual(parsed.categories, ['Changed']); assert.equal(parsed.description, 'Edited'); assert.equal(parsed.showPalette, false);
  assert.equal(parsed.resources[0].customResource, 7); assert.equal(parsed.resources[0].name, 'original name');
  assert.equal(parsed.resources[0].params.featured, 3); assert.equal(parsed.resources[1].params.featured, false);
  assert.deepEqual(parsed.resources[0].params.extra, { a: 1 }); assert.equal(parsed.resources[0].params.size, '12cm');
  assert.equal(parsed.resources[0].params.captureDate, '2020-02-03'); assert.equal(parsed.resources[1].params.hidden, true);
  assert.ok(result.endsWith(editing.body)); assert.deepEqual(editing.metadata, before);
  await s.settle();
});

test('publishing a new album uploads originals then creates the config with If-Match * and triggers one rebuild', async () => {
  const bucket = new FakeBucket(), s = server(bucket);
  const album = { title: '手机一辑', slug: '2026-11-02-phone', date: '2026-11-02', categories: [], description: '' };
  const photo = { file: '一张.HEIC', blob: new Blob(['camera original']), description: '', cover: true };
  const result = await publishAlbum(s.api, album, [photo], false, () => {}, dump);
  assert.equal(result.slug, album.slug); assert.match(result.etag, /^"[a-f0-9]{32}"$/);
  assert.equal(bucket.text('albums/2026-11-02-phone/一张.HEIC'), 'camera original');
  assert.ok(bucket.text('albums/2026-11-02-phone/index.md').startsWith('---\n'));
  const writes = bucket.writes();
  assert.deepEqual(writes.map(c => c.method), ['PUT', 'PUT']);
  assert.equal(writes[1].options.onlyIf.etagDoesNotMatch, '*');
  await s.settle(); assert.equal(s.hooks.length, 1); assert.equal(s.hooks[0].options.method, 'POST');
});

test('same-name album refuses without the update flag before any upload, and updates with the loaded etag', async () => {
  const bucket = mainBucket(), s = server(bucket);
  const album = { title: 'Trip', slug: 'trip', date: '2026-11-02', categories: [], description: '' };
  const photo = { file: 'fresh.jpg', blob: new Blob(['fresh']), description: '', cover: true };
  bucket.calls = [];
  await assert.rejects(publishAlbum(s.api, album, [photo], false, () => {}, dump), /同名专辑已存在/);
  assert.equal(bucket.writes().length, 0);
  const current = bucket.objects.get('albums/trip/index.md').etag;
  await publishAlbum(s.api, album, [photo], true, () => {}, dump);
  const configWrite = bucket.writes().find(c => c.key === 'albums/trip/index.md');
  assert.equal(configWrite.options.onlyIf.etagMatches, current);
  await s.settle();
});

test('update uploads only new originals, commits config before deleting removed ones, keeps unrelated files', async () => {
  const bucket = mainBucket(), { s, editing } = await editingFor(bucket);
  bucket.calls = [];
  const photos = [editing.photos[0], newPhoto()];
  const result = await updateAlbum(s.api, editing, editing.album, photos, () => {}, dump);
  assert.equal(result.removed, 2);
  assert.equal(bucket.text('albums/trip/a.jpg'), 'original A');
  assert.equal(bucket.text('albums/trip/new photo 中文.jpg'), 'NEW ORIGINAL');
  assert.equal(bucket.text('albums/trip/b.jpg'), undefined);
  assert.equal(bucket.text('albums/trip/feature 中文 photo.jpg'), undefined);
  assert.equal(bucket.text('albums/trip/notes.txt'), 'keep notes');
  assert.equal(bucket.text('albums/trip/nested/keep.txt'), 'unrelated album file');
  assert.ok(bucket.text('albums/trip-other/index.md'));
  const writes = bucket.writes();
  assert.deepEqual(writes.map(c => c.method + ' ' + (c.key ?? c.keys[0]).replace('albums/trip/', '')), ['PUT new photo 中文.jpg', 'PUT index.md', 'DELETE b.jpg', 'DELETE feature 中文 photo.jpg']);
  assert.equal(writes[1].options.onlyIf.etagMatches, editing.album.etag);
  await s.settle(); assert.equal(s.hooks.length, 1);
});

test('removed cover must be corrected; empty albums and immutable date/slug/title rejected without writes', async () => {
  const bucket = mainBucket(), { s, editing } = await editingFor(bucket);
  const remaining = editing.photos.slice(2).map(p => ({ ...p }));
  bucket.calls = [];
  await assert.rejects(updateAlbum(s.api, editing, editing.album, remaining, undefined, dump), /封面/);
  remaining[0].cover = true;
  assert.equal(parseConfig(editConfig(editing, editing.album, remaining, dump)).resources[0].params.cover, true);
  await assert.rejects(updateAlbum(s.api, editing, editing.album, [], undefined, dump), /选择照片/);
  assert.throws(() => editConfig(editing, { ...editing.album, date: '2026-11-04' }, editing.photos, dump), /不能改变/);
  assert.throws(() => editConfig(editing, { ...editing.album, slug: 'other' }, editing.photos, dump), /不能改变/);
  await assert.rejects(updateAlbum(s.api, editing, { ...editing.album, title: 'Changed' }, editing.photos, undefined, dump), /标题不能改变/);
  assert.equal(bucket.writes().length, 0);
  await updateAlbum(s.api, editing, editing.album, remaining, undefined, dump);
  await s.settle();
});

test('stale config etag stops the update before any deletion; stale list entry cannot load silently', async () => {
  const bucket = mainBucket(), { s, list, editing } = await editingFor(bucket);
  bucket.bump('albums/trip/index.md');
  bucket.calls = [];
  await assert.rejects(updateAlbum(s.api, editing, editing.album, [editing.photos[0], newPhoto()], undefined, dump), /其他设备修改/);
  assert.ok(bucket.text('albums/trip/b.jpg')); assert.ok(bucket.text('albums/trip/feature 中文 photo.jpg'));
  assert.equal(bucket.writes().filter(c => c.method === 'DELETE').length, 0);
  await assert.rejects(loadAlbum(s.api, list.albums.find(a => a.slug === 'trip'), yaml), /刷新专辑列表/);
  await s.settle();
});

test('config etag changing between load and commit prevents overwriting another device', async () => {
  const bucket = mainBucket(), { s, editing } = await editingFor(bucket);
  bucket.hook = (method, key) => { if (method === 'PUT' && key === 'albums/trip/index.md') { bucket.hook = null; bucket.bump('albums/trip/index.md'); } };
  await assert.rejects(updateAlbum(s.api, editing, editing.album, [editing.photos[0]], undefined, dump), /其他设备修改/);
  assert.ok(bucket.text('albums/trip/b.jpg'));
  await s.settle();
});

test('delete removes the whole album prefix but no sibling; stale etag deletes nothing', async () => {
  const bucket = mainBucket(), { s, editing } = await editingFor(bucket);
  bucket.calls = [];
  const result = await deleteAlbum(s.api, editing);
  assert.equal(result.deleted, 6);
  assert.ok([...bucket.objects.keys()].every(k => !k.startsWith('albums/trip/')));
  assert.ok(bucket.text('albums/trip-other/index.md'));
  await s.settle(); assert.equal(s.hooks.length, 1);
  const second = await editingFor(bucket, 'trip-other');
  second.s.env.BUCKET.bump('albums/trip-other/index.md');
  await assert.rejects(deleteAlbum(second.s.api, second.editing), /其他设备修改/);
  assert.ok(second.s.env.BUCKET.text('albums/trip-other/index.md'));
  await second.s.settle();
});

test('forged descriptors, targets and slugs reject before any request', async () => {
  const bucket = mainBucket(), { s, list, editing } = await editingFor(bucket);
  const original = editing.photos[0];
  bucket.calls = [];
  for (const photo of [{ ...original, remote: { ...original.remote, etag: '"f'.padEnd(33, 'f') + '"' } }, { ...original, remote: { ...original.remote, size: 999 } }, { ...original, file: 'other.jpg' }, { ...original, file: '../a.jpg' }, { ...original, blob: new Blob(['injection']) }]) {
    await assert.rejects(updateAlbum(s.api, editing, editing.album, [photo], undefined, dump));
    await assert.rejects(readPhotoBlob(s.api, editing, photo));
  }
  const forged = { ...editing, album: { ...editing.album, slug: '../trip' } };
  await assert.rejects(deleteAlbum(s.api, forged), /目标/);
  await assert.rejects(deleteAlbum(s.api, { settings: SETTINGS, album: { ...list.albums.find(a => a.slug === 'trip') } }), /目标/);
  assert.equal(bucket.calls.length, 0);
  await s.settle();
});

test('malformed front matter, unsafe slugs and duplicate cloud photos fail the whole list', async () => {
  for (const [key, text] of [['albums/trip/index.md', '---\ntitle: [\n---\n'], ['albums/trip/index.md', '---\n- scalar\n---\n'], ['albums/trip/index.md', 'no front matter']]) {
    const bucket = new FakeBucket(); bucket.seed({ [key]: text });
    const s = server(bucket);
    await assert.rejects(listAlbums(s.api, yaml));
    await s.settle();
  }
  const dup = new FakeBucket();
  dup.seed(albumFiles());
  dup.objects.set('albums/trip/a.jpg', { bytes: Buffer.from('x'), etag: 'bad', contentType: 'application/octet-stream' });
  const s = server(dup);
  await assert.rejects(listAlbums(s.api, yaml), /etag/);
  await s.settle();
});

test('Unicode slugs publish, load and update end to end', async () => {
  const bucket = new FakeBucket(), s = server(bucket);
  const album = { title: '旅行', slug: '2026-11-02-旅行', date: '2026-11-02', categories: [], description: '' };
  await publishAlbum(s.api, album, [{ file: '照片.jpg', blob: new Blob(['original']), description: '', cover: true }], false, () => {}, dump);
  const { editing } = await editingFor(bucket, '2026-11-02-旅行');
  await updateAlbum(s.api, editing, editing.album, editing.photos, undefined, dump);
  assert.equal(bucket.text('albums/2026-11-02-旅行/照片.jpg'), 'original');
  await s.settle();
});

test('effective cover matches build ordering and resolves multiple cover flags to exactly one', async () => {
  for (const resources of [[], [{ src: 'b.jpg', params: { cover: true } }, { src: 'a.jpg', params: { cover: true } }]]) {
    const bucket = mainBucket({ 'albums/trip/index.md': config({ title: 'Trip', date: '2026-11-02', resources }) });
    const { s, editing } = await editingFor(bucket);
    assert.deepEqual(editing.photos.filter(p => p.cover).map(p => p.file), [resources.length ? 'b.jpg' : 'feature 中文 photo.jpg']);
    const parsed = parseConfig(editConfig(editing, editing.album, editing.photos, dump));
    assert.equal(parsed.resources.filter(r => r.params.cover).length, 1);
    await s.settle();
  }
});

test('preview downloads only the requested original and verifies its size', async () => {
  const bucket = mainBucket(), { s, editing } = await editingFor(bucket);
  const photo = editing.photos[0];
  bucket.calls = [];
  const blob = await readPhotoBlob(s.api, editing, photo);
  assert.equal(await blob.text(), 'original A'); assert.equal(blob.size, photo.remote.size);
  assert.deepEqual(bucket.calls, [{ method: 'GET', key: 'albums/trip/a.jpg' }]);
  bucket.objects.get('albums/trip/a.jpg').bytes = Buffer.from('FAKE');
  await assert.rejects(readPhotoBlob(s.api, editing, photo), /校验/);
  await s.settle();
});

test('missing client and rejected tokens fail without touching storage', async () => {
  for (const run of [() => listAlbums(null, yaml), () => loadAlbum(null, {}, yaml), () => publishAlbum(null, {}, [], false), () => updateAlbum(null, {}, {}, []), () => deleteAlbum(null, {}), () => readPhotoBlob(null, {}, {})]) await assert.rejects(run, /令牌/);
  const bucket = mainBucket(), s = server(bucket);
  const { storage } = await import('../public/publish/core.mjs');
  const wrong = storage('wrong-token', s.request);
  await assert.rejects(listAlbums(wrong, yaml), /401/);
  assert.equal(bucket.calls.length, 0);
  await s.settle();
});