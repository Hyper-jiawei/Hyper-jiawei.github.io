import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const source = stripTypeScriptTypes(await fs.readFile(new URL("../src/lib/full-resolution.ts", import.meta.url), "utf8"))
  .replace("export function fetchOriginal", "function fetchOriginal");
function setup() {
  const requests = [];
  class Request {
    constructor() { requests.push(this); }
    open(method, src) { this.method = method; this.src = src; }
    send() { this.sent = true; }
    abort() { this.aborted = true; }
  }
  const context = vm.createContext({ XMLHttpRequest: Request, DOMException });
  vm.runInContext(source, context);
  return { fetchOriginal: context.fetchOriginal, requests };
}

test("original download reports byte progress and returns source bytes", async () => {
  const { fetchOriginal, requests } = setup();
  const progress = [];
  const pending = fetchOriginal("/img/original.jpg", new AbortController().signal, (p) => progress.push(p));
  const request = requests[0];
  assert.equal(request.src, "/img/original.jpg");
  assert.equal(request.responseType, "blob");
  request.onprogress({ lengthComputable: true, loaded: 40, total: 100 });
  request.onprogress({ lengthComputable: false });
  assert.deepEqual(progress, [0.4, null]);
  request.status = 200;
  request.response = new Blob(["source bytes"]);
  request.onload();
  assert.equal(await (await pending).text(), "source bytes");
});

test("closing or paging cancels the request, including an already cancelled signal", async () => {
  for (const alreadyAborted of [false, true]) {
    const { fetchOriginal, requests } = setup();
    const controller = new AbortController();
    if (alreadyAborted) controller.abort();
    const pending = fetchOriginal("/original.jpg", controller.signal, () => {});
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(requests[0].aborted, true);
    if (alreadyAborted) assert.equal(requests[0].sent, undefined);
  }
});

test("HTTP and network errors reject without creating a false completion", async () => {
  for (const failure of ["http", "network"]) {
    const { fetchOriginal, requests } = setup();
    const controller = new AbortController();
    const pending = fetchOriginal("/original.jpg", controller.signal, () => {});
    if (failure === "http") { requests[0].status = 404; requests[0].onload(); }
    else requests[0].onerror();
    await assert.rejects(pending, /Image download failed/);
    controller.abort();
    assert.equal(requests[0].aborted, undefined);
  }
});

const viewerSource = stripTypeScriptTypes(await fs.readFile(new URL("../src/lib/lightbox.ts", import.meta.url), "utf8"))
  .replace(/^import .*;$/gm, "")
  .replace("export function initLightbox", "function initLightbox");
function viewer(pending) {
  let instance;
  const downloads = [];
  const revoked = [];
  const gallery = { dataset: pending === undefined ? {} : { lightboxPending: pending }, querySelectorAll: () => [{}] };
  class ImageElement {
    complete = true;
    naturalWidth = 1600;
    style = { width: "960px", height: "640px" };
    src = "/preview.webp";
    currentSrc = "/preview.webp";
    decode() { return Promise.resolve(); }
    animate() { return { finished: Promise.resolve(), cancel() {} }; }
    remove() { this.removed = true; }
  }
  class Lightbox {
    listeners = {};
    filters = {};
    constructor(options) { instance = this; this.options = options; }
    on(name, handler) { (this.listeners[name] ??= []).push(handler); }
    addFilter(name, handler) { this.filters[name] = handler; }
    emit(name, data) { this.listeners[name]?.forEach((fn) => fn(data)); }
    init() {}
    loadAndOpen(index, dataSource) { this.queuedOpen = { index, dataSource }; }
    destroy() { this.emit("destroy"); }
  }
  const context = vm.createContext({
    PhotoSwipeLightbox: Lightbox,
    PhotoSwipe: class {},
    Image: ImageElement,
    HTMLImageElement: ImageElement,
    AbortController,
    URL: { createObjectURL: () => "blob:original", revokeObjectURL: (url) => revoked.push(url) },
    matchMedia: () => ({ matches: false }),
    // The viewer takes its words from the page's language (see i18n); one language is enough here.
    ui: { zh: { lightbox: { close: "", error: "", download: "", zoomIn: "", zoomOut: "", states: { waiting: "", loading: "", decoding: "", ready: "", error: "" } } } },
    langOf: () => "zh",
    location: { pathname: "/" },
    document: { querySelectorAll: () => [gallery], documentElement: { classList: { add() {}, remove() {} } } },
    fetchOriginal: (src, signal, progress) => new Promise((resolve, reject) => {
      downloads.push({ src, signal, progress, resolve, reject });
    }),
  });
  vm.runInContext(viewerSource, context);
  context.initLightbox();
  const makeSlide = (src) => {
    const image = new ImageElement();
    const anchor = { href: src, querySelector: () => image, dataset: { downloadName: "photo.jpg" } };
    const data = instance.filters.itemData({ element: anchor, src, width: 6192, height: 4128, srcset: "responsive variants" });
    const content = { element: image, data };
    return { content, data, isActive: true, container: { append() {} } };
  };
  instance.pswp = { currSlide: makeSlide("/original.jpg"), options: {} };
  return { instance, downloads, revoked, makeSlide };
}
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

test("viewer reuses currentSrc for opening and requests original only after the animation", async () => {
  const { instance, downloads, revoked } = viewer();
  const slide = instance.pswp.currSlide;
  assert.equal(slide.data.src, "/preview.webp");
  assert.equal(slide.data.srcset, undefined);
  instance.emit("change");
  instance.emit("loadComplete", { content: slide.content });
  assert.equal(downloads.length, 0);
  instance.emit("openingAnimationEnd");
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].src, "/original.jpg");
  downloads[0].resolve(new Blob(["original"]));
  await flush();
  assert.equal(slide.content.element.src, "blob:original");
  assert.equal(slide.content.data.src, "blob:original");
  assert.equal(slide.content.data.width, 6192);
  instance.emit("destroy");
  assert.deepEqual(revoked, ["blob:original"]);
});

test("paging cancels the previous original and closing cancels the current original", () => {
  const { instance, downloads, makeSlide } = viewer();
  instance.emit("openingAnimationEnd");
  instance.pswp.currSlide.isActive = false;
  instance.pswp.currSlide = makeSlide("/second-original.jpg");
  instance.emit("change");
  assert.equal(downloads[0].signal.aborted, true);
  assert.equal(downloads[1].src, "/second-original.jpg");
  instance.emit("close");
  assert.equal(downloads[1].signal.aborted, true);
});


test("a click queued before viewer readiness opens exactly once after initialization", () => {
  const { instance } = viewer("0");
  assert.equal(instance.options.gallery.dataset.lightboxReady, "true");
  assert.equal(instance.options.gallery.dataset.lightboxPending, undefined);
  assert.equal(instance.queuedOpen.index, 0);
  assert.equal(instance.queuedOpen.dataSource.gallery, instance.options.gallery);
  assert.equal(typeof instance.options.pswpModule, "function");
});
