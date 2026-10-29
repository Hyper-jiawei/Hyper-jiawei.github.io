interface NavigationEvent extends Event {
  from: URL;
  to: URL;
  navigationType: string;
  signal: AbortSignal;
  loader: () => Promise<void>;
  newDocument: Document;
}

interface SavedList {
  shell: Document;
  main: HTMLElement;
}

const keyOf = (url: URL) => url.pathname + url.search;
const isList = (url: URL) => url.pathname === "/" || url.pathname.startsWith("/categories/");

/** Keep a few visited lists alive instead of refetching HTML and rebuilding their images. */
export function installListPageCache(limit = 3) {
  const pages = new Map<string, SavedList>();
  const restores = new WeakMap<Document, SavedList>();

  // Already loaded, scoped page CSS can stay active across these static routes.
  // Keeping the original stylesheet nodes also avoids a CSS fetch/wait on return.
  const retainStyles = (next: Document) => {
    for (const style of document.head.querySelectorAll("link[rel=stylesheet], style")) {
      const exists = [...next.head.querySelectorAll("link[rel=stylesheet], style")].some((other) =>
        style.tagName === "LINK"
          ? other.tagName === "LINK" && other.getAttribute("href") === style.getAttribute("href")
          : other.tagName === "STYLE" && other.textContent === style.textContent,
      );
      if (!exists) next.head.append(style.cloneNode(true));
    }
  };

  const prepare = (event: Event) => {
    const ev = event as NavigationEvent;
    const saved = ev.navigationType === "traverse" && isList(ev.to) ? pages.get(keyOf(ev.to)) : undefined;
    const original = ev.loader;
    ev.loader = async () => {
      if (ev.signal.aborted) return;
      if (saved && !saved.main.isConnected) {
        // Only clone the lightweight page shell. The original image nodes are
        // attached at swap time, so an aborted navigation cannot consume them.
        ev.newDocument = saved.shell.cloneNode(true) as Document;
        restores.set(ev.newDocument, saved);
      } else await original();
      if (!ev.signal.aborted) retainStyles(ev.newDocument);
    };
  };

  const beforeSwap = (event: Event) => {
    const ev = event as NavigationEvent;
    if (isList(ev.from)) {
      const main = document.querySelector<HTMLElement>("main");
      if (main) {
        const shell = document.implementation.createHTMLDocument();
        for (const attr of document.documentElement.attributes) shell.documentElement.setAttribute(attr.name, attr.value);
        shell.head.replaceWith(document.head.cloneNode(true));
        const body = document.body.cloneNode(false) as HTMLElement;
        for (const child of document.body.childNodes) {
          body.append(child === main ? shell.createElement("main") : child.cloneNode(true));
        }
        shell.body.replaceWith(body);
        const key = keyOf(ev.from);
        pages.delete(key);
        pages.set(key, { shell, main });
        while (pages.size > limit) pages.delete(pages.keys().next().value!);
      }
    }
    const saved = restores.get(ev.newDocument);
    if (saved) {
      // These images are already downloaded, but the browser may have dropped their
      // decoded pixels while the list was detached. With async decoding the view
      // transition would capture empty cards and the photos would pop in again, which
      // looks like a reload. Decode synchronously at paint so they return in place.
      for (const img of saved.main.querySelectorAll("img")) {
        if (img.complete && img.naturalWidth) img.decoding = "sync";
      }
      ev.newDocument.querySelector("main")?.replaceWith(saved.main);
      // Refresh recency without retaining an additional copy of this list.
      const key = keyOf(ev.to);
      pages.delete(key);
      pages.set(key, saved);
      restores.delete(ev.newDocument);
    }
  };

  document.addEventListener("astro:before-preparation", prepare);
  document.addEventListener("astro:before-swap", beforeSwap);
  return () => {
    document.removeEventListener("astro:before-preparation", prepare);
    document.removeEventListener("astro:before-swap", beforeSwap);
    pages.clear();
  };
}
