import { TAB_HREF_LIMIT, type TabPlace } from "@orbyn/core";

export type Destination = TabPlace & {
  href: string;
  pathname: string;
  search: string;
  hash: string;
};

const identifier = /^[A-Za-z0-9_-]{1,160}$/;
const routes: readonly [RegExp, string, boolean?][] = [
  [/^\/app(?:\/(?:today|home|overview|search))?$/, "Overview"],
  [/^\/app\/(?:tasks|add)$/, "My tasks"],
  [/^\/app\/task\/([^/]+)$/, "My tasks", true],
  [/^\/app\/projects$/, "Projects"],
  [/^\/app\/project\/([^/]+)$/, "Projects", true],
  [/^\/app\/views$/, "Views"],
  [/^\/app\/view\/([^/]+)$/, "Views", true],
  [/^\/app\/lists$/, "Lists"],
  [/^\/app\/calendar$/, "Calendar"],
  [/^\/app\/docs$/, "Docs"],
  [/^\/app\/doc\/([^/]+)$/, "Docs", true],
  [/^\/app\/memory$/, "Memory"],
  [/^\/app\/agent-notes$/, "Agent notes"],
  [/^\/app\/brief$/, "Daily brief"],
  [/^\/app\/assistant$/, "AI assistant"],
  [/^\/app\/background$/, "Background"],
  [/^\/app\/overnight(?:\/([^/]+))?$/, "Overnight", true],
  [/^\/app\/review(?:\/([^/]+))?$/, "Review", true],
  [/^\/app\/study$/, "Study"],
  [/^\/app\/teams$/, "Teams"],
  [/^\/app\/booking$/, "Booking"],
  [/^\/app\/notifications$/, "Notifications"],
  [/^\/app\/admin(?:\/([a-z][a-z0-9-]{0,59}))?$/, "Admin"],
  [
    /^\/app\/(?:settings(?:\/[a-z][a-z0-9-]{0,59})?|agents|chatgpt)$/,
    "Settings",
  ],
];
const legacyPaths: Record<string, string> = {
  Overview: "/app",
  "My tasks": "/app/tasks",
  Projects: "/app/projects",
  Views: "/app/views",
  Lists: "/app/lists",
  Calendar: "/app/calendar",
  Docs: "/app/docs",
  Memory: "/app/memory",
  "Agent notes": "/app/agent-notes",
  "Daily brief": "/app/brief",
  "AI assistant": "/app/assistant",
  Background: "/app/background",
  Overnight: "/app/overnight",
  Review: "/app/review",
  Study: "/app/study",
  Teams: "/app/teams",
  Booking: "/app/booking",
  Notifications: "/app/notifications",
  Admin: "/app/admin",
  Settings: "/app/settings",
};
const objectPaths: Record<string, string> = {
  "My tasks": "/app/task/",
  Projects: "/app/project/",
  Views: "/app/view/",
  Docs: "/app/doc/",
  Overnight: "/app/overnight/",
  Review: "/app/review/",
};

/** Runtime authority: app-relative route only. This does not establish object access. */
export function destination(href: string, title = ""): Destination | null {
  if (
    !href.startsWith("/app") ||
    href.startsWith("//") ||
    href.length > TAB_HREF_LIMIT ||
    /[\\\u0000-\u001f\u007f]/.test(href)
  )
    return null;
  let url: URL;
  try {
    url = new URL(href, "https://workspace.invalid");
  } catch {
    return null;
  }
  if (
    url.origin !== "https://workspace.invalid" ||
    url.username ||
    url.password
  )
    return null;
  const route = routes.find(([pattern]) => pattern.test(url.pathname));
  if (!route) return null;
  const match = route[0].exec(url.pathname)!;
  const id = route[2] ? (match[1] ?? null) : null;
  if (id !== null && !identifier.test(id)) return null;
  return {
    view: route[1],
    id,
    title: title.slice(0, 300),
    href: url.pathname + url.search + url.hash,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
}

/** A present invalid href is never downgraded into a different legacy destination. */
export function placeDestination(place: TabPlace): Destination | null {
  if (place.href !== undefined) {
    const next = destination(place.href, place.title);
    return next && next.view === place.view && next.id === place.id
      ? next
      : null;
  }
  const base =
    place.id === null
      ? legacyPaths[place.view]
      : identifier.test(place.id)
        ? objectPaths[place.view]
        : undefined;
  return base ? destination(base + (place.id ?? ""), place.title) : null;
}

const persistentQuery: Record<string, readonly string[]> = {
  "/app/assistant": [
    "task",
    "chat",
    "project",
    "conversation",
    "entry",
    "panel",
  ],
  "/app/teams": ["team"],
  "/app/booking": ["open"],
  "/app/docs": ["folder"],
  "/app/calendar": ["date", "mode"],
};

/** A separate projection: action seeds/private capability parameters never enter restore data. */
export function persistentDestination(place: TabPlace): TabPlace | null {
  const next = placeDestination(place);
  if (!next) return null;
  // Settings is an overlay with a separate opening/return contract.
  if (
    next.view === "Settings" ||
    next.pathname === "/app/add" ||
    next.pathname === "/app/search"
  )
    return null;
  const query = new URLSearchParams();
  for (const key of persistentQuery[next.pathname] ?? []) {
    const values = new URLSearchParams(next.search).getAll(key);
    if (values.length !== 1) continue;
    const value = values[0];
    const valid =
      key === "panel"
        ? value === "upcoming"
        : key === "date"
          ? /^\d{4}-\d{2}-\d{2}$/.test(value)
          : key === "mode"
            ? ["stage", "day", "week", "month"].includes(value)
            : identifier.test(value);
    if (valid) query.set(key, value);
  }
  const hash =
    next.pathname.startsWith("/app/doc/") &&
    /^#[A-Za-z0-9_-]{1,160}$/.test(next.hash)
      ? next.hash
      : "";
  const search = query.toString();
  return {
    view: next.view,
    id: next.id,
    title: next.title,
    href: next.pathname + (search ? `?${search}` : "") + hash,
  };
}
