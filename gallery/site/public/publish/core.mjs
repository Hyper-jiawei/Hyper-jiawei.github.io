import { buildConfig } from './config.mjs';
const IMAGE = /\.(jpe?g|png|webp|tiff?|heic|heif)$/i;
export const PHOTO_LIMIT = 95 * 1024 ** 2;
export const ALBUM_LIMIT = 1024 ** 3;

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}

function dateFromMatch(match) {
  if (!match) return '';
  const [, y, m, d] = match;
  const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return validDate(date) ? date : '';
}

export function enableHeicBrands(fileParsers) {
  const parser = fileParsers.get('heic');
  const canHandle = parser.canHandle.bind(parser);
  // The bundled reader rejects newer iPhone ftyp boxes longer than 50 bytes.
  parser.canHandle = (file, prefix) => (file.byteLength >= 16 && file.getUint32(0) >= 16 &&
    file.getUint32(0) <= file.byteLength - 8 && file.getString(4, 4) === 'ftyp' &&
    /^(hei[cxms]|hev[cxms]|mif1|msf1)$/.test(file.getString(8, 4))) || canHandle(file, prefix);
}

const CREATION_FIELDS = ['DateTimeOriginal', 'CreateDate'];
const CREATION_TAGS = { reviveValues: false, pick: CREATION_FIELDS };

async function webpExif(file) {
  const header = new DataView(await file.slice(0, 12).arrayBuffer());
  if (header.byteLength < 12 || header.getUint32(0) !== 0x52494646 || header.getUint32(8) !== 0x57454250) return null;
  const end = Math.min(file.size, header.getUint32(4, true) + 8);
  for (let offset = 12; offset + 8 <= end;) {
    const chunk = new DataView(await file.slice(offset, offset + 8).arrayBuffer());
    const size = chunk.getUint32(4, true);
    const start = offset + 8;
    if (start + size > end) break;
    if (chunk.getUint32(0) === 0x45584946 && size >= 6) {
      const prefix = new DataView(await file.slice(start, start + 6).arrayBuffer());
      const skip = prefix.getUint32(0) === 0x45786966 && prefix.getUint16(4) === 0 ? 6 : 0;
      return file.slice(start + skip, start + size);
    }
    offset = start + size + (size % 2);
  }
  return null;
}

export async function readPhotoDate(file, parseExif) {
  try {
    const source = /\.webp$/i.test(file.name) ? await webpExif(file) : file;
    if (!source) return '';
    const tags = await parseExif(source, CREATION_TAGS);
    for (const field of CREATION_FIELDS) {
      const value = tags?.[field];
      if (typeof value !== 'string') continue;
      const date = dateFromMatch(value.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})(?=$|[ T])/));
      if (date) return date;
    }
  } catch {}
  return '';
}

export const photoTitle = name => name.replace(/\.[^.]+$/, '');

export function selectedFiles(kind, files) {
  if (!files.length) throw Error('请先选择照片');
  if (kind === 'single') {
    if (files.length !== 1 || !IMAGE.test(files[0].name)) throw Error('请选择一张支持的照片（JPG、PNG、WebP、TIFF 或 HEIC / HEIF）');
    return { kind, files };
  }
  const folderName = kind === 'folder' ? files[0].webkitRelativePath?.split('/')[0] : '';
  if (kind === 'folder' && !folderName) throw Error('未读到文件夹名称，请使用「改为多选照片」');
  const images = files.filter(file => IMAGE.test(file.name) && !file.name.startsWith('.') &&
    (!folderName || file.webkitRelativePath === `${folderName}/${file.name}`));
  if (!images.length) throw Error(folderName ? '文件夹顶层没有支持的照片，请选直接存放照片的文件夹' : '没有选中支持的照片');
  if (folderName) images.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  return { kind: 'album', folderName, files: images };
}

export function publicationFor({ kind, folderName }, photos) {
  const single = kind === 'single';
  const firstTitle = photos.length ? photoTitle(photos[0].file) : '';
  const folderDate = folderName ? dateFromMatch(folderName.match(/(?:^|\D)(\d{4})[-_. 年](\d{1,2})[-_. 月](\d{1,2})日?(?!\d)/) ??
    folderName.match(/(?:^|\D)(\d{4})(\d{2})(\d{2})(?!\d)/)) : '';
  const photoDate = photos.map(p => p.date).filter(Boolean).sort()[0] ?? '';
  const date = folderDate || photoDate;
  const title = folderName || (single || !firstTitle ? firstTitle : `${firstTitle} · 专辑`);
  const key = !folderName && date ? `${date}-${title}` : title;
  const slug = key.normalize('NFC').replace(/[^\p{L}\p{M}\p{N}_.-]+/gu, '-').replace(/^[^\p{L}\p{N}_]+|[.-]+$/gu, '') ||
    (title && `${single ? 'photo' : 'album'}-${Array.from(title, c => c.codePointAt(0).toString(16)).join('-')}`);
  return { title, slug, date, dateSource: folderDate ? 'folder' : photoDate ? 'photo' : '', ...(single && { metadata: { layout: 'single-big-photo' } }) };
}

export function validate(album, photos) {
  if (!photos.length) throw Error('请先选择照片');
  if (!album.title.trim()) throw Error('未能从文件名识别标题');
  if (!/^[\p{L}\p{N}_-][\p{L}\p{M}\p{N}_.-]*$/u.test(album.slug)) throw Error('无法生成发布目录，请检查文件或文件夹名称');
  if (album.date && !validDate(album.date)) throw Error('日期无效');
  const names = new Set();
  for (const p of photos) {
    if (!IMAGE.test(p.file) || /[\\/\u0000-\u001f?#%]/.test(p.file) || p.file.startsWith('.')) throw Error('不支持的文件名：' + p.file);
    const stem = p.file.replace(/\.[^.]+$/,'');
    if (!stem.trim() || names.has(stem)) throw Error('照片标题重复或为空：' + stem);
    names.add(stem);
    const size = p.blob?.size ?? p.remote?.size;
    if (!Number.isInteger(size) || size < 1) throw Error(p.file + ' 没有有效原图');
    if (size > PHOTO_LIMIT) throw Error(p.file + ' 超过单文件 95 MiB 上传限制');
  }
  if (photos.reduce((n,p)=>n+(p.blob?.size ?? p.remote?.size),0) > ALBUM_LIMIT) throw Error('单辑请控制在 1 GiB 以内');
  if (photos.filter(p=>p.cover).length !== 1) throw Error('请选择一张封面');
}
export function configFor(album, photos) {
  validate(album, photos);
  return buildConfig({ ...album, photos: photos.map(p => p.date ? { ...p, params: { ...p.params, captureDate: p.date } } : p) });
}

// The only network client: same-origin /api proxy to the storage Worker.
// The token is sent nowhere else; photos and drafts never leave through it.
export function storage(token, request = fetch) {
  return async (method, path, body, headers = {}) => {
    const isBlob = typeof Blob !== 'undefined' && body instanceof Blob;
    const response = await request('/api' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(isBlob ? { 'Content-Type': body.type || 'application/octet-stream' } : body != null ? { 'Content-Type': 'text/plain;charset=utf-8' } : {}),
        ...headers,
      },
      ...(body != null ? { body } : {}),
    });
    if (!response.ok) {
      let detail = ''; try { detail = (await response.json()).message || ''; } catch {}
      const help = response.status === 401 ? '请检查发布令牌是否与上传服务一致。'
        : response.status === 409 ? '内容已被其他设备修改或同名冲突，请刷新后重试。'
        : '网络中断后可重试；已上传的原图不会丢失。';
      const error = Error(`${detail || '访问 Cloudflare 存储失败'}（${response.status}）。${help}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response;
  };
}
