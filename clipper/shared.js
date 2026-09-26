// Shared by the popup, the options page and the service worker: settings,
// site rules, and calls to Orbyn. The Clipper signs in with a Clipper key
// (ocl_…), made in Orbyn under Settings → Connections → Orbyn Clipper. It
// can only save clips and list where they may go; it can't read your pages
// or change your account.

/** Where Orbyn's API is, unless the options say otherwise. */
export const DEFAULT_API = "https://orbyn.dev/api";

export const CLIP_TYPES = {
  article: "Article",
  paper: "Paper",
  assignment: "Assignment",
  read_later: "Read later",
  highlights: "Highlights",
};

/** Built-in site rules; yours come first (the same list as Orbyn's own). */
export const BUILT_IN_RULES = [
  { host: "arxiv.org", type: "paper" },
  { host: "doi.org", type: "paper" },
  { host: "pubmed.ncbi.nlm.nih.gov", type: "paper" },
  { host: "ncbi.nlm.nih.gov", path: "/pmc", type: "paper" },
  { host: "jstor.org", type: "paper" },
  { host: "semanticscholar.org", type: "paper" },
  { host: "sciencedirect.com", type: "paper" },
  { host: "springer.com", type: "paper" },
  { host: "nature.com", path: "/articles", type: "paper" },
  { host: "acm.org", path: "/doi", type: "paper" },
  { host: "ieeexplore.ieee.org", type: "paper" },
  { host: "biorxiv.org", type: "paper" },
  { host: "ssrn.com", type: "paper" },
  { host: "instructure.com", path: "/courses", type: "assignment" },
  { host: "classroom.google.com", type: "assignment" },
  { host: "blackboard.com", type: "assignment" },
  { host: "moodle", type: "assignment" },
  { host: "brightspace.com", type: "assignment" },
  { host: "d2l.com", type: "assignment" },
  { host: "gradescope.com", type: "assignment" },
];

const hostMatches = (host, rule) =>
  rule.includes(".")
    ? host === rule || host.endsWith(`.${rule}`)
    : host.split(".").includes(rule);

/** The clip shape for a page: your rules, then the built-in ones, else Article. */
export function clipTypeFor(url, rules = []) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return "article";
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const r of [...rules, ...BUILT_IN_RULES]) {
    const h = String(r.host || "")
      .toLowerCase()
      .replace(/^www\./, "");
    if (!h || !hostMatches(host, h)) continue;
    if (r.path && !u.pathname.startsWith(r.path)) continue;
    return r.type;
  }
  return "article";
}

/** The saved settings: the API address, the key, your site rules. */
export async function settings() {
  const got = await chrome.storage.sync.get({
    api: DEFAULT_API,
    rules: [],
    lastDestination: "",
  });
  const local = await chrome.storage.local.get({ key: "" });
  return { ...got, key: local.key };
}

export async function saveSettings(change) {
  const { key, ...rest } = change;
  if (Object.keys(rest).length) await chrome.storage.sync.set(rest);
  // The key stays on this computer only, never synced.
  if (key !== undefined) await chrome.storage.local.set({ key });
}

/** A call to Orbyn with the Clipper key; throws with Orbyn's own message. */
export async function orbyn(path, body) {
  const { api, key } = await settings();
  if (!key) throw new Error("Connect the Clipper first: open its options.");
  const res = await fetch(`${api.replace(/\/+$/, "")}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok)
    throw new Error(
      (data && data.message) ||
        (res.status === 401
          ? "The Clipper key isn't valid any more. Make a new one in Orbyn."
          : `Orbyn couldn't save it (${res.status}).`),
    );
  return data;
}

/** Highlights kept for one page address (without its #fragment). */
export const pageKey = (url) => `hl:${String(url).split("#")[0]}`;

export async function highlightsFor(url) {
  const key = pageKey(url);
  return (await chrome.storage.local.get({ [key]: [] }))[key];
}

export async function setHighlights(url, list) {
  const key = pageKey(url);
  if (list.length) await chrome.storage.local.set({ [key]: list });
  else await chrome.storage.local.remove(key);
}
