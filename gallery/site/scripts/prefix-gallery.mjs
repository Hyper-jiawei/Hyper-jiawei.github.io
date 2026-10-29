// Keep the original image cache and filesystem layout; prefix only published URLs.
import fs from 'node:fs';
const file = new URL('../src/data/gallery.json', import.meta.url);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
function walk(value) {
 if (typeof value === 'string') return value.startsWith('/img/') ? '/gallery' + value : value;
 if (Array.isArray(value)) return value.map(walk);
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
 return value;
}
fs.writeFileSync(file, JSON.stringify(walk(data)));
