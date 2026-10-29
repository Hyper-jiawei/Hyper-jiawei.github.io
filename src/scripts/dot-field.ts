// Equally spaced ASCII characters; the pointer changes and displaces nearby cells.
// Render on demand, with a static composition on touch / reduced-motion devices.
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const calm = matchMedia('(prefers-reduced-motion: reduce)');
interface Character { x: number; y: number; glyph: string; alpha: number }
interface Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  host: HTMLElement;
  cover: boolean;
  width: number;
  height: number;
  characters: Character[];
}
const layers: Layer[] = [];
const field = document.querySelector<HTMLElement>('.dot-field');
const hero = document.querySelector<HTMLElement>('.article-hero.has-cover');
let ink = '';
let pointerX = -9999, pointerY = -9999, x = pointerX, y = pointerY;
let target = 0, strength = 0, frame = 0;

function addLayer(host: HTMLElement, cover: boolean) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return; // keep the CSS background if canvas is unavailable
  canvas.className = `dot-light ${cover ? 'dot-light-hero' : 'dot-light-page'}`;
  canvas.setAttribute('aria-hidden', 'true');
  if (cover) host.prepend(canvas); else host.after(canvas);
  layers.push({ canvas, ctx, host, cover, width: 0, height: 0, characters: [] });
}
if (field && !hero) addLayer(field, false);
if (hero) addLayer(hero, true);

function readInk() {
  const style = getComputedStyle(document.documentElement);
  ink = style.getPropertyValue('--fg').trim();
}
function measure() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  for (const layer of layers) {
    const box = layer.canvas.getBoundingClientRect();
    layer.width = box.width;
    layer.height = box.height;
    layer.canvas.width = Math.round(box.width * dpr);
    layer.canvas.height = Math.round(box.height * dpr);
    layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layer.characters = [];
    const spacing = 24;
    const columns = Math.max(0, Math.floor((box.width - 24) / spacing) + 1);
    const startX = (box.width - (columns - 1) * spacing) / 2;
    for (let py = 12; py < box.height - 12; py += spacing) {
      const fade = Math.max(0, 1 - py / (box.height * 0.95));
      for (let column = 0; column < columns; column++) {
        layer.characters.push({
          x: startX + column * spacing,
          y: py,
          glyph: '+',
          alpha: 0.14 * fade,
        });
      }
    }
    layer.host.classList.add('ascii-ready');
  }
  paint();
}
function paint() {
  for (const layer of layers) {
    const { ctx, width, height } = layer;
    ctx.clearRect(0, 0, width, height);
    const box = layer.canvas.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) continue;
    const cx = x - box.left, cy = y - box.top;
    ctx.font = '10px "JetBrains Mono Variable", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const character of layer.characters) {
      const dx = character.x - cx, dy = character.y - cy;
      const distance = Math.hypot(dx, dy);
      const influence = Math.exp(-distance * distance / (2 * 105 * 105)) * strength;
      const displacement = influence * 10;
      const px = character.x + dx / Math.max(distance, 1) * displacement;
      const py = character.y + dy / Math.max(distance, 1) * displacement;
      ctx.fillStyle = layer.cover ? '#ffffff' : ink;
      ctx.globalAlpha = Math.min(0.45, character.alpha + influence * 0.22 * Math.max(0, 1 - py / height));
      const glyph = influence > 0.7 ? '#' : influence > 0.4 ? '*' : influence > 0.15 ? ':' : character.glyph;
      ctx.fillText(glyph, px, py);
    }
    ctx.globalAlpha = 1;
  }
}
function tick() {
  x += (pointerX - x) * 0.16;
  y += (pointerY - y) * 0.16;
  strength += (target - strength) * 0.12;
  paint();
  const moving = Math.abs(pointerX - x) + Math.abs(pointerY - y) > 0.3 || Math.abs(target - strength) > 0.003;
  frame = moving ? requestAnimationFrame(tick) : 0;
}
function kick() { if (!frame) frame = requestAnimationFrame(tick); }
function release() { target = 0; kick(); }
addEventListener('pointermove', event => {
  if (!fine.matches || calm.matches || event.pointerType !== 'mouse') return;
  if (strength < 0.01) { x = event.clientX; y = event.clientY; }
  pointerX = event.clientX;
  pointerY = event.clientY;
  target = 1;
  kick();
}, { passive: true });
document.documentElement.addEventListener('pointerleave', release);
addEventListener('blur', release);
addEventListener('scroll', kick, { passive: true });
calm.addEventListener('change', () => {
  if (calm.matches) {
    cancelAnimationFrame(frame); frame = 0; target = strength = 0; paint();
  }
});
fine.addEventListener('change', release);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(frame); frame = 0; target = strength = 0; }
  else paint();
});
const resize = new ResizeObserver(measure);
layers.forEach(layer => resize.observe(layer.canvas));
new MutationObserver(() => { readInk(); paint(); }).observe(document.documentElement, {
  attributes: true, attributeFilter: ['data-theme'],
});
addEventListener('pagehide', () => { cancelAnimationFrame(frame); resize.disconnect(); }, { once: true });
readInk();
measure();
