// Client-side behaviour, re-run after every navigation (astro:page-load).
import { initPlaqueScrollbar } from "./plaque-scrollbar";
import { installListPageCache } from "./list-page-cache";
import { navigate } from "astro:transitions/client";
import { preparePhotoNavigation } from "./navigation-image";
import { prefetch } from "astro:prefetch";
import { festiveKey, headwearKey, markHit, markMarkup, popMark } from "./festive";
import { langOf, localeSwitch, type Lang } from "../i18n";
import { applySizeScale, layoutPrinted } from "./screen";

installListPageCache();

// Touch screens never fire "hover", so on-site links used to start loading only on
// click. Begin fetching the page (and its first photograph) as soon as a finger or
// mouse button goes down — usually 80–150 ms before the click — so the navigation
// that follows starts with a request already in flight. Nothing else changes.
const pressed = new WeakSet<HTMLAnchorElement>();
document.addEventListener(
  "pointerdown",
  (e) => {
    if (e.button !== 0) return;
    const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href]");
    if (!link || link.hasAttribute("data-back") || link.hasAttribute("data-pswp-width") || link.hasAttribute("download") || pressed.has(link) || link.target === "_blank" || link.origin !== location.origin) return;
    if (link.pathname === location.pathname) return;
    pressed.add(link);
    prefetch(link.href, { ignoreSlowConnection: true });
    if (link.dataset.preloadSrcset) {
      const img = new Image();
      img.fetchPriority = "high";
      img.sizes = link.dataset.preloadSizes ?? "100vw";
      img.srcset = link.dataset.preloadSrcset;
    }
  },
  { capture: true, passive: true },
);

let cleanups: Array<() => void> = [];

// Shared-image transitions: only the one photo being opened or returned to gets a
// view-transition name. Naming every card on a long index made each page change
// snapshot hundreds of elements, which is what stuttered on the big pages.
// A photo opens from (and returns to) the frame that was clicked: a waterfall card or
// the home page's featured slide. Frames that can carry a photo's name:
const PHOTO_FRAMES = "[data-card] figure, .slide-media[data-vt-key]";
const photoOrigin = new Map<string, "hero" | "card">();
const namePhotoFrame = (frame: HTMLElement, key: string) => {
  frame.style.viewTransitionName = `photo-${key}`;
  frame.style.setProperty("view-transition-class", "photo");
};
const clearPhotoFrames = (root: ParentNode) =>
  root.querySelectorAll<HTMLElement>(PHOTO_FRAMES).forEach((f) => {
    f.style.viewTransitionName = "";
    f.style.removeProperty("view-transition-class");
  });
document.addEventListener(
  "click",
  (e) => {
    const target = e.target as Element | null;
    // The featured slide: its photo or its title opens the same album.
    const slide = target?.closest?.(".slide.is-active");
    const hero = slide?.querySelector<HTMLElement>(".slide-media[data-vt-key]");
    if (hero && target?.closest?.("a")) {
      clearPhotoFrames(document);
      namePhotoFrame(hero, hero.dataset.vtKey!);
      photoOrigin.set(hero.dataset.vtKey!, "hero");
      return;
    }
    // Albums open with a plain cross-fade: their cover may sit anywhere in the album.
    const card = target?.closest?.("[data-card]:not(.is-album)");
    // Name the whole frame (not just the <img>) so its coloured backing travels with the
    // photo instead of being left behind as a dark box in the old spot.
    const img = card?.querySelector<HTMLImageElement>("img[data-vt-key]");
    const frame = img?.closest("figure");
    if (!img || !frame) return;
    // A list page restored from memory still carries the name from the last return.
    clearPhotoFrames(document);
    namePhotoFrame(frame, img.dataset.vtKey!);
    photoOrigin.set(img.dataset.vtKey!, "card");
  },
  true,
);
// Going back (or forward) to a page you've already seen: show it as you left it,
// without replaying the scroll-in reveals, image fades or intro animations.
document.addEventListener("astro:before-swap", (e) => {
  if (lastNavType !== "traverse") return;
  const doc = e.newDocument;
  doc.documentElement.classList.add("is-return");
  doc.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-visible", "is-done"));
  doc.querySelectorAll("img.fade:not([data-deferred-src])").forEach((el) => el.classList.add("is-loaded"));
});

// Leaving a photograph: it returns to the frame it was opened from. A photo opened from
// the featured slide goes back to that slide if it is still the one showing.
document.addEventListener("astro:before-swap", (e) => {
  const key = document.querySelector<HTMLElement>("[data-vt-current]")?.dataset.vtCurrent;
  if (!key) return;
  const doc = e.newDocument;
  clearPhotoFrames(doc);
  const hero = doc.querySelector<HTMLElement>(`.slide.is-active .slide-media[data-vt-key="${key}"]`);
  const card = doc.querySelector(`img[data-vt-key="${key}"]`)?.closest("figure");
  const frame = photoOrigin.get(key) === "hero" && hero ? hero : card ?? null;
  if (frame instanceof HTMLElement) namePhotoFrame(frame, key);
});

// WebKit (Safari, and every browser on iOS, Chrome included) plays a new page's entrance
// animations inside the view transition and then starts them over when the transition
// ends, so headings and photos rise twice; slow networks make it obvious. There, hold
// entrances (paused, still at their starting pose) until the transition has finished.
const webkitEngine = (() => {
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/(Chrome|Chromium|Edg|OPR)\//.test(ua);
})();
document.addEventListener("astro:before-swap", (e) => {
  if (!webkitEngine || !e.viewTransition?.finished) return;
  e.newDocument.documentElement.setAttribute("data-vt-hold", "");
  e.viewTransition.finished.finally(() => document.documentElement.removeAttribute("data-vt-hold"));
});

// Opening a photo from a card: its frame shadow stays put while the photo flies in, so
// keep it off until the transition ends and let it fade in afterwards.
document.addEventListener("astro:before-swap", (e) => {
  const flying = [...document.querySelectorAll<HTMLElement>(PHOTO_FRAMES)].some((f) => f.style.viewTransitionName);
  if (!flying || !e.newDocument.querySelector(".museum-photo")) return;
  e.newDocument.documentElement.setAttribute("data-photo-landing", "");
  e.viewTransition.finished.finally(() => document.documentElement.removeAttribute("data-photo-landing"));
});

document.addEventListener("astro:before-swap", () => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
});

function on<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) {
  target.addEventListener(type, fn, opts);
  cleanups.push(() => target.removeEventListener(type, fn, opts));
}

function headerScroll() {
  const body = document.body;
  let last = window.scrollY;
  const update = () => {
    const y = window.scrollY;
    body.classList.toggle("is-scrolled", y > 24);
    // Hide the header while scrolling down through the photos, show it again on the way up.
    body.classList.toggle("is-scrolled-down", y > last && y > window.innerHeight * 0.6);
    last = y;
  };
  update();
  on(window, "scroll", update, { passive: true });
}

function backToTop() {
  const button = document.querySelector<HTMLButtonElement>("[data-back-to-top]");
  if (!button) return;
  let lastY = Math.max(0, window.scrollY);
  let returningToTop = false;
  // A list page restored from the back cache brings the button back in whatever state
  // it was left in, so start from what is actually shown.
  let visible = button.classList.contains("is-visible");
  const awayFromTop = () => window.scrollY > 160;
  const atBottom = () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 24;
  const show = (value: boolean) => {
    if (value === visible) return;
    visible = value;
    button.classList.toggle("is-visible", value);
    button.inert = !value;
    button.setAttribute("aria-hidden", String(!value));
  };
  const onScroll = () => {
    const y = Math.max(0, window.scrollY);
    const delta = y - lastY;
    lastY = y;
    if (!awayFromTop()) {
      returningToTop = false;
      show(false);
    } else if (returningToTop) show(false);
    else if (atBottom()) show(true);
    else if (delta !== 0) show(delta < 0);
  };
  const onInterrupt = () => { returningToTop = false; };
  const onClick = () => {
    returningToTop = true;
    show(false);
    window.scrollTo({
      top: 0,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  };
  button.addEventListener("click", onClick);
  on(window, "scroll", onScroll, { passive: true });
  on(window, "resize", onScroll);
  on(window, "wheel", onInterrupt, { passive: true });
  on(window, "touchstart", onInterrupt, { passive: true });
  on(window, "pointerdown", onInterrupt, { passive: true });
  on(window, "keydown", onInterrupt);
  onScroll();
  cleanups.push(() => button.removeEventListener("click", onClick));
}

function themeToggle() {
  const btn = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  if (!btn) return;
  const toggle = () => {
    const root = document.documentElement;
    const current = root.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    const apply = () => {
      root.dataset.theme = next;
      try {
        localStorage.setItem("theme", next);
      } catch {}
    };
    if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(apply);
    } else apply();
  };
  btn.addEventListener("click", toggle);
  cleanups.push(() => btn.removeEventListener("click", toggle));
}

function heroSlideshow() {
  const hero = document.querySelector<HTMLElement>("[data-hero]");
  if (!hero) return;
  const slides = [...hero.querySelectorAll<HTMLElement>("[data-slide]")];
  const dots = [...hero.querySelectorAll<HTMLButtonElement>("[data-dot]")];
  if (slides.length < 2) return;
  let index = Math.max(0, slides.findIndex((slide) => slide.classList.contains("is-active")));
  let timer: number | undefined;
  const show = (i: number) => {
    index = (i + slides.length) % slides.length;
    // The numerical stacking order stays fixed in CSS. Every inactive photo
    // retracts, including the outgoing photo underneath an incoming upper layer.
    slides.forEach((s, j) => {
      s.classList.toggle("is-active", j === index);
      s.inert = j !== index;
    });
    dots.forEach((d, j) => d.setAttribute("aria-current", String(j === index)));
    hero.dispatchEvent(new Event("gallery:slide-change"));
  };
  const start = () => {
    stop();
    if (!document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      timer = window.setInterval(() => show(index + 1), 7000);
    }
  };
  const stop = () => window.clearInterval(timer);
  const select = (i: number) => {
    show(i);
    start();
  };
  dots.forEach((d, j) => {
    const click = () => select(j);
    d.addEventListener("click", click);
    cleanups.push(() => d.removeEventListener("click", click));
  });
  // ← / → on the home page step through the featured photographs.
  const onKey = (e: KeyboardEvent) => {
    if (shortcutBlocked(e)) return;
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    select(index + step);
  };
  document.addEventListener("keydown", onKey);
  cleanups.push(() => document.removeEventListener("keydown", onKey));
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVisibility);
  cleanups.push(() => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  });
  // Dragging only chooses a slide; the same CSS transition as the numbered buttons
  // runs after release, without any finger-driven styles overriding it.
  const stage = hero.querySelector<HTMLElement>(".stage") ?? hero;
  let x0 = 0;
  let y0 = 0;
  let t0 = 0;
  let dx = 0;
  let mode: "undecided" | "drag" | "scroll" = "undecided";
  let pointerId: number | null = null;
  let swiped = false;

  const onStart = (e: PointerEvent) => {
    if (!e.isPrimary) {
      onCancel();
      return;
    }
    if (e.button !== 0 || pointerId !== null) return;
    pointerId = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    t0 = performance.now();
    dx = 0;
    mode = "undecided";
    swiped = false;
    stop();
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId || mode === "scroll") return;
    const mx = e.clientX - x0;
    const my = e.clientY - y0;
    if (mode === "undecided") {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      mode = Math.abs(mx) > Math.abs(my) ? "drag" : "scroll";
      if (mode === "scroll") return;
      stage.classList.add("is-dragging");
    }
    dx = mx;
    swiped = true;
  };
  const onEnd = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    // Include the release position even when the last move event was coalesced.
    onMove(e);
    pointerId = null;
    stage.classList.remove("is-dragging");
    const speed = Math.abs(dx) / Math.max(1, performance.now() - t0);
    const commit = mode === "drag" && (
      Math.abs(dx) > stage.getBoundingClientRect().width * 0.22 ||
      (speed > 0.45 && Math.abs(dx) > 24)
    );
    mode = "undecided";
    if (commit) select(index + (dx < 0 ? 1 : -1));
    else start();
  };
  const onCancel = () => {
    if (pointerId === null) return;
    pointerId = null;
    stage.classList.remove("is-dragging");
    mode = "undecided";
    start();
  };
  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId === pointerId) onCancel();
  };
  // Prevent the browser from dragging the image/link instead of the slideshow.
  const onDragStart = (e: DragEvent) => e.preventDefault();
  // A swipe that ends on a link should not also open it.
  const onClick = (e: MouseEvent) => {
    if (swiped) {
      e.preventDefault();
      e.stopPropagation();
      swiped = false;
    }
  };
  stage.addEventListener("pointerdown", onStart, { passive: true });
  // Window listeners keep a mouse drag working when it leaves the photograph.
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerup", onEnd, { passive: true });
  window.addEventListener("pointercancel", onPointerCancel, { passive: true });
  window.addEventListener("blur", onCancel);
  stage.addEventListener("dragstart", onDragStart);
  stage.addEventListener("click", onClick, true);
  cleanups.push(() => {
    stage.removeEventListener("pointerdown", onStart);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("blur", onCancel);
    stage.removeEventListener("dragstart", onDragStart);
    stage.removeEventListener("click", onClick, true);
    stage.classList.remove("is-dragging");
  });

  show(index);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) start();
}

function categoryFilter() {
  const bar = document.querySelector<HTMLElement>("[data-filter-bar]");
  if (!bar) return;
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>("[data-filter]")];
  const groups = [...document.querySelectorAll<HTMLElement>("[data-year-group]")];

  const apply = (value: string) => {
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === value)));
    for (const group of groups) {
      let visible = 0;
      group.querySelectorAll<HTMLElement>("[data-card]").forEach((card) => {
        const match = !value || (card.dataset.categories ?? "").split("|").includes(value);
        card.hidden = !match;
        if (match) {
          card.classList.add("is-visible", "is-done");
          visible++;
        }
      });
      group.hidden = visible === 0;
      const count = group.querySelector("[data-year-count]");
      if (count) count.textContent = String(visible);
    }
    // Re-deal the remaining cards into the shortest columns (see early-page.js).
    (window as Window & { __arrangeWaterfalls?: () => void }).__arrangeWaterfalls?.();
  };

  buttons.forEach((b) => {
    const click = () => {
      const value = b.dataset.filter ?? "";
      const url = new URL(location.href);
      if (value) url.searchParams.set("c", value);
      else url.searchParams.delete("c");
      history.replaceState(history.state, "", url);
      const run = () => apply(value);
      if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        document.startViewTransition(run);
      } else run();
      const top = bar.getBoundingClientRect().top + window.scrollY - 80;
      if (window.scrollY > top) window.scrollTo({ top, behavior: "smooth" });
    };
    b.addEventListener("click", click);
    cleanups.push(() => b.removeEventListener("click", click));
  });

  const initial = new URL(location.href).searchParams.get("c");
  if (initial && buttons.some((b) => b.dataset.filter === initial)) apply(initial);
}

function markLoadedImages() {
  // Images that finished loading before their onload handler was attached.
  document.querySelectorAll<HTMLImageElement>("img.fade:not(.is-loaded)").forEach((img) => {
    if (img.complete && img.naturalWidth > 0) img.classList.add("is-loaded");
  });
}

// A mirror of this tab's on-site history, so "返回" can jump straight back to the list
// (home or a category) you came from, even after paging through several albums.
const stack: string[] = [location.pathname];
let index = 0;
let lastNavType = "push";
let jumpTo: number | null = null;
document.addEventListener("astro:before-preparation", (e) => {
  const ev = e as Event & { navigationType?: string; direction?: string; to?: URL };
  lastNavType = ev.navigationType ?? "push";
  const to = ev.to?.pathname ?? location.pathname;
  if (ev.navigationType === "push") {
    stack.splice(index + 1, stack.length, to);
    index = stack.length - 1;
  } else if (ev.navigationType === "replace") {
    stack[index] = to;
  } else if (ev.navigationType === "traverse") {
    index = jumpTo ?? Math.max(0, Math.min(stack.length - 1, index + (ev.direction === "back" ? -1 : 1)));
    jumpTo = null;
    stack[index] = to;
  }
});

// Typing in a field, or a held modifier, keeps the keyboard shortcuts out of the way.
const shortcutBlocked = (e: KeyboardEvent) =>
  e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented ||
  document.documentElement.classList.contains("lb-open") ||
  !!(e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]");

// Esc or Backspace does what the 返回 button does, wherever that button is shown.
// Capture phase: the lightbox closing on the same Esc must not also leave the page.
window.addEventListener(
  "keydown",
  (e) => {
    if ((e.key !== "Escape" && e.key !== "Backspace") || e.repeat || shortcutBlocked(e)) return;
    const back = document.querySelector<HTMLAnchorElement>("[data-back]");
    if (!back) return;
    e.preventDefault();
    back.click();
  },
  true,
);

// D switches between light and dark, everywhere (same as the round toggle in the bar).
window.addEventListener("keydown", (e) => {
  if (e.key !== "d" && e.key !== "D") return;
  if (e.repeat || shortcutBlocked(e)) return;
  const toggle = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  if (!toggle) return;
  e.preventDefault();
  toggle.click();
});

// Single photograph pages: F opens the full-size viewer, and F again closes it.
window.addEventListener("keydown", (e) => {
  if (e.key !== "f" && e.key !== "F") return;
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
  if ((e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
  const photo = document.querySelector<HTMLAnchorElement>(".museum-photo[data-pswp-width]");
  if (!photo) return;
  e.preventDefault();
  if (document.documentElement.classList.contains("lb-open")) {
    (window as Window & { pswp?: { close(): void } }).pswp?.close();
  } else photo.click();
});

const isList = (p: string) => p === "/" || p.startsWith("/categories/");

function backButton() {
  const btn = document.querySelector<HTMLAnchorElement>("[data-back]");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const here = stack[index];
    // A single category always goes up to the categories index, never sideways to
    // another category or out to the home page.
    const target = /^\/categories\/.+/.test(decodeURI(here)) ? (p: string) => p === "/categories/" : (p: string) => isList(p) && p !== here;
    for (let j = index - 1; j >= 0; j--) {
      if (target(stack[j])) {
        jumpTo = j;
        history.go(j - index);
        return;
      }
    }
    navigate(btn.getAttribute("href") ?? "/");
  });
}

// ---- Paging between photographs -------------------------------------------------
// The outgoing page fades away and the next photograph floats up into place.
let flipDir: "prev" | "next" | null = null;

function startFlip(link: HTMLAnchorElement) {
  flipDir = (link.dataset.flip as "prev" | "next") ?? null;
  // Paging uses the album reveal, not the shared-photo morph.
  const stage = document.querySelector<HTMLElement>("[data-stage]");
  if (stage) stage.style.viewTransitionName = "none";
  // data-flipping goes on the incoming page only: on this one it would replay the
  // plaque's rise while the next page is still loading.
}

document.addEventListener(
  "click",
  (e) => {
    const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a[data-flip]");
    if (link) startFlip(link);
  },
  true,
);

document.addEventListener("astro:before-preparation", preparePhotoNavigation);

// Phones, leaving a photograph or an album: its text block sinks back the way it rose
// in, instead of vanishing in the page cross-fade. Paging keeps its own transition.
document.addEventListener("astro:before-preparation", () => {
  if (flipDir || !matchMedia("(max-width: 900px)").matches) return;
  const text = document.querySelector<HTMLElement>("main .plaque, main .album-head");
  if (text) text.style.viewTransitionName = "page-text";
});

document.addEventListener("astro:before-swap", (e) => {
  if (!flipDir) {
    delete document.documentElement.dataset.flipping;
    return;
  }
  e.newDocument.documentElement.dataset.flipping = flipDir;
  e.newDocument.querySelector(".museum-photo")?.classList.add("reveal");
  const stage = e.newDocument.querySelector<HTMLElement>("[data-stage]");
  if (stage) stage.style.viewTransitionName = "none";
  flipDir = null;
});

// Warm neighbours only after this page's eager images finish. CPU idle time
// alone says nothing about how busy the network is on a slow connection.
function preloadNeighbours() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>("a[data-flip][data-preload-srcset]")];
  if (!links.length) return;
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string; downlink?: number };
  }).connection;
  const constrained = () => connection?.saveData || /(^|-)2g$|^3g$/.test(connection?.effectiveType ?? "")
    || (connection?.downlink !== undefined && connection.downlink < 1.5);
  const warmed = new Set<HTMLAnchorElement>();
  let disposed = false;
  let idle: number | undefined;
  let timeout: number | undefined;
  const warm = (link: HTMLAnchorElement) => {
    if (disposed || warmed.has(link)) return;
    warmed.add(link);
    // The page itself is a few KB: having it ready lets the plaque change on the click.
    prefetch(link.href, { ignoreSlowConnection: true });
    const img = new Image();
    img.fetchPriority = "low";
    img.decoding = "async";
    img.sizes = link.dataset.preloadSizes ?? "100vw";
    img.srcset = link.dataset.preloadSrcset ?? "";
  };
  const pending = [...document.querySelectorAll<HTMLImageElement>("main img")]
    .filter((img) => img.loading !== "lazy" && !img.complete);
  const removers: Array<() => void> = [];
  const schedule = () => {
    if (disposed || constrained()) return;
    const run = () => {
      if (!constrained()) links.forEach(warm);
    };
    if ("requestIdleCallback" in window) idle = window.requestIdleCallback(run, { timeout: 1500 });
    else timeout = window.setTimeout(run, 600);
  };
  // Intent can still warm one neighbour on slow networks, once the current
  // photographs are ready. Navigation and its animations keep their usual path.
  links.forEach((link) => {
    const intent = () => { if (!pending.length) warm(link); };
    link.addEventListener("pointerenter", intent);
    link.addEventListener("focus", intent);
    removers.push(() => {
      link.removeEventListener("pointerenter", intent);
      link.removeEventListener("focus", intent);
    });
  });
  pending.slice().forEach((img) => {
    const settled = () => {
      img.removeEventListener("load", settled);
      img.removeEventListener("error", settled);
      pending.splice(pending.indexOf(img), 1);
      if (!pending.length) schedule();
    };
    img.addEventListener("load", settled);
    img.addEventListener("error", settled);
    removers.push(() => {
      img.removeEventListener("load", settled);
      img.removeEventListener("error", settled);
    });
  });
  if (!pending.length) schedule();
  cleanups.push(() => {
    disposed = true;
    if (idle !== undefined) window.cancelIdleCallback(idle);
    if (timeout !== undefined) window.clearTimeout(timeout);
    removers.forEach((remove) => remove());
  });
}

// ← / → page through photographs (unless the lightbox is open).
function flipKeys() {
  if (!document.querySelector("[data-flip]")) return;
  const onKey = (e: KeyboardEvent) => {
    if (shortcutBlocked(e)) return;
    const dir = e.key === "ArrowLeft" ? "prev" : e.key === "ArrowRight" ? "next" : null;
    const link = dir && document.querySelector<HTMLAnchorElement>(`a[data-flip="${dir}"]`);
    if (link) {
      e.preventDefault();
      link.click(); // same path as a mouse click, so the router and flip animation both apply
    }
  };
  document.addEventListener("keydown", onKey);
  cleanups.push(() => document.removeEventListener("keydown", onKey));
}

// Phones: choose the gap between filter options so the screen edge always cuts through
// the middle of an option rather than falling in a gap, which shows the row scrolls.
function fitFilterRow() {
  const row = document.querySelector<HTMLElement>(".filter-row");
  if (!row) return;
  const fit = () => {
    if (!matchMedia("(max-width: 900px)").matches) {
      row.style.removeProperty("--filter-gap");
      return;
    }
    const items = [...row.children] as HTMLElement[];
    const edge = row.getBoundingClientRect().left + row.clientWidth;
    // How far through the option under the screen edge the edge falls (0–1), or -1 in a gap.
    const cutAt = () => {
      for (const el of items) {
        const r = el.getBoundingClientRect();
        if (r.left < edge && r.right > edge) return (edge - r.left) / r.width;
      }
      return -1;
    };
    let best = 22;
    let bestScore = Infinity;
    for (let g = 14; g <= 32; g += 0.5) {
      row.style.setProperty("--filter-gap", `${g}px`);
      const c = cutAt();
      const score = c < 0 ? Infinity : Math.abs(c - 0.5) + Math.abs(g - 22) / 100;
      if (score < bestScore) [best, bestScore] = [g, score];
    }
    row.style.setProperty("--filter-gap", `${best}px`);
  };
  fit();
  document.fonts?.ready.then(fit);
  // Phone browsers fire resize as the address bar slides in and out while scrolling;
  // only a change of width can move the row's edge.
  let width = window.innerWidth;
  const onResize = () => {
    if (window.innerWidth === width) return;
    width = window.innerWidth;
    fit();
  };
  window.addEventListener("resize", onResize);
  cleanups.push(() => window.removeEventListener("resize", onResize));
}

// On a solar term, a holiday or the birthday, a festive mark takes the apostrophe's
// place in every wordmark. The marks are fetched only on such days; once loaded,
// the incoming page gets its mark before it is shown, so navigation never flashes.
let festive: { key: string; markup: string } | null = null;

function applyFestive(doc: Document) {
  if (!festive) return;
  const ticks = doc.querySelectorAll(".wm path.wm-tick");
  if (!ticks.length) return;
  // Drop the stand-in target the apostrophe got on a plain day; the mark's comes with it.
  doc.querySelectorAll(".wm-tick-hit").forEach((el) => el.remove());
  const parsed = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${festive.markup}</svg>`, "image/svg+xml");
  ticks.forEach((tick) => tick.replaceWith(...Array.from(parsed.documentElement.children, (el) => doc.importNode(el, true))));
}

function festiveMark() {
  const key = festiveKey();
  if (!key || festive?.key === key) return;
  void import("../data/festive-marks.json").then(({ default: data }) => {
    const mark = data.marks.find((m) => m.name === key);
    if (!mark) return;
    festive = { key, markup: markMarkup(mark.name, data.place, mark.svg) + markHit(data.place) };
    applyFestive(document);
  });
}

document.addEventListener("astro:before-swap", (e) => {
  applyFestive(e.newDocument);
  // The blank-page hold never survives a navigation: the gallery's arrival sets it again if
  // it is the way in, and leaving mid-celebration must never hide the page you land on.
  document.documentElement.classList.remove("is-celebrating", "is-revealing");
});

// The mark in the home page's big wordmark (and in the hidden gallery) hops when clicked.
// Clicks are caught by a still target around it, since hovering lifts the mark away.
let leaving = false;
document.addEventListener("click", (e) => {
  const hit = (e.target as Element | null)?.closest?.(".statement .wm-mark-hit, [data-festive-gallery] .wm-mark-hit");
  if (!hit) return;
  const svg = hit.closest("svg");
  const mark = svg?.querySelector(".wm-mark.is-on, .wm-mark:not([data-mark])");
  if (mark) popMark(mark);
  // On the home page, five taps within three seconds are the way into the hidden gallery:
  // it opens blank, celebrates, and only then shows itself. A plain page load, rather than
  // the router, so nothing of this page is left cross-fading under the ribbons.
  if (!leaving && hit.closest(".statement") && countEggTap()) {
    leaving = true;
    try {
      sessionStorage.setItem(EGG_ARRIVAL, "1");
    } catch {
      /* private mode: the page simply opens without the celebration */
    }
    location.assign(localeSwitch("/egg/", langOf(location.pathname)));
  }
});

const EGG_ARRIVAL = "egg-arrival";
const EGG_TAPS = 5;
const EGG_TAP_WINDOW = 3000;
let eggTaps: number[] = [];

/** Records a tap and says whether it completed the five-in-three-seconds sequence. */
function countEggTap() {
  const now = performance.now();
  eggTaps = eggTaps.filter((t) => now - t < EGG_TAP_WINDOW);
  eggTaps.push(now);
  if (eggTaps.length < EGG_TAPS) return false;
  eggTaps = [];
  return true;
}

// The apostrophe is that way in on any ordinary day, but hovering lifts it out from under
// the pointer, so give it the still target a festive mark gets. Sizes are in the wordmark's
// own units, so the target is measured in screen pixels to stay reachable on a phone.
function tickHitTarget() {
  for (const svg of document.querySelectorAll<SVGSVGElement>(".statement .wm svg")) {
    if (svg.querySelector(".wm-mark-hit")) continue;
    const tick = svg.querySelector<SVGGraphicsElement>("path.wm-tick");
    const ctm = svg.getScreenCTM();
    if (!tick || !ctm) continue;
    const b = tick.getBBox();
    const pxPerUnit = Math.hypot(ctm.a, ctm.b) || 1;
    const pad = Math.max(40, 16 / pxPerUnit);
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", "wm-mark-hit wm-tick-hit");
    rect.setAttribute("x", String(b.x - pad));
    // Plus the 200 units it floats up on hover, so the target follows it there.
    rect.setAttribute("y", String(b.y - 200 - pad));
    rect.setAttribute("width", String(b.width + pad * 2));
    rect.setAttribute("height", String(b.height + 200 + pad * 2));
    rect.setAttribute("fill", "none");
    rect.setAttribute("pointer-events", "all");
    tick.after(rect);
  }
}

// The footer is carried across page swaps, so its language links are re-pointed at the page
// the visitor is actually on, and the current language is marked. They reload rather than
// swap: another language is another document, with its own fonts and its own <html lang>.
function syncLangSwitch() {
  const nav = document.querySelector<HTMLElement>("[data-lang-switch]");
  if (!nav) return;
  const here = langOf(location.pathname);
  nav.querySelectorAll<HTMLAnchorElement>("[data-lang]").forEach((a) => {
    const lang = a.dataset.lang as Lang;
    a.href = localeSwitch(location.pathname, lang);
    const current = lang === here;
    a.classList.toggle("is-current", current);
    if (current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

// The footer avatar's headwear for the day (the footer persists across navigation).
function avatarWear() {
  const frame = document.querySelector<HTMLElement>(".avatar-frame");
  const wear = headwearKey();
  if (!frame || frame.dataset.wear === wear) return;
  frame.dataset.wear = wear;
  void import("./avatar-wear").then(({ wearMarkup }) => {
    frame.querySelector(".avatar-wear")?.remove();
    frame.insertAdjacentHTML("beforeend", wearMarkup(wear as Parameters<typeof wearMarkup>[0]));
  });
}

let printedResize = false;

export function initPage() {
  // Print sizes remain proportional at every width; one sheet is shared with the viewer.
  applySizeScale();
  layoutPrinted();
  const printedSheet = document.querySelector(".sheet-printed");
  if (printedSheet) void document.fonts.ready.then(() => {
    if (printedSheet.isConnected) layoutPrinted();
  });
  // Recompose rows after a width or pixel-density change, not mobile address-bar movement.
  if (!printedResize) {
    printedResize = true;
    let frame = 0;
    let lastWidth = innerWidth;
    let lastDensity = devicePixelRatio;
    addEventListener("resize", () => {
      if (frame || (innerWidth === lastWidth && devicePixelRatio === lastDensity)) return;
      // Follow the drag on the next paint, coalescing resize bursts into one layout.
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (innerWidth === lastWidth && devicePixelRatio === lastDensity) return;
        lastWidth = innerWidth;
        lastDensity = devicePixelRatio;
        applySizeScale();
        layoutPrinted();
      });
    });
  }
  festiveMark();
  tickHitTarget();
  syncLangSwitch();
  avatarWear();
  const egg = document.querySelector<HTMLElement>("[data-festive-gallery]");
  if (egg) {
    let dispose: (() => void) | undefined;
    let disposed = false;
    void import("./festive-gallery").then(({ initFestiveGallery }) => {
      if (!disposed) dispose = initFestiveGallery(egg);
    });
    cleanups.push(() => {
      disposed = true;
      dispose?.();
    });
  }
  // The photo viewer is only fetched on pages that have photos to open.
  if (document.querySelector("[data-gallery]")) {
    let dispose: (() => void) | undefined;
    let disposed = false;
    // Fetch the viewer core alongside, rather than after, the viewer setup.
    void import("photoswipe");
    void import("./lightbox").then(({ initLightbox }) => {
      if (!disposed) dispose = initLightbox();
    });
    cleanups.push(() => {
      disposed = true;
      dispose?.();
    });
  }
  cleanups.push(initPlaqueScrollbar());
  fitFilterRow();
  flipKeys();
  backButton();
  markLoadedImages();
  headerScroll();
  backToTop();
  themeToggle();
  heroSlideshow();
  categoryFilter();
  const preloadFrame = requestAnimationFrame(() => {
    preloadNeighbours();
  });
  cleanups.push(() => cancelAnimationFrame(preloadFrame));
}
