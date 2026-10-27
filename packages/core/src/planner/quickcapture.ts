// Quick capture from a link. A Siri Shortcut, a home-screen shortcut, or a
// share sheet can open a URL like `orbyn://add?text=Buy%20milk` to capture a
// task hands-free — no native extension needed, since the Shortcuts app's
// "Open URL" action (which Siri can run) is enough. This parses that link
// (custom scheme, or an https deep link ending in `/add`) into the text to
// quick-add, or null when it isn't one.

/** The text to quick-add from an `add` deep link, or null when it isn't one. */
export function parseAddDeepLink(
  url: string | null | undefined,
): string | null {
  if (!url || typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  // orbyn://add?text=…  (host is "add", or the path is "add")
  const isCustomAdd =
    parsed.protocol === "orbyn:" &&
    (parsed.hostname === "add" || path === "add");
  // https://host/…/add?text=…
  const isHttpAdd =
    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
    /(^|\/)add$/.test(path);
  if (!isCustomAdd && !isHttpAdd) return null;
  const text = (parsed.searchParams.get("text") ?? "").trim();
  return text || null;
}
