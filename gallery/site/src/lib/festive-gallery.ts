// The hidden /egg/ page (festive marks): browse every festive mark in the wordmark, one at a time.
import { festiveKey } from "./festive";

export function initFestiveGallery(root: HTMLElement): () => void {
  const wm = root.querySelector<HTMLElement>(".wm");
  const svg = wm?.querySelector("svg");
  const marks = Array.from(root.querySelectorAll<SVGGElement>(".wm-mark"));
  const thumbs = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-egg-thumb]"));
  if (!wm || !svg || !marks.length) return () => {};
  const indexEl = root.querySelector("[data-egg-index]")!;
  const nameEl = root.querySelector("[data-egg-name]")!;
  const kindEl = root.querySelector("[data-egg-kind]")!;
  const whenEl = root.querySelector("[data-egg-when]")!;
  const n = marks.length;
  const byName = (name: string) => thumbs.findIndex((t) => t.dataset.name === name);

  let index = -1;
  const show = (next: number, dir = 1) => {
    next = ((next % n) + n) % n;
    if (next === index) return;
    svg.style.setProperty("--dir", String(dir));
    const incoming = marks[next];
    // Park the incoming mark on the side it enters from, without animating there.
    incoming.classList.remove("was-on");
    incoming.classList.add("no-anim");
    incoming.getBoundingClientRect();
    incoming.classList.remove("no-anim");
    if (index >= 0) {
      marks[index].classList.remove("is-on");
      marks[index].classList.add("was-on");
    }
    incoming.classList.add("is-on");
    thumbs[index]?.setAttribute("aria-current", "false");
    thumbs[next].setAttribute("aria-current", "true");
    const t = thumbs[next].dataset;
    indexEl.textContent = String(next + 1).padStart(2, "0");
    nameEl.textContent = t.label ?? t.name ?? "";
    kindEl.textContent = t.kind ?? "";
    whenEl.textContent = t.when ?? "";
    history.replaceState(history.state, "", `#${encodeURIComponent(t.name ?? "")}`);
    index = next;
  };

  // Start from the mark named in the link, else today's, else the first.
  const fromHash = byName(decodeURIComponent(location.hash.slice(1)));
  const today = festiveKey();
  show(fromHash >= 0 ? fromHash : today ? Math.max(0, byName(today)) : 0);

  const off: Array<() => void> = [];
  const listen = <K extends keyof HTMLElementEventMap>(el: EventTarget, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
    el.addEventListener(type, fn, opts);
    off.push(() => el.removeEventListener(type, fn, opts));
  };

  root.querySelectorAll<HTMLButtonElement>("[data-egg-step]").forEach((b) => {
    const step = Number(b.dataset.eggStep);
    listen(b, "click", () => show(index + step, step));
  });
  thumbs.forEach((b, i) => listen(b, "click", () => show(i, i < index ? -1 : 1)));
  listen(window, "hashchange", () => {
    const i = byName(decodeURIComponent(location.hash.slice(1)));
    if (i >= 0) show(i, i < index ? -1 : 1);
  });
  listen(document, "keydown", (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    show(index + step, step);
  });

  // Touch: swipe sideways to switch; a tap on the wordmark holds the hover pose (there is
  // no hover), while a tap on the mark itself makes it hop (handled with the home page's).
  const stage = root.querySelector<HTMLElement>("[data-egg-stage]")!;
  let x0 = 0, y0 = 0, touching = false;
  listen(stage, "pointerdown", (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    touching = true;
    x0 = e.clientX;
    y0 = e.clientY;
  });
  listen(stage, "pointerup", (e: PointerEvent) => {
    if (!touching) return;
    touching = false;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && wm.contains(e.target as Node) && !(e.target as Element).closest(".wm-mark-hit")) wm.classList.toggle("is-lifted");
  });
  listen(stage, "pointercancel", () => (touching = false));

  return () => off.forEach((fn) => fn());
}
