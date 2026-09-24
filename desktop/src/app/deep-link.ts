import "./deep-link.css";

/**
 * Links that open one thing in Orbyn, as agents (MCP) and emails carry them:
 *
 *   /app/task/<id>            a task or event
 *   /app/doc/<id>#<line>      a page, scrolled to the line when given
 *   /app/project/<id>         a project
 *   /app/today                the Today list (on Overview)
 *   /app/view/<id>            (reserved: saved views arrive later)
 *   /app/review/<id>          (reserved: the Review inbox arrives later)
 *
 * A link followed while signed out is kept for this tab (and in the sign-in
 * page's ?next=) through every sign-in step, two-step and passkeys
 * included, and opened right after. Only these same-origin paths are ever
 * followed, so ?next= can't send anyone elsewhere.
 */

export type DeepLink =
  | { kind: "task"; id: string }
  | { kind: "doc"; id: string; block: string | null }
  | { kind: "project"; id: string }
  | { kind: "today" }
  | { kind: "view"; id: string }
  | { kind: "review"; id: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const WITH_ID = new RegExp(
  `^/app/(task|doc|project|view|review)/(${UUID})/?$`,
  "i",
);
const BLOCK = /^#([A-Za-z0-9_-]{1,64})$/;
const KEY = "orbyn-open-link";

/** The link in a path (and hash), or null for any other path. */
export function deepLinkOf(path: string, hash = ""): DeepLink | null {
  if (/^\/app\/today\/?$/i.test(path)) return { kind: "today" };
  const m = WITH_ID.exec(path);
  if (!m) return null;
  const kind = m[1].toLowerCase() as
    "task" | "doc" | "project" | "view" | "review";
  const id = m[2].toLowerCase();
  if (kind === "doc") return { kind, id, block: BLOCK.exec(hash)?.[1] ?? null };
  return { kind, id };
}

/** The path (and hash) that opens a link. */
export function deepLinkPath(link: DeepLink): string {
  if (link.kind === "today") return "/app/today";
  if (link.kind === "doc")
    return `/app/doc/${link.id}${link.block ? `#${link.block}` : ""}`;
  return `/app/${link.kind}/${link.id}`;
}

/** A stable string for a link, for effect dependencies. */
export const deepLinkKey = (link: DeepLink | null) =>
  link ? deepLinkPath(link) : "";

/**
 * A sign-in page's ?next=, only when it is one of the links above:
 * same-origin, no scheme, no host, nothing else.
 */
export function safeNext(search: string): DeepLink | null {
  const next = new URLSearchParams(search).get("next");
  if (!next || !next.startsWith("/app/") || next.startsWith("//")) return null;
  const hashAt = next.indexOf("#");
  const path = hashAt < 0 ? next : next.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : next.slice(hashAt);
  return deepLinkOf(path, hash);
}

/** Keep a link to open after signing in (this tab only). */
export function rememberDeepLink(link: DeepLink) {
  try {
    sessionStorage.setItem(KEY, deepLinkPath(link));
  } catch {
    // Storage can be off (a private window): ?next= still carries it.
  }
}

/** The link waiting since before sign-in, once; null when there's none. */
export function takeDeepLink(search = ""): DeepLink | null {
  let kept: string | null = null;
  try {
    kept = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    // Fall back to ?next= below.
  }
  if (kept) {
    const hashAt = kept.indexOf("#");
    const link = deepLinkOf(
      hashAt < 0 ? kept : kept.slice(0, hashAt),
      hashAt < 0 ? "" : kept.slice(hashAt),
    );
    if (link) return link;
  }
  return safeNext(search);
}

/**
 * Scroll a page's line into view once the page has drawn it, and mark it
 * for a moment so the eye finds it.
 */
export function focusDocBlock(blockId: string, tries = 40) {
  const selector = `[data-block-id="${CSS.escape(blockId)}"]`;
  const look = (left: number) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) {
      if (left > 0) window.setTimeout(() => look(left - 1), 100);
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("deep-linked-block");
    window.setTimeout(() => el.classList.remove("deep-linked-block"), 2600);
  };
  look(tries);
}
