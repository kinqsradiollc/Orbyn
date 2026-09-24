import { env } from "../config/env.js";

/**
 * Turning Orbyn's data into answers an outside agent can use safely.
 *
 * Text in Orbyn comes from many hands: the person themselves, teammates,
 * imported files, subscribed calendars. Anything not written by the person
 * the agent acts for is data, never instructions, so it is cleaned of the
 * tricks that hide instructions (invisible and direction-changing
 * characters, HTML comments, hidden elements), stripped of images that
 * would make the agent's client fetch an outside address (the image
 * exfiltration channel), labelled with where it came from and fenced.
 * Answers are capped, with a marker saying how to get the rest.
 */

/** About the size of one answer; more is marked and cut. */
export const MAX_RESULT_CHARS = 24_000;
/** Titles are cut to this many characters. */
export const MAX_TITLE_CHARS = 200;

/** Where a piece of text came from. */
export type Provenance =
  | "you"
  | `teammate:${string}`
  | "subscribed_feed"
  | "booking_guest"
  | "inbound_email"
  | "import";

/** Zero-width, joiner, word-joiner, invisible operator and BOM characters. */
const INVISIBLE =
  /[\u00ad\u180e\u200b-\u200f\u2060-\u2064\u206a-\u206f\ufeff]/g;
/** Direction overrides and isolates, which can reorder what a reader sees. */
const BIDI = /[\u202a-\u202e\u2066-\u2069]/g;
/** Unicode tag characters (U+E0000-U+E007F) hide text from people entirely. */
const TAGS = /[\u{e0000}-\u{e007f}]/gu;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
/**
 * Elements whose content never shows, and drawings (SVG) that can
 * load pictures from elsewhere: removed with everything inside them.
 */
const HIDDEN_ELEMENTS =
  /<(script|style|template|iframe|object|noscript|svg)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
/** Elements that load something from an address as soon as they're shown. */
const EMBEDS =
  /<\/?(?:img|image|picture|iframe|embed|object|link|meta|source|video|audio|track|input|frame|frameset|applet|base|use|feimage|svg)\b[^>]*>/gi;
/** Any other tag that loads a picture through its style or a background. */
const LOADING_TAGS =
  /<[a-z][^>]*(?:url\s*\(|\bbackground\s*=|\bsrcset\s*=|\bposter\s*=)[^>]*>/gi;
/** A span or div styled invisible, with what it hides. */
const INVISIBLE_ELEMENT =
  /<(span|div|p)\b[^>]*style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi;
/**
 * A Markdown link reference definition (`[x]: https://…`), which a
 * reference image (`![x]` or `![a][x]`) would load from.
 */
const REFERENCE_DEFINITION =
  /^ {0,3}\[((?:\\.|[^\\\]])+)\]:[ \t]*\n?[ \t]*(<[^>\n]*>|\S+)[^\n]*$/gm;

/** The web app's own host: images there are Orbyn's and may stay. */
function ownHost(): string | null {
  try {
    return new URL(env.APP_URL).host;
  } catch {
    return null;
  }
}

/**
 * The address an image may keep: one on the web app's own host, written
 * plainly (no escapes, entities, credentials or spaces that a Markdown
 * renderer and a URL parser could read differently). A path on its own is
 * made absolute on the web app. null for everything else.
 */
function ownImageUrl(raw: string, own: string | null): string | null {
  if (!own || !/^[A-Za-z0-9\-._~:/?#[\]!$'()*+,;=%]+$/.test(raw)) return null;
  if (raw.includes("@") || raw.includes("\\")) return null;
  if (raw.startsWith("/") && !raw.startsWith("//"))
    return `${env.APP_URL.replace(/\/+$/, "")}${raw}`;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.host === own
        ? raw
        : null
      : null;
  } catch {
    return null;
  }
}

/** An image's description as plain words: no brackets, links or markup. */
const altText = (alt: string) =>
  alt
    .replace(/\\(.)/g, "$1")
    .replace(/[[\]()<>!`*_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

/** Where the `]` that closes the `[` at `i` is, counting nesting and escapes; -1 if none. */
function closingBracket(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return j;
  }
  return -1;
}

/**
 * An inline link's `(destination "title")` starting at the `(` at `i`, as
 * CommonMark reads it: `<…>` (which may hold spaces) or a run with balanced
 * brackets and escapes, then an optional title. null when it isn't one.
 */
function inlineTarget(
  s: string,
  i: number,
): { url: string; end: number } | null {
  let j = i + 1;
  const space = () => {
    while (j < s.length && /\s/.test(s[j])) j++;
  };
  space();
  let url: string;
  if (s[j] === "<") {
    const close = s.indexOf(">", j + 1);
    if (close < 0 || s.slice(j + 1, close).includes("\n")) return null;
    url = s.slice(j + 1, close);
    j = close + 1;
  } else {
    const start = j;
    let depth = 0;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === "\\") {
        j++;
        continue;
      }
      if (/\s/.test(c)) break;
      if (c === "(") depth++;
      else if (c === ")") {
        if (depth === 0) break;
        depth--;
      }
    }
    url = s.slice(start, j);
  }
  space();
  const opener = s[j];
  if (opener === '"' || opener === "'" || opener === "(") {
    const closer = opener === "(" ? ")" : opener;
    for (j++; j < s.length && s[j] !== closer; j++) if (s[j] === "\\") j++;
    if (j >= s.length) return null;
    j++;
    space();
  }
  return s[j] === ")" ? { url, end: j + 1 } : null;
}

/**
 * Every Markdown image in `s` that would load from somewhere other than the
 * web app becomes its description, `[image: …]`, whatever its form: inline
 * (brackets inside the description, escapes, `<…>` addresses), reference or
 * shortcut. Afterwards no `![` is left but the web app's own images.
 */
function neutraliseImages(s: string, own: string | null): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const at = s.indexOf("![", i);
    if (at < 0) {
      out += s.slice(i);
      break;
    }
    // "\![" is an escaped "!" followed by a link, not an image.
    let slashes = 0;
    for (let k = at - 1; k >= i && s[k] === "\\"; k--) slashes++;
    if (slashes % 2 === 1) {
      out += s.slice(i, at + 1);
      i = at + 1;
      continue;
    }
    out += s.slice(i, at);
    const close = closingBracket(s, at + 1);
    if (close < 0) {
      out += "!\\[";
      i = at + 2;
      continue;
    }
    const alt = altText(s.slice(at + 2, close));
    const placeholder = alt ? `[image: ${alt}]` : "[image removed]";
    if (s[close + 1] === "(") {
      const target = inlineTarget(s, close + 1);
      if (target) {
        const keep = ownImageUrl(target.url, own);
        out += keep ? `![${alt}](${keep})` : placeholder;
        i = target.end;
        continue;
      }
    }
    // A reference image: ![alt][label] or ![alt][] (the label goes too).
    let end = close + 1;
    if (s[end] === "[") {
      const label = closingBracket(s, end);
      if (label > 0) end = label + 1;
    }
    out += placeholder;
    i = end;
  }
  return out;
}

/**
 * Text as an agent may see it: control, invisible and direction characters
 * removed, HTML comments, hidden elements and anything that loads from an
 * address gone, images from other hosts replaced by their description (and
 * reference definitions pointing elsewhere dropped), and cut to `max`
 * characters.
 */
export function clean(text: unknown, max = MAX_RESULT_CHARS): string {
  const own = ownHost();
  let out = String(text ?? "")
    .replace(INVISIBLE, "")
    .replace(BIDI, "")
    .replace(TAGS, "")
    .replace(HTML_COMMENT, "")
    .replace(HIDDEN_ELEMENTS, "")
    .replace(INVISIBLE_ELEMENT, "")
    .replace(EMBEDS, "")
    .replace(LOADING_TAGS, "")
    .replace(
      REFERENCE_DEFINITION,
      (line: string, _label: string, dest: string) =>
        ownImageUrl(dest.replace(/^<|>$/g, ""), own) ? line : "",
    );
  out = neutraliseImages(out, own);
  // Control characters other than newlines and tabs.
  out = Array.from(out)
    .map((c) => (c < " " && c !== "\n" && c !== "\t" ? " " : c))
    .join("");
  return out.length > max ? out.slice(0, max) : out;
}

/** A title: one line, cleaned, at most 200 characters. */
export const cleanTitle = (text: unknown) =>
  clean(text, MAX_TITLE_CHARS * 2)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_CHARS);

const FENCE_OPEN = /<\s*\/?\s*untrusted-content/gi;

/**
 * Text from someone other than the person, fenced and labelled, so the agent
 * reads it as data. A fence inside the text can't close this one early.
 */
export function fence(text: string, source: Provenance): string {
  const body = clean(text).replace(FENCE_OPEN, "&lt;untrusted-content");
  const label = source.replace(/["<>\n]/g, "");
  return `<untrusted-content source="${label}">\n${body}\n</untrusted-content>`;
}

/** Sources outside Orbyn itself (not the person, not their teammates). */
const OUTSIDE: Record<string, string> = {
  subscribed_feed: "a subscribed calendar",
  import: "an imported file",
  inbound_email: "an email",
  booking_guest: "a booking guest",
};

/** Whether text from `source` came from outside Orbyn. */
export const isOutside = (source: string) => source in OUTSIDE;

/**
 * What a connection that hides outside content gets instead of the text:
 * that something is there, and where it came from.
 */
export const hiddenText = (source: string) =>
  `[Hidden: text from ${OUTSIDE[source] ?? "outside Orbyn"}. This connection leaves out outside content.]`;

/** Email addresses, so a booking guest's contact details stay out. */
const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** `text` with every email address hidden. */
export const maskEmails = (text: string) =>
  text.replace(EMAIL, "[email hidden]");

/**
 * Text from `source`: as it is when the person wrote it, fenced otherwise,
 * and left out when it came from outside Orbyn and the connection hides
 * outside content. A booking guest's email address never shows.
 */
export const labelled = (
  text: string,
  source: Provenance,
  hideOutside = false,
) =>
  source === "you"
    ? clean(text)
    : hideOutside && isOutside(source)
      ? hiddenText(source)
      : fence(source === "booking_guest" ? maskEmails(text) : text, source);

/** A title as an agent sees it: cleaned, and without a guest's email address. */
export const titleFor = (title: unknown, source: Provenance | string) => {
  const t = cleanTitle(title);
  return source === "booking_guest" ? maskEmails(t) : t;
};

/** Outside sources an item's text can come from (see sources.ts). */
const ITEM_SOURCES = new Set(["booking_guest", "inbound_email"]);

/**
 * Who wrote something, from the person's point of view: themselves, a
 * teammate by name, or an outside source. `source` is an item's outside
 * source (a booking guest, an email), and `editors` the other people who
 * changed a team page after it was made: text anyone else touched isn't
 * the person's own.
 */
export function provenanceOf(
  viewerId: string,
  row: {
    user_id?: string | null;
    author_name?: string | null;
    imported?: boolean;
    subscribed?: boolean;
    source?: string | null;
    editors?: (string | null)[] | null;
  },
): Provenance {
  if (row.subscribed) return "subscribed_feed";
  if (row.imported) return "import";
  if (row.source && ITEM_SOURCES.has(row.source))
    return row.source as Provenance;
  const names = [
    ...(row.user_id && row.user_id !== viewerId
      ? [row.author_name ?? "someone"]
      : []),
    ...(row.editors ?? []).map((e) => e ?? "someone"),
  ]
    .map((n) => cleanTitle(n).slice(0, 60) || "someone")
    .filter((n, i, all) => all.indexOf(n) === i);
  if (!names.length) return "you";
  return `teammate:${names.join(", ").slice(0, 60)}`;
}

/**
 * Cut an answer to `max` characters on a line boundary, saying how much was
 * left out and how to get it.
 */
export function cap(
  text: string,
  max = MAX_RESULT_CHARS,
  how = "Ask for less, or page with the cursor.",
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.lastIndexOf("\n", max - 200);
  const kept = text.slice(0, cut > max / 2 ? cut : max - 200);
  return {
    text: `${kept}\n\n[truncated: ${text.length - kept.length} more characters. ${how}]`,
    truncated: true,
  };
}

/** "Thu 25 Sep 09:00" in the person's zone. */
export function localTime(
  at: Date | string,
  timeZone: string,
  allDay = false,
): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(allDay ? {} : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  })
    .format(d)
    .replace(",", "");
}

/** "YYYY-MM-DD" in the person's zone. */
export function localDay(at: Date | string, timeZone: string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** An instant as both: exact ISO and the local reading. */
export const both = (at: Date | string | null, timeZone: string) =>
  at === null
    ? null
    : {
        at: (typeof at === "string" ? new Date(at) : at).toISOString(),
        local: localTime(at, timeZone),
      };

/** Markdown for one list line, with its link. */
export const mdLink = (title: string, url: string) =>
  `[${title.replace(/[[\]]/g, "")}](${url})`;
