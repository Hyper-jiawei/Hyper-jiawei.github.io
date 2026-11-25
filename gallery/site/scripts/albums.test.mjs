import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { load, dump, CORE_SCHEMA } from 'js-yaml';
import { listAlbums, loadAlbum, editConfig, updateAlbum, deleteAlbum, readPhotoBlob } from '../public/publish/albums.mjs';
import { MAIN_BUDGET } from '../public/publish/core.mjs';

const yaml = text => load(text, { schema: CORE_SCHEMA });
const MAIN = 'User/site', ARCHIVE = 'User/originals', PREFIX = 'gallery/content/trip/';
const values = { repository: MAIN };
const hash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const bytes = value => Buffer.isBuffer(value) ? value : Buffer.from(value);
const config = (metadata, body = '\n\nOriginal **Markdown**.\n') => '---\n' + dump(metadata) + '---' + body;
const metadata = {
  title: 'Trip', date: '2026-11-02', categories: ['Travel'], description: 'Original', layout: 'actual', featured: true, private: true, showPalette: true,
  custom: { nested: ['x', false] }, params: { size: '10cm', secret: 12 },
  resources: [{ src: 'a.jpg', name: 'original name', customResource: 7, params: { cover: true, featured: 3, description: 'First', captureDate: '2020-02-03', size: '12cm', hidden: false, extra: { a: 1 } } }, { src: 'b.jpg', params: { featured: false, hidden: true, description: 'Second' } }],
};

class Git {
  constructor() { this.repos = new Map(); this.calls = []; this.serial = 0; this.hook = null; }
  id() { return createHash('sha1').update('fake-object-' + ++this.serial).digest('hex'); }
  add(repo, files, branch = 'main') {
    const state = { branch, blobs: new Map(), trees: new Map(), commits: new Map(), readonly: false, push: true, private: false };
    const tree = [];
    for (const [path, content] of Object.entries(files)) {
      const data = bytes(content), sha = hash(data);
      state.blobs.set(sha, data);
      tree.push({ path, sha, size: data.length, mode: '100644', type: 'blob' });
    }
    const treeSha = this.id(), commit = this.id();
    state.trees.set(treeSha, tree); state.commits.set(commit, { sha: commit, tree: { sha: treeSha }, parents: [] }); state.head = commit;
    this.repos.set(repo, state); return state;
  }
  tree(repo, commit = this.repos.get(repo).head) {
    const state = this.repos.get(repo); return state.trees.get(state.commits.get(commit).tree.sha);
  }
  content(repo, path, commit) {
    const entry = this.tree(repo, commit).find(e => e.path === path);
    return entry && this.repos.get(repo).blobs.get(entry.sha).toString();
  }
  bump(repo) {
    const state = this.repos.get(repo), old = state.head, sha = this.id();
    state.commits.set(sha, { ...state.commits.get(old), sha, parents: [{ sha: old }] }); state.head = sha;
  }
  api = async (method, path, body) => {
    this.calls.push({ method, path, body: structuredClone(body) });
    if (this.hook) await this.hook(method, path, body);
    const match = path.match(/^\/repos\/([^/]+\/[^/]+)(.*)$/);
    assert.ok(match, 'Only authenticated repository Git endpoints allowed: ' + path);
    const [, repo, route] = match, state = this.repos.get(repo);
    if (!state) throw Error('GitHub 404 Contents access');
    if (method === 'GET' && route === '') return { full_name: repo, default_branch: state.branch, private: state.private, permissions: { push: state.push } };
    if (method !== 'GET' && state.readonly) throw Error('GitHub 403 Contents: Read and write');
    if (method === 'GET' && route.startsWith('/git/ref/heads/')) {
      assert.equal(decodeURIComponent(route.slice('/git/ref/heads/'.length)), state.branch);
      return { object: { sha: state.head } };
    }
    if (method === 'GET' && route.startsWith('/git/commits/')) {
      const result = state.commits.get(route.slice('/git/commits/'.length)); if (!result) throw Error('Missing pinned commit'); return structuredClone(result);
    }
    if (method === 'GET' && route.startsWith('/git/trees/')) {
      const tree = state.trees.get(route.slice('/git/trees/'.length).split('?')[0]); if (!tree) throw Error('Missing tree'); return { tree: structuredClone(tree), truncated: false };
    }
    if (method === 'GET' && route.startsWith('/git/blobs/')) {
      const sha = route.slice('/git/blobs/'.length), data = state.blobs.get(sha); if (!data) throw Error('Missing blob');
      return { sha, size: data.length, encoding: 'base64', content: data.toString('base64') };
    }
    if (method === 'POST' && route === '/git/blobs') {
      const data = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8'), sha = hash(data); state.blobs.set(sha, data); return { sha };
    }
    if (method === 'POST' && route === '/git/trees') {
      const map = new Map(state.trees.get(body.base_tree).map(e => [e.path, { ...e }]));
      assert.equal(new Set(body.tree.map(e => e.path)).size, body.tree.length, 'No duplicate tree operations');
      for (const entry of body.tree) {
        if (entry.sha === null) map.delete(entry.path);
        else { assert.ok(state.blobs.has(entry.sha), 'Tree must use an existing blob'); map.set(entry.path, { ...entry, size: state.blobs.get(entry.sha).length }); }
      }
      const sha = this.id(); state.trees.set(sha, [...map.values()]); return { sha };
    }
    if (method === 'POST' && route === '/git/commits') {
      assert.ok(state.trees.has(body.tree));
      const sha = this.id(); state.commits.set(sha, { sha, tree: { sha: body.tree }, parents: body.parents.map(sha => ({ sha })), message: body.message }); return { sha };
    }
    if (method === 'PATCH' && route.startsWith('/git/refs/heads/')) {
      assert.equal(body.force, false); assert.deepEqual(state.commits.get(body.sha).parents, [{ sha: state.head }], 'No concurrent ref overwrite');
      state.head = body.sha; return { object: { sha: body.sha } };
    }
    throw Error('Unexpected Git call: ' + method + ' ' + path);
  };
  mutations(repo) { return this.calls.filter(c => c.method !== 'GET' && (!repo || c.path.startsWith('/repos/' + repo + '/')) && !(c.path.endsWith('/git/blobs') && c.body.content === '')); }
  downloads(repo) { return this.calls.filter(c => c.method === 'GET' && c.path.includes('/git/blobs/') && (!repo || c.path.startsWith('/repos/' + repo + '/'))); }
}
function mainGit(extra = {}) {
  const git = new Git();
  git.add(MAIN, { [PREFIX + 'index.md']: config(metadata), [PREFIX + 'a.jpg']: 'original A', [PREFIX + 'b.jpg']: 'original B', [PREFIX + 'feature 中文 photo.jpg']: 'original C', [PREFIX + 'notes.txt']: 'keep notes', [PREFIX + '_preview/abc/100.webp']: 'preview', [PREFIX + 'nested/keep.txt']: 'unrelated album file', 'gallery/content/trip-other/index.md': config({ title: 'Sibling', date: '2026-11-03' }), '.github/workflows/publish.yml': 'workflow', 'index.html': 'site', ...extra });
  return git;
}
async function editingFor(git, options = values, slug = 'trip') {
  const list = await listAlbums(git.api, options, yaml);
  return loadAlbum(git.api, list.albums.find(a => a.slug === slug), options, yaml);
}
function archived(kind = 'sources') {
  const git = new Git(), archive = git.add(ARCHIVE, { [PREFIX + 'a.jpg']: 'original A', [PREFIX + 'b.jpg']: 'original B', [PREFIX + 'feature 中文 photo.jpg']: 'original C', [PREFIX + 'index.md']: 'archive config', 'unrelated.txt': 'untouched' }, 'originals');
  const files = git.tree(ARCHIVE).filter(e => /\.jpg$/.test(e.path)).map(e => ({ name: e.path.slice(PREFIX.length), sha: e.sha, size: e.size }));
  const source = { repository: ARCHIVE, commit: archive.head, path: PREFIX, files };
  const manifest = kind === 'sources' ? source : { archive: { repository: ARCHIVE, commit: archive.head }, cover: 'a.jpg', photos: files.map((f, i) => ({ file: f.name, key: String(i).padStart(12, '0'), original: { url: `https://raw.githubusercontent.com/${ARCHIVE}/${archive.head}/${PREFIX}${encodeURIComponent(f.name)}` } })) };
  git.add(MAIN, { [PREFIX + 'index.md']: config(metadata), [PREFIX + (kind === 'sources' ? '_sources.json' : '_processed.json')]: JSON.stringify(manifest), [PREFIX + '_preview/000000000000/100.webp']: 'preview', [PREFIX + 'notes.txt']: 'notes', 'index.html': 'site' });
  return { git, source, manifest };
}
const parseConfig = text => yaml(text.match(/^---\n([\s\S]*?)\n---/)[1]);
const newPhoto = (file = 'new photo 中文.jpg') => ({ file, blob: new Blob(['NEW ORIGINAL']), date: '2026-11-01', description: 'New', cover: false, featured: true, params: { size: '6cm' } });

test('direct album listing preserves dates and titles, filters nested configs, orders date then title', async () => {
  const git = mainGit({ 'gallery/content/z/index.md': config({ title: 'Zed', date: '2026-11-03' }), 'gallery/content/missing/index.md': config({ title: 'Missing' }), 'gallery/content/trip/nested/index.md': config({ title: 'Not an album' }) });
  const list = await listAlbums(git.api, values, yaml);
  assert.deepEqual(list.albums.map(a => [a.slug, a.title, a.date]), [['trip-other', 'Sibling', '2026-11-03'], ['z', 'Zed', '2026-11-03'], ['trip', 'Trip', '2026-11-02'], ['missing', 'Missing', '']]);
  assert.equal(list.branch, 'main'); assert.ok(list.settings); assert.match(list.sha, /^[a-f0-9]{40}$/);
  assert.equal(git.downloads().length, 4);
  assert.ok(git.calls.some(c => c.method === 'POST' && c.body.content === ''));
});

test('loading descriptors includes unlisted Unicode photos without downloading originals', async () => {
  const git = mainGit(), editing = await editingFor(git);
  assert.deepEqual(editing.photos.map(p => p.file), ['a.jpg', 'b.jpg', 'feature 中文 photo.jpg']);
  assert.equal(editing.photos.filter(p => p.cover).length, 1);
  assert.equal(editing.photos[0].featured, 3); assert.equal(editing.photos[1].featured, false);
  assert.equal(editing.photos[1].params.hidden, true);
  assert.equal(editing.album.dateSource, 'published'); assert.equal(editing.source, null);
  assert.equal(editing.body, '\n\nOriginal **Markdown**.\n');
  assert.ok(git.downloads().every(c => !['original A', 'original B', 'original C'].some(value => c.path.endsWith(hash(Buffer.from(value))))));
});

test('config edits preserve body, unknown metadata, layout, album featured, resource extras and params without mutation', async () => {
  const editing = await editingFor(mainGit()), before = structuredClone(editing.metadata);
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
});

test('main edit adds/removes only scoped originals, keeps original Git blobs/history and unrelated files', async () => {
  const git = mainGit(), editing = await editingFor(git), previous = editing.sha;
  git.calls = [];
  const photos = [editing.photos[0], newPhoto()];
  const result = await updateAlbum(git.api, editing, editing.album, photos, () => {}, dump);
  assert.equal(result.repository, MAIN); assert.equal(result.branch, 'main'); assert.ok(result.actions.endsWith('/actions')); assert.ok(result.url.endsWith(result.commit));
  assert.equal(git.downloads().length, 0);
  assert.equal(git.content(MAIN, PREFIX + 'a.jpg'), 'original A'); assert.equal(git.content(MAIN, PREFIX + 'new photo 中文.jpg'), 'NEW ORIGINAL');
  assert.equal(git.content(MAIN, PREFIX + 'b.jpg'), undefined); assert.equal(git.content(MAIN, PREFIX + 'feature 中文 photo.jpg'), undefined);
  assert.equal(git.content(MAIN, PREFIX + '_preview/abc/100.webp'), undefined);
  assert.equal(git.content(MAIN, PREFIX + 'notes.txt'), 'keep notes'); assert.equal(git.content(MAIN, PREFIX + 'nested/keep.txt'), 'unrelated album file');
  assert.equal(git.content(MAIN, '.github/workflows/publish.yml'), 'workflow'); assert.equal(git.content(MAIN, 'index.html'), 'site');
  assert.equal(git.content(MAIN, PREFIX + 'b.jpg', previous), 'original B');
  assert.deepEqual(git.repos.get(MAIN).commits.get(result.commit).parents, [{ sha: previous }]);
  const uploads = git.mutations().filter(c => c.path.endsWith('/git/blobs'));
  assert.equal(uploads.length, 2); assert.ok(!uploads.some(c => c.body.content === Buffer.from('original A').toString('base64')));
});

test('removed cover must be corrected by caller; empty albums and immutable date/slug/title rejected', async () => {
  const git = mainGit(), editing = await editingFor(git), remaining = editing.photos.slice(2).map(p => ({ ...p })); git.calls = [];
  await assert.rejects(updateAlbum(git.api, editing, editing.album, remaining, undefined, dump), /封面/);
  remaining[0].cover = true;
  assert.equal(parseConfig(editConfig(editing, editing.album, remaining, dump)).resources[0].params.cover, true);
  await assert.rejects(updateAlbum(git.api, editing, editing.album, [], undefined, dump), /选择照片/);
  assert.throws(() => editConfig(editing, { ...editing.album, date: '2026-11-04' }, editing.photos, dump), /不能改变/);
  assert.throws(() => editConfig(editing, { ...editing.album, slug: 'other' }, editing.photos, dump), /不能改变/);
  await assert.rejects(updateAlbum(git.api, editing, { ...editing.album, title: 'Changed' }, editing.photos, undefined, dump), /标题不能改变/);
  assert.equal(git.mutations().length, 0);
  await updateAlbum(git.api, editing, editing.album, remaining, undefined, dump);
});

test('delete removes every exact-prefix blob but no sibling, site or workflow; history survives', async () => {
  const git = mainGit(), editing = await editingFor(git), previous = editing.sha; git.calls = [];
  const result = await deleteAlbum(git.api, editing);
  assert.ok(git.tree(MAIN).every(e => !e.path.startsWith(PREFIX)));
  assert.ok(git.content(MAIN, 'gallery/content/trip-other/index.md')); assert.equal(git.content(MAIN, '.github/workflows/publish.yml'), 'workflow');
  assert.equal(git.content(MAIN, 'index.html'), 'site'); assert.equal(git.content(MAIN, PREFIX + 'a.jpg', previous), 'original A');
  assert.equal(git.downloads().length, 0); assert.deepEqual(git.repos.get(MAIN).commits.get(result.commit).parents, [{ sha: previous }]);
});

test('missing API and read-only PAT fail without file/ref mutations even when permissions.push is true', async () => {
  const git = mainGit(), editing = await editingFor(git); git.calls = [];
  for (const run of [() => listAlbums(null, values, yaml), () => loadAlbum(null, {}, values, yaml), () => updateAlbum(null, editing, editing.album, editing.photos, undefined, dump), () => deleteAlbum(null, editing), () => readPhotoBlob(null, editing, editing.photos[0])]) await assert.rejects(run, /令牌/);
  assert.equal(git.calls.length, 0);
  git.repos.get(MAIN).readonly = true;
  await assert.rejects(listAlbums(git.api, values, yaml), /Contents/);
  const configSha = git.tree(MAIN).find(e => e.path === PREFIX + 'index.md').sha;
  await assert.rejects(loadAlbum(git.api, { slug: 'trip', configSha }, values, yaml), /Contents/);
  await assert.rejects(updateAlbum(git.api, editing, editing.album, editing.photos, undefined, dump), /Contents/);
  await assert.rejects(deleteAlbum(git.api, editing), /Contents/);
  assert.equal(git.repos.get(MAIN).head, editing.sha);
  assert.equal(git.mutations().length, 0);
});

test('stale list config cannot load silently', async () => {
  const git = mainGit(), list = await listAlbums(git.api, values, yaml), entry = list.albums.find(a => a.slug === 'trip');
  const configEntry = git.tree(MAIN).find(e => e.path === PREFIX + 'index.md'); configEntry.sha = hash(Buffer.from('new config'));
  await assert.rejects(loadAlbum(git.api, entry, values, yaml), /刷新专辑列表/);
});

test('stale main head fails before uploading or changing anything for edit and delete', async () => {
  const git = mainGit(), editing = await editingFor(git); git.bump(MAIN); const head = git.repos.get(MAIN).head; git.calls = [];
  await assert.rejects(updateAlbum(git.api, editing, editing.album, [editing.photos[0], newPhoto()], undefined, dump), /新提交/);
  await assert.rejects(deleteAlbum(git.api, editing), /新提交/);
  assert.equal(git.mutations().length, 0); assert.equal(git.repos.get(MAIN).head, head);
});

test('main head changing during detached commit prevents PATCH for update and delete', async () => {
  for (const deletion of [false, true]) {
    const git = mainGit(), editing = await editingFor(git); git.calls = [];
    git.hook = (method, path) => { if (method === 'POST' && path.endsWith('/git/commits')) { git.bump(MAIN); git.hook = null; } };
    await assert.rejects(deletion ? deleteAlbum(git.api, editing) : updateAlbum(git.api, editing, editing.album, [editing.photos[0], newPhoto()], undefined, dump), /新提交/);
    assert.ok(!git.calls.some(c => c.method === 'PATCH'));
    assert.equal(git.content(MAIN, PREFIX + 'new photo 中文.jpg'), undefined); assert.equal(git.content(MAIN, PREFIX + 'a.jpg'), 'original A');
  }
});

test('forged remote descriptors, preview targets, settings and slugs reject before requests', async () => {
  const git = mainGit(), editing = await editingFor(git), original = editing.photos[0]; git.calls = [];
  for (const photo of [{ ...original, remote: { ...original.remote, sha: 'a'.repeat(40) } }, { ...original, remote: { ...original.remote, size: 999 } }, { ...original, file: 'other.jpg' }, { ...original, file: '../a.jpg' }, { ...original, blob: new Blob(['injection']) }]) {
    await assert.rejects(updateAlbum(git.api, editing, editing.album, [photo], undefined, dump));
    await assert.rejects(readPhotoBlob(git.api, editing, photo));
  }
  const originalSettings = editing.settings;
  editing.settings = { ...editing.settings, repository: ARCHIVE };
  await assert.rejects(deleteAlbum(git.api, editing), /目标/); editing.settings = originalSettings;
  editing.album.slug = '../trip'; await assert.rejects(deleteAlbum(git.api, editing), /目标/);
  assert.equal(git.calls.length, 0);
});

test('unsafe album paths, malformed front matter and YAML types fail the whole list', async () => {
  for (const [path, text] of [['gallery/content/../index.md', config({ title: 'Bad' })], ['gallery/content/a%2fb/index.md', config({ title: 'Bad' })], ['gallery/content/trip/index.md', '---\ntitle: [\n---\n'], ['gallery/content/trip/index.md', '---\n- scalar\n---\n'], ['gallery/content/trip/index.md', '---\ntitle: !!js/function function(){}\n---\n']]) {
    const git = new Git(); git.add(MAIN, { [path]: text }); await assert.rejects(listAlbums(git.api, values, yaml));
  }
  const git = mainGit(); git.calls = [];
  await assert.rejects(listAlbums(git.api, { repository: MAIN, contentPath: 'gallery/../content' }, yaml)); assert.equal(git.calls.length, 0);
});

test('existing safe slugs broader than new publishing validator can be edited', async () => {
  const git = new Git(), prefix = 'gallery/content/Old album (中文)/';
  git.add(MAIN, { [prefix + 'index.md']: config({ title: 'Old', resources: [] }), [prefix + 'photo.jpg']: 'original' });
  const editing = await editingFor(git, values, 'Old album (中文)');
  await updateAlbum(git.api, editing, editing.album, editing.photos, undefined, dump);
  assert.ok(git.content(MAIN, prefix + 'index.md'));
});

test('_sources removal edits only main and does not require archive write; archive originals/history untouched', async () => {
  const { git, source } = archived(), editing = await editingFor(git); git.calls = [];
  git.repos.get(ARCHIVE).readonly = true; git.repos.get(ARCHIVE).push = false;
  const result = await updateAlbum(git.api, editing, editing.album, [editing.photos[0]], undefined, dump);
  const manifest = JSON.parse(git.content(MAIN, PREFIX + '_sources.json'));
  assert.equal(result.archive, ARCHIVE); assert.equal(manifest.commit, source.commit); assert.equal(manifest.files.length, 1);
  assert.equal(git.repos.get(ARCHIVE).head, source.commit); assert.equal(git.content(ARCHIVE, PREFIX + 'b.jpg'), 'original B');
  assert.ok(!git.calls.some(c => c.path.startsWith('/repos/' + ARCHIVE))); assert.equal(git.downloads().length, 0);
});

test('_sources additions write only new originals into same archive default branch, retain pinned files and never delete', async () => {
  const { git, source } = archived(), editing = await editingFor(git); git.calls = [];
  const result = await updateAlbum(git.api, editing, editing.album, [editing.photos[0], newPhoto()], undefined, dump);
  const manifest = JSON.parse(git.content(MAIN, PREFIX + '_sources.json'));
  assert.equal(manifest.repository, ARCHIVE); assert.equal(manifest.path, source.path); assert.equal(manifest.commit, git.repos.get(ARCHIVE).head);
  assert.notEqual(manifest.commit, source.commit); assert.deepEqual(manifest.files.map(f => f.name), ['a.jpg', 'new photo 中文.jpg']);
  assert.equal(result.archive, ARCHIVE); assert.equal(git.content(ARCHIVE, PREFIX + 'b.jpg'), 'original B');
  assert.equal(git.content(ARCHIVE, PREFIX + 'index.md'), 'archive config'); assert.equal(git.content(ARCHIVE, 'unrelated.txt'), 'untouched');
  assert.equal(git.content(ARCHIVE, PREFIX + 'new photo 中文.jpg'), 'NEW ORIGINAL'); assert.equal(git.content(MAIN, PREFIX + 'new photo 中文.jpg'), undefined);
  assert.ok(git.calls.some(c => c.path === '/repos/' + ARCHIVE + '/git/blobs' && c.body.content === ''));
  assert.equal(git.mutations(ARCHIVE).filter(c => c.path.endsWith('/git/blobs')).length, 1);
  assert.ok(git.mutations(ARCHIVE).filter(c => c.path.endsWith('/git/trees')).every(c => c.body.tree.every(e => e.sha !== null)));
  assert.equal(git.downloads().length, 0);
  for (const file of manifest.files) { const entry = git.tree(ARCHIVE, manifest.commit).find(e => e.path === manifest.path + file.name); assert.equal(entry.sha, file.sha); assert.equal(entry.size, file.size); }
});

test('archive additions require actual PAT write, reject missing/changed kept paths and never overwrite originals', async () => {
  for (const fault of ['readonly', 'changed-kept', 'name-conflict']) {
    const { git } = archived(), editing = await editingFor(git); git.calls = [];
    if (fault === 'readonly') git.repos.get(ARCHIVE).readonly = true;
    if (fault === 'changed-kept') { git.bump(ARCHIVE); git.tree(ARCHIVE).find(e => e.path === PREFIX + 'a.jpg').sha = 'f'.repeat(40); }
    const added = fault === 'name-conflict' ? newPhoto('b.jpg') : newPhoto();
    await assert.rejects(updateAlbum(git.api, editing, editing.album, [editing.photos[0], added], undefined, dump));
    assert.equal(git.repos.get(MAIN).head, editing.sha);
    assert.ok(!git.calls.some(c => c.method === 'PATCH')); assert.equal(git.mutations().length, 0);
  }
});

test('archive concurrent changes stop its PATCH and leave main unchanged', async () => {
  const { git } = archived(), editing = await editingFor(git); git.calls = [];
  git.hook = (method, path) => { if (method === 'POST' && path === '/repos/' + ARCHIVE + '/git/commits') { git.bump(ARCHIVE); git.hook = null; } };
  await assert.rejects(updateAlbum(git.api, editing, editing.album, [editing.photos[0], newPhoto()], undefined, dump), /新提交/);
  assert.ok(!git.calls.some(c => c.method === 'PATCH')); assert.equal(git.repos.get(MAIN).head, editing.sha);
});

test('pinned source repo/path/SHA/size/commit corruption rejects loading and public provenance cannot be changed', async () => {
  for (const corrupt of [s => s.repository = 'https://evil.invalid/repo', s => s.repository = 'User/..', s => s.path = 'gallery/../content/', s => s.commit = 'main', s => s.files[0].name = 'a%2f.jpg', s => s.files[0].sha = 'f'.repeat(40), s => s.files[0].size++, s => s.files.push({ ...s.files[0] })]) {
    const { git, source } = archived(); corrupt(source);
    const state = git.repos.get(MAIN), text = JSON.stringify(source), data = Buffer.from(text), entry = git.tree(MAIN).find(e => e.path === PREFIX + '_sources.json');
    entry.sha = hash(data); entry.size = data.length; state.blobs.set(entry.sha, data);
    await assert.rejects(editingFor(git)); assert.equal(git.mutations(ARCHIVE).length, 0);
  }
  const { git } = archived(), editing = await editingFor(git); git.calls = [];
  editing.source.repository = 'Other/fake';
  await assert.rejects(updateAlbum(git.api, editing, editing.album, editing.photos, undefined, dump), /来源/);
  await assert.rejects(readPhotoBlob(git.api, editing, editing.photos[0]), /来源/); assert.equal(git.calls.length, 0);
});

test('_processed migration verifies pinned original URLs and preserves metadata/body, removes previews, no archive write on removal', async () => {
  const { git, source } = archived('processed'), editing = await editingFor(git); git.calls = [];
  assert.equal(editing.source.repository, ARCHIVE); assert.equal(editing.source.commit, source.commit); assert.equal(editing.photos.length, 3);
  git.repos.get(ARCHIVE).readonly = true;
  await updateAlbum(git.api, editing, editing.album, [editing.photos[0]], undefined, dump);
  const manifest = JSON.parse(git.content(MAIN, PREFIX + '_sources.json'));
  assert.equal(manifest.commit, source.commit); assert.equal(manifest.files.length, 1);
  assert.equal(git.content(MAIN, PREFIX + '_processed.json'), undefined); assert.ok(git.tree(MAIN).every(e => !e.path.includes('/_preview/')));
  const output = git.content(MAIN, PREFIX + 'index.md'); assert.equal(parseConfig(output).layout, 'actual'); assert.equal(parseConfig(output).featured, true); assert.ok(output.endsWith(editing.body));
  assert.ok(!git.calls.some(c => c.path.startsWith('/repos/' + ARCHIVE)));
});

test('_processed additions migrate through the same archive; forged URL and key never fetch arbitrary URLs', async () => {
  const { git } = archived('processed'), editing = await editingFor(git); git.calls = [];
  await updateAlbum(git.api, editing, editing.album, [editing.photos[0], newPhoto()], undefined, dump);
  assert.equal(git.content(ARCHIVE, PREFIX + 'new photo 中文.jpg'), 'NEW ORIGINAL'); assert.ok(git.content(MAIN, PREFIX + '_sources.json'));
  for (const corrupt of [m => m.photos[0].original.url = 'https://evil.invalid/token', m => m.photos[0].original.url += '?token=leak', m => m.photos[0].key = '../preview', m => m.photos[0].original.url = m.photos[0].original.url.replace('/a.jpg', '/b.jpg')]) {
    const { git, manifest } = archived('processed'); corrupt(manifest);
    const data = Buffer.from(JSON.stringify(manifest)), entry = git.tree(MAIN).find(e => e.path.endsWith('_processed.json'));
    entry.sha = hash(data); entry.size = data.length; git.repos.get(MAIN).blobs.set(entry.sha, data);
    await assert.rejects(editingFor(git));
    assert.ok(git.calls.every(c => c.path.startsWith('/repos/')));
  }
});

test('preview downloads only explicitly requested trusted Git blobs and verifies SHA/base64/size', async () => {
  for (const archive of [false, true]) {
    const git = archive ? archived().git : mainGit(), editing = await editingFor(git); git.calls = [];
    const photo = editing.photos[0], result = await readPhotoBlob(git.api, editing, photo);
    assert.ok(result instanceof Blob); assert.equal(await result.text(), 'original A'); assert.equal(result.size, photo.remote.size);
    assert.equal(git.calls.length, 1); assert.equal(git.calls[0].path, `/repos/${archive ? ARCHIVE : MAIN}/git/blobs/${photo.remote.sha}`);
    const state = git.repos.get(archive ? ARCHIVE : MAIN); state.blobs.set(photo.remote.sha, Buffer.from('FAKE BYTES'));
    await assert.rejects(readPhotoBlob(git.api, editing, photo), /校验/);
  }
  const git = mainGit(), editing = await editingFor(git), api = async (method, path) => ({ ...(await git.api(method, path)), content: 'not base64!' });
  await assert.rejects(readPhotoBlob(api, editing, editing.photos[0]), /编码/);
});

test('direct main capacity over budget rejects before uploads; never silently switches archive/settings', async () => {
  const git = mainGit(), editing = await editingFor(git);
  const extra = { path: 'gallery/content/other/huge.jpg', type: 'blob', mode: '100644', sha: 'e'.repeat(40), size: Math.ceil(MAIN_BUDGET / 3) };
  git.tree(MAIN).push(extra); git.calls = [];
  await assert.rejects(updateAlbum(git.api, editing, editing.album, [editing.photos[0], newPhoto()], undefined, dump), /分仓发布/);
  assert.equal(git.calls.filter(c => c.method !== 'GET').length, 0); assert.equal(git.repos.get(MAIN).head, editing.sha);
});

test('effective cover matches build image ordering and resolves multiple cover flags to exactly one', async () => {
  for (const resources of [[], [{ src: 'b.jpg', params: { cover: true } }, { src: 'a.jpg', params: { cover: true } }]]) {
    const git = mainGit({ [PREFIX + 'index.md']: config({ title: 'Trip', date: '2026-11-02', resources }) });
    const editing = await editingFor(git);
    assert.deepEqual(editing.photos.filter(p => p.cover).map(p => p.file), [resources.length ? 'b.jpg' : 'feature 中文 photo.jpg']);
    const parsed = parseConfig(editConfig(editing, editing.album, editing.photos, dump));
    assert.equal(parsed.resources.filter(r => r.params.cover).length, 1);
  }
});

test('protected branch error is propagated without broadening permissions or changing the ref', async () => {
  const git = mainGit(), editing = await editingFor(git), denied = Error('GitHub 403 Protected branch update failed');
  git.calls = [];
  git.hook = (method) => { if (method === 'PATCH') throw denied; };
  await assert.rejects(updateAlbum(git.api, editing, editing.album, [editing.photos[0]], undefined, dump), error => error === denied);
  assert.equal(git.repos.get(MAIN).head, editing.sha);
  assert.ok(git.calls.every(c => c.path.startsWith('/repos/' + MAIN)));
  assert.equal(git.content(MAIN, PREFIX + 'b.jpg'), 'original B');
});

test('truncated main or pinned archive trees reject loading without file or ref mutations', async () => {
  const { git } = archived();
  for (const repo of [MAIN, ARCHIVE]) {
    git.calls = [];
    const api = async (method, path, body) => {
      const result = await git.api(method, path, body);
      return path.startsWith('/repos/' + repo + '/git/trees/') ? { ...result, truncated: true } : result;
    };
    const configSha = git.tree(MAIN).find(e => e.path === PREFIX + 'index.md').sha;
    await assert.rejects(loadAlbum(api, { slug: 'trip', configSha }, values, yaml), /不完整/);
    assert.equal(git.mutations().length, 0);
  }
});

test('archive album deletion never touches archive repository or historical originals', async () => {
  const { git, source } = archived(), editing = await editingFor(git); git.calls = []; git.repos.get(ARCHIVE).readonly = true;
  await deleteAlbum(git.api, editing);
  assert.ok(!git.calls.some(c => c.path.startsWith('/repos/' + ARCHIVE))); assert.equal(git.repos.get(ARCHIVE).head, source.commit);
  assert.equal(git.content(ARCHIVE, PREFIX + 'a.jpg'), 'original A'); assert.equal(git.content(MAIN, 'index.html'), 'site');
});

test('authenticated list entries allow scoped deletion without needing archive read or write', async () => {
  const { git } = archived(), list = await listAlbums(git.api, values, yaml), entry = list.albums[0];
  git.calls = []; git.repos.delete(ARCHIVE);
  await deleteAlbum(git.api, { ...list, album: entry });
  assert.ok(git.tree(MAIN).every(e => !e.path.startsWith(PREFIX)));
  assert.ok(!git.calls.some(c => c.path.startsWith('/repos/' + ARCHIVE)));
});

test('list deletion rejects forged entries, changed targets and stale snapshots', async () => {
  const git = mainGit(), list = await listAlbums(git.api, values, yaml), entry = list.albums.find(a => a.slug === 'trip');
  git.calls = [];
  await assert.rejects(deleteAlbum(git.api, { ...list, album: { ...entry } }), /目标/);
  await assert.rejects(deleteAlbum(git.api, { ...list, settings: { ...list.settings, contentPath: 'other' }, album: entry }), /目标/);
  assert.equal(git.calls.length, 0);
  git.bump(MAIN);
  await assert.rejects(deleteAlbum(git.api, { ...list, album: entry }), /新提交/);
  assert.equal(git.mutations().length, 0);
});

test('published album list excludes unpublished draft configurations', async () => {
  const git = mainGit({ 'gallery/content/draft/index.md': config({ title: 'Not published', draft: true }) });
  const list = await listAlbums(git.api, values, yaml);
  assert.ok(list.albums.every(album => album.slug !== 'draft'));
});

test('private source archives reject loading without changing visibility or writing files', async () => {
  const { git } = archived(); git.repos.get(ARCHIVE).private = true;
  await assert.rejects(editingFor(git), /不是公开仓库/);
  assert.equal(git.mutations().length, 0);
  assert.equal(git.repos.get(ARCHIVE).private, true);
});

test('adding originals to a full archive stops before uploads and keeps both branches unchanged', async () => {
  const { git } = archived(), editing = await editingFor(git), archiveHead = git.repos.get(ARCHIVE).head;
  git.calls = [];
  const api = async (method, path, body) => {
    const result = await git.api(method, path, body);
    return method === 'GET' && path === '/repos/' + ARCHIVE ? { ...result, size: 800 * 1024 } : result;
  };
  await assert.rejects(updateAlbum(api, editing, editing.album, [editing.photos[0], newPhoto()], undefined, dump), /800 MiB/);
  assert.equal(git.mutations().length, 0);
  assert.equal(git.repos.get(MAIN).head, editing.sha);
  assert.equal(git.repos.get(ARCHIVE).head, archiveHead);
});
