/**
 * Open a page in a window of its own (NAV-06): in the desktop app a second
 * window with just the page, in a browser a new tab with the page alone.
 * The page's address is its link (/app/doc/<id>) with ?window=page, which
 * shows the page without the sidebar and library.
 */
export function openInWindow(docId: string) {
  const path = `/app/doc/${docId}?window=page`;
  if (window.orbynDesktop?.openWindow) {
    void window.orbynDesktop.openWindow(path);
    return;
  }
  window.open(path, "_blank", "noopener");
}

/** Whether this window shows one page alone (opened by openInWindow). */
export const isPageWindow = () =>
  new URLSearchParams(location.search).get("window") === "page" ||
  new URLSearchParams(location.hash.split("?")[1] ?? "").get("window") ===
    "page";
