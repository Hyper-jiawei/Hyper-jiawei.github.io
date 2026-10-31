import PhotoSwipeLightbox from "photoswipe/lightbox";
import type PhotoSwipe from "photoswipe";
import { fetchOriginal } from "./full-resolution";
import { langOf, ui } from "../i18n";

type Content = NonNullable<PhotoSwipe["currSlide"]>["content"];

interface Upgrade {
  controller: AbortController;
  state: "loading" | "decoding" | "ready" | "error";
  fraction: number | null;
  url?: string;
  overlay?: HTMLImageElement;
  animation?: Animation;
}

export function initLightbox(): () => void {
  // The viewer speaks the language of the page it opened on.
  const tr = ui[langOf(location.pathname)].lightbox;
  const galleries = document.querySelectorAll<HTMLElement>("[data-gallery]");
  const instances: PhotoSwipeLightbox[] = [];

  // Largest zoom: the photo's own pixels, or 4× the fitted size for small images.
  const maxZoom = (zl: { fit: number }) => Math.max(1, zl.fit * 4);

  galleries.forEach((gallery) => {
    let opened = false;
    let indicator: HTMLElement | undefined;
    const upgrades = new Map<Content, Upgrade>();
    const lightbox = new PhotoSwipeLightbox({
      gallery,
      children: "a[data-pswp-width]",
      // The viewer core (most of this bundle) loads on first use or when the page is idle.
      pswpModule: () => import("photoswipe"),
      bgOpacity: 1,
      showHideAnimationType: "zoom",
      showAnimationDuration: 440,
      // Slow start, then a soft landing: the crop opens gently out of the page photo.
      easing: "cubic-bezier(0.6, 0, 0.2, 1)",
      hideAnimationDuration: 260,
      preload: [1, 2],
      imageClickAction: "zoom",
      tapAction: "toggle-controls",
      wheelToZoom: true,
      counter: false,
      arrowPrev: false,
      arrowNext: false,
      preloader: false,
      paddingFn: (viewport) =>
        viewport.x < 640 ? { top: 60, bottom: 16, left: 0, right: 0 } : { top: 60, bottom: 24, left: 40, right: 40 },
      closeTitle: tr.close,
      closeSVG: '<svg class="pswp__icn" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>',
      // Separate zoom-in / zoom-out buttons replace PhotoSwipe's single toggle.
      zoom: false,
      // Three steps: fit, then two zoom-ins (the second is the maximum, also for
      // pinch and wheel). The middle step sits halfway between them on a log scale.
      secondaryZoomLevel: (zl) => Math.sqrt(zl.fit * maxZoom(zl)),
      maxZoomLevel: maxZoom,
      errorMsg: tr.error,
    });

    // A photo zoomed by hover overflows its frame. Open from exactly what is on screen:
    // the zoomed photo, cropped to the frame, so the crop then widens to the full image.
    const held = new Set<HTMLElement>();
    let closing = false;
    lightbox.addFilter("thumbBounds", (bounds, itemData) => {
      const frame = itemData.element;
      const image = frame?.querySelector("img");
      if (!frame || !image) return bounds;
      const outer = frame.getBoundingClientRect();
      const inner = image.getBoundingClientRect();
      if (inner.width <= outer.width + 0.5) return bounds;
      // Opening from a hover-zoomed photo: hold that zoom while the viewer is open.
      if (!closing && !held.size) {
        frame.dataset.held = "";
        held.add(frame);
      }
      return {
        x: inner.left,
        y: inner.top,
        w: inner.width,
        // As in PhotoSwipe's own cropped bounds: the image's offset from the visible frame.
        innerRect: { x: inner.left - outer.left, y: inner.top - outer.top, w: outer.width, h: outer.height },
      };
    });

    // The opening frame must reuse the exact resource already displayed on the page.
    // Keep source dimensions for full-resolution zoom, but don't request the source yet.
    lightbox.addFilter("itemData", (data) => {
      const image = data.element?.querySelector("img");
      if (image) {
        data.src = image.currentSrc || image.src;
        data.msrc = data.src;
        data.srcset = undefined;
      }
      return data;
    });

    const updateProgress = () => {
      if (!indicator) return;
      const content = lightbox.pswp?.currSlide?.content;
      const job = content && upgrades.get(content);
      const state = job?.state ?? "waiting";
      indicator.dataset.state = state;
      indicator.hidden = state === "ready";
      const labels = tr.states;
      indicator.setAttribute("aria-label", labels[state]);
      indicator.title = labels[state];
      const fraction = job?.fraction;
      indicator.classList.toggle("is-indeterminate", fraction == null || state === "decoding");
      if (fraction == null || state === "decoding") indicator.removeAttribute("aria-valuenow");
      else indicator.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
      indicator.style.setProperty("--progress", String(fraction ?? 0.25));
    };

    const release = (content: Content) => {
      const job = upgrades.get(content);
      if (!job) return;
      job.controller.abort();
      job.animation?.cancel();
      job.overlay?.remove();
      if (job.state !== "ready" && content.element instanceof HTMLImageElement) {
        content.element.src = content.data.src ?? "";
      }
      if (job.url) URL.revokeObjectURL(job.url);
      upgrades.delete(content);
    };

    const upgradeCurrent = async () => {
      const slide = lightbox.pswp?.currSlide;
      if (!opened || !slide) return;
      const content = slide.content;
      const image = content.element;
      const source = slide.data.element as HTMLAnchorElement | undefined;
      if (!source || !(image instanceof HTMLImageElement) || !image.complete || !image.naturalWidth) return;
      if (upgrades.has(content)) { updateProgress(); return; }
      const job: Upgrade = { controller: new AbortController(), state: "loading", fraction: 0 };
      upgrades.set(content, job);
      updateProgress();
      try {
        const blob = await fetchOriginal(source.href, job.controller.signal, (fraction) => {
          job.fraction = fraction;
          if (slide.isActive) updateProgress();
        });
        if (job.controller.signal.aborted) return;
        job.state = "decoding";
        job.fraction = 1;
        updateProgress();
        const full = new Image();
        job.overlay = full;
        job.url = URL.createObjectURL(blob);
        full.src = job.url;
        await full.decode();
        if (job.controller.signal.aborted) return;
        full.className = "pswp__img lb-full-image";
        full.alt = image.alt;
        full.style.width = image.style.width;
        full.style.height = image.style.height;
        slide.container.append(full);
        // Preserve the preview underneath until the decoded source has faded in.
        job.animation = full.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240,
          fill: "forwards",
        });
        await job.animation.finished;
        if (job.controller.signal.aborted) return;
        image.src = job.url;
        await image.decode();
        if (job.controller.signal.aborted) return;
        content.data.src = job.url;
        full.remove();
        job.overlay = undefined;
        job.state = "ready";
        updateProgress();
      } catch {
        if (job.controller.signal.aborted) return;
        job.animation?.cancel();
        job.overlay?.remove();
        image.src = content.data.src ?? "";
        if (job.url) { URL.revokeObjectURL(job.url); job.url = undefined; }
        job.state = "error";
        updateProgress();
      }
    };

    lightbox.on("beforeOpen", () => {
      closing = false;
      document.documentElement.classList.add("lb-open");
    });
    lightbox.on("openingAnimationEnd", () => {
      opened = true;
      void upgradeCurrent();
    });
    lightbox.on("change", () => {
      const current = lightbox.pswp?.currSlide?.content;
      // Cancel unfinished downloads when paging quickly; retain completed sources in this session.
      for (const [content, job] of upgrades) {
        if (content !== current && job.state !== "ready") release(content);
      }
      updateProgress();
      void upgradeCurrent();
    });
    lightbox.on("loadComplete", ({ content }) => {
      if (content === lightbox.pswp?.currSlide?.content) void upgradeCurrent();
    });
    lightbox.on("contentResize", ({ content, width, height }) => {
      const overlay = upgrades.get(content)?.overlay;
      if (overlay) {
        overlay.style.width = `${width}px`;
        overlay.style.height = `${height}px`;
      }
    });
    lightbox.on("contentDestroy", ({ content }) => release(content));
    lightbox.on("close", () => {
      opened = false;
      for (const job of upgrades.values()) job.controller.abort();
      if (lightbox.pswp) lightbox.pswp.options.showHideAnimationType = "fade";
    });
    lightbox.on("destroy", () => {
      opened = false;
      for (const content of upgrades.keys()) release(content);
      indicator = undefined;
      document.documentElement.classList.remove("lb-open");
    });
    // The clicked photo keeps its hover zoom while the viewer covers it (the viewer takes
    // the pointer's :hover away); it is released when the viewer closes.
    lightbox.on("close", () => {
      closing = true;
      for (const photo of held) delete photo.dataset.held;
      held.clear();
    });

    lightbox.on("uiRegister", () => {
      lightbox.pswp?.ui?.registerElement({
        name: "original-progress",
        order: 6,
        appendTo: "bar",
        html: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle class="lb-progress-track" cx="10" cy="10" r="7"/><circle class="lb-progress-value" cx="10" cy="10" r="7" pathLength="1"/></svg>',
        onInit: (element) => {
          indicator = element;
          element.classList.add("lb-progress");
          element.setAttribute("role", "progressbar");
          element.setAttribute("aria-valuemin", "0");
          element.setAttribute("aria-valuemax", "100");
          updateProgress();
        },
      });
      // Zoom out / zoom in step through fit → middle → max, and grey out at either end.
      const zoomButton = (name: "zoom-out" | "zoom-in", order: number, title: string, icon: string) =>
        lightbox.pswp?.ui?.registerElement({
          name,
          order,
          isButton: true,
          title,
          ariaLabel: title,
          appendTo: "bar",
          html: `<svg class="pswp__icn" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5"/><path d="m12 12 5 5M6 8.5h5"/>${icon}</svg>`,
          onInit: (element, pswp) => {
            const button = element as HTMLButtonElement;
            const steps = () => {
              const levels = pswp.currSlide?.zoomLevels;
              return levels ? [levels.initial, levels.secondary, levels.max] : [];
            };
            const next = () => {
              const slide = pswp.currSlide;
              if (!slide || !slide.isZoomable()) return undefined;
              const z = slide.currZoomLevel;
              const list = steps();
              return name === "zoom-in"
                ? list.find((level) => level > z * 1.01)
                : list.slice().reverse().find((level) => level < z * 0.99);
            };
            const update = () => {
              button.disabled = next() === undefined;
            };
            button.addEventListener("click", () => {
              const level = next();
              if (level === undefined) return;
              pswp.currSlide?.zoomTo(level, { x: pswp.viewportSize.x / 2, y: pswp.viewportSize.y / 2 }, 333);
            });
            pswp.on("change", update);
            pswp.on("zoomPanUpdate", update);
            pswp.on("zoomLevelsUpdate", () => requestAnimationFrame(update));
            update();
          },
        });
      zoomButton("zoom-out", 9, tr.zoomOut, "");
      zoomButton("zoom-in", 10, tr.zoomIn, '<path d="M8.5 6v5"/>');

      lightbox.pswp?.ui?.registerElement({
        name: "download",
        order: 8,
        isButton: true,
        tagName: "a",
        title: tr.download,
        ariaLabel: tr.download,
        appendTo: "bar",
        html: '<svg class="pswp__icn" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10m-4-4 4 4 4-4M4 15v3h12v-3"/></svg>',
        onInit: (element, pswp) => {
          const link = element as HTMLAnchorElement;
          const update = () => {
            const source = pswp.currSlide?.data.element as HTMLAnchorElement | undefined;
            if (!source) return;
            link.href = source.dataset.downloadSrc ?? source.href;
            link.download = source.dataset.downloadName ?? "original";
          };
          pswp.on("change", update);
          update();
        },
      });
    });

    lightbox.init();
    gallery.dataset.lightboxReady = "true";
    const pending = gallery.dataset.lightboxPending;
    delete gallery.dataset.lightboxPending;
    if (pending !== undefined) {
      const index = Number(pending);
      if (Number.isInteger(index) && index >= 0 && index < gallery.querySelectorAll("a[data-pswp-width]").length) {
        lightbox.loadAndOpen(index, { gallery });
      }
    }
    instances.push(lightbox);
  });

  // Warm the viewer core while idle, so the first photo still opens without waiting.
  let warm: number | undefined;
  if (galleries.length && typeof requestIdleCallback === "function") {
    warm = requestIdleCallback(() => void import("photoswipe"), { timeout: 4000 });
  }

  return () => {
    if (warm !== undefined) cancelIdleCallback(warm);
    galleries.forEach((gallery) => {
      delete gallery.dataset.lightboxReady;
      delete gallery.dataset.lightboxPending;
    });
    instances.forEach((lb) => lb.destroy());
  };
}
