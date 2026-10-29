// Headwear for the footer avatar: one piece per season, and a hat or hair ornament on
// the days whose customs involve one. Drawn as stickers (soft fills, a warm brown
// outline) in a 100 × 100 box that matches the avatar, mostly beyond its top-right edge.

const INK = "#5b4740";
const W = 2.6;

const f = (n: number) => n.toFixed(1);
const at = (x: number, y: number, rot: number, body: string, scale = 1) =>
  `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})">${body}</g>`;
const path = (d: string, fill: string, stroke = true) =>
  `<path d="${d}" fill="${fill}"${stroke ? ` stroke="${INK}" stroke-width="${W}" stroke-linejoin="round" stroke-linecap="round"` : ""}/>`;
const line = (d: string, colour: string, width: number) =>
  `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const circle = (x: number, y: number, r: number, fill: string, stroke = true) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"${stroke ? ` stroke="${INK}" stroke-width="${W}"` : ""}/>`;

/** A cherry blossom of radius r: five notched petals and a pale centre with stamens. */
function sakura(r: number, fill: string, centre: string) {
  const p = `M0 0C${f(-r * 0.62)} ${f(-r * 0.3)} ${f(-r * 0.58)} ${f(-r * 0.98)} ${f(-r * 0.2)} ${f(-r)}L0 ${f(-r * 0.84)}L${f(r * 0.2)} ${f(-r)}C${f(r * 0.58)} ${f(-r * 0.98)} ${f(r * 0.62)} ${f(-r * 0.3)} 0 0Z`;
  let petals = "";
  let stamens = "";
  for (let k = 0; k < 5; k++) {
    petals += `<g transform="rotate(${k * 72})">${path(p, fill)}</g>`;
    stamens += `<g transform="rotate(${k * 72})">${line(`M0 0L0 ${f(-r * 0.42)}`, centre, r * 0.09)}</g>`;
  }
  return petals + stamens + circle(0, 0, r * 0.16, centre, false);
}

/** A leaf pointing up, length l. */
function leaf(l: number, fill: string, vein = "#9fe0d0") {
  const w = l * 0.36;
  return path(`M0 0C${f(-w)} ${f(-l * 0.3)} ${f(-w * 0.8)} ${f(-l * 0.8)} 0 ${f(-l)}C${f(w * 0.8)} ${f(-l * 0.8)} ${f(w)} ${f(-l * 0.3)} 0 0Z`, fill) + line(`M0 ${f(-l * 0.15)}L0 ${f(-l * 0.7)}`, vein, l * 0.07);
}

/** A maple leaf of radius r, stem down. */
function maple(r: number, fill: string, vein: string) {
  const k = r / 44;
  const outline =
    "M0-44L8-24L24-34L20-14L42-16L28 0L40 12L18 12L20 32L4 20L0 42L-4 20L-20 32L-18 12L-40 12L-28 0L-42-16L-20-14L-24-34L-8-24Z";
  return (
    line(`M0 ${f(r * 0.4)}L0 ${f(r * 1.15)}`, INK, W * 1.2) +
    `<path d="${outline}" transform="scale(${k.toFixed(3)})" fill="${fill}" stroke="${INK}" stroke-width="${f(W / k)}" stroke-linejoin="round"/>` +
    line(`M0 ${f(r * 0.6)}L0 ${f(-r * 0.6)}M0 ${f(r * 0.05)}L${f(-r * 0.55)} ${f(-r * 0.3)}M0 ${f(r * 0.05)}L${f(r * 0.55)} ${f(-r * 0.3)}`, vein, r * 0.07)
  );
}

/** A ginkgo leaf of radius r: a notched fan on a stem. */
function ginkgo(r: number) {
  const k = r / 18;
  return (
    line(`M0 0L0 ${f(r * 0.75)}`, INK, W * 1.1) +
    `<path d="M0 0C-4-6-14-11-16-18C-9-24-3-22 0-18C3-22 9-24 16-18C14-11 4-6 0 0Z" transform="scale(${k.toFixed(3)})" fill="#f5cf55" stroke="${INK}" stroke-width="${f(W / k)}" stroke-linejoin="round"/>` +
    line(`M0 ${f(-r * 0.2)}L${f(-r * 0.45)} ${f(-r * 0.8)}M0 ${f(-r * 0.2)}L${f(r * 0.45)} ${f(-r * 0.8)}`, "#fbe6a0", r * 0.06)
  );
}

function snowflake(r: number, fill: string) {
  let arms = "";
  for (let k = 0; k < 6; k++)
    arms += `<g transform="rotate(${k * 60})">${line(`M0 0L0 ${f(-r)}M0 ${f(-r * 0.55)}L${f(-r * 0.28)} ${f(-r * 0.8)}M0 ${f(-r * 0.55)}L${f(r * 0.28)} ${f(-r * 0.8)}`, INK, r * 0.34)}</g>`;
  let inner = "";
  for (let k = 0; k < 6; k++)
    inner += `<g transform="rotate(${k * 60})">${line(`M0 0L0 ${f(-r)}M0 ${f(-r * 0.55)}L${f(-r * 0.28)} ${f(-r * 0.8)}M0 ${f(-r * 0.55)}L${f(r * 0.28)} ${f(-r * 0.8)}`, fill, r * 0.16)}</g>`;
  return arms + inner;
}

function pompom(r: number, fill: string, shade: string) {
  let tufts = "";
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    tufts += circle(Math.round(Math.cos(a) * r * 6.2) / 10, Math.round(Math.sin(a) * r * 6.2) / 10, r * 0.48, fill);
  }
  return tufts + circle(0, 0, r * 0.7, fill, false) + circle(-r * 0.2, -r * 0.2, r * 0.25, shade, false);
}

// ---------- The pieces ----------

/** Puts a piece on the head: its origin goes to the point at `deg` round the avatar
 *  (0 = right, -90 = top) and `r` from its centre, with its "up" pointing outward. */
const worn = (deg: number, r: number, body: string, scale = 1, lean = 0) => {
  const a = (deg * Math.PI) / 180;
  return at(50 + Math.cos(a) * r, 50 + Math.sin(a) * r, deg + 90 + lean, body, scale);
};

// Hair ornaments sit in the hair over the top-right edge, as in the reference sticker.
const spring =
  worn(-62, 50, leaf(18, "#73c7b5"), 1, -50) +
  worn(-20, 54, leaf(16, "#73c7b5"), 1, 60) +
  worn(-70, 54, circle(0, 0, 6, "#f7c2cc") + path("M-5 4C-2 9 2 9 5 4C2 6-2 6-5 4Z", "#73c7b5")) +
  worn(-56, 46, sakura(13, "#f8bfca", "#fff3f0"), 1, 10) +
  worn(-38, 51, sakura(17, "#f9c9d2", "#fff3f0"), 1, -20) +
  worn(-16, 60, circle(0, 0, 4.5, "#f7c2cc"));

// Hats sit on the crown, tipped to the right, their brims over the hair.
const summer = worn(-64, 40,
  // Straw hat: brim, crown, red ribbon and a little daisy.
  at(0, -6, 0,
    path("M-34 6C-30 -2 30 -2 34 6C30 14-30 14-34 6Z", "#f2d48c") +
    path("M-18 4C-18 -18 18 -18 18 4C10 8-10 8-18 4Z", "#f6dfa2") +
    path("M-18 -2C-10 2 10 2 18 -2L18 4C10 8-10 8-18 4Z", "#ea6b5f") +
    line("M-26 7C-14 10 14 10 26 7", "#d9b46a", 1.4) +
    at(13, -4, 0, sakura(6.5, "#fffaf0", "#f6c94a")),
  ), 1.05);

const autumn =
  worn(-14, 54, ginkgo(13), 1, 20) +
  worn(-58, 47, maple(14, "#f29a4b", "#ffd9b0"), 1, -25) +
  worn(-34, 54, maple(18, "#e9614b", "#ffc7b8"), 1, 10);

const winter = worn(-62, 40,
  // Knit beanie with a fold-up band and a pom-pom, pulled down over the head.
  at(0, -15, 0,
    path("M-22 10C-24 -14 24 -14 22 10Z", "#7fb6d6") +
    line("M-12 -4L-12 8M-4 -8L-4 9M4 -8L4 9M12 -4L12 8", "#a9d2ea", 2.2) +
    path("M-25 8C-12 4 12 4 25 8L25 17C12 13-12 13-25 17Z", "#f3ead9") +
    line("M-18 9L-18 15M-9 7L-9 13M0 7L0 13M9 7L9 13M18 9L18 15", "#d9cbb2", 1.6) +
    at(0, -18, 0, pompom(9, "#fbf6ee", "#ffffff")),
  ), 1.1) +
  worn(-20, 56, snowflake(7, "#bfe3f6"));

const christmas = worn(-62, 40,
  at(0, -17, 0,
    path("M-22 12C-18 -10 0 -22 16 -24C20 -18 22 -10 22 12Z", "#e85a50") +
    path("M14 -24C24 -24 30 -14 30 -6C26 -10 20 -14 14 -16Z", "#e85a50") +
    path("M-25 10C-12 6 12 6 25 10L25 19C12 15-12 15-25 19Z", "#fbf6ee") +
    at(30, -4, 0, pompom(7.5, "#fbf6ee", "#ffffff")),
  ), 1.1);

const halloween =
  worn(-64, 39,
    // Witch hat with a bent tip, an orange band and a buckle.
    at(0, -18, 0,
      path("M-30 18C-30 10 30 10 30 18C30 24-30 24-30 18Z", "#7d6bc4") +
      path("M-16 14C-12 0-6 -14 2 -22C8 -28 16 -26 20 -18C14 -20 10 -18 9 -12C10 -2 14 8 16 14Z", "#8f7dd6") +
      path("M-15 9C-6 12 8 12 15 9L16 15C8 18-6 18-16 15Z", "#f39a3d") +
      path("M-3 9L5 9L5 16L-3 16Z", "#f6d36b"),
    ), 1.05) +
  worn(-14, 60, path("M0 0C-4 -4-9 -4-12 0C-9 0-8 2-8 4C-5 2-2 2 0 4C2 2 5 2 8 4C8 2 9 0 12 0C9 -4 4 -4 0 0Z", "#4b3b62"), 1, -90);

const birthday =
  worn(-56, 41,
    // Party hat with stripes and a pom-pom on top, worn at an angle, confetti around.
    at(0, -19, 0,
      path("M-18 18L0 -26L18 18C8 22-8 22-18 18Z", "#f7b2c4") +
      line("M-11 0L8 -6M-15 10L14 2", "#f6d36b", 4.2) +
      line("M-5 -12L4 -15", "#8fd0e8", 3.6) +
      at(0, -28, 0, pompom(6, "#8fd0e8", "#d9f1fa")),
    ), 1.05, 6) +
  circle(52, -8, 2.6, "#f6d36b", false) +
  circle(110, 30, 2.6, "#8fd0e8", false) +
  path("M104 8l5 2-2 5-5-2z", "#f39a3d", false);

// 戴柳: a ring of willow round the head, its leaves trailing from the twig.
const willowArc = (() => {
  const pts = [];
  for (let d = -128; d <= -8; d += 10) {
    const a = (d * Math.PI) / 180;
    pts.push(`${f(50 + Math.cos(a) * 47)} ${f(50 + Math.sin(a) * 47)}`);
  }
  return `M${pts.join("L")}`;
})();
const qingming =
  line(willowArc, INK, W * 2.4) +
  line(willowArc, "#8a6a4a", W * 1.1) +
  [-120, -106, -92, -78, -64, -50, -36, -22, -10].map((d, i) => worn(d, 48, leaf(15 + (i % 3) * 3, i % 2 ? "#9bd27f" : "#86c46a", "#c8ecb4"), 1, 55 + (i % 2) * 15)).join("");

// 插茱萸: a sprig of dogwood tucked into the hair, berries out past the edge.
const chongyang = worn(-40, 40,
  line("M0 6L0 -22", INK, W * 2.2) +
  line("M0 6L0 -22", "#8a6a4a", W * 0.9) +
  at(-2, -10, -55, leaf(15, "#6fb36a", "#bfe6b5")) +
  at(2, -14, 55, leaf(14, "#6fb36a", "#bfe6b5")) +
  [[0, -28], [-8, -24], [8, -24], [-5, -33], [5, -33], [0, -20]].map(([x, y]) => circle(x, y, 5, "#e2493b") + circle(x - 1.6, y - 1.6, 1.4, "#ffb3a8", false)).join(""),
  1.05);

export const WEAR = { spring, summer, autumn, winter, christmas, halloween, birthday, qingming, chongyang } as const;
export type Wear = keyof typeof WEAR;
export const WEAR_LABEL: Record<Wear, string> = {
  spring: "春 · 樱花",
  summer: "夏 · 草帽",
  autumn: "秋 · 枫叶",
  winter: "冬 · 毛线帽",
  christmas: "圣诞节 · 圣诞帽",
  halloween: "万圣节 · 巫师帽",
  birthday: "生日 · 派对帽",
  qingming: "清明 · 戴柳",
  chongyang: "重阳 · 插茱萸",
};

/** Markup for an overlay on the avatar: same box, drawn mostly past its top-right edge. */
export function wearMarkup(wear: Wear) {
  return `<svg class="avatar-wear" viewBox="0 0 100 100" aria-hidden="true" data-wear="${wear}">${WEAR[wear]}</svg>`;
}
