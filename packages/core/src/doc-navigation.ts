import { parseAppLink } from "./app-links.js";
import { isDocLinkSafe, plainText, type DocBlock } from "./docs.js";
import { sectionRange } from "./doc-outline.js";

export type DocLinkDestination =
  | { kind: "fragment"; fragment: string }
  | { kind: "app"; url: string }
  | { kind: "external"; url: string };

/** Resolve document-relative links against this installation, never an implicit OS base. */
export function docLinkDestination(
  href: string,
  webOrigin: string | null,
): DocLinkDestination | null {
  if (!isDocLinkSafe(href)) return null;
  if (href.startsWith("#")) {
    try {
      const fragment = decodeURIComponent(href.slice(1));
      return fragment.length <= 512 && !/[\u0000-\u001f\u007f]/.test(fragment)
        ? { kind: "fragment", fragment }
        : null;
    } catch {
      return null;
    }
  }
  try {
    const base = webOrigin ? new URL(webOrigin) : null;
    if (base && !["https:", "http:"].includes(base.protocol)) return null;
    const url = new URL(href, base ? `${base.origin}/` : undefined);
    const app = parseAppLink(url.href);
    if (
      app &&
      (url.protocol === "orbyn:" ||
        (url.origin === base?.origin && url.pathname.startsWith("/app/")))
    )
      return { kind: "app", url: url.href };
    return { kind: "external", url: url.href };
  } catch {
    return null;
  }
}

/** Open only the folded sections containing a navigation target. */
export function docFoldsForTarget(
  blocks: DocBlock[],
  folds: ReadonlySet<string>,
  index: number,
): Set<string> {
  const next = new Set(folds);
  if (!blocks[index]) return next;
  blocks.forEach((block, at) => {
    if (
      block.type === "heading" &&
      block.id &&
      next.has(block.id) &&
      at < index &&
      sectionRange(blocks, at).end > index
    )
      next.delete(block.id);
  });
  return next;
}

/** Stable heading fragments, disambiguated in document order without changing stored block IDs. */
export function docHeadingAnchors(blocks: DocBlock[]): Map<number, string> {
  const anchors = new Map<number, string>();
  const used = new Set<string>();
  for (const [index, block] of blocks.entries()) {
    if (block.type !== "heading") continue;
    const base =
      plainText(block.text)
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
        .replace(/\s/g, "-") || "section";
    let slug = base;
    for (let suffix = 1; used.has(slug); suffix++) slug = `${base}-${suffix}`;
    used.add(slug);
    anchors.set(index, slug);
  }
  return anchors;
}

/** Resolve a stored block ID, exported outline anchor, or Markdown heading fragment. */
export function docFragmentIndex(
  blocks: DocBlock[],
  fragment: string,
): number | null {
  const block = blocks.findIndex((entry) => entry.id === fragment);
  if (block >= 0) return block;
  const exported = /^h-(\d+)$/.exec(fragment);
  if (exported && blocks[Number(exported[1])]?.type === "heading")
    return Number(exported[1]);
  for (const [index, slug] of docHeadingAnchors(blocks))
    if (slug === fragment) return index;
  return null;
}
