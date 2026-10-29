// Inlined at the start of the egg page's body: the arrival must not wait for
// the router, the main module graph, fonts, or the gallery's own interactions.
(() => {
  const root = document.documentElement;
  if (!root.classList.contains("is-celebrating")) return;
  let cancelled = false;
  let revealTimer;
  const stop = () => {
    cancelled = true;
    clearTimeout(revealTimer);
    document.querySelector(".egg-burst")?.remove();
    root.classList.remove("is-celebrating", "is-revealing");
    document.removeEventListener("astro:before-swap", stop);
  };
  document.addEventListener("astro:before-swap", stop);

  // The hidden gallery's way in: arriving from five taps on the wordmark, the page's content is
  // held empty and colourful ribbons and confetti go off. The burst is a circle — never stretched
  // to the shape of the window — and it is sized to the shortest side so it always fits.

  const COLORS = ["#c4392b", "#e0a03a", "#2e7d6f", "#3d6cb0", "#b64a83", "#8f6a3a"];
  const RIBBONS = 26;
  const CONFETTI = 22;
  /** Long enough for the last ribbon to land before the page comes in. */
  const DURATION = 1500;

  /** Small deterministic generator, so a burst always looks the same and no two pieces collide. */
  function seeded(seed) {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  }

  /** Plays the celebration out of a point on the screen and resolves once it has died away.
   *  `unit` sizes the ribbons; the radius is the same in every direction, from whichever side
   *  has the least room, so a portrait phone and a wide desktop get the same shape. */
  function burstAt(x, y, unit) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
    const u = Math.max(30, unit);
    // The circle's radius: the shortest distance from the burst to an edge, kept a little short
    // of it so a ribbon's own length still lands on screen.
    const radius = Math.max(60, 0.85 * Math.min(x, innerWidth - x, y, innerHeight - y));

    const layer = document.createElement("div");
    layer.className = "egg-burst";
    layer.setAttribute("aria-hidden", "true");
    layer.style.left = `${x}px`;
    layer.style.top = `${y}px`;
    layer.style.setProperty("--r", `${u.toFixed(1)}px`);

    const add = (className, vars = {}) => {
      const el = document.createElement("i");
      el.className = className;
      for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
      layer.append(el);
    };
    const px = (n) => `${n.toFixed(1)}px`;
    const rand = seeded(20260322);

    /**
     * One piece's flight: straight out along its own ray to the same distance whatever the
     * direction, then a little further down as it fades, which is what makes the shower read
     * as gravity.
     */
    const flight = (angle, share, sag) => {
      const dist = radius * share;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      // Room left below this piece before the bottom edge, so the sag never pushes it off
      // (allowing for the length of a ribbon itself).
      const drop = Math.max(0, Math.min(radius * sag, innerHeight - y - dy - u * 0.9));
      return { dx, dy, drop };
    };

    // The pop itself: a warm flash, then the shower.
    add("egg-burst-glow");

    // Ribbons: long strips thrown all the way round, each on its own ray, twisting as it flies.
    for (let i = 0; i < RIBBONS; i++) {
      const angle = (i / RIBBONS) * Math.PI * 2 + (rand() - 0.5) * 0.5;
      const { dx, dy, drop } = flight(angle, 0.6 + rand() * 0.25, 0.2 + rand() * 0.24);
      const long = i % 2 === 0;
      add("egg-burst-ribbon", {
        "--c": COLORS[i % COLORS.length],
        "--w": px(u * (long ? 0.2 : 0.3)),
        "--h": px(u * (long ? 1.5 : 0.95)),
        "--dx": px(dx),
        "--dy": px(dy),
        "--drop": px(drop),
        "--spin": `${((rand() * 2 - 1) * 520).toFixed(0)}deg`,
        "--flip": `${(300 + rand() * 420).toFixed(0)}deg`,
        "--t": `${(rand() * 70).toFixed(0)}ms`,
        "--dur": `${(1.15 + rand() * 0.25).toFixed(2)}s`,
      });
    }

    // Confetti: small squares on the same rays, faster and spinning flat.
    for (let i = 0; i < CONFETTI; i++) {
      const angle = (i / CONFETTI) * Math.PI * 2 + rand() * 0.4;
      const { dx, dy, drop } = flight(angle, 0.55 + rand() * 0.28, 0.18 + rand() * 0.22);
      add("egg-burst-confetti", {
        "--c": COLORS[(i + 3) % COLORS.length],
        "--dx": px(dx),
        "--dy": px(dy),
        "--drop": px(drop),
        "--spin": `${((rand() * 2 - 1) * 720).toFixed(0)}deg`,
        "--t": `${(rand() * 90).toFixed(0)}ms`,
        "--dur": `${(1.05 + rand() * 0.25).toFixed(2)}s`,
      });
    }

    document.body.append(layer);
    return new Promise((resolve) => {
      setTimeout(() => {
        layer.remove();
        resolve();
      }, DURATION);
    });
  }

  // Keep the original geometry and 1500ms burst, followed by the same page reveal.
  const unit = Math.min(Math.max(Math.min(innerWidth, innerHeight) * 0.055, 46), 88);
  void burstAt(innerWidth / 2, innerHeight / 2, unit).then(() => {
    if (cancelled) return;
    root.classList.remove("is-celebrating");
    root.classList.add("is-revealing");
    revealTimer = setTimeout(() => {
      root.classList.remove("is-revealing");
      document.removeEventListener("astro:before-swap", stop);
    }, 1600);
  });
})();
