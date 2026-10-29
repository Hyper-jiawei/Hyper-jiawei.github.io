/* Content lives in ../content.json. No build step or external runtime. */
'use strict';
const $ = (selector) => document.querySelector(selector);
const text = (tag, value, className = '') => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
const safeUrl = (value) => { if (!value || typeof value !== 'string') return ''; try { const url = new URL(value, location.href); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const link = (label, url, className = '') => { const el = text('a', label, className); el.href = safeUrl(url); if (el.origin !== location.origin) { el.target = '_blank'; el.rel = 'noopener noreferrer'; } return el; };
const fallback = (container, label = '图片暂未就绪') => container.replaceChildren(text('span', label, 'empty-frame'));
const image = (src, alt, container) => { const url = safeUrl(src); if (!url) return; const img = document.createElement('img'); img.src = url; img.alt = alt; img.loading = 'lazy'; img.addEventListener('error', () => fallback(container), { once: true }); container.append(img); };
const files = (items = []) => { const box = text('div', '', 'file-links'); items.forEach(item => { if (safeUrl(item.url)) box.append(link(item.name || '查看文件', item.url)); }); return box; };
const themeButton = $('#theme');
function themeLabel() { const dark = document.documentElement.dataset.theme === 'dark'; themeButton.setAttribute('aria-label', dark ? '切换浅色主题' : '切换深色主题'); themeButton.setAttribute('aria-pressed', String(dark)); }
themeButton.addEventListener('click', () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('hyper-theme', next); } catch {} themeLabel(); });
themeLabel();
const dialog = $('#album-dialog');
$('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
function openAlbum(album) {
 $('#album-title').textContent = album.title; $('#album-description').textContent = album.description || ''; const photos = $('#album-photos'); photos.replaceChildren();
 if (!(album.photos || []).length) photos.append(text('p', '画册还没有照片。下一帧，留给未来。'));
 (album.photos || []).forEach(photo => { const figure = document.createElement('figure'); image(photo.src, photo.alt || album.title, figure); if (photo.caption) figure.append(text('figcaption', photo.caption)); photos.append(figure); });
 $('#album-files').replaceChildren(files(album.files)); dialog.showModal();
}
function render(data) {
 const profile = data.profile;
 document.title = `${profile.name} · Personal Collection`;
 $('#name').textContent = profile.name; $('#name-en').textContent = profile.nameEn; $('#bio').textContent = profile.bio; $('#intro').textContent = profile.intro;
 $('#hero-title').replaceChildren(); (data.featured.title || '').split('\n').forEach((line, i) => { if (i) $('#hero-title').append(document.createElement('br')); $('#hero-title').append(document.createTextNode(line)); });
 $('#hero-eyebrow').textContent = data.featured.eyebrow; $('#hero-sub').textContent = data.featured.subtitle;
 if (safeUrl(data.featured.image)) { $('#hero-frame').replaceChildren(); image(data.featured.image, data.featured.alt || '', $('#hero-frame')); }
 const facts = [['LOCATION', profile.location], ['ORGANIZATION', profile.organization], ['EXPLORING', (profile.interests || []).join(' / ')], ['ELSEWHERE', `@${profile.username}`]];
 facts.forEach(([label, value]) => { if (!value) return; const box = document.createElement('div'); box.append(text('span', label, 'fact-label mono'), text('span', value, 'fact-value')); $('#facts').append(box); });
 $('#contact').append(link('GitHub ↗', profile.github));
 if (profile.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) { const email = text('a', 'Email ↗'); email.href = `mailto:${profile.email}`; $('#contact').append(email); }
 $('#copyright').textContent = `© ${new Date().getFullYear()} ${profile.nameEn}`; $('#updated').textContent = `UPDATED ${profile.updated}`;
 const all = [...data.projects.map(item => ({ ...item, kind: 'projects' })), ...data.albums.map(item => ({ ...item, kind: 'albums' }))];
 ['projects', 'albums'].forEach(kind => { $(`#count-${kind}`).textContent = data[kind].length; }); $('#count-all').textContent = all.length;
 function show(filter) {
  const selected = all.filter(item => filter === 'all' || item.kind === filter).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const works = $('#works'); works.replaceChildren(); $('#result-count').textContent = `${selected.length} ENTRIES`;
  const groups = new Map(); selected.forEach(item => { const year = item.date ? item.date.slice(0, 4) : '待续'; if (!groups.has(year)) groups.set(year, []); groups.get(year).push(item); });
  if (!selected.length) works.append(text('p', '这一栏还没有内容。', 'empty-albums'));
  groups.forEach((items, year) => {
   const section = text('section', '', 'year-group'); const head = text('header', '', 'year-head'); head.append(text('h3', year), text('p', `${String(items.length).padStart(2, '0')} ENTRIES`, 'mono'));
   const grid = text('div', '', 'work-grid');
   items.forEach(item => {
    const article = document.createElement('article'); const card = item.kind === 'albums' ? document.createElement('button') : link('', item.url); card.className = 'card';
    if (item.kind === 'albums') { card.type = 'button'; card.addEventListener('click', () => openAlbum(item)); } card.setAttribute('aria-label', item.kind === 'albums' ? `打开画册：${item.title}` : `查看项目：${item.title}`);
    const visual = text('div', '', 'card-visual');
    if (safeUrl(item.cover)) image(item.cover, item.title, visual); else visual.append(text('span', item.kind === 'albums' ? '＋' : '</>', 'card-code'));
    visual.append(text('span', item.kind === 'albums' ? 'PHOTO / 待上传' : `PROJECT / ${item.language || 'CODE'}`, 'card-mark mono'), text('span', item.kind === 'albums' ? '＋' : '↗', 'corner-arrow'));
    const meta = text('div', '', 'card-meta'); meta.append(text('span', `°${String(all.indexOf(item) + 1).padStart(3, '0')}`, 'number mono'), text('span', item.category));
    card.append(visual, text('h4', item.title), meta, text('p', item.description || '', 'card-description')); article.append(card); if (item.files?.length) article.append(files(item.files)); grid.append(article);
   }); section.append(head, grid); works.append(section);
  });
 }
 document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); show(button.dataset.filter); }));
 show('all');
 const notes = $('#notes');
 if (!data.notes.length) { const empty = text('div', '', 'empty-notes'); empty.append(text('span', '新的想法，慢慢写。'), text('span', 'A LITTLE SPACE FOR FUTURE THOUGHTS', 'mono')); notes.append(empty); }
 [...data.notes].sort((a, b) => b.date.localeCompare(a.date)).forEach(note => { const article = text('article', '', 'note'); const time = text('time', note.date); time.dateTime = note.date; const body = document.createElement('div'); body.append(text('h3', note.title), text('p', note.text)); if (note.url && safeUrl(note.url)) body.append(link('继续阅读 ↗', note.url)); body.append(files(note.files)); article.append(time, body); notes.append(article); });
}
fetch('content.json').then(response => { if (!response.ok) throw new Error('无法加载 content.json'); return response.json(); }).then(render).catch(error => { console.error(error); $('#works').replaceChildren(text('p', '内容暂时无法加载。请刷新重试，或通过页眉的 GitHub 链接查看项目。维护者请检查 content.json 的格式。', 'load-error')); });
// Retire the old template worker, which otherwise serves stale pages to returning visitors.
if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration('./').then(registration => { if (registration && new URL(registration.active?.scriptURL || registration.installing?.scriptURL || location.href).pathname === '/sw.js') registration.update(); }).catch(() => {});
