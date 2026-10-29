import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { modulePreloads } from "./module-preloads.mjs";

const earlySource = await fs.readFile(new URL("../src/lib/early-page.js", import.meta.url), "utf8");
const navigationSource = stripTypeScriptTypes(await fs.readFile(new URL("../src/lib/navigation-image.ts", import.meta.url), "utf8"))
  .replace("export function preparePhotoNavigation", "function preparePhotoNavigation");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

function carousel() {
  const requests = [];
  const observed = [];
  const frames = new Map();
  let nextFrame = 0;
  const slides = Array.from({ length: 5 }, (_, index) => {
    const slide = { active: index === 0, classList: { contains: () => slide.active } };
    const attrs = new Map([["data-deferred-src", `${index}.webp`], ["data-deferred-srcset", `${index}.webp 960w`]]);
    const img = Object.assign(new EventTarget(), {
      complete: false,
      getAttribute: (key) => attrs.get(key),
      setAttribute: (key, value) => {
        attrs.set(key, value);
        if (key === "src") requests.push(index);
      },
      removeAttribute: (key) => attrs.delete(key),
      closest: () => slide,
    });
    slide.img = img;
    slide.querySelector = () => img;
    return slide;
  });
  const hero = Object.assign(new EventTarget(), { querySelectorAll: () => slides });
  const main = Object.assign(new EventTarget(), {
    querySelector: () => hero,
    querySelectorAll: (selector) => selector.startsWith(".reveal") ? [] : slides.map((slide) => slide.img),
  });
  const document = Object.assign(new EventTarget(), { querySelector: () => main });
  vm.runInNewContext(earlySource, {
    document, Event,
    window: { IntersectionObserver: true },
    IntersectionObserver: class {
      observe(img) { observed.push(img); }
      disconnect() {}
    },
    requestAnimationFrame: (fn) => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout, clearTimeout,
  });
  while (frames.size) {
    const jobs = [...frames.values()];
    frames.clear();
    jobs.forEach((fn) => fn());
  }
  return {
    requests, observed, slides,
    loaded(index, type = "load") {
      slides[index].img.complete = true;
      slides[index].img.dispatchEvent(new Event(type));
    },
    show(index) {
      slides.forEach((slide, i) => { slide.active = i === index; });
      hero.dispatchEvent(new Event("gallery:slide-change"));
    },
    dispose() { document.dispatchEvent(new Event("astro:before-swap")); },
  };
}

test("carousel protects the first photo's bandwidth and warms only the next slide", () => {
  const page = carousel();
  assert.deepEqual(page.requests, [0]);
  assert.equal(page.observed.length, 0, "clipped hero images must not enter generic image observation");
  page.loaded(0);
  assert.deepEqual(page.requests, [0, 1]);
  assert.equal(page.slides[1].img.fetchPriority, "low");
  page.loaded(1);
  assert.deepEqual(page.requests, [0, 1], "a background load must not cascade through all slides");
  page.show(3);
  assert.deepEqual(page.requests, [0, 1, 3], "direct selection starts the requested slide immediately");
  page.loaded(3);
  assert.deepEqual(page.requests, [0, 1, 3, 4]);
  page.dispose();
});

test("carousel errors, rapid selection and navigation do not leave stale warmups", () => {
  const page = carousel();
  page.show(2);
  page.loaded(0);
  assert.deepEqual(page.requests, [0, 2]);
  page.loaded(2, "error");
  assert.deepEqual(page.requests, [0, 2, 3]);
  page.show(4);
  page.dispose();
  page.loaded(4);
  assert.deepEqual(page.requests, [0, 2, 3, 4]);
});

function navigation({ metadata = true, redirect = false } = {}) {
  const html = deferred();
  const images = [];
  const sequence = [];
  const timers = new Map();
  const controller = new AbortController();
  const destination = { srcset: redirect ? "redirect.webp 960w" : "photo.webp 960w", sizes: "70vw", src: "fallback.webp" };
  let nextTimer = 0;
  const context = vm.createContext({
    Image: class {
      constructor() {
        this.decodingReady = deferred();
        images.push(this);
        sequence.push("photo");
      }
      decode() { return this.decodingReady.promise; }
    },
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(navigationSource, context);
  const event = {
    loader: () => { sequence.push("html"); return html.promise; },
    signal: controller.signal,
    sourceElement: metadata ? { closest: () => ({ dataset: { preloadSrcset: "photo.webp 960w", preloadSizes: "70vw" } }) } : undefined,
    newDocument: { querySelector: () => destination },
  };
  context.preparePhotoNavigation(event);
  return { event, html, images, sequence, timers, controller };
}

test("navigation downloads the destination image in parallel with HTML and reuses the probe", async () => {
  const page = navigation();
  const completed = page.event.loader();
  assert.deepEqual(page.sequence, ["photo", "html"]);
  page.images[0].decodingReady.resolve();
  page.html.resolve();
  await completed;
  assert.equal(page.images.length, 1);
  assert.equal(page.timers.size, 0);
});

test("navigation falls back to destination metadata and handles redirects", async () => {
  for (const options of [{ metadata: false }, { redirect: true }]) {
    const page = navigation(options);
    const completed = page.event.loader();
    page.html.resolve();
    await new Promise(setImmediate);
    assert.equal(page.images.length, options.redirect ? 2 : 1);
    page.images.at(-1).decodingReady.reject(new Error("unavailable photo"));
    await completed;
    assert.equal(page.timers.size, 0);
  }
});

test("navigation abort and timeout release decode waits and timers", async () => {
  for (const abort of [true, false]) {
    const page = navigation();
    const completed = page.event.loader();
    page.html.resolve();
    await new Promise(setImmediate);
    assert.equal(page.timers.size, 1);
    if (abort) page.controller.abort();
    else [...page.timers.values()].forEach((fn) => fn());
    await completed;
    assert.equal(page.timers.size, 0);
  }
});

test("module preloads follow static imports, deduplicate cycles and leave dynamic imports alone", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gallery-modules-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const integration = modulePreloads();
  let config;
  integration.hooks["astro:config:setup"]({ updateConfig: (value) => { config = value; } });
  const chunk = (fileName, imports = [], dynamicImports = []) => ({ type: "chunk", fileName, imports, dynamicImports });
  const bundle = {
    entry: chunk("_astro/main.js", ["_astro/router.js"], ["_astro/photoswipe.js"]),
    router: chunk("_astro/router.js", ["_astro/shared.js"]),
    shared: chunk("_astro/shared.js", ["_astro/router.js"]),
    photoswipe: chunk("_astro/photoswipe.js"),
  };
  config.vite.plugins[0].generateBundle({}, bundle);
  await fs.writeFile(path.join(dir, "index.html"), '<head><title>Gallery</title><script type="module" src="/_astro/main.js"></script></head>');
  await integration.hooks["astro:build:done"]({ dir: pathToFileURL(dir + path.sep) });
  const result = await fs.readFile(path.join(dir, "index.html"), "utf8");
  assert.equal((result.match(/rel="modulepreload"/g) ?? []).length, 2);
  assert.ok(result.includes('href="/_astro/router.js"'));
  assert.ok(result.includes('href="/_astro/shared.js"'));
  assert.ok(!result.includes("photoswipe.js"));
});

test("photo pages preload the viewer graph without pulling in unrelated dynamic features", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gallery-viewer-modules-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const integration = modulePreloads();
  let config;
  integration.hooks["astro:config:setup"]({ updateConfig: (value) => { config = value; } });
  const chunk = (fileName, facadeModuleId, imports = [], dynamicImports = []) =>
    ({ type: "chunk", fileName, facadeModuleId, imports, dynamicImports });
  config.vite.plugins[0].generateBundle({}, {
    main: chunk("_astro/main.js", "/app/src/lib/client.ts", [], ["_astro/holiday.js", "_astro/viewer.js", "_astro/core.js"]),
    viewer: chunk("_astro/viewer.js", "/app/src/lib/lightbox.ts", ["_astro/shared.js"], ["_astro/core.js"]),
    core: chunk("_astro/core.js", "/app/node_modules/photoswipe/dist/photoswipe.esm.js"),
    shared: chunk("_astro/shared.js", "/app/src/lib/full-resolution.ts"),
    holiday: chunk("_astro/holiday.js", "/app/src/data/festive-marks.json", [], ["_astro/motion.js"]),
    motion: chunk("_astro/motion.js", "/app/src/lib/mark-motion.ts"),
  });
  const html = '<head><title>Photo</title><script type="module" src="/_astro/main.js"></script></head><main data-gallery></main>';
  await fs.writeFile(path.join(dir, "index.html"), html);
  await integration.hooks["astro:build:done"]({ dir: pathToFileURL(dir + path.sep) });
  const result = await fs.readFile(path.join(dir, "index.html"), "utf8");
  assert.equal((result.match(/rel="modulepreload"/g) ?? []).length, 3);
  for (const file of ["viewer.js", "core.js", "shared.js"]) assert.ok(result.includes(`href="/_astro/${file}"`));
  for (const file of ["holiday.js", "motion.js"]) assert.ok(!result.includes(file));
});

function earlyPhotoClicks() {
  const gallery = { dataset: {}, querySelectorAll: () => links };
  const links = [0, 1].map(() => ({ closest: () => gallery }));
  const main = Object.assign(new EventTarget(), {
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const document = Object.assign(new EventTarget(), { querySelector: () => main });
  vm.runInNewContext(earlySource, {
    document, window: {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, clearTimeout,
  });
  return {
    gallery, document,
    click(index, modifiers = {}) {
      const event = new Event("click", { cancelable: true });
      Object.assign(event, { button: 0, ...modifiers });
      Object.defineProperty(event, "target", { value: { closest: () => links[index] } });
      main.dispatchEvent(event);
      return event;
    },
  };
}

test("image clicks before module readiness are prevented and keep the requested photo", () => {
  const page = earlyPhotoClicks();
  assert.equal(page.click(0).defaultPrevented, true);
  assert.equal(page.click(1).defaultPrevented, true);
  assert.equal(page.gallery.dataset.lightboxPending, "1");
});

test("repeat clicks while the viewer opens cannot navigate to the raw image", () => {
  const page = earlyPhotoClicks();
  page.gallery.dataset.lightboxReady = "true";
  assert.equal(page.click(0).defaultPrevented, true);
  assert.equal(page.click(0).defaultPrevented, true);
  assert.equal(page.gallery.dataset.lightboxPending, undefined);
});

test("modified photo clicks retain browser actions and old pages release their click guard", () => {
  const page = earlyPhotoClicks();
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    assert.equal(page.click(0, modifiers).defaultPrevented, false);
  }
  assert.equal(page.gallery.dataset.lightboxPending, undefined);
  page.document.dispatchEvent(new Event("astro:before-swap"));
  assert.equal(page.click(0).defaultPrevented, false);
});
