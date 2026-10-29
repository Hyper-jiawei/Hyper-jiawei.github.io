// Click animations for the festive marks. Each one is acted out by the drawing's own
// parts: the sprout regrows and its flower opens, the steam over the dumpling rises,
// the two stars of 七夕 cross the bridge to meet. Nothing appears out of thin air:
// the few particles there are come out of something in the drawing (a splash where a
// seedling goes into the water, sparks where the lightning strikes). Loaded on the
// first click. Particle lengths are in the wordmark's units (a mark is about 330
// across); a scene's lengths are in the drawing's own 100-unit box.

type Frames = Keyframe[];
interface Motion {
  frames: Frames;
  duration: number;
  origin?: string;
}
interface Emit {
  shape: keyof typeof SHAPES;
  colours: string[];
  n: number;
  /** Spread of the start point, in units. */
  jitter?: number;
  /** Direction in degrees (0 = right, -90 = up, 90 = down) and its spread either side. */
  angle?: number;
  spread?: number;
  dist: [number, number];
  /** Extra drop (positive) or lift (negative) by the end. */
  gravity?: number;
  size: [number, number];
  /** Scale at the start and at the end, relative to size. */
  grow?: [number, number];
  spin?: number;
  duration: [number, number];
  delay?: number;
  /** Spread the particles' start times over this many ms. */
  stagger?: number;
  stroke?: boolean;
}
interface PartOptions {
  duration: number;
  delay?: number;
  /** Transform origin within the part's own box, e.g. "50% 100%" for its foot; or "user"
   *  for transforms written out in the drawing's coordinates. */
  origin?: string;
  iterations?: number;
  easing?: string;
}
interface Scene {
  /** The drawing's top-level shapes, in drawing order. */
  c: Element[];
  /** Animates some shapes together (wrapped in a group, so their own transforms stay). */
  part: (els: Element | Element[], frames: Frames, o: PartOptions) => SVGGElement;
  /** Particles from a point of the drawing. */
  from: (x: number, y: number, e: Emit) => void;
  /** Animates a shape's paint, which needs no wrapping. */
  paint: (el: Element, frames: Frames, o: PartOptions) => void;
  art: SVGGElement;
  layer: Element;
  toLayer: (x: number, y: number) => DOMPoint;
}
interface Effect {
  motion: Motion;
  scene?: (s: Scene) => void;
}

// Particle shapes, drawn about (0, 0) in a box 20 units across.
const SHAPES = {
  drop: "M0-13C4-6 8-2 8 3A8 8 0 0 1-8 3C-8-2-4-6 0-13Z",
  sparkle: "M0-12L3-3L12 0L3 3L0 12L-3 3L-12 0L-3-3Z",
  flake: "M-1.5-11H1.5V-2.6L8.8-6.8L10.3-4.2L3-0L10.3 4.2L8.8 6.8L1.5 2.6V11H-1.5V2.6L-8.8 6.8L-10.3 4.2L-3 0L-10.3-4.2L-8.8-6.8L-1.5-2.6Z",
  seed: "M0-8C4-4 4 4 0 8C-4 4-4-4 0-8Z",
  steam: "M0 10C-6 5 6 0 0-5C-6-10 6-12 0-16",
  ring: "M-10 0a10 4 0 1 0 20 0a10 4 0 1 0-20 0Z",
  streak: "M-10 0H10",
};

const RED = "#e2493b";
const GOLD = "#f2b21f";
const BLUE = "#4c9fd8";
const SKY = "#8ec3ea";
const STEAM = "#9fb2c4";
const NS = "http://www.w3.org/2000/svg";
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const T = (s: string): Keyframe => ({ transform: s });

// ---------- Whole-mark moves ----------
const still = (duration: number): Motion => ({ duration, frames: [T("none"), T("none")] });
const hop: Motion = {
  duration: 1100,
  frames: [
    { transform: "translateY(0) scale(1, 1)", easing: "ease-out" },
    { transform: "translateY(30px) scale(1.16, 0.82)", offset: 0.14, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
    { transform: "translateY(-340px) scale(0.94, 1.08)", offset: 0.5, easing: "cubic-bezier(0.6, 0, 0.8, 0.4)" },
    { transform: "translateY(20px) scale(1.14, 0.86)", offset: 0.8, easing: "ease-out" },
    T("translateY(0) scale(1, 1)"),
  ],
};
const sway = (deg: number, duration: number, origin = "50% 100%"): Motion => ({
  origin,
  duration,
  frames: [0, -deg, deg * 0.85, -deg * 0.6, deg * 0.35, -deg * 0.15, 0].map((d) => T(`rotate(${d}deg)`)),
});
const shake = (dx: number, duration: number): Motion => ({
  duration,
  frames: [0, -dx, dx, -dx * 0.8, dx * 0.8, -dx * 0.5, dx * 0.5, 0].map((x, i) => T(`translateX(${x}px) rotate(${i % 2 ? -3 : 3}deg)`)),
});
const swingTop: Motion = {
  origin: "50% 0%",
  duration: 1600,
  frames: [0, 20, -16, 11, -7, 3, 0].map((d) => T(`rotate(${d}deg)`)),
};
const heartbeat: Motion = {
  duration: 1000,
  frames: [1, 1.28, 1, 1.2, 1].map((s, i) => ({ transform: `scale(${s})`, offset: [0, 0.18, 0.4, 0.58, 1][i] })),
};
// The swallow faces left: it climbs away forwards, leaves, and glides back in from
// behind, so it never turns round.
const glide: Motion = {
  duration: 1800,
  frames: [
    { transform: "translate(0, 0) rotate(0deg) scale(1)", opacity: 1, easing: "ease-in" },
    { transform: "translate(-60px, 20px) rotate(-8deg) scale(1)", opacity: 1, offset: 0.1, easing: "ease-in" },
    { transform: "translate(-320px, -200px) rotate(18deg) scale(0.9)", opacity: 1, offset: 0.36, easing: "linear" },
    { transform: "translate(-460px, -280px) rotate(22deg) scale(0.8)", opacity: 0, offset: 0.46 },
    { transform: "translate(460px, -160px) rotate(-10deg) scale(0.8)", opacity: 0, offset: 0.5, easing: "ease-out" },
    { transform: "translate(300px, -90px) rotate(-12deg) scale(0.9)", opacity: 1, offset: 0.6, easing: "ease-in-out" },
    { transform: "translate(30px, 10px) rotate(-4deg) scale(1)", opacity: 1, offset: 0.88 },
    { transform: "translate(0, 0) rotate(0deg) scale(1)", opacity: 1 },
  ],
};
const buzz: Motion = {
  duration: 1400,
  frames: [[0, 0], [90, -120], [20, -180], [140, -260], [-60, -230], [-130, -120], [-30, -60], [0, 0]].map(([x, y], i) =>
    T(`translate(${x}px, ${y}px) rotate(${i % 2 ? 10 : -10}deg)`),
  ),
};
const kite: Motion = {
  duration: 1800,
  frames: [
    T("translate(0, 0) rotate(0deg)"),
    T("translate(40px, -260px) rotate(-12deg)"),
    T("translate(-30px, -320px) rotate(10deg)"),
    T("translate(30px, -300px) rotate(-8deg)"),
    T("translate(0, 0) rotate(0deg)"),
  ],
};
const float: Motion = {
  duration: 2000,
  frames: [
    T("translate(0, 0) rotate(0deg)"),
    { transform: "translate(40px, -420px) rotate(6deg)", offset: 0.45 },
    { transform: "translate(-20px, -380px) rotate(-5deg)", offset: 0.6 },
    T("translate(0, 0) rotate(0deg)"),
  ],
};
const flutterDown: Motion = {
  duration: 1800,
  frames: [
    { transform: "translate(0, 0) rotate(0deg)", easing: "ease-out" },
    { transform: "translate(0, -300px) rotate(-30deg)", offset: 0.2 },
    { transform: "translate(80px, -220px) rotate(25deg)", offset: 0.42 },
    { transform: "translate(-70px, -130px) rotate(-20deg)", offset: 0.62 },
    { transform: "translate(40px, -50px) rotate(10deg)", offset: 0.82 },
    T("translate(0, 0) rotate(0deg)"),
  ],
};
const scuttle: Motion = {
  duration: 1200,
  frames: [0, -70, -70, -140, -140, 0, 0, 70, 70, 0].map((x, i) => T(`translate(${x}px, ${i % 2 ? -24 : 0}px)`)),
};
const drop: Motion = {
  origin: "50% 100%",
  duration: 1300,
  frames: [
    { transform: "translateY(0) scale(1, 1)", easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
    { transform: "translateY(-300px) scale(1, 1)", offset: 0.35, easing: "cubic-bezier(0.6, 0, 0.9, 0.5)" },
    { transform: "translateY(0) scale(1.25, 0.72)", offset: 0.6, easing: "ease-out" },
    { transform: "translateY(-60px) scale(0.95, 1.06)", offset: 0.75, easing: "ease-in" },
    { transform: "translateY(0) scale(1.06, 0.95)", offset: 0.88 },
    T("translateY(0) scale(1, 1)"),
  ],
};
const tip: Motion = {
  origin: "50% 100%",
  duration: 1300,
  frames: [
    { transform: "translateY(0) rotate(0deg)", easing: "ease-out" },
    { transform: "translateY(-140px) rotate(-24deg)", offset: 0.3 },
    { transform: "translateY(-140px) rotate(-24deg)", offset: 0.6, easing: "ease-in" },
    { transform: "translateY(10px) rotate(4deg)", offset: 0.85 },
    T("translateY(0) rotate(0deg)"),
  ],
};
const shiver: Motion = {
  duration: 1800,
  frames: Array.from({ length: 15 }, (_, i) => (i === 0 || i === 14 ? T("translate(0, 0)") : T(`translate(${i % 2 ? -8 : 8}px, ${i % 3 ? -4 : 3}px)`))),
};

// ---------- Frame builders for parts ----------
/** Shrinks away at the start, then comes back from `at` (0–1) with a little overshoot. */
const regrow = (at: number, from = "scale(0)", over = "scale(1.12)"): Frames => [
  T("none"),
  { transform: from, offset: 0.08 },
  { transform: from, offset: at, easing: "cubic-bezier(0.3, 0, 0.3, 1.4)" },
  { transform: over, offset: Math.min(0.92, at + 0.18) },
  T("none"),
];
/** A hop at `at`, lasting `len` of the whole. */
const bob = (dy: number, at: number, len = 0.22): Frames => [
  T("none"),
  { transform: "none", offset: at },
  { transform: `translateY(${-dy}px) scale(0.96, 1.05)`, offset: at + len * 0.45, easing: "ease-in" },
  { transform: "translateY(0) scale(1.08, 0.9)", offset: at + len * 0.8 },
  { transform: "none", offset: Math.min(0.99, at + len) },
  T("none"),
];
const twinkle = (at: number): Frames => [
  T("none"),
  { transform: "none", offset: at },
  { transform: "scale(1.5) rotate(36deg)", offset: Math.min(0.95, at + 0.12) },
  { transform: "none", offset: Math.min(0.98, at + 0.26) },
  T("none"),
];
/** Rises and fades like vapour, then forms again where it was. */
const rise: Frames = [
  { transform: "none", opacity: 1, easing: "ease-in" },
  { transform: "translateY(-26px) scale(1.1, 1.3)", opacity: 0, offset: 0.45 },
  { transform: "translateY(10px) scale(0.9, 0.6)", opacity: 0, offset: 0.55, easing: "ease-out" },
  { transform: "none", opacity: 1 },
];

// ---------- Particles that come out of the drawing ----------
const splash = (colours = [BLUE, SKY], n = 5): Emit => ({
  shape: "drop", colours, n, angle: -90, spread: 55, dist: [90, 170], gravity: 160, size: [20, 30], duration: [600, 800],
});
const ripple = (colour = BLUE): Emit => ({
  shape: "ring", colours: [colour], n: 2, dist: [0, 0], size: [40, 40], grow: [1, 7], duration: [1000, 1000], stagger: 400, stroke: true,
});
const sparks = (colours = [GOLD, "#ffd84a"], n = 6): Emit => ({
  shape: "sparkle", colours, n, angle: -90, spread: 80, dist: [100, 200], gravity: 40, size: [30, 46], grow: [0.4, 0.1], spin: 90, duration: [500, 700],
});

// ---------- The marks ----------
const EFFECTS: Record<string, Effect> = {
  // The sprout pulls back into the ground and grows again: stem, then leaves, then the flower.
  立春: {
    motion: still(1700),
    scene: ({ c, part }) => {
      part(c[0], regrow(0.1, "scale(1, 0)", "scale(1, 1.08)"), { duration: 1700, origin: "50% 100%" });
      part(c[1], regrow(0.3, "rotate(50deg) scale(0)", "rotate(-6deg) scale(1.05)"), { duration: 1700, origin: "100% 100%" });
      part(c[2], regrow(0.36, "rotate(-50deg) scale(0)", "rotate(6deg) scale(1.05)"), { duration: 1700, origin: "0% 100%" });
      part(c.slice(3, 9), regrow(0.52, "rotate(-90deg) scale(0)", "rotate(10deg) scale(1.2)"), { duration: 1700, origin: "50% 50%" });
    },
  },
  // Each raindrop falls away and a new one gathers in its place.
  雨水: {
    motion: still(1700),
    scene: ({ c, part }) =>
      c.forEach((el, i) =>
        part(el, [
          { transform: "none", opacity: 1, easing: "ease-in" },
          { transform: "translateY(40px) scale(0.85, 1.25)", opacity: 0, offset: 0.35 },
          { transform: "translateY(-14px) scale(0)", opacity: 0, offset: 0.4, easing: "cubic-bezier(0.3, 0, 0.3, 1.4)" },
          { transform: "none", opacity: 1, offset: 0.75 },
          T("none"),
        ], { duration: 1300, delay: i * 200, origin: "50% 100%" }),
      ),
  },
  // The cloud darkens and rumbles, the bolt strikes and flickers, sparks fly where it lands.
  惊蛰: {
    motion: still(1500),
    scene: ({ c, part, paint, from }) => {
      paint(c[0], [{ fill: "#7d8fa6" }, { fill: "#56657a", offset: 0.2 }, { fill: "#56657a", offset: 0.7 }, { fill: "#7d8fa6" }], { duration: 1400 });
      part(c[0], Array.from({ length: 11 }, (_, i) => T(i % 10 ? `translateX(${i % 2 ? -3 : 3}px)` : "none")), { duration: 1400 });
      part(c[1], [
        T("none"),
        { transform: "scale(1, 0)", opacity: 0, offset: 0.1 },
        { transform: "scale(1, 0)", opacity: 0, offset: 0.25, easing: "cubic-bezier(0.2, 0, 0.2, 1)" },
        { transform: "scale(1.05, 1.15)", opacity: 1, offset: 0.32 },
        { opacity: 0.2, transform: "none", offset: 0.4 },
        { opacity: 1, transform: "none", offset: 0.46 },
        { opacity: 0.4, transform: "none", offset: 0.52 },
        { opacity: 1, transform: "none" },
      ], { duration: 1500, origin: "50% 0%" });
      from(42, 98, { ...sparks(), delay: 470 });
    },
  },
  // The swallow flies off forwards and glides back in from behind.
  春分: { motion: glide },
  // The kite climbs; its tail streams and swings behind it.
  清明: {
    motion: kite,
    scene: ({ c, part }) => void part(c.slice(3, 5), [0, 18, -14, 12, -10, 6, 0].map((d) => T(`rotate(${d}deg)`)), { duration: 1800, origin: "50% 0%" }),
  },
  // Two raindrops land on the peony, which dips under them and springs back.
  谷雨: {
    motion: still(1700),
    scene: ({ c, part, from }) => {
      const fall = (dx: number, dy: number): Frames => [
        { transform: "none", opacity: 1, easing: "ease-in" },
        { transform: `translate(${dx}px, ${dy}px) scale(0.8, 1.2)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${dx}px, ${dy + 4}px) scale(1.4, 0.3)`, opacity: 0, offset: 0.36 },
        { transform: "scale(0)", opacity: 0, offset: 0.6, easing: "ease-out" },
        { transform: "none", opacity: 1 },
      ];
      part(c[0], fall(16, 24), { duration: 1600 });
      part(c[1], fall(-12, 10), { duration: 1600, delay: 120 });
      part(c[3], [0, 0, -8, 5, -2, 0].map((d) => T(`rotate(${d}deg)`)), { duration: 1600, origin: "100% 50%" });
      part(c.slice(4, 7), [T("none"), { transform: "none", offset: 0.3 }, { transform: "rotate(-6deg) scale(1.06, 0.9)", offset: 0.4 }, { transform: "rotate(4deg) scale(0.97, 1.04)", offset: 0.55 }, T("none")], { duration: 1600, origin: "50% 100%" });
      from(38, 30, { ...splash(), n: 4, delay: 500 });
    },
  },
  // The egg in its net swings from the string.
  立夏: { motion: swingTop },
  // The ear fills out grain by grain from the bottom up, while the stalk sways.
  小满: {
    motion: sway(10, 1700),
    scene: ({ c, part }) =>
      [7, 8, 5, 6, 3, 4, 1, 2, 9].forEach((i, k) =>
        part(c[i], [T("none"), { transform: "none", offset: 0.1 + k * 0.07 }, { transform: "scale(1.35)", offset: 0.18 + k * 0.07 }, { transform: "none", offset: Math.min(0.99, 0.3 + k * 0.07) }, T("none")], { duration: 1700 }),
      ),
  },
  // The seedlings go into the paddy one at a time, each with a splash.
  芒种: {
    motion: still(1900),
    scene: ({ c, part, from }) =>
      c.slice(1).forEach((el, i) => {
        const at = 0.18 + i * 0.2;
        part(el, [
          T("none"),
          { transform: "scale(0.6, 0)", opacity: 0, offset: 0.1 },
          { transform: "scale(0.6, 0)", opacity: 0, offset: at },
          { transform: "translateY(-12px) scale(0.9, 0.5)", opacity: 1, offset: at + 0.02, easing: "cubic-bezier(0.3, 0, 0.3, 1.5)" },
          { transform: "translateY(0) scale(1, 1.08)", offset: at + 0.12 },
          { transform: "none", offset: Math.min(0.95, at + 0.2) },
          T("none"),
        ], { duration: 1900, origin: "50% 100%" });
        from([25, 50, 76][i], 84, { ...splash(), delay: 1900 * at });
      }),
  },
  // Bites come out of the slice one after another, spilling seeds; then it is whole again.
  夏至: { motion: still(2300), scene: bite },
  // The lotus opens wider, its inner petals turning, and the pad ripples.
  小暑: {
    motion: still(1600),
    scene: ({ c, part, from }) => {
      part(c[0], [T("none"), { transform: "scale(1.08, 0.9)", offset: 0.5 }, T("none")], { duration: 1600 });
      part(c.slice(2, 7), [T("none"), { transform: "rotate(-18deg) scale(0.7)", offset: 0.2 }, { transform: "rotate(4deg) scale(1.15)", offset: 0.55 }, T("none")], { duration: 1600 });
      part(c.slice(7, 10), [T("none"), { transform: "rotate(30deg) scale(0.6)", offset: 0.25 }, { transform: "rotate(-6deg) scale(1.2)", offset: 0.6 }, T("none")], { duration: 1600 });
      from(50, 82, { ...ripple("#3f9a52"), delay: 500 });
    },
  },
  // The fan folds shut, opens with a snap, and fans; the air it moves streams off its edge.
  大暑: {
    motion: still(1700),
    scene: ({ c, part, from }) => {
      part(c.slice(0, 7), [
        T("none"),
        { transform: "scaleX(0.12)", offset: 0.2, easing: "cubic-bezier(0.2, 0, 0.2, 1.4)" },
        { transform: "none", offset: 0.4 },
        { transform: "rotate(-22deg)", offset: 0.55 },
        { transform: "rotate(20deg)", offset: 0.7 },
        { transform: "rotate(-10deg)", offset: 0.85 },
        T("none"),
      ], { duration: 1700, origin: "50% 100%" });
      from(50, 16, { shape: "streak", colours: [STEAM, SKY], n: 5, jitter: 60, angle: -60, spread: 40, dist: [160, 260], size: [50, 70], grow: [1, 0.2], duration: [500, 700], stroke: true, delay: 850, stagger: 500 });
    },
  },
  // The maple leaf lets go, flutters down and settles back.
  立秋: { motion: flutterDown },
  // The river lantern bobs on the water; its flame flickers; rings spread from it.
  处暑: {
    motion: still(1700),
    scene: ({ c, part, from }) => {
      part(c[0], [T("none"), { transform: "scaleX(1.06)", offset: 0.4 }, T("none")], { duration: 1700 });
      const lantern = part(c.slice(1, 15), [0, -10, 3, -6, 2, -2, 0].map((y, i) => T(`translateY(${y}px) rotate(${[0, -4, 3, -2, 1, -1, 0][i]}deg)`)), { duration: 1700, origin: "50% 100%" });
      part(Array.from(lantern.children).slice(12, 14), [1, 0.8, 1.15, 0.85, 1.2, 0.9, 1].map((s, i) => T(`scale(${i % 2 ? 1.1 : 0.9}, ${s})`)), { duration: 1500, origin: "50% 100%" });
      from(50, 82, ripple());
    },
  },
  // The dewdrops run down the blade, drip off its foot, and gather again.
  白露: {
    motion: sway(5, 2200),
    scene: ({ c, part }) =>
      ([[c[2], -24, 44, 0], [c[3], -10, 30, 350]] as const).forEach(([el, dx, dy, delay]) =>
        part(el, [
          { transform: "none", opacity: 1, easing: "ease-in" },
          { transform: "scale(0.9, 1.15)", offset: 0.12, easing: "cubic-bezier(0.5, 0, 0.8, 0.6)" },
          { transform: `translate(${dx}px, ${dy}px) scale(0.85, 1.2)`, offset: 0.45, easing: "ease-in" },
          { transform: `translate(${dx - 4}px, ${dy + 60}px) scale(0.8, 1.3)`, opacity: 0, offset: 0.62 },
          { transform: "scale(0)", opacity: 0, offset: 0.7, easing: "cubic-bezier(0.3, 0, 0.3, 1.4)" },
          { transform: "none", opacity: 1 },
        ], { duration: 1800, delay, origin: "50% 100%" }),
      ),
  },
  // The crab scuttles sideways, legs working, claws snapping, eyes up.
  秋分: {
    motion: scuttle,
    scene: ({ c, part }) => {
      const steps = (deg: number) => [0, deg, -deg, deg, -deg, deg, -deg, 0].map((d) => T(`rotate(${d}deg)`));
      part(c.slice(1, 3), steps(12), { duration: 1200, origin: "100% 0%" });
      part(c.slice(3, 5), steps(-12), { duration: 1200, origin: "0% 0%" });
      part(c[5], [1, 0.8, 1.1, 0.8, 1.1, 0.8, 1].map((s) => T(`scale(${2 - s}, ${s})`)), { duration: 1200, origin: "50% 100%" });
      part(c.slice(6, 8), [T("none"), { transform: "translateY(-5px)", offset: 0.15 }, { transform: "translateY(-5px)", offset: 0.85 }, T("none")], { duration: 1200 });
    },
  },
  // The chrysanthemum's two rings of petals turn against each other.
  寒露: {
    motion: still(1600),
    scene: ({ c, part }) => {
      part(c.slice(0, 12), [T("none"), { transform: "rotate(30deg) scale(1.1)", offset: 0.5 }, T("rotate(60deg)")], { duration: 1600 });
      part(c.slice(12, 22), [T("none"), { transform: "rotate(-36deg) scale(0.85)", offset: 0.5 }, T("rotate(-72deg)")], { duration: 1600 });
      part(c[22], [T("none"), { transform: "scale(1.25)", offset: 0.5 }, T("none")], { duration: 1600 });
    },
  },
  // The persimmon drops and bounces; its calyx wobbles on landing.
  霜降: {
    motion: drop,
    scene: ({ c, part }) =>
      void part(c.slice(1, 3), [T("none"), { transform: "none", offset: 0.58 }, { transform: "rotate(-16deg)", offset: 0.68 }, { transform: "rotate(10deg)", offset: 0.8 }, { transform: "rotate(-4deg)", offset: 0.9 }, T("none")], { duration: 1300, origin: "50% 100%" }),
  },
  // The hot pot bubbles: the food bobs up, and the steam over it rises, drifts off and
  // gathers again.
  立冬: {
    motion: still(1800),
    scene: ({ c, part }) => {
      part(c.slice(0, 3), [T("none"), { transform: "scale(1.04, 0.95)", offset: 0.2 }, { transform: "none", offset: 0.35 }, { transform: "scale(1.03, 0.97)", offset: 0.55 }, T("none")], { duration: 1800, origin: "50% 100%" });
      part(c[3], [...bob(14, 0.1, 0.25).slice(0, -1), ...bob(10, 0.45, 0.25).slice(1)], { duration: 1800, origin: "50% 100%" });
      part(c[4], rise, { duration: 1800, origin: "50% 100%" });
    },
  },
  // The snowflake turns, its branches reaching out as it goes.
  小雪: {
    motion: still(1800),
    scene: ({ c, part }) => void part(c, [T("none"), { transform: "rotate(30deg) scale(1.15)", offset: 0.5 }, T("rotate(60deg)")], { duration: 1800 }),
  },
  // Shaken, the pine sheds its snow in clumps, which falls; fresh snow settles again.
  大雪: {
    motion: shake(14, 900),
    scene: ({ c, part, from }) => {
      part(c[1], [
        { transform: "none", opacity: 1 },
        { transform: "translateY(10px)", opacity: 0, offset: 0.35 },
        { transform: "translateY(-12px)", opacity: 0, offset: 0.55, easing: "ease-out" },
        { transform: "none", opacity: 1 },
      ], { duration: 1800 });
      for (const [x, y] of [[50, 26], [36, 48], [64, 48], [30, 78], [70, 78]])
        from(x, y, { shape: "flake", colours: ["#a9d4f2", SKY], n: 2, jitter: 20, angle: 90, spread: 30, dist: [140, 240], size: [24, 36], grow: [1, 0.6], spin: 120, duration: [800, 1100], delay: 150, stagger: 300 });
    },
  },
  // The dumpling wobbles; the steam drawn over it rises away and forms again.
  冬至: {
    motion: still(1800),
    scene: ({ c, part }) => {
      part(c.slice(0, 2), [1, 1.12, 0.9, 1.06, 0.97, 1].map((s, i) => ({ transform: `scale(${2 - s}, ${s})`, offset: [0, 0.15, 0.32, 0.5, 0.7, 1][i] })), { duration: 1400, origin: "50% 100%" });
      part(c[2], rise, { duration: 1800, origin: "50% 100%" });
    },
  },
  // The branch sways; the bud swells open; a petal comes loose, drifts down and grows back.
  小寒: {
    motion: sway(7, 1900, "0% 100%"),
    scene: ({ c, part }) => {
      part(c[10], [
        { transform: "none", opacity: 1, easing: "ease-in" },
        { transform: "translate(-6px, 30px) rotate(120deg)", opacity: 1, offset: 0.4 },
        { transform: "translate(6px, 60px) rotate(240deg)", opacity: 0, offset: 0.65 },
        { transform: "scale(0)", opacity: 0, offset: 0.7, easing: "ease-out" },
        { transform: "none", opacity: 1 },
      ], { duration: 1900 });
      part(c[13], [T("none"), { transform: "scale(1.6)", offset: 0.3 }, { transform: "scale(1.35)", offset: 0.6 }, T("none")], { duration: 1900 });
    },
  },
  // The skewer is twirled: the haws turn and their sugar glints, then each bounces.
  大寒: {
    motion: still(1500),
    scene: ({ c, art, part }) => {
      [[1, 2], [3, 4], [5, 6]].forEach(([a, b], i) => part([c[a], c[b]], bob(8, 0.5 + i * 0.1, 0.2), { duration: 1500, origin: "50% 100%" }));
      part(Array.from(art.children), [T("none"), { transform: "scaleX(-1)", offset: 0.25 }, { transform: "none", offset: 0.5 }, T("none")], { duration: 1500 });
    },
  },
  // The page turns over the top of the calendar and settles back.
  元旦: {
    motion: still(1400),
    scene: ({ c, part }) => {
      part(c[0], [T("none"), { transform: "scaleY(0)", offset: 0.35, easing: "ease-in" }, { transform: "scaleY(0)", offset: 0.45, easing: "cubic-bezier(0.3, 0, 0.3, 1.3)" }, T("none")], { duration: 1400, origin: "50% 0%" });
      part(c[2], [0, -6, 4, -2, 0].map((y) => T(`translateY(${y}px)`)), { duration: 1400 });
      part(c[3], [T("none"), { transform: "scaleY(0)", offset: 0.3, easing: "ease-in" }, { transform: "scaleY(0)", offset: 0.5, easing: "cubic-bezier(0.3, 0, 0.3, 1.3)" }, T("none")], { duration: 1400, origin: "50% 0%" });
    },
  },
  // A rocket climbs from below, bursts into the rays, and its sparks spread and twinkle.
  除夕: {
    motion: still(1700),
    scene: ({ c, part }) => {
      part(c.slice(0, 12), [T("none"), { transform: "scale(0)", offset: 0.05 }, { transform: "scale(0)", offset: 0.34, easing: "cubic-bezier(0.1, 0.8, 0.3, 1)" }, { transform: "scale(1.15)", offset: 0.55 }, T("none")], { duration: 1700 });
      part(c.slice(12, 24), [
        { transform: "none", opacity: 1 },
        { transform: "scale(0.2)", opacity: 0, offset: 0.05 },
        { transform: "scale(0.2)", opacity: 0, offset: 0.36, easing: "cubic-bezier(0.1, 0.8, 0.3, 1)" },
        { transform: "scale(1.25)", opacity: 1, offset: 0.6 },
        { transform: "scale(1.15)", opacity: 0.4, offset: 0.72 },
        { transform: "scale(1.1)", opacity: 1, offset: 0.82 },
        { transform: "none", opacity: 1 },
      ], { duration: 1700 });
      part(c[24], [T("none"), { transform: "translateY(60px) scale(0.5)", offset: 0.05 }, { transform: "translateY(60px) scale(0.5)", offset: 0.1, easing: "cubic-bezier(0.3, 0, 0.6, 1)" }, { transform: "translateY(0) scale(0.8)", offset: 0.32 }, { transform: "scale(1.5)", offset: 0.4 }, T("none")], { duration: 1700 });
    },
  },
  // The lantern swings and lights up; its tassels trail the swing.
  春节: {
    motion: swingTop,
    scene: ({ c, part, paint }) => {
      paint(c[1], [{ fill: "#d93a3a" }, { fill: "#ff6a4a", offset: 0.3 }, { fill: "#ff7d52", offset: 0.6 }, { fill: "#d93a3a" }], { duration: 1600 });
      part(c[4], [0, -14, 18, -12, 8, -4, 0].map((d) => T(`rotate(${d}deg)`)), { duration: 1600, delay: 80, origin: "50% 0%" });
    },
  },
  // The tangyuan hop up out of the bowl one after another and drop back in.
  元宵: {
    motion: still(1600),
    scene: ({ c, part }) =>
      [c.slice(8, 11), c.slice(2, 5), c.slice(5, 8)].forEach((ball, i) =>
        part(ball, [
          T("none"),
          { transform: "none", offset: 0.05 + i * 0.18 },
          { transform: "translateY(-34px) rotate(-20deg)", offset: 0.25 + i * 0.18, easing: "ease-in" },
          { transform: "translateY(0) scale(1.12, 0.88)", offset: 0.42 + i * 0.18 },
          { transform: "none", offset: Math.min(0.99, 0.5 + i * 0.18) },
          T("none"),
        ], { duration: 1600, origin: "50% 100%" }),
      ),
  },
  // The heart beats twice.
  情人节: { motion: heartbeat },
  // The bee buzzes about, wings beating fast.
  劳动节: {
    motion: buzz,
    scene: ({ c, part }) => {
      const beat = [T("none"), T("scaleY(0.35)"), T("none")];
      part(c[2], beat, { duration: 100, iterations: 14, origin: "100% 100%" });
      part(c[3], beat, { duration: 100, iterations: 14, origin: "0% 100%" });
    },
  },
  // The balloons float up, each bobbing on its own, strings trailing.
  儿童节: {
    motion: float,
    scene: ({ c, part }) => {
      const red = [0, -10, 4, -6, 0].map((y, i) => T(`translateY(${y}px) rotate(${[0, -5, 3, -2, 0][i]}deg)`));
      part(c[0], red, { duration: 2000, origin: "50% 100%" });
      part(c[1], [0, -6, 6, -4, 0].map((y, i) => T(`translateY(${y}px) rotate(${[0, 6, -4, 2, 0][i]}deg)`)), { duration: 2000, origin: "50% 100%" });
      part(c[2], red, { duration: 2000, origin: "50% 100%" });
      part(c[3], [0, 10, -8, 6, 0].map((d) => T(`skewX(${d}deg)`)), { duration: 2000, origin: "50% 0%" });
    },
  },
  // The zongzi hops; the end of its string swings.
  端午: {
    motion: still(2800),
    scene: ({ c, part, paint }) => {
      // Strings undrawn and drawn again along their own length.
      const string = (el: Element, off: number, on: number, len: number): Frames => {
        el.setAttribute("pathLength", "100");
        const f = (dash: number, offset?: number): Keyframe => ({ strokeDasharray: "100 100", strokeDashoffset: String(dash), ...(offset === undefined ? {} : { offset }) });
        return [f(0), f(0, off), f(100, off + len), f(100, on), f(0, on + len), f(0)];
      };
      // The loose end flicks, then the string unwinds; at the end it is tied on again.
      paint(c[7], string(c[7], 0.12, 0.84, 0.08), { duration: 2800 });
      paint(c[6], string(c[6], 0.18, 0.78, 0.14), { duration: 2800 });
      part(c[7], [T("none"), { transform: "rotate(25deg)", offset: 0.06 }, { transform: "rotate(-15deg)", offset: 0.12 }, T("none")], { duration: 2800, origin: "0% 0%" });
      // The front leaves fold back to show the rice, then close over it again.
      const open = (deg: number, dx: number): Frames => [
        T("none"),
        { transform: "none", offset: 0.32, easing: "cubic-bezier(0.3, 0, 0.2, 1.2)" },
        { transform: `translateX(${dx}px) rotate(${deg}deg)`, offset: 0.48 },
        { transform: `translateX(${dx}px) rotate(${deg}deg)`, offset: 0.66, easing: "cubic-bezier(0.4, 0, 0.2, 1.1)" },
        { transform: "none", offset: 0.8 },
        T("none"),
      ];
      part(c[3], open(-22, -8), { duration: 2800, origin: "0% 100%" });
      part(c.slice(4, 6), open(22, 8), { duration: 2800, origin: "100% 100%" });
      part(c.slice(1, 3), [T("none"), { transform: "none", offset: 0.46 }, { transform: "scale(1.06, 0.94)", offset: 0.52 }, { transform: "scale(0.98, 1.04)", offset: 0.58 }, T("none")], { duration: 2800, origin: "50% 100%" });
    },
  },
  // The hat is tipped in greeting; the stars on its band twinkle.
  美国独立日: {
    motion: tip,
    scene: ({ c, part }) => [6, 7, 8].forEach((i, k) => part(c[i], twinkle(0.35 + k * 0.1), { duration: 1300 })),
  },
  // The two stars cross the bridge of magpies and meet over it; the heart beats; they part.
  七夕: {
    motion: still(2200),
    scene: ({ c, part }) => {
      c.slice(1, 6).forEach((el, i) => part(el, [T("none"), T("translateY(-4px) scaleY(0.6)"), T("none")], { duration: 260, delay: i * 90, iterations: 3 }));
      const meet = (dx: number): Frames => [
        T("none"),
        { transform: `translate(${dx * 0.5}px, -6px) rotate(${dx > 0 ? 60 : -60}deg)`, offset: 0.25 },
        { transform: `translate(${dx}px, 4px) rotate(${dx > 0 ? 144 : -144}deg) scale(0.8)`, offset: 0.42 },
        { transform: `translate(${dx}px, 4px) rotate(${dx > 0 ? 144 : -144}deg) scale(0.8)`, offset: 0.62 },
        T("rotate(0deg)"),
      ];
      part(c[6], meet(26), { duration: 2200 });
      part(c[7], meet(-26), { duration: 2200 });
      part(c[8], [T("none"), { transform: "none", offset: 0.4 }, { transform: "scale(1.5)", offset: 0.47 }, { transform: "scale(1.1)", offset: 0.53 }, { transform: "scale(1.4)", offset: 0.58 }, { transform: "none", offset: 0.68 }, T("none")], { duration: 2200 });
    },
  },
  // The mooncake turns its pattern and glows like the moon.
  中秋: {
    motion: still(1600),
    scene: ({ c, part, paint }) => {
      paint(c[1], [{ fill: "#e8b25a" }, { fill: "#f6d07a", offset: 0.5 }, { fill: "#e8b25a" }], { duration: 1600 });
      part(c.slice(0, 2), [T("none"), { transform: "scale(1.06)", offset: 0.5 }, T("none")], { duration: 1600 });
      part(c.slice(2, 11), [T("none"), { transform: "rotate(45deg) scale(1.08)", offset: 0.5 }, T("rotate(90deg)")], { duration: 1600 });
    },
  },
  // The flag comes down the pole and is raised again, then flies.
  国庆: {
    motion: still(2200),
    scene: ({ c, part }) =>
      void part(c.slice(2, 8), [
        { transform: "none", easing: "ease-in" },
        { transform: "translateY(36px) scaleY(0.92)", offset: 0.15, easing: "cubic-bezier(0.3, 0, 0.3, 1)" },
        { transform: "none", offset: 0.55 },
        { transform: "skewY(8deg) scaleX(0.94)", offset: 0.65 },
        { transform: "skewY(-6deg) scaleX(1.02)", offset: 0.75 },
        { transform: "skewY(4deg) scaleX(0.97)", offset: 0.85 },
        T("none"),
      ], { duration: 2200, origin: "0% 50%" }),
  },
  // 重阳, "double sun": the back sun sinks behind the front one and rises again, both
  // turning their rays.
  重阳: {
    motion: still(1800),
    scene: ({ c, part }) => {
      const backRays = part(c[0], [T("none"), T("rotate(30deg)")], { duration: 1800 });
      const frontRays = part(c[2], [T("none"), T("rotate(-30deg)")], { duration: 1800 });
      part([backRays, c[1]], [
        T("none"),
        { transform: "translate(-22px, 22px) scale(0.85)", offset: 0.35 },
        { transform: "translate(-22px, 22px) scale(0.85)", offset: 0.45, easing: "cubic-bezier(0.3, 0, 0.3, 1.3)" },
        T("none"),
      ], { duration: 1800 });
      part([frontRays, c[3]], [T("none"), { transform: "scale(1.08)", offset: 0.4 }, { transform: "scale(0.96)", offset: 0.7 }, T("none")], { duration: 1800 });
    },
  },
  // The two 十 straighten up and stand side by side, then lean back together.
  双十节: {
    motion: still(2000),
    scene: ({ c, paint }) => {
      // Each 十 is drawn turned about its own centre. Its frames spell that same turn out in
      // full, so the first frame is exactly the drawing: lean in a touch, straighten and
      // step apart to stand side by side, then lean back together.
      const pose = (cx: number, cy: number, lean: number, dx: number, dy: number): Frames => {
        const at = (x: number, y: number, r: number, s: number) => `translate(${cx + x}px, ${cy + y}px) rotate(${r}deg) scale(${s}) translate(${-cx}px, ${-cy}px)`;
        return [
          { transform: at(0, 0, lean, 1), easing: "ease-in-out" },
          { transform: at(-dx * 0.12, -dy * 0.12, lean * 1.25, 1.03), offset: 0.12, easing: "cubic-bezier(0.3, 0, 0.2, 1.25)" },
          { transform: at(dx, dy, 0, 0.92), offset: 0.4 },
          { transform: at(dx, dy, 0, 0.92), offset: 0.64, easing: "cubic-bezier(0.4, 0, 0.2, 1.15)" },
          { transform: at(0, 0, lean, 1) },
        ];
      };
      paint(c[0], pose(36, 54, -12, -16, -4), { duration: 2000, origin: "user" });
      paint(c[1], pose(66, 46, 12, 16, 4), { duration: 2000, origin: "user" });
    },
  },
  // The face lights up from inside and the pumpkin glows.
  万圣节: { motion: shiver, scene: glow },
  // The porridge simmers: beans and grains bob up through it one after another.
  腊八: {
    motion: still(1600),
    scene: ({ c, part }) => {
      part(c[1], [T("none"), { transform: "scale(1.02, 1.25)", offset: 0.3 }, { transform: "none", offset: 0.5 }, { transform: "scale(1.02, 1.2)", offset: 0.7 }, T("none")], { duration: 1600 });
      [2, 5, 3, 7, 4, 8, 6].forEach((i, k) => part(c[i], bob(8, 0.05 + k * 0.1, 0.22), { duration: 1600, origin: "50% 100%" }));
    },
  },
  // Shaken, the tree drops its presents, which bounce at its foot; its star turns and
  // its baubles twinkle.
  圣诞节: {
    motion: shake(18, 900),
    scene: (s) => {
      s.part(s.c[2], [T("none"), T("rotate(72deg) scale(1.3)"), T("rotate(144deg)")], { duration: 1200 });
      s.c.slice(3, 8).forEach((el, i) => s.part(el, twinkle(0.1 + i * 0.1), { duration: 1500 }));
      gifts(s);
    },
  },
  // The candle is blown out, a wisp of smoke leaves the wick, and it lights again.
  生日: {
    motion: still(2000),
    scene: ({ c, part, from }) => {
      part(c[3], [
        T("none"),
        { transform: "scale(1.1, 0.8) skewX(-12deg)", offset: 0.12 },
        { transform: "scale(0.9, 1.1) skewX(-20deg)", offset: 0.22 },
        { transform: "scale(0)", offset: 0.3 },
        { transform: "scale(0)", offset: 0.62, easing: "cubic-bezier(0.3, 0, 0.3, 1.5)" },
        { transform: "scale(1.2)", offset: 0.75 },
        T("none"),
      ], { duration: 2000, origin: "50% 100%" });
      [4, 5, 6].forEach((i, k) => part(c[i], twinkle(0.72 + k * 0.06), { duration: 2000 }));
      from(50, 28, { shape: "steam", colours: [STEAM], n: 2, jitter: 4, angle: -95, spread: 6, dist: [120, 180], size: [40, 50], grow: [0.4, 1.2], duration: [900, 1100], stroke: true, delay: 560, stagger: 150 });
    },
  },
};

// ---------- Scenes too long to write inline ----------
let uid = 0;

// 夏至: bites come out of the slice one after another; then it is whole again.
function bite({ art, from }: Scene) {
  const total = 2300;
  const bites = [[28, 40, 16], [52, 37, 18], [76, 40, 16], [40, 54, 14]];
  const id = `mark-bite-${++uid}`;
  const mask = document.createElementNS(NS, "mask");
  mask.id = id;
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  mask.setAttribute("x", "-50");
  mask.setAttribute("y", "-50");
  mask.setAttribute("width", "200");
  mask.setAttribute("height", "200");
  mask.innerHTML = `<rect x="-50" y="-50" width="200" height="200" fill="#fff"/>` + bites.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#000"/>`).join("");
  const holder = document.createElementNS(NS, "g");
  holder.append(...Array.from(art.children));
  art.append(holder, mask);
  holder.setAttribute("mask", `url(#${id})`);
  Array.from(mask.querySelectorAll("circle")).forEach((c, i) => {
    const at = 0.08 + i * 0.16;
    animate(c, [
      T("scale(0)"),
      { transform: "scale(0)", offset: at },
      { transform: "scale(1.1)", offset: at + 0.04, easing: "ease-out" },
      { transform: "scale(1)", offset: at + 0.08 },
      { transform: "scale(1)", offset: 0.84 },
      T("scale(0)"),
    ], { duration: total });
    const [x, y] = bites[i];
    from(x, y, { shape: "seed", colours: ["#4a2a22", RED, "#ec4b51"], n: 4, angle: -90, spread: 70, dist: [100, 200], gravity: 220, size: [18, 26], spin: 300, duration: [600, 800], delay: total * at });
  });
  animate(holder, [T("none"), { transform: "none", offset: 0.84 }, { transform: "scale(0.85)", offset: 0.9 }, { transform: "scale(1.06)", offset: 0.96 }, T("none")], { duration: total });
}

// 万圣节: the face lights up from inside and the pumpkin glows.
function glow({ c, paint, layer, toLayer }: Scene) {
  paint(c[2], [
    { fill: "#5a2a0a" },
    { fill: "#ffd84a", offset: 0.15 },
    { fill: "#ffb02e", offset: 0.3 },
    { fill: "#ffe680", offset: 0.42 },
    { fill: "#ffc23a", offset: 0.75 },
    { fill: "#5a2a0a" },
  ], { duration: 1800 });
  const id = `mark-glow-${++uid}`;
  const centre = toLayer(50, 58);
  const r = Math.abs(toLayer(120, 58).x - centre.x);
  const halo = document.createElementNS(NS, "g");
  halo.innerHTML = `<defs><radialGradient id="${id}"><stop offset="0" stop-color="#ffc94a" stop-opacity="0.9"/><stop offset="0.45" stop-color="#ff9a2e" stop-opacity="0.45"/><stop offset="1" stop-color="#ff9a2e" stop-opacity="0"/></radialGradient></defs><circle cx="${centre.x}" cy="${centre.y}" r="${r}" fill="url(#${id})"/>`;
  layer.insertBefore(halo, layer.firstChild);
  animate(halo, [
    { opacity: 0, transform: "scale(0.6)" },
    { opacity: 1, transform: "scale(1.05)", offset: 0.2 },
    { opacity: 0.7, transform: "scale(0.95)", offset: 0.35 },
    { opacity: 1, transform: "scale(1.1)", offset: 0.5 },
    { opacity: 0.8, transform: "scale(1)", offset: 0.75 },
    { opacity: 0, transform: "scale(0.8)" },
  ], { duration: 1800 }).finished.finally(() => halo.remove());
}

// 圣诞节: presents fall from the branches and bounce at the tree's foot.
function gifts({ layer, toLayer }: Scene) {
  const base = toLayer(50, 96).y;
  const looks = [[RED, GOLD], [BLUE, "#f4efe4"], [GOLD, RED], ["#7a6fd0", GOLD], ["#6fb33f", RED]];
  for (let i = 0; i < 5; i++) {
    const start = toLayer(rand(34, 66), rand(40, 70));
    const size = rand(54, 74);
    const [box, ribbon] = looks[i];
    const h = size / 2;
    const g = document.createElementNS(NS, "g");
    g.setAttribute("transform", `translate(${start.x.toFixed(1)} ${start.y.toFixed(1)})`);
    g.innerHTML = `<g><rect x="${-h}" y="${-h}" width="${size}" height="${size}" rx="${size * 0.1}" fill="${box}"/><rect x="${-size * 0.1}" y="${-h}" width="${size * 0.2}" height="${size}" fill="${ribbon}"/><rect x="${-h}" y="${-size * 0.1}" width="${size}" height="${size * 0.2}" fill="${ribbon}"/><path d="M0 ${-h}C${-h} ${-size} ${-h * 0.2} ${-h * 1.6} 0 ${-h}C${h * 0.2} ${-h * 1.6} ${h} ${-size} 0 ${-h}Z" fill="${ribbon}"/></g>`;
    layer.appendChild(g);
    const land = base - start.y + 30 + i * 6 - h;
    const dx = rand(-1, 1) * 160;
    const turn = rand(-1, 1) * 40;
    animate(g.firstElementChild!, [
      { transform: "translate(0, 0) rotate(0deg) scale(0)", opacity: 1, easing: "ease-out" },
      { transform: "translate(0, -20px) rotate(0deg) scale(1)", offset: 0.12, easing: "cubic-bezier(0.5, 0, 0.9, 0.6)" },
      { transform: `translate(${dx}px, ${land}px) rotate(${turn}deg) scale(1)`, offset: 0.45, easing: "ease-out" },
      { transform: `translate(${dx * 1.15}px, ${land - 70}px) rotate(${turn * 1.4}deg) scale(1)`, offset: 0.58, easing: "ease-in" },
      { transform: `translate(${dx * 1.25}px, ${land}px) rotate(${turn * 1.5}deg) scale(1)`, offset: 0.7 },
      { transform: `translate(${dx * 1.25}px, ${land}px) rotate(${turn * 1.5}deg) scale(1)`, opacity: 1, offset: 0.88 },
      { transform: `translate(${dx * 1.25}px, ${land}px) rotate(${turn * 1.5}deg) scale(0.6)`, opacity: 0 },
    ], { duration: 1900, delay: 250 + i * 140 }).finished.finally(() => g.remove());
  }
}

// ---------- Running it ----------
let running: Animation[] = [];

function animate(el: Element, frames: Frames, o: PartOptions) {
  const style = (el as SVGElement).style;
  if (o.origin === "user") {
    // Transforms written out in the drawing's own coordinates, like an SVG transform attribute.
    style.transformBox = "view-box";
    style.transformOrigin = "0px 0px";
  } else {
    style.transformBox = "fill-box";
    style.transformOrigin = o.origin ?? "50% 50%";
  }
  // Poses without their own easing ease in and out.
  const eased = frames.map((f) => ("easing" in f ? f : { ...f, easing: o.easing ?? "ease-in-out" }));
  const a = el.animate(eased, { duration: o.duration, delay: o.delay ?? 0, iterations: o.iterations ?? 1, fill: "backwards" });
  running.push(a);
  return a;
}

function emit(layer: Element, x0: number, y0: number, e: Emit) {
  for (let i = 0; i < e.n; i++) {
    const x = x0 + rand(-1, 1) * (e.jitter ?? 0);
    const y = y0 + rand(-1, 1) * (e.jitter ?? 0) * 0.3;
    const a = (((e.angle ?? -90) + rand(-1, 1) * (e.spread ?? 0)) * Math.PI) / 180;
    const d = rand(...e.dist);
    const dx = Math.cos(a) * d;
    const dy = Math.sin(a) * d;
    const g = e.gravity ?? 0;
    const s = (rand(...e.size) * 1.3) / 20;
    const [g0, g1] = e.grow ?? [0.3, 0];
    const r = rand(-1, 1) * (e.spin ?? 0);
    const colour = e.colours[i % e.colours.length];

    const at = document.createElementNS(NS, "g");
    at.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", SHAPES[e.shape]);
    if (e.stroke) {
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", colour);
      // Rings spread a long way, so they start thin.
      p.setAttribute("stroke-width", String((e.shape === "ring" ? 5 : 14) / s));
      p.setAttribute("stroke-linecap", "round");
    } else p.setAttribute("fill", colour);
    p.style.pointerEvents = "none";
    // Hidden until its delay is over (the animation itself does not fill backwards).
    p.style.opacity = "0";
    at.appendChild(p);
    layer.appendChild(at);
    const mid = Math.min(1, (g1 + g0) / 2 + 0.6);
    p.animate(
      [
        { transform: `translate(0px, 0px) rotate(0deg) scale(${s * g0})`, opacity: 1 },
        { transform: `translate(${dx * 0.7}px, ${dy * 0.7 + g * 0.3}px) rotate(${r * 0.6}deg) scale(${s * mid})`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy + g}px) rotate(${r}deg) scale(${s * (g1 || 0.001)})`, opacity: 0 },
      ],
      {
        duration: rand(...e.duration),
        delay: (e.delay ?? 0) + Math.random() * (e.stagger ?? 0),
        easing: g > 0 ? "cubic-bezier(0.3, 0.6, 0.6, 1)" : "cubic-bezier(0.2, 0.7, 0.3, 1)",
      },
    ).finished.finally(() => at.remove());
  }
}

export function play(mark: Element) {
  const pop = mark.querySelector<SVGGraphicsElement>(".wm-mark-pop");
  const slot = pop?.parentElement;
  const art = pop?.querySelector<SVGGElement>(":scope > g > g");
  if (!pop || !slot || !art || pop.dataset.popping !== undefined) return;
  pop.dataset.popping = "";
  const effect = EFFECTS[(mark as HTMLElement).dataset.name ?? ""] ?? { motion: hop };
  // The scene rearranges the drawing to animate its parts; once everything has played,
  // the drawing is put back exactly as it was.
  const saved = art.innerHTML;
  running = [];

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    animate(pop, [T("scale(1)"), T("scale(1.15)"), T("scale(1)")], { duration: 400 });
  } else {
    animate(pop, effect.motion.frames, { duration: effect.motion.duration, origin: effect.motion.origin });
    if (effect.scene) {
      const m = (slot as SVGGraphicsElement).getScreenCTM()!.inverse().multiply(art.getScreenCTM()!);
      const toLayer = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(m);
      effect.scene({
        c: Array.from(art.children),
        art,
        layer: slot,
        toLayer,
        part: (els, frames, o) => {
          const list = Array.isArray(els) ? els : [els];
          const g = document.createElementNS(NS, "g");
          list[0].before(g);
          g.append(...list);
          animate(g, frames, o);
          return g;
        },
        paint: (el, frames, o) => void animate(el, frames, o),
        from: (x, y, e) => {
          const p = toLayer(x, y);
          emit(slot, p.x, p.y, e);
        },
      });
    }
  }
  const animations = running;
  void Promise.allSettled(animations.map((a) => a.finished)).then(() => {
    if (art.innerHTML !== saved) art.innerHTML = saved;
    delete pop.dataset.popping;
  });
}
