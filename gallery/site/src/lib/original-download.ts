// Browsers ignore `download` for cross-origin URLs. Fetch public archive bytes first,
// then save a local Blob URL so both download buttons keep the original filename.
export function installOriginalDownloads() {
  document.addEventListener("click", async (event) => {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[data-original-download], a.pswp__button--download");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.origin === location.origin) return;
    event.preventDefault();
    if (link.getAttribute("aria-busy") === "true") return;
    link.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(link.href, { credentials: "omit" });
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const save = document.createElement("a");
      save.href = url;
      save.download = link.download || "original";
      document.body.append(save);
      save.click();
      save.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      // Keep the raw original reachable even if a browser/network blocks the fetch.
      const open = document.createElement("a");
      open.href = link.href;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      document.body.append(open);
      open.click();
      open.remove();
    } finally {
      link.removeAttribute("aria-busy");
    }
  });
}
