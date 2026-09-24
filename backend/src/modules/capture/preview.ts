import { readLinkPreview, siteOf, type LinkPreview } from "@orbyn/core";
import { publicFetch } from "../../lib/netguard.js";

/**
 * A shared link's title and site, for the share sheet and the "Read:
 * <title>" task. Only the start of the page is read, over https, at public
 * addresses only (netguard), with every redirect checked in turn. Anything
 * that goes wrong — a slow site, a private address, a PDF — just means no
 * title: the site's name stands in, and the share still works.
 */
const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
/** Enough for a page's <head>; the rest is never read. */
const MAX_BYTES = 256 * 1024;

async function readStart(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}

export async function linkPreview(url: string): Promise<LinkPreview> {
  const site = siteOf(url);
  const none: LinkPreview = { url, title: null, site };
  // An http link is looked up at its https address; nearly every site has one.
  let current = url.replace(/^http:\/\//i, "https://");
  try {
    for (let hop = 0; ; hop++) {
      const response = await publicFetch(
        current,
        {
          headers: {
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            "User-Agent": "Orbyn-LinkPreview/1",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
        "link",
      );
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {});
        const location = response.headers.get("location");
        if (!location || hop >= MAX_REDIRECTS) return none;
        current = new URL(location, current).toString();
        continue;
      }
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !/html/i.test(type)) {
        await response.body?.cancel().catch(() => {});
        return none;
      }
      const read = readLinkPreview(await readStart(response), current);
      return { url, title: read.title, site: read.site || site };
    }
  } catch {
    return none;
  }
}
