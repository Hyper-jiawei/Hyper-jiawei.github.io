/** A draggable scroll marker on the photograph plaque's existing left divider. */
export function initPlaqueScrollbar(): () => void {
  const plaque = document.querySelector<HTMLElement>(".plaque");
  const details = plaque?.querySelector<HTMLElement>(".plaque-details");
  const rail = plaque?.querySelector<HTMLElement>(".plaque-scrollbar");
  const paging = plaque?.querySelector<HTMLElement>(":scope > .flip");
  if (!plaque || !details || !rail) return () => {};

  let thumbSize = 0;
  let travel = 0;
  let maximum = 0;
  let pointer: number | null = null;
  let grabOffset = 0;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const showWhileScrolling = () => {
    if (disposed || rail.hidden) return;
    clearTimeout(hideTimer);
    rail.classList.add("is-scrolling");
    hideTimer = setTimeout(() => {
      if (pointer === null) rail.classList.remove("is-scrolling");
    }, 800);
  };
  const update = () => {
    const desktop = matchMedia("(min-width: 901px)").matches;
    if (paging) {
      // Measure natural content rather than the already constrained scroll viewport.
      // This stays stable when the paging controls move out of normal flow.
      const contentGap = parseFloat(getComputedStyle(details).rowGap) || 0;
      const plaqueGap = parseFloat(getComputedStyle(plaque).rowGap) || 0;
      const contentHeight = Array.from(details.children).reduce((sum, child) => sum + (child as HTMLElement).offsetHeight, 0)
        + Math.max(0, details.children.length - 1) * contentGap;
      const clearance = paging.offsetHeight + plaqueGap;
      plaque.style.setProperty("--paging-clearance", `${clearance}px`);
      plaque.classList.toggle("has-floating-paging", desktop && contentHeight + clearance > plaque.clientHeight + 1);
    }
    const height = details.clientHeight;
    maximum = Math.max(0, details.scrollHeight - height);
    const active = desktop && maximum > 1;
    rail.hidden = !active;
    if (!active) {
      clearTimeout(hideTimer);
      rail.classList.remove("is-scrolling");
    }
    // The divider spans the entire plaque, including its fixed paging controls.
    const trackHeight = plaque.clientHeight;
    thumbSize = Math.min(trackHeight, Math.max(24, trackHeight * height / Math.max(1, details.scrollHeight)));
    travel = trackHeight - thumbSize;
    rail.style.setProperty("--scroll-thumb", `${thumbSize}px`);
    rail.setAttribute("aria-valuemax", String(maximum));
    position();
  };
  // Scrolling only moves the thumb: read the offset first, then write, so no layout
  // has to be redone per scroll event. Sizes are re-measured by the ResizeObserver.
  const position = () => {
    const top = details.scrollTop;
    rail.style.setProperty("--scroll-offset", `${maximum ? Math.min(1, Math.max(0, top / maximum)) * travel : 0}px`);
    rail.setAttribute("aria-valuenow", String(Math.round(Math.min(maximum, Math.max(0, top)))));
  };
  const moveTo = (clientY: number) => {
    if (travel <= 0) return;
    const offset = clientY - rail.getBoundingClientRect().top - grabOffset;
    details.scrollTop = Math.min(1, Math.max(0, offset / travel)) * maximum;
    position();
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    rail.focus({ preventScroll: true });
    const offset = maximum ? details.scrollTop / maximum * travel : 0;
    const y = event.clientY - rail.getBoundingClientRect().top;
    grabOffset = y >= offset && y <= offset + thumbSize ? y - offset : thumbSize / 2;
    pointer = event.pointerId;
    rail.setPointerCapture(pointer);
    rail.classList.add("is-dragging");
    showWhileScrolling();
    moveTo(event.clientY);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId === pointer) moveTo(event.clientY);
  };
  const end = () => {
    if (pointer === null) return;
    const previousPointer = pointer;
    pointer = null;
    if (rail.hasPointerCapture(previousPointer)) rail.releasePointerCapture(previousPointer);
    rail.classList.remove("is-dragging");
    showWhileScrolling();
  };
  const scroll = () => {
    position();
    showWhileScrolling();
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? details.clientHeight : 1;
    details.scrollTop += event.deltaY * unit;
    scroll();
  };
  const key = (event: KeyboardEvent) => {
    const steps: Record<string, number> = {
      ArrowUp: -40, ArrowDown: 40,
      PageUp: -details.clientHeight * 0.9, PageDown: details.clientHeight * 0.9,
      Home: -maximum, End: maximum,
    };
    if (!(event.key in steps)) return;
    event.preventDefault();
    event.stopPropagation();
    details.scrollTop += steps[event.key];
    scroll();
  };

  details.addEventListener("scroll", scroll, { passive: true });
  rail.addEventListener("pointerdown", down);
  rail.addEventListener("pointermove", move);
  rail.addEventListener("pointerup", end);
  rail.addEventListener("pointercancel", end);
  rail.addEventListener("lostpointercapture", end);
  rail.addEventListener("keydown", key);
  rail.addEventListener("wheel", wheel, { passive: false });
  const observer = new ResizeObserver(update);
  observer.observe(plaque);
  observer.observe(details);
  if (paging) observer.observe(paging);
  for (const child of details.children) observer.observe(child);
  update();

  return () => {
    disposed = true;
    clearTimeout(hideTimer);
    end();
    observer.disconnect();
    details.removeEventListener("scroll", scroll);
    rail.removeEventListener("pointerdown", down);
    rail.removeEventListener("pointermove", move);
    rail.removeEventListener("pointerup", end);
    rail.removeEventListener("pointercancel", end);
    rail.removeEventListener("lostpointercapture", end);
    rail.removeEventListener("keydown", key);
    rail.removeEventListener("wheel", wheel);
  };
}
