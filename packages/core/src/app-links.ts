/**
 * Links into the phone app: orbyn:// links (from Shortcuts, the app icon's
 * quick actions, the share sheet) and the same paths on the web app's host
 * (universal links, and the in-app links pages, tasks and projects share).
 * Each becomes one thing to open. Nothing here acts on its own: a link only
 * ever opens something for the person to confirm or use.
 */
import { parseAddDeepLink } from "./quickcapture.js";

/** A page, task or project, as a link to it names it. */
export type LinkTarget = {
  kind: "task" | "doc" | "project";
  id: string;
  /** For a page, the heading or line to open it at (LNK-04). */
  block?: string;
};

/** What a link into the app asks to open. */
export type AppLink =
  /** A new task: `text` fills it in when the link carries some. */
  | { kind: "add"; text: string | null }
  /** The Today tab. */
  | { kind: "today" }
  /** Today's agenda page. */
  | { kind: "agenda" }
  /** The camera, to scan a page of notes into Uploads. */
  | { kind: "scan" }
  /** The assistant, ready to ask. */
  | { kind: "assistant" }
  /** Focus on what's next (a Siri action, the Live Activity). */
  | { kind: "focus" }
  /** "Share into Orbyn" with this text or link, to choose where it goes. */
  | { kind: "share"; text: string | null; url: string | null }
  /** The Review inbox, at one change when the link names it. */
  | { kind: "review"; id: string | null }
  /** Search, with these words already typed (orbyn://search?q=). */
  | { kind: "search"; q: string }
  /** A saved view (orbyn://view/<id>, /app/view/<id>). */
  | { kind: "view"; id: string }
  | LinkTarget;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The path that opens a page, task or project in the web app. */
export const appPath = (target: LinkTarget) =>
  `/app/${target.kind}/${target.id.toLowerCase()}${
    target.kind === "doc" &&
    target.block &&
    /^[A-Za-z0-9_-]{1,64}$/.test(target.block)
      ? `#${target.block}`
      : ""
  }`;

/** The full link to a page, task or project, on the web app at `origin`. */
export const appUrl = (origin: string, target: LinkTarget) =>
  `${origin.replace(/\/+$/, "")}${appPath(target)}`;

/**
 * What a link asks the app to open, or null when it isn't one of ours.
 * `orbyn://doc/<id>` and `https://<host>/app/doc/<id>` are the same page.
 */
export function parseAppLink(url: string | null | undefined): AppLink | null {
  if (!url || typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const custom = parsed.protocol === "orbyn:";
  const web = parsed.protocol === "https:" || parsed.protocol === "http:";
  if (!custom && !web) return null;
  // orbyn://doc/<id> has "doc" as its host; the web has it in the path.
  let parts: string[];
  try {
    parts = [
      ...(custom && parsed.hostname ? [parsed.hostname] : []),
      ...parsed.pathname.split("/"),
    ]
      .filter(Boolean)
      .map((p) => decodeURIComponent(p));
  } catch {
    return null;
  }
  // The web app's in-app paths start with /app.
  if (web && parts[0] === "app") parts.shift();
  const [head = "", id, ...rest] = parts.map((p, n) =>
    n === 0 ? p.toLowerCase() : p,
  );
  const text = (key: string) =>
    (parsed.searchParams.get(key) ?? "").trim() || null;

  if (head === "add" && !id) {
    // The same reading as always for a link with words to add.
    return { kind: "add", text: parseAddDeepLink(url) };
  }
  if ((head === "task" || head === "doc" || head === "project") && id) {
    if (rest.length || !UUID.test(id)) return null;
    // A page's link can name a line to open it at: /app/doc/<id>#<line>.
    const line = /^#([A-Za-z0-9_-]{1,64})$/.exec(parsed.hash)?.[1];
    if (head === "doc" && line)
      return { kind: head, id: id.toLowerCase(), block: line };
    return { kind: head, id: id.toLowerCase() };
  }
  if (head === "view" && id) {
    if (rest.length || !UUID.test(id)) return null;
    return { kind: "view", id: id.toLowerCase() };
  }
  if (head === "review") {
    if (rest.length || (id && !UUID.test(id))) return null;
    return { kind: "review", id: id ? id.toLowerCase() : null };
  }
  if (id) return null;
  if (head === "today") return { kind: "today" };
  if (head === "search")
    return { kind: "search", q: (text("q") ?? "").slice(0, 200) };
  // These three are the phone's own; the web has no such pages.
  if (custom && head === "agenda") return { kind: "agenda" };
  if (custom && head === "scan") return { kind: "scan" };
  if (custom && head === "assistant") return { kind: "assistant" };
  if (custom && head === "focus") return { kind: "focus" };
  // A share arrives as orbyn://share, or as a web share target (/share).
  if (head === "share") {
    const shared = text("url");
    return {
      kind: "share",
      text: text("text"),
      url: shared && /^https?:\/\/\S+$/i.test(shared) ? shared : null,
    };
  }
  return null;
}

/**
 * The app icon's quick actions (a long press on the icon). Each opens one
 * of the links above; the native side (a config plugin and, on iOS, a small
 * module) is in mobile/modules/orbyn-quick-actions and must list the same.
 */
export const QUICK_ACTIONS = [
  {
    id: "new-task",
    title: "New task",
    /** What Android shows when there is little room. */
    short: "New task",
    url: "orbyn://add",
    /** An SF Symbol for iOS. */
    symbol: "square.and.pencil",
  },
  {
    id: "agenda",
    title: "Today’s agenda",
    short: "Agenda",
    url: "orbyn://agenda",
    symbol: "calendar",
  },
  {
    id: "scan",
    title: "Scan notes",
    short: "Scan notes",
    url: "orbyn://scan",
    symbol: "doc.text.viewfinder",
  },
  {
    id: "assistant",
    title: "Ask assistant",
    short: "Assistant",
    url: "orbyn://assistant",
    symbol: "sparkles",
  },
] as const;
