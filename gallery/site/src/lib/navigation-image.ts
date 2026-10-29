interface PreparationEvent extends Event {
  loader: () => Promise<void>;
  newDocument: Document;
  sourceElement?: Element;
  signal: AbortSignal;
  navigationType?: string;
}

function probeImage(srcset: string, sizes: string, src?: string) {
  const image = new Image();
  image.fetchPriority = "high";
  image.decoding = "async";
  image.sizes = sizes;
  image.srcset = srcset;
  if (src) image.src = src;
  return { image, decoded: image.decode().catch(() => {}) };
}

// Start the photograph alongside the HTML request, before the router waits for
// destination CSS. Keep the same decode-before-transition policy and 1200ms cap.
export function preparePhotoNavigation(event: Event) {
  const ev = event as PreparationEvent;
  const original = ev.loader;
  // History restoration must not start a new image request or wait for decoding.
  if (ev.navigationType === "traverse") return;
  ev.loader = async () => {
    if (ev.signal.aborted) return;
    const link = ev.sourceElement?.closest<HTMLAnchorElement>("a[data-preload-srcset]");
    let probe = link?.dataset.preloadSrcset
      ? probeImage(link.dataset.preloadSrcset, link.dataset.preloadSizes ?? "100vw")
      : undefined;
    await original();
    if (ev.signal.aborted) return;
    const img = ev.newDocument.querySelector<HTMLImageElement>("[data-stage], .work-photo img");
    if (!img) return;
    // Redirects or unrelated navigation may produce a different destination.
    if (!probe || probe.image.srcset !== img.srcset || probe.image.sizes !== img.sizes) {
      probe = probeImage(img.srcset, img.sizes, img.src);
    }
    const decoded = probe.decoded;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        ev.signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, 1200);
      ev.signal.addEventListener("abort", done, { once: true });
      decoded.then(done);
    });
  };
}
