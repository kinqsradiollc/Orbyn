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
/** Elements whose content never shows, and embeds that load from elsewhere. */
const HIDDEN_ELEMENTS =
  /<(script|style|template|iframe|object|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const EMBEDS =
  /<(?:img|iframe|embed|object|link|meta|source|video|audio)\b[^>]*>/gi;
/** A span or div styled invisible, with what it hides. */
const INVISIBLE_ELEMENT =
  /<(span|div|p)\b[^>]*style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi;
/** Markdown images: ![alt](url "title"). */
const MD_IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
/** Reference-style image definitions pointing anywhere. */
const MD_IMAGE_REF = /!\[([^\]]*)\]\[[^\]]*\]/g;

/** The web app's own host: images there are Orbyn's and may stay. */
function ownHost(): string | null {
  try {
    return new URL(env.APP_URL).host;
  } catch {
    return null;
  }
}

/**
 * Text as an agent may see it: control, invisible and direction characters
 * removed, HTML comments and hidden elements gone, images from other hosts
 * replaced by their description, and cut to `max` characters.
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
    .replace(MD_IMAGE, (_m, alt: string, url: string) => {
      try {
        const host = new URL(url, env.APP_URL).host;
        if (own && host === own) return `![${alt}](${url})`;
      } catch {
        // Not a URL at all: dropped like any other outside image.
      }
      return alt ? `[image: ${alt}]` : "[image removed]";
    })
    .replace(MD_IMAGE_REF, (_m, alt: string) =>
      alt ? `[image: ${alt}]` : "[image removed]",
    );
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

/**
 * Text from `source`: as it is when the person wrote it, fenced otherwise,
 * and left out when it came from outside Orbyn and the connection hides
 * outside content.
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
      : fence(text, source);

/**
 * Who wrote something, from the person's point of view: themselves, a
 * teammate by name, or an outside source.
 */
export function provenanceOf(
  viewerId: string,
  row: {
    user_id?: string | null;
    author_name?: string | null;
    imported?: boolean;
    subscribed?: boolean;
  },
): Provenance {
  if (row.subscribed) return "subscribed_feed";
  if (row.imported) return "import";
  if (!row.user_id || row.user_id === viewerId) return "you";
  const name = cleanTitle(row.author_name ?? "").slice(0, 60) || "someone";
  return `teammate:${name}`;
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
