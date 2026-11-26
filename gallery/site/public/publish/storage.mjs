import { validate, configFor, PHOTO_LIMIT, ALBUM_LIMIT } from './core.mjs';

const IMAGE = /\.(jpe?g|png|webp|tiff?|heic|heif)$/i;
const loaded = new WeakMap(), listed = new WeakMap();
const copy = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const SETTINGS = Object.freeze({ storage: 'cloudflare-r2', api: '/api' });
function authenticated(api) {
  if (typeof api !== 'function') throw Error('请先连接具有写入权限的发布令牌');
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
function etag(value) {
  if (typeof value !== 'string' || !/^"[^"]+"$/.test(value)) throw Error('无效的版本 etag');
  return value;
}
function descriptor(value) {
  etag(value?.etag);
  if (!Number.isInteger(value.size) || value.size < 1 || value.size > PHOTO_LIMIT) throw Error('照片大小无效或超过 95 MiB');
  return { etag: value.etag, size: value.size };
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
function photoList(value) {
  if (!Array.isArray(value)) throw Error('无效的照片列表');
  const seen = new Set();
  const files = value.map(file => {
    const name = imageName(file.name);
    if (seen.has(name)) throw Error('云端照片重名：' + name);
    seen.add(name);
    return { name, ...descriptor(file) };
  });
  if (files.reduce((n, f) => n + f.size, 0) > ALBUM_LIMIT) throw Error('单辑请控制在 1 GiB 以内');
  return files;
}

export async function listAlbums(api, loadYaml) {
  authenticated(api);
  const { albums: entries } = await (await api('GET', '/albums')).json();
  if (!Array.isArray(entries)) throw Error('云端专辑列表无效');
  const albums = [];
  for (const entry of entries) {
    const slug = component(entry.slug);
    const version = etag(entry.etag);
    const { metadata } = frontMatter(entry.config, loadYaml);
    photoList(entry.photos);
    if (metadata.draft === true) continue;
    const album = { slug, title: metadata.title ?? slug, date: metadata.date ?? '', etag: version };
    listed.set(album, copy({ settings: SETTINGS, album }));
    albums.push(album);
  }
  albums.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh'));
  return { settings: SETTINGS, albums };
}

export async function loadAlbum(api, entry, loadYaml) {
  authenticated(api);
  const slug = component(entry.slug);
  etag(entry.etag);
  const data = await (await api('GET', '/albums/' + encodeURIComponent(slug))).json();
  const version = etag(data.etag);
  if (data.slug !== slug || version !== entry.etag) throw Error('专辑配置已更新，请刷新专辑列表');
  const { metadata, body } = frontMatter(data.config, loadYaml);
  const files = photoList(data.photos);
  const resources = metadata.resources ?? [];
  const sorted = [...files].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const order = [...new Set([...resources.map(r => r.src).filter(f => files.some(p => p.name === f)), ...sorted.map(f => f.name)])];
  const cover = resources.find(r => r.params?.cover && files.some(f => f.name === r.src))?.src ?? sorted.find(f => /feature/i.test(f.name))?.name ?? sorted[0]?.name;
  const photos = order.map(file => {
    const resource = copy(resources.find(r => r.src === file) ?? { src: file });
    const params = copy(resource.params ?? {});
    return { file, remote: descriptor(files.find(f => f.name === file)), date: params.captureDate ?? '', description: params.description ?? '', cover: file === cover, featured: params.featured, params, resource };
  });
  const album = { title: metadata.title ?? slug, slug, date: metadata.date ?? '', dateSource: 'published', categories: copy(metadata.categories ?? []), description: metadata.description ?? metadata.params?.description ?? '', showPalette: (metadata.showPalette ?? metadata.params?.showPalette ?? false) === true, metadata: copy(metadata), etag: version };
  const editing = { settings: SETTINGS, album, metadata, body, photos };
  loaded.set(editing, copy(editing));
  return editing;
}

function bound(editing, allowListed = false) {
  const original = loaded.get(editing) ?? (allowListed ? listed.get(editing?.album) : undefined);
  if (!original || !equal(editing.settings, original.settings) || editing.album?.slug !== original.album.slug || editing.album?.date !== original.album.date || editing.album?.title !== original.album.title || editing.album?.etag !== original.album.etag) throw Error('编辑目标已改变，请重新加载专辑');
  component(original.album.slug);
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
    } else if (!(photo.blob instanceof Blob) || !Number.isInteger(photo.blob.size) || photo.blob.size < 1 || photo.blob.size > PHOTO_LIMIT) throw Error('新照片缺少有效文件：' + photo.file);
  }
}
function validateEdit(editing, album, photos) {
  const original = loaded.get(editing) ?? editing;
  component(album.slug);
  if (album.slug !== original.album.slug || album.date !== original.album.date) throw Error('现有专辑的目录与发布日期不能改变');
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

export async function publishAlbum(api, album, photos, allowUpdate, progress = () => {}, dumpYaml) {
  authenticated(api);
  const config = configFor(album, photos);
  const slug = component(album.slug);
  let match = '*';
  try {
    const current = await (await api('GET', '/albums/' + encodeURIComponent(slug))).json();
    if (!allowUpdate) throw Error('同名专辑已存在，请勾选「更新同名作品」');
    match = etag(current.etag);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  for (const [index, photo] of photos.entries()) {
    progress(`上传原图 ${index + 1}/${photos.length} · ${photo.file}`);
    await api('PUT', `/albums/${encodeURIComponent(slug)}/${encodeURIComponent(photo.file)}`, photo.blob);
  }
  progress('提交专辑配置 · Cloudflare R2');
  const result = await (await api('PUT', `/albums/${encodeURIComponent(slug)}`, config, { 'If-Match': match })).json();
  return { etag: etag(result.etag), slug };
}

export async function updateAlbum(api, editing, album, photos, progress = () => {}, dumpYaml) {
  authenticated(api);
  const original = bound(editing);
  if (album.title !== original.album.title) throw Error('现有专辑的原标题不能改变');
  checkPhotos(original, photos);
  const config = editConfig(editing, album, photos, dumpYaml);
  const slug = original.album.slug;
  const newPhotos = photos.filter(p => !p.remote);
  for (const [index, photo] of newPhotos.entries()) {
    progress(`上传原图 ${index + 1}/${newPhotos.length} · ${photo.file}`);
    await api('PUT', `/albums/${encodeURIComponent(slug)}/${encodeURIComponent(photo.file)}`, photo.blob);
  }
  progress('提交专辑配置 · Cloudflare R2');
  const result = await (await api('PUT', `/albums/${encodeURIComponent(slug)}`, config, { 'If-Match': original.album.etag })).json();
  const keep = new Set(photos.map(p => p.file));
  const removed = original.photos.filter(p => !keep.has(p.file));
  for (const photo of removed) {
    progress('移除原图 · ' + photo.file);
    await api('DELETE', `/albums/${encodeURIComponent(slug)}/${encodeURIComponent(photo.file)}`, null, { 'If-Match': photo.remote.etag });
  }
  return { etag: etag(result.etag), slug, removed: removed.length };
}

export async function deleteAlbum(api, editing) {
  authenticated(api);
  const original = bound(editing, true);
  const result = await (await api('DELETE', '/albums/' + encodeURIComponent(original.album.slug), null, { 'If-Match': original.album.etag })).json();
  return { slug: original.album.slug, deleted: result.deleted };
}

export async function readPhotoBlob(api, editing, photo) {
  authenticated(api);
  const original = bound(editing);
  if (!photo?.remote) throw Error('只能预览已加载的原图');
  checkPhotos(original, [photo]);
  const response = await api('GET', `/albums/${encodeURIComponent(original.album.slug)}/${encodeURIComponent(photo.file)}`);
  const blob = await response.blob();
  if (blob.size !== photo.remote.size) throw Error('原图大小校验失败：' + photo.file);
  return blob;
}
