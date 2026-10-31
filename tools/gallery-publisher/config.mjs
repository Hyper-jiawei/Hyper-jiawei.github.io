/** Shared by the editor and tests. Every unselected photo omits featured entirely. */
export function buildConfig({ metadata = {}, title = '', date = '', categories = [], description = '', showPalette = true, photos = [] }) {
  const quote = value => JSON.stringify(value ?? '');
  const extra = { ...metadata };
  for (const key of ['title', 'date', 'categories', 'description', 'showPalette', 'resources', 'featured']) delete extra[key];
  const rows = ['---', 'title: ' + quote(title.trim()), 'date: ' + quote(date), 'categories: ' + JSON.stringify(categories), 'showPalette: ' + showPalette, 'description: ' + quote(description)];
  for (const [key, value] of Object.entries(extra)) rows.push(quote(key) + ': ' + JSON.stringify(value));
  rows.push('resources:');
  for (const photo of photos) {
    rows.push('  - src: ' + quote(photo.file), '    params:');
    const params = { ...(photo.params || {}) };
    for (const key of ['cover', 'featured', 'description']) delete params[key];
    for (const [key, value] of Object.entries(params)) rows.push('      ' + quote(key) + ': ' + JSON.stringify(value));
    if (photo.cover) rows.push('      cover: true');
    if (photo.featured === true) rows.push('      featured: true');
    rows.push('      description: ' + quote(photo.description));
  }
  return rows.concat('---', '').join('\n');
}
