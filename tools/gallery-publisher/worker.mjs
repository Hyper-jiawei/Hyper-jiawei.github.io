import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../gallery/site/package.json', import.meta.url));
const yaml = require('js-yaml');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
try {
  if (input.action === 'generate') {
    const { buildConfig } = await import('./config.mjs');
    process.stdout.write(JSON.stringify({ config: buildConfig(input) }));
  } else if (input.action === 'preview') {
    const { default: sharp } = await import('../../gallery/site/node_modules/sharp/lib/index.js');
    const { imageInput } = await import('../../gallery/site/scripts/heic-input.mjs');
    const jpeg = await sharp(await imageInput(input.file)).rotate().resize(400, 300, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
    process.stdout.write(jpeg);
  } else {
    const match = input.config.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) throw Error('配置必须以 --- 开头，并使用独立一行的 --- 结束。');
    const data = yaml.load(match[1]);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('配置需要是 YAML 对象。');
    if (data.date instanceof Date) data.date = data.date.toISOString().slice(0, 10);
    const errors = [];
    if (typeof data.title !== 'string' || !data.title.trim()) errors.push('请填写专辑标题。');
    if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || Number.isNaN(Date.parse(data.date)) || new Date(data.date).toISOString().slice(0, 10) !== data.date) errors.push('日期请填写有效的 YYYY-MM-DD。');
    if (data.categories != null && (!Array.isArray(data.categories) || data.categories.some(c => typeof c !== 'string'))) errors.push('categories 需要是文字数组。');
    if (data.description != null && typeof data.description !== 'string') errors.push('专辑 description 需要是文字或留空。');
    if (data.draft === true || data.private === true) errors.push('发布工具仅发布公开专辑，请移除 draft / private 或改为 false。');
    const files = new Set(input.files);
    const resources = data.resources ?? [];
    if (!Array.isArray(resources)) errors.push('resources 需要是列表。');
    else {
      const seen = new Set();
      for (const r of resources) {
        if (!r || typeof r.src !== 'string' || !files.has(r.src)) { errors.push(`配置找不到原图：${r?.src ?? '(未填写 src)'}`); continue; }
        if (r.params != null && (typeof r.params !== 'object' || Array.isArray(r.params))) errors.push(`${r.src} 的 params 需要是配置对象。`);
        if (seen.has(r.src)) errors.push(`配置重复引用：${r.src}`);
        seen.add(r.src);
        if (r.params?.description != null && typeof r.params.description !== 'string') errors.push(`${r.src} 的 description 需要是文字。`);
        const featured = r.params?.featured;
        if (featured != null && ![true, false, '精选照片'].includes(featured) && !(typeof featured === 'number' && Number.isFinite(featured) && featured >= 0)) errors.push(`${r.src} 的 featured 请使用 true、false 或正数。`);
      }
      if (resources.filter(r => r?.params?.cover === true).length > 1) errors.push('只能选择一张专辑封面。');
    }
    process.stdout.write(JSON.stringify({ data, errors }));
  }
} catch (error) {
  process.stderr.write(error.message + '\n'); process.exitCode = 1;
}
