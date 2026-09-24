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
/** A span or div styled invisible, with what it hides. */
const INVISIBLE_ELEMENT =
  /<(span|div|p)\b[^>]*style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi;
/**
 * Elements that load something from an address as soon as they're shown,
 * and the hidden ones above (whose tags alone may be left).
 */
const EMBED_NAMES =
  "img|image|picture|iframe|embed|object|link|meta|source|video|audio|track|input|frame|frameset|applet|base|use|feimage|svg|mglyph|bgsound|portal|script|style|template|noscript";
const EMBED_SET = new Set(EMBED_NAMES.split("|"));
/** Such an element's tag, read the quick way (up to the first `>`). */
const EMBEDS = new RegExp(`<\\/?(?:${EMBED_NAMES})\\b[^>]*>`, "gi");
/** The start of such a tag, wherever one is still left: escaped at the end. */
const EMBED_OPENER = new RegExp(`<(?=\\/?(?:${EMBED_NAMES})\\b)`, "gi");
/**
 * Attributes that load a picture (a style, a background, a poster) or run
 * a script, on any element.
 */
const ACTIVE_ATTRIBUTE =
  /^(?:style|background|srcset|poster|lowsrc|dynsrc|icon|manifest|on.+)$/i;
/** Anything in a tag that loads from an address wherever it's used. */
const LOADING_VALUE = /url\s*\(|image-set\s*\(|@import/i;
/** The `<` of a tag. */
const TAG_START = /<(?=\/?[A-Za-z])/g;
/**
 * A Markdown link reference definition (`[x]: https://…`), which a
 * reference image would load from; also inside a quote or a list item
 * (`> [x]: …`, `- [x]: …`), which CommonMark counts too.
 */
const REFERENCE_DEFINITION =
  /^((?:[ \t>*+-]|\d{1,9}[.)])*)\[((?:\\.|[^\\\]])+)\]:[ \t]*(?:\n[ \t>]*)?(<[^>\n]*>|\S+)[^\n]*$/gm;
/** Times cleaning runs again on text whose removals rebuild what they removed. */
const MAX_ROUNDS = 8;

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
 * `out`, ready to be followed by `[`: a `!` at its end (not itself escaped)
 * would make what follows an image again, so it is escaped.
 */
function unbang(out: string): string {
  if (!out.endsWith("!")) return out;
  let slashes = 0;
  for (let k = out.length - 2; k >= 0 && out[k] === "\\"; k--) slashes++;
  return slashes % 2 === 0 ? `${out.slice(0, -1)}\\!` : out;
}

/**
 * Every Markdown image in `s` that would load from somewhere other than the
 * web app becomes its description, `[image: …]`, whatever its form: inline
 * (brackets inside the description, escapes, `<…>` addresses), reference or
 * shortcut. A `!` just before the description is escaped, so it can't be
 * read as an image itself. Afterwards no unescaped `![` is left but the web
 * app's own inline images.
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
        out = keep ? `${out}![${alt}](${keep})` : unbang(out) + placeholder;
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
    out = unbang(out) + placeholder;
    i = end;
  }
  return out;
}

const isSpace = (c: string | undefined) =>
  c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

type Tag = { end: number; name: string; attributes: string[] };

/**
 * The HTML tag starting at the `<` at `i`, read the way a browser reads it:
 * a quoted attribute value may hold `>`, and a quote anywhere else is part
 * of a name. null when that `<` doesn't start a tag; "open" when the tag
 * runs to the end of the text, so whatever comes after the text (a fence,
 * the next line of an answer) could close it.
 */
function readTag(s: string, i: number): Tag | "open" | null {
  let j = i + 1;
  if (s[j] === "/") j++;
  if (!/[A-Za-z]/.test(s[j] ?? "")) return null;
  const from = j;
  while (j < s.length && !isSpace(s[j]) && s[j] !== "/" && s[j] !== ">") j++;
  const name = s.slice(from, j).toLowerCase();
  const attributes: string[] = [];
  for (;;) {
    while (j < s.length && (isSpace(s[j]) || s[j] === "/")) j++;
    if (j >= s.length) return "open";
    if (s[j] === ">") return { end: j + 1, name, attributes };
    // An attribute's name; its first character belongs to it even if "=".
    const start = j++;
    while (
      j < s.length &&
      !isSpace(s[j]) &&
      s[j] !== "/" &&
      s[j] !== ">" &&
      s[j] !== "="
    )
      j++;
    attributes.push(s.slice(start, j));
    while (isSpace(s[j])) j++;
    if (s[j] !== "=") continue;
    j++;
    while (isSpace(s[j])) j++;
    const quote = s[j];
    if (quote === '"' || quote === "'") {
      const close = s.indexOf(quote, j + 1);
      if (close < 0) return "open";
      j = close + 1;
    } else while (j < s.length && !isSpace(s[j]) && s[j] !== ">") j++;
  }
}

/**
 * Every tag read as a browser would, and those that load something dropped:
 * embeds, and any tag with a loading or script attribute. A tag that never
 * closes could be closed by what follows the text and take attributes from
 * there, so from its `<` on, every tag's `<` is escaped and it's all text.
 */
function dropLoadingTags(s: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const lt = s.indexOf("<", i);
    if (lt < 0) return out + s.slice(i);
    out += s.slice(i, lt);
    const tag = readTag(s, lt);
    if (tag === null) {
      out += "<";
      i = lt + 1;
      continue;
    }
    if (tag === "open") return out + s.slice(lt).replace(TAG_START, "&lt;");
    const raw = s.slice(lt, tag.end);
    const loads =
      EMBED_SET.has(tag.name) ||
      LOADING_VALUE.test(raw) ||
      tag.attributes.some((a) => ACTIVE_ATTRIBUTE.test(a));
    if (!loads) out += raw;
    i = tag.end;
  }
}

/**
 * One round of cleaning: comments, hidden elements and whatever loads from
 * an address removed, reference definitions pointing elsewhere dropped and
 * images from other hosts replaced by their description.
 */
function scrub(s: string, own: string | null): string {
  const markup = dropLoadingTags(
    s
      .replace(HTML_COMMENT, "")
      .replace(HIDDEN_ELEMENTS, "")
      .replace(INVISIBLE_ELEMENT, "")
      .replace(EMBEDS, ""),
  ).replace(
    REFERENCE_DEFINITION,
    (line: string, container: string, _label: string, dest: string) =>
      ownImageUrl(dest.replace(/^<|>$/g, ""), own) ? line : container,
  );
  return neutraliseImages(markup, own);
}

/**
 * Text as an agent may see it: control, invisible and direction characters
 * removed, HTML comments, hidden elements and anything that loads from an
 * address gone, images from other hosts replaced by their description (and
 * reference definitions pointing elsewhere dropped), and cut to `max`
 * characters. A removal can join the halves of another tag or image around
 * it (`<im<img>g src=…>`), so cleaning runs again until nothing changes;
 * and a tag left open at the end (or by the cut) is escaped, so text that
 * follows can't close it.
 */
export function clean(text: unknown, max = MAX_RESULT_CHARS): string {
  const own = ownHost();
  let out = Array.from(
    String(text ?? "")
      .replace(INVISIBLE, "")
      .replace(BIDI, "")
      .replace(TAGS, ""),
  )
    // Control characters other than newlines and tabs.
    .map((c) => (c < " " && c !== "\n" && c !== "\t" ? " " : c))
    .join("");
  for (let round = 0; ; round++) {
    const next = scrub(out, own);
    if (next === out) break;
    if (round === MAX_ROUNDS) {
      // Built to rebuild itself without end: no tag or image is left.
      out = next.replace(/</g, "&lt;").replace(/!\[/g, "!\\[");
      break;
    }
    out = next;
  }
  out = out.replace(EMBED_OPENER, "&lt;");
  return dropLoadingTags(out.length > max ? out.slice(0, max) : out);
}

/**
 * A title: one line, cleaned, at most 200 characters. Spaces of every kind
 * become plain ones before cleaning, so the tags read then are the tags a
 * reader sees.
 */
export const cleanTitle = (text: unknown) =>
  dropLoadingTags(
    clean(String(text ?? "").replace(/\s+/g, " "), MAX_TITLE_CHARS * 2)
      .replace(/ {2,}/g, " ")
      .trim()
      .slice(0, MAX_TITLE_CHARS),
  );

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

/**
 * A title as an agent sees it: cleaned, and without a guest's email address.
 * A booking's title is made from what its guest typed (their name, say), so
 * it is only "Booking" when the connection hides outside content.
 */
export const titleFor = (
  title: unknown,
  source: Provenance | string,
  hideOutside = false,
) => {
  if (source !== "booking_guest") return cleanTitle(title);
  return hideOutside ? "Booking" : maskEmails(cleanTitle(title)) || "Booking";
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
