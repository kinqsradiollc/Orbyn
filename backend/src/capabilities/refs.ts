import { env } from "../config/env.js";

/**
 * How agents name things in Orbyn, and the three forms every result carries
 * so they can chain and cite:
 *
 * - a typed id: `task:<uuid>`, `event:<uuid>@<occurrence>`,
 *   `doc:<uuid>#<block>`, `project:<uuid>`, `record:<uuid>`,
 *   `template:<uuid>` (and, in later phases, `view:`, `proposal:`, `import:`);
 * - an `orbyn://` URI, for MCP resources;
 * - an https link that opens it in the web app (/app/task/…, /app/doc/…#…,
 *   /app/project/…, /app/today).
 *
 * `parseRef` accepts any of these, a bare id, or an exact title.
 */

export const REF_TYPES = [
  "task",
  "event",
  "doc",
  "project",
  "record",
  "template",
  "view",
  "proposal",
  "import",
  "source",
] as const;
export type RefType = (typeof REF_TYPES)[number];

export type Ref = {
  type: RefType;
  id: string;
  /** A page's line (`doc:…#b123`). */
  block?: string;
  /** One occurrence of a repeating event, as an ISO instant. */
  occurrence?: string;
};

export type ParsedRef =
  | Ref
  | { type: "any"; id: string; block?: string }
  | { type: "title"; text: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BLOCK = "[A-Za-z0-9_-]{1,64}";
const TYPED = new RegExp(
  `^(${REF_TYPES.join("|")}):(${UUID})(?:@([0-9TZ:.+-]{10,40}))?(?:#(${BLOCK}))?$`,
  "i",
);
const URI = new RegExp(
  `^orbyn://(${REF_TYPES.join("|")})/(${UUID})(?:#(${BLOCK}))?$`,
  "i",
);
const APP_LINK = new RegExp(
  `^https?://[^/\\s]+/app/(task|doc|project)/(${UUID})/?(?:#(${BLOCK}))?$`,
  "i",
);
const BARE = new RegExp(`^(${UUID})(?:#(${BLOCK}))?$`, "i");

/** Whatever an agent passed as an id, understood. */
export function parseRef(input: string): ParsedRef {
  const text = input.trim();
  let m = TYPED.exec(text);
  if (m) {
    const type = m[1].toLowerCase() as RefType;
    return {
      type,
      id: m[2].toLowerCase(),
      ...(m[3] && !Number.isNaN(Date.parse(m[3]))
        ? { occurrence: new Date(m[3]).toISOString() }
        : {}),
      ...(m[4] ? { block: m[4] } : {}),
    };
  }
  m = URI.exec(text);
  if (m)
    return {
      type: m[1].toLowerCase() as RefType,
      id: m[2].toLowerCase(),
      ...(m[3] ? { block: m[3] } : {}),
    };
  m = APP_LINK.exec(text);
  if (m)
    return {
      type: m[1].toLowerCase() as RefType,
      id: m[2].toLowerCase(),
      ...(m[3] ? { block: m[3] } : {}),
    };
  m = BARE.exec(text);
  if (m)
    return {
      type: "any",
      id: m[1].toLowerCase(),
      ...(m[2] ? { block: m[2] } : {}),
    };
  return { type: "title", text };
}

/** The typed id: `doc:<id>#<block>`, `event:<id>@<occurrence>`. */
export function refId(ref: Ref): string {
  return (
    `${ref.type}:${ref.id}` +
    (ref.occurrence ? `@${ref.occurrence}` : "") +
    (ref.block ? `#${ref.block}` : "")
  );
}

/** The MCP resource URI. Events and tasks share one resource per item. */
export function refUri(ref: Ref): string {
  const type = ref.type === "event" ? "task" : ref.type;
  return `orbyn://${type}/${ref.id}${ref.block ? `#${ref.block}` : ""}`;
}

/** The web app's address, with no trailing slash. */
export const appUrl = () => env.APP_URL.replace(/\/+$/, "");

/**
 * The link that opens it in the web app. Records and templates open the
 * project they belong to when there is one.
 */
export function refUrl(ref: Ref, projectId?: string | null): string {
  const base = appUrl();
  switch (ref.type) {
    case "task":
    case "event":
      return `${base}/app/task/${ref.id}`;
    case "doc":
      return `${base}/app/doc/${ref.id}${ref.block ? `#${ref.block}` : ""}`;
    case "project":
      return `${base}/app/project/${ref.id}`;
    case "view":
      return `${base}/app/view/${ref.id}`;
    case "proposal":
      return `${base}/app/review/${ref.id}`;
    default:
      return projectId ? `${base}/app/project/${projectId}` : `${base}/app`;
  }
}

/**
 * The phone app's link for a web app link (H7): the same path on orbyn://,
 * as the apps' own share links have it (`https://…/app/doc/<id>#b1` and
 * `orbyn://doc/<id>#b1` open the same page). The app's home is Today.
 * Empty for a link that isn't the web app's.
 */
export function appLinkFor(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("orbyn://")) return url;
  const base = `${appUrl()}/app`;
  if (
    url !== base &&
    !url.startsWith(`${base}/`) &&
    !url.startsWith(`${base}#`)
  )
    return "";
  const rest = url.slice(base.length).replace(/^\/+/, "");
  return `orbyn://${rest && !rest.startsWith("#") ? rest : "today"}`;
}

/** Both links to a thing: the web app's and the phone app's. */
export const linksFor = (ref: Ref, projectId?: string | null) => {
  const url = refUrl(ref, projectId);
  return { url, app_url: appLinkFor(url) };
};

/** The Today list in the web app. */
export const todayUrl = () => `${appUrl()}/app/today`;

/** All three forms at once, as results carry them. */
export const refs = (ref: Ref, projectId?: string | null) => ({
  id: refId(ref),
  uri: refUri(ref),
  url: refUrl(ref, projectId),
});
