/**
 * Links that open one thing in Orbyn, as agents (MCP) and emails carry them:
 *
 *   /app/task/<id>            a task or event
 *   /app/doc/<id>#<line>      a page, scrolled to the line when given
 *   /app/project/<id>         a project
 *   /app/today                the Today list (on Home)
 *   /app/home, /app/overview  Home (W1; Overview was its old name)
 *   /app/view/<id>            a saved view (D4a)
 *   /app/review[/<id>]        the Review inbox (Notifications until it lands)
 *   /app/add?text=<words>     Quick add, filled in, to confirm (never adds)
 *   /app/search?q=<words>     ⌘K with the words typed
 *   /app/agents               Settings → Connected agents (H7)
 *
 * The desktop app opens the same links as orbyn://task/<id> and so on
 * (fromAppLink), handed over by its main process.
 *
 * A link followed while signed out is kept for this tab (and in the sign-in
 * page's ?next=) through every sign-in step, two-step and passkeys
 * included, and opened right after. Only these same-origin paths are ever
 * followed, so ?next= can't send anyone elsewhere.
 */

import {
  appLinkFragment,
  appPath,
  parseAppLink,
  type AppLink,
} from "@orbyn/core";

export type DeepLink =
  | { kind: "task"; id: string }
  | { kind: "doc"; id: string; block: string | null }
  | { kind: "project"; id: string }
  | { kind: "today" }
  | { kind: "view"; id: string }
  | { kind: "review"; id: string | null }
  | { kind: "assistant" }
  | { kind: "overnight"; id?: string }
  | { kind: "add"; text: string }
  | { kind: "search"; q: string }
  | { kind: "agents" }
  | { kind: "chatgpt"; requestId?: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const WITH_ID = new RegExp(
  `^/app/(task|doc|project|view|review|overnight)/(${UUID})/?$`,
  "i",
);
const KEY = "orbyn-open-link";

/** The words a link carries (?text= or ?q=), trimmed and kept short. */
const wordsIn = (search: string, key: string, max: number) =>
  (new URLSearchParams(search).get(key) ?? "").trim().slice(0, max);

/** The link in a path (and hash and query), or null for any other path. */
export function deepLinkOf(
  path: string,
  hash = "",
  search = "",
): DeepLink | null {
  if (/^\/app\/(today|home|overview)\/?$/i.test(path)) return { kind: "today" };
  if (/^\/app\/agents\/?$/i.test(path)) return { kind: "agents" };
  if (/^\/app\/chatgpt\/?$/i.test(path)) {
    const link = parseAppLink(`orbyn://chatgpt${search}${hash}`);
    return link?.kind === "chatgpt" ? link : null;
  }
  if (/^\/app\/assistant\/?$/i.test(path)) return { kind: "assistant" };
  if (/^\/app\/overnight\/?$/i.test(path)) return { kind: "overnight" };
  if (/^\/app\/review\/?$/i.test(path)) return { kind: "review", id: null };
  if (/^\/app\/add\/?$/i.test(path))
    return { kind: "add", text: wordsIn(search, "text", 500) };
  if (/^\/app\/search\/?$/i.test(path))
    return { kind: "search", q: wordsIn(search, "q", 200) };
  const m = WITH_ID.exec(path);
  if (!m) return null;
  const kind = m[1].toLowerCase() as
    "task" | "doc" | "project" | "view" | "review" | "overnight";
  const id = m[2].toLowerCase();
  if (kind === "doc") return { kind, id, block: appLinkFragment(hash) };
  return { kind, id };
}

/** The path (and hash) that opens a link. */
export function deepLinkPath(link: DeepLink): string {
  if (link.kind === "today") return "/app/today";
  if (link.kind === "agents") return "/app/agents";
  if (link.kind === "chatgpt")
    return link.requestId
      ? `/app/chatgpt?request=${link.requestId}`
      : "/app/chatgpt";
  if (link.kind === "assistant") return "/app/assistant";
  if (link.kind === "overnight")
    return link.id ? `/app/overnight/${link.id}` : "/app/overnight";
  if (link.kind === "add")
    return link.text
      ? `/app/add?${new URLSearchParams({ text: link.text })}`
      : "/app/add";
  if (link.kind === "search")
    return link.q
      ? `/app/search?${new URLSearchParams({ q: link.q })}`
      : "/app/search";
  if (link.kind === "doc")
    return appPath({
      kind: "doc",
      id: link.id,
      block: link.block ?? undefined,
    });
  if (link.kind === "review" && !link.id) return "/app/review";
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
  return linkAt(next);
}

/** A kept "/app/…?…#…" read back into its link. */
function linkAt(kept: string): DeepLink | null {
  const hashAt = kept.indexOf("#");
  const beforeHash = hashAt < 0 ? kept : kept.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : kept.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  const path = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const search = queryAt < 0 ? "" : beforeHash.slice(queryAt);
  return deepLinkOf(path, hash, search);
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
    const link = linkAt(kept);
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

/**
 * An orbyn:// link (or a web one) as the web app's link, for the desktop
 * app: the same things open the same way. The phone's own links (the
 * agenda, the camera, the assistant) open their nearest screen here.
 * `hash` is the link's #line, for a page opened at a line.
 */
export function fromAppLink(link: AppLink, hash = ""): DeepLink | null {
  switch (link.kind) {
    case "task":
    case "project":
    case "view":
      return { kind: link.kind, id: link.id };
    case "doc":
      return {
        kind: "doc",
        id: link.id,
        block: hash ? appLinkFragment(hash) : (link.block ?? null),
      };
    case "today":
    case "agenda":
      return { kind: "today" };
    case "review":
      return { kind: "review", id: link.id };
    case "add":
      return { kind: "add", text: link.text ?? "" };
    case "search":
      return { kind: "search", q: link.q };
    case "agents":
      return { kind: "agents" };
    case "chatgpt":
      return link;
    case "assistant":
      return { kind: "assistant" };
    case "overnight":
      return link.id
        ? { kind: "overnight", id: link.id }
        : { kind: "overnight" };
    case "share":
      return {
        kind: "add",
        text: [link.text, link.url].filter(Boolean).join(" ").slice(0, 500),
      };
    default:
      return null;
  }
}

/** A whole orbyn:// (or web) address as the link it opens, #line and all. */
export function deepLinkOfUrl(url: string): DeepLink | null {
  const app = parseAppLink(url);
  if (!app) return null;
  let hash = "";
  try {
    hash = new URL(url).hash;
  } catch {
    // parseAppLink read it, so this can't fail; no line if it does.
  }
  return fromAppLink(app, hash);
}
