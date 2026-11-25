import { settingsFor, checkRepository, snapshot, blobSha, base64, validate, MAIN_BUDGET, ARCHIVE_BUDGET } from './core.mjs';

const IMAGE = /\.(jpe?g|png|webp|tiff?|heic|heif)$/i;
const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/;
const loaded = new WeakMap(), listed = new WeakMap();
const copy = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function authenticated(api) {
  if (typeof api !== 'function') throw Error('请先连接具有 Contents: Read and write 权限的 GitHub 令牌');
}
function component(value) {
  if (typeof value !== 'string' || !value.trim() || value === '.' || value.includes('..') || /[\\/\x00-\x1f\x7f?#%]/.test(value)) throw Error('不安全的专辑路径或文件名');
  return value;
}
function imageName(value) {
  component(value);
  if (!IMAGE.test(value) || value.startsWith('.')) throw Error('不支持的照片文件名：' + value);
  return value;
}
function repository(value) {
  if (typeof value !== 'string' || !REPOSITORY.test(value) || ['.', '..'].includes(value.split('/')[1])) throw Error('无效的原图库 repository');
  return value;
}
function sha(value) {
  if (typeof value !== 'string' || !SHA.test(value)) throw Error('无效的 Git SHA');
  return value;
}
function descriptor(value) {
  sha(value?.sha);
  if (!Number.isInteger(value.size) || value.size < 1 || value.size >= 100 * 1024 ** 2) throw Error('照片大小无效或超过 100 MiB');
  return { sha: value.sha, size: value.size };
}
function prefixFor(settings, slug) {
  component(slug);
  return settings.contentPath + '/' + slug + '/';
}
function sourcePath(value) {
  if (typeof value !== 'string') throw Error('无效的原图库 path');
  const path = value.endsWith('/') ? value.slice(0, -1) : value;
  path.split('/').forEach(component);
  return path + '/';
}
async function bytesFor(api, repo, remote) {
  sha(remote.sha);
  const result = await api('GET', `/repos/${repo}/git/blobs/${remote.sha}`);
  const encoded = typeof result.content === 'string' ? result.content.replace(/\s/g, '') : '';
  if (result.encoding !== 'base64' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw Error('Git blob 编码无效');
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const blob = new Blob([bytes]);
  if (blob.size !== remote.size || result.size !== remote.size || result.sha !== remote.sha || await blobSha(blob) !== remote.sha) throw Error('Git blob SHA 或大小校验失败');
  return blob;
}
async function textFor(api, repo, entry) {
  if (entry.type !== 'blob' || entry.mode === '120000' || !Number.isInteger(entry.size) || entry.size < 0) throw Error('无效的专辑配置 blob');
  return new TextDecoder('utf-8', { fatal: true }).decode(await (await bytesFor(api, repo, entry)).arrayBuffer());
}
function frontMatter(text, loadYaml) {
  if (typeof loadYaml !== 'function') throw Error('缺少安全 YAML 解析器');
  const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)^---[ \t]*(?=\r?$)/m);
  if (!match || match.index !== 0) throw Error('专辑 index.md 缺少有效 YAML front matter');
  const metadata = loadYaml(match[1]);
  if (!object(metadata)) throw Error('专辑 YAML 必须是对象');
  if (metadata.title != null && typeof metadata.title !== 'string') throw Error('专辑标题必须是文本');
  if (metadata.date != null && typeof metadata.date !== 'string') throw Error('专辑日期必须是文本（使用 CORE_SCHEMA）');
  if (metadata.resources != null && !Array.isArray(metadata.resources)) throw Error('resources 必须是数组');
  for (const resource of metadata.resources ?? []) {
    if (!object(resource) || typeof resource.src !== 'string' || (resource.params != null && !object(resource.params))) throw Error('无效的照片 resource');
    component(resource.src);
  }
  return { metadata, body: text.slice(match[0].length) };
}
async function pinnedTree(api, repo, commitSha) {
  repository(repo); sha(commitSha);
  const commit = await api('GET', `/repos/${repo}/git/commits/${commitSha}`);
  if (commit.sha !== commitSha) throw Error('原图库 commit 校验失败');
  sha(commit.tree?.sha);
  const tree = await api('GET', `/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw Error('原图库目录不完整');
  return tree.tree;
}
function verifyFiles(source, tree) {
  const seen = new Set();
  if (!Array.isArray(source.files) || !source.files.length) throw Error('原图库没有有效照片');
  for (const file of source.files) {
    imageName(file.name); descriptor(file);
    if (seen.has(file.name)) throw Error('原图库照片重名');
    seen.add(file.name);
    const found = tree.find(e => e.path === source.path + file.name && e.type === 'blob' && e.mode !== '120000');
    if (!found || found.sha !== file.sha || found.size !== file.size) throw Error('原图库路径 / SHA / 大小与 pinned commit 不符：' + file.name);
  }
  if (source.files.reduce((n, f) => n + f.size, 0) >= ARCHIVE_BUDGET) throw Error('单辑请控制在 800 MiB 以内');
}
function directImages(tree, prefix) {
  return tree.filter(e => e.type === 'blob' && e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes('/') && IMAGE.test(e.path)).map(e => {
    const file = imageName(e.path.slice(prefix.length));
    if (e.mode === '120000') throw Error('照片不能是符号链接');
    return { name: file, ...descriptor(e) };
  });
}

export async function listAlbums(api, values, loadYaml) {
  authenticated(api);
  const settings = settingsFor(values);
  const info = await checkRepository(api, settings.repository);
  const branch = settings.branch || info.default_branch;
  const snap = await snapshot(api, settings.repository, branch);
  const albums = [];
  const prefix = settings.contentPath + '/';
  for (const entry of snap.tree) {
    if (!entry.path.startsWith(prefix) || !entry.path.endsWith('/index.md')) continue;
    const parts = entry.path.slice(prefix.length).split('/');
    if (parts.length !== 2) continue;
    const slug = component(parts[0]);
    const { metadata } = frontMatter(await textFor(api, settings.repository, entry), loadYaml);
    if (metadata.draft === true) continue;
    const album = { slug, title: metadata.title ?? slug, date: metadata.date ?? '', configSha: sha(entry.sha) };
    listed.set(album, copy({ settings, branch, sha: snap.sha, album }));
    albums.push(album);
  }
  albums.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh'));
  return { settings, branch, sha: snap.sha, albums };
}

export async function loadAlbum(api, entry, values, loadYaml) {
  authenticated(api);
  const settings = settingsFor(values), prefix = prefixFor(settings, entry.slug);
  sha(entry.configSha);
  const info = await checkRepository(api, settings.repository);
  const branch = settings.branch || info.default_branch;
  const snap = await snapshot(api, settings.repository, branch);
  const config = snap.tree.find(e => e.path === prefix + 'index.md');
  if (!config || config.sha !== entry.configSha) throw Error('专辑配置已更新，请刷新专辑列表');
  const { metadata, body } = frontMatter(await textFor(api, settings.repository, config), loadYaml);
  const mainFiles = directImages(snap.tree, prefix);
  let source = null, prepared = null;
  const sourcesEntry = snap.tree.find(e => e.path === prefix + '_sources.json');
  const processedEntry = snap.tree.find(e => e.path === prefix + '_processed.json');
  if (sourcesEntry) {
    const manifest = JSON.parse(await textFor(api, settings.repository, sourcesEntry));
    if (!object(manifest)) throw Error('无效的原图库 manifest');
    source = { repository: repository(manifest.repository), commit: sha(manifest.commit), path: sourcePath(manifest.path ?? prefix), files: copy(manifest.files) };
    verifyFiles(source, await pinnedTree(api, source.repository, source.commit));
  } else if (processedEntry) {
    prepared = JSON.parse(await textFor(api, settings.repository, processedEntry));
    if (!object(prepared) || !object(prepared.archive) || !Array.isArray(prepared.photos) || !prepared.photos.length) throw Error('无效的 _processed.json');
    source = { repository: repository(prepared.archive.repository), commit: sha(prepared.archive.commit), path: prefix, files: [] };
    const tree = await pinnedTree(api, source.repository, source.commit);
    source.files = directImages(tree, prefix);
    const seen = new Set();
    for (const photo of prepared.photos) {
      imageName(photo.file);
      if (seen.has(photo.file) || !/^[a-f0-9]{12}$/.test(photo.key)) throw Error('无效的 prepared photo');
      seen.add(photo.file);
      const url = new URL(photo.original?.url);
      if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || url.port || url.username || url.password || url.search || url.hash || decodeURIComponent(url.pathname) !== `/${source.repository}/${source.commit}/${prefix}${photo.file}` || !source.files.some(f => f.name === photo.file)) throw Error('prepared 原图 URL 与 pinned archive 不符');
    }
    verifyFiles(source, tree);
  }
  if (source) {
    if (source.repository.toLowerCase() === settings.repository.toLowerCase()) throw Error('原图库不能与网站仓库相同');
    const info = await api('GET', `/repos/${source.repository}`);
    if (info.private) throw Error('原图库不是公开仓库，无法构建公开照片');
  }
  const files = source?.files ?? mainFiles;
  const resources = metadata.resources ?? [];
  const sorted = [...files].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const order = [...new Set([...resources.map(r => r.src).filter(f => files.some(p => p.name === f)), ...sorted.map(f => f.name)])];
  const explicit = resources.find(r => r.params?.cover && files.some(f => f.name === r.src))?.src;
  const cover = explicit ?? (prepared && files.some(f => f.name === prepared.cover) ? prepared.cover : sorted.find(f => /feature/i.test(f.name))?.name ?? sorted[0]?.name);
  const photos = order.map(file => {
    const resource = copy(resources.find(r => r.src === file) ?? { src: file });
    const params = copy(resource.params ?? {});
    const preparedPhoto = prepared?.photos.find(p => p.file === file);
    return { file, remote: descriptor(files.find(f => f.name === file)), date: params.captureDate ?? preparedPhoto?.captureDate ?? '', description: params.description ?? '', cover: file === cover, featured: params.featured, params, resource };
  });
  const album = { title: metadata.title ?? entry.slug, slug: entry.slug, date: metadata.date ?? '', dateSource: 'published', categories: copy(metadata.categories ?? []), description: metadata.description ?? metadata.params?.description ?? '', showPalette: (metadata.showPalette ?? metadata.params?.showPalette ?? (prepared ? true : false)) === true, metadata: copy(metadata) };
  const editing = { settings, branch, ...snap, album, metadata, body, photos, source };
  loaded.set(editing, copy(editing));
  return editing;
}

function bound(editing, allowListed = false) {
  const original = loaded.get(editing) ?? (allowListed ? listed.get(editing?.album) : undefined);
  if (!original || !equal(editing.settings, original.settings) || editing.branch !== original.branch || editing.sha !== original.sha || editing.album?.slug !== original.album.slug || editing.album?.date !== original.album.date || editing.album?.title !== original.album.title || !equal(editing.source, original.source)) throw Error('编辑目标或原图来源已改变，请重新加载专辑');
  settingsFor(original.settings); prefixFor(original.settings, original.album.slug);
  return original;
}
function checkPhotos(original, photos) {
  if (!Array.isArray(photos)) throw Error('无效的照片列表');
  for (const photo of photos) {
    imageName(photo.file);
    if (photo.remote) {
      const remote = descriptor(photo.remote);
      const retained = original.photos.find(p => p.file === photo.file);
      if (photo.blob || !retained || !equal(remote, retained.remote)) throw Error('原图描述已改变或伪造：' + photo.file);
    } else if (!(photo.blob instanceof Blob) || !Number.isInteger(photo.blob.size) || photo.blob.size < 1 || photo.blob.size >= 100 * 1024 ** 2) throw Error('新照片缺少有效文件：' + photo.file);
  }
}
function validateEdit(editing, album, photos) {
  const original = loaded.get(editing) ?? editing;
  component(album.slug);
  if (album.slug !== original.album.slug || album.date !== original.album.date) throw Error('现有专辑的目录与发布日期不能改变');
  // Existing directory names can be broader than newly generated publisher slugs.
  validate({ ...album, slug: 'existing-album' }, photos);
}
export function editConfig(editing, album, photos, dumpYaml) {
  if (typeof dumpYaml !== 'function') throw Error('缺少 YAML 序列化器');
  validateEdit(editing, album, photos);
  const original = loaded.get(editing) ?? editing;
  const metadata = copy(original.metadata);
  Object.assign(metadata, { title: album.title, date: album.date, categories: copy(album.categories ?? []), description: album.description ?? '', showPalette: album.showPalette });
  metadata.resources = photos.map(photo => {
    const retained = original.photos.find(p => p.file === photo.file);
    const resource = copy(retained?.resource ?? photo.resource ?? {});
    const params = { ...copy(retained?.params ?? {}), ...copy(photo.params ?? {}) };
    delete params.cover;
    if (photo.cover) params.cover = true;
    params.description = photo.description ?? '';
    if (photo.featured === undefined) delete params.featured;
    else params.featured = photo.featured;
    if (photo.date) params.captureDate = photo.date;
    return { ...resource, src: photo.file, params };
  });
  return '---\n' + dumpYaml(metadata, { noRefs: true, lineWidth: -1 }) + '---' + original.body;
}
async function unchanged(api, repo, branch, expected) {
  const ref = await api('GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (ref.object.sha !== expected) throw Error('远端有新提交，请重新加载；不会覆盖别人的更新');
}
async function upload(api, repo, blob) {
  const expected = await blobSha(blob);
  const result = await api('POST', `/repos/${repo}/git/blobs`, { encoding: 'base64', content: await base64(blob) });
  if (result.sha !== expected) throw Error('上传 SHA 校验失败');
  return expected;
}
async function commitEntries(api, repo, branch, snap, entries, message) {
  const tree = await api('POST', `/repos/${repo}/git/trees`, { base_tree: snap.treeSha, tree: entries });
  const commit = await api('POST', `/repos/${repo}/git/commits`, { tree: sha(tree.sha), parents: [snap.sha], message });
  sha(commit.sha);
  await unchanged(api, repo, branch, snap.sha);
  await api('PATCH', `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
  return commit.sha;
}
const treeEntry = (path, sha) => ({ path, mode: '100644', type: 'blob', sha });
function resultFor(commit, original, archive) {
  const repository = original.settings.repository;
  return { commit, repository, branch: original.branch, ...(archive && { archive }), url: `https://github.com/${repository}/commit/${commit}`, actions: `https://github.com/${repository}/actions` };
}
export async function updateAlbum(api, editing, album, photos, progress = () => {}, dumpYaml) {
  authenticated(api);
  const original = bound(editing);
  if (album.title !== original.album.title) throw Error('现有专辑的原标题不能改变');
  checkPhotos(original, photos);
  const config = new Blob([editConfig(editing, album, photos, dumpYaml)]);
  const { repository: repo } = original.settings, prefix = prefixFor(original.settings, original.album.slug);
  const main = await snapshot(api, repo, original.branch);
  if (main.sha !== original.sha) throw Error('远端有新提交，请重新加载；不会覆盖别人的更新');
  const newPhotos = photos.filter(p => !p.remote);
  const keep = new Set(photos.map(p => p.file));
  const remove = main.tree.filter(e => {
    if (e.type !== 'blob' || !e.path.startsWith(prefix)) return false;
    const leaf = e.path.slice(prefix.length);
    return leaf === '_processed.json' || leaf.startsWith('_preview/') || (!leaf.includes('/') && IMAGE.test(leaf) && (original.source || !keep.has(leaf)));
  });
  const removed = new Set([...remove.map(e => e.path), ...newPhotos.map(p => prefix + p.file), prefix + 'index.md', prefix + '_sources.json']);
  let budget = main.tree.filter(e => e.type === 'blob' && e.path.startsWith(original.settings.contentPath + '/') && !removed.has(e.path)).reduce((n, e) => n + (e.size || 0) * (IMAGE.test(e.path) && !e.path.includes('/_preview/') ? 3 : 1), 0) + config.size;
  if (!original.source) budget += newPhotos.reduce((n, p) => n + p.blob.size * 3, 0);
  else budget += new Blob([JSON.stringify(original.source)]).size + newPhotos.length * 200;
  if (budget > MAIN_BUDGET) throw Error('主站超过容量预算；请使用分仓发布，现有专辑编辑不会自动迁移原图');
  await checkRepository(api, repo);
  await unchanged(api, repo, original.branch, original.sha);
  let source = original.source ? copy(original.source) : null;
  if (source) {
    source.files = photos.filter(p => p.remote).map(p => ({ name: p.file, ...descriptor(p.remote) }));
    if (newPhotos.length) {
      progress('检查原图库写入权限 · ' + source.repository);
      const info = await checkRepository(api, source.repository, true);
      if ((info.size || 0) * 1024 + newPhotos.reduce((n, p) => n + p.blob.size, 0) >= ARCHIVE_BUDGET) throw Error('原图库接近 800 MiB 预算，请使用分仓发布；本次编辑未上传新照片');
      const archiveBranch = info.default_branch;
      const archive = await snapshot(api, source.repository, archiveBranch);
      if (source.files.length) verifyFiles(source, archive.tree);
      const entries = [];
      for (const photo of newPhotos) {
        const expected = await blobSha(photo.blob), path = source.path + photo.file;
        const existing = archive.tree.find(e => e.path === path);
        if (existing && (existing.type !== 'blob' || existing.sha !== expected || existing.size !== photo.blob.size || existing.mode === '120000')) throw Error('原图库同名原图已存在，不能覆盖：' + photo.file);
        if (!existing) {
          progress('上传原图 · ' + photo.file);
          entries.push(treeEntry(path, await upload(api, source.repository, photo.blob)));
        }
        source.files.push({ name: photo.file, sha: expected, size: photo.blob.size });
      }
      await unchanged(api, repo, original.branch, original.sha);
      source.commit = entries.length ? await commitEntries(api, source.repository, archiveBranch, archive, entries, 'gallery: add originals ' + original.album.slug) : archive.sha;
      verifyFiles(source, await pinnedTree(api, source.repository, source.commit));
    }
  }
  await unchanged(api, repo, original.branch, original.sha);
  const entries = remove.map(e => treeEntry(e.path, null));
  if (!source) {
    for (const photo of photos) {
      if (photo.remote) entries.push(treeEntry(prefix + photo.file, photo.remote.sha));
      else {
        progress('上传照片 · ' + photo.file);
        entries.push(treeEntry(prefix + photo.file, await upload(api, repo, photo.blob)));
      }
    }
  } else entries.push(treeEntry(prefix + '_sources.json', await upload(api, repo, new Blob([JSON.stringify(source)]))));
  entries.push(treeEntry(prefix + 'index.md', await upload(api, repo, config)));
  const commit = await commitEntries(api, repo, original.branch, main, entries, 'gallery: edit ' + original.album.slug);
  return resultFor(commit, original, source?.repository);
}

export async function deleteAlbum(api, editing) {
  authenticated(api);
  const original = bound(editing, true), repo = original.settings.repository;
  const prefix = prefixFor(original.settings, original.album.slug);
  const snap = await snapshot(api, repo, original.branch);
  if (snap.sha !== original.sha) throw Error('远端有新提交，请重新加载；不会覆盖别人的更新');
  await checkRepository(api, repo);
  await unchanged(api, repo, original.branch, original.sha);
  const entries = snap.tree.filter(e => e.type === 'blob' && e.path.startsWith(prefix)).map(e => treeEntry(e.path, null));
  if (!entries.length) throw Error('专辑不存在，请刷新列表');
  const commit = await commitEntries(api, repo, original.branch, snap, entries, 'gallery: delete ' + original.album.slug);
  return resultFor(commit, original);
}

export async function readPhotoBlob(api, editing, photo) {
  authenticated(api);
  const original = bound(editing);
  if (!photo?.remote) throw Error('只能预览已加载的原图');
  checkPhotos(original, [photo]);
  const repo = original.source?.repository ?? original.settings.repository;
  return bytesFor(api, repo, descriptor(photo.remote));
}
