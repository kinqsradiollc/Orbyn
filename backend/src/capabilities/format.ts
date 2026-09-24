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
 * Elements whose content never shows, and drawings (SVG) that can load
 * pictures from elsewhere: removed with everything inside them.
 */
const HIDDEN_OPEN = /<(script|style|template|iframe|object|noscript|svg)\b/gi;
/** Elements that can be styled invisible, hiding what's inside them. */
const STYLED_OPEN = /<(span|div|p)\b/gi;
/**
 * A character reference, which a browser reads in an attribute value before
 * the style is: `display&#58;none` is `display:none`.
 */
const CHAR_REFERENCE =
  /&#[xX]([0-9a-fA-F]+);?|&#([0-9]+);?|&([A-Za-z][A-Za-z0-9]*);/g;
/** The named references for the characters a style is written with. */
const NAMED_REFERENCES: Record<string, string> = {
  Tab: "\t",
  NewLine: "\n",
  nbsp: "\u00a0",
  excl: "!",
  quot: '"',
  QUOT: '"',
  num: "#",
  dollar: "$",
  percnt: "%",
  amp: "&",
  AMP: "&",
  apos: "'",
  lpar: "(",
  rpar: ")",
  ast: "*",
  midast: "*",
  plus: "+",
  comma: ",",
  period: ".",
  sol: "/",
  colon: ":",
  semi: ";",
  lt: "<",
  LT: "<",
  equals: "=",
  gt: ">",
  GT: ">",
  quest: "?",
  commat: "@",
  lsqb: "[",
  lbrack: "[",
  bsol: "\\",
  rsqb: "]",
  rbrack: "]",
  Hat: "^",
  lowbar: "_",
  UnderBar: "_",
  grave: "`",
  DiacriticalGrave: "`",
  lcub: "{",
  lbrace: "{",
  verbar: "|",
  vert: "|",
  VerticalLine: "|",
  rcub: "}",
  rbrace: "}",
};
/** A CSS comment, which separates what's on either side of it. */
const CSS_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g;
/** A CSS escape: `\6f ` and `\o` are both "o". */
const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([^\n\r\f]))/g;
/** A size or amount of nothing: 0, 0px, .0em, 0%. */
const ZERO = /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[a-z]+|%)?$/;
/**
 * Elements that load something from an address as soon as they're shown,
 * and the hidden ones above (whose tags alone may be left).
 */
const EMBED_NAMES =
  "img|image|picture|iframe|embed|object|link|meta|source|video|audio|track|input|frame|frameset|applet|base|use|feimage|svg|mglyph|bgsound|portal|script|style|template|noscript";
const EMBED_SET = new Set(EMBED_NAMES.split("|"));
/** The start of such an element's tag (opening or closing). */
const EMBED_START = new RegExp(`<\\/?(?:${EMBED_NAMES})\\b`, "gi");
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
/** Times cleaning runs again on text whose removals rebuild what they removed. */
const MAX_ROUNDS = 8;

/*
 * Every pass below reads the text once from left to right, whatever it
 * holds: text built to make a pass look far ahead again and again (a
 * thousand `![a](` or `<img` with nothing to close them) costs no more
 * than ordinary text of the same length. So nothing an agent can be made
 * to read can hold the service up.
 */

/**
 * The first place at or after `from` where `needle` is, or -1. Remembers
 * its last answer, so asking from positions that only move forward reads
 * the text once.
 */
function finder(s: string, needle: string | RegExp) {
  let asked = -1;
  let found = -1;
  const search =
    typeof needle === "string"
      ? (from: number) => s.indexOf(needle, from)
      : (from: number) => {
          needle.lastIndex = from;
          return needle.exec(s)?.index ?? -1;
        };
  return (from: number): number => {
    if (asked >= 0 && from >= asked && (found < 0 || found >= from))
      return found;
    asked = from;
    found = search(from);
    return found;
  };
}

/**
 * Where an element closes: the first `</name>` at or after a point, for
 * points that only move forward.
 */
function closers(s: string) {
  const byName = new Map<
    string,
    { re: RegExp; find: (from: number) => number }
  >();
  return (name: string, from: number): { at: number; end: number } | null => {
    let c = byName.get(name);
    if (!c) {
      const re = new RegExp(`<\\/${name}\\s*>`, "gi");
      c = { re, find: finder(s, re) };
      byName.set(name, c);
    }
    const at = c.find(from);
    if (at < 0) return null;
    c.re.lastIndex = at;
    return { at, end: at + c.re.exec(s)![0].length };
  };
}

/**
 * Elements whose content never shows (script, style, …), each removed with
 * everything up to its closing tag, or to the end when it never closes.
 */
function dropHiddenElements(s: string): string {
  const gt = finder(s, ">");
  const close = closers(s);
  let out = "";
  let from = 0;
  HIDDEN_OPEN.lastIndex = 0;
  for (let m; (m = HIDDEN_OPEN.exec(s));) {
    // The tag runs to the first ">"; with none after it, no element opens.
    const tagEnd = gt(m.index + m[0].length);
    if (tagEnd < 0) break;
    out += s.slice(from, m.index);
    from = close(m[1].toLowerCase(), tagEnd + 1)?.end ?? s.length;
    HIDDEN_OPEN.lastIndex = from;
  }
  return out + s.slice(from);
}

/** The character a reference or escape stands for; U+FFFD for none. */
const codePoint = (n: number) =>
  n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff)
    ? String.fromCodePoint(n)
    : "\ufffd";

/** A CSS name or value with its escapes read. */
const unescapeCss = (text: string) =>
  text.replace(CSS_ESCAPE, (_, hex: string | undefined, char: string) =>
    hex === undefined ? char : codePoint(parseInt(hex, 16)),
  );

/**
 * Whether a style attribute's value hides its element, read as a browser
 * reads it: character references first, then comments (which separate
 * words), then each declaration's escapes. Hiding means display none,
 * visibility hidden or collapse, a font size of zero or no opacity.
 */
function hidingStyle(value: string): boolean {
  const css = value
    .replace(CHAR_REFERENCE, (all, hex, dec, name: string | undefined) =>
      hex !== undefined
        ? codePoint(parseInt(hex, 16))
        : dec !== undefined
          ? codePoint(parseInt(dec, 10))
          : (NAMED_REFERENCES[name!] ?? all),
    )
    .replace(CSS_COMMENT, " ");
  // Declarations end at a ";" and their name at the first ":", unless a
  // backslash escapes it.
  let start = 0;
  let colon = -1;
  for (let i = 0; i <= css.length; i++) {
    const c = css[i];
    if (c === "\\" && i + 1 < css.length) {
      i++;
      continue;
    }
    if (c === ":" && colon < 0) colon = i;
    else if (c === ";" || i === css.length) {
      if (colon >= 0) {
        const name = unescapeCss(css.slice(start, colon)).trim().toLowerCase();
        const setting = unescapeCss(css.slice(colon + 1, i))
          .replace(/!\s*important\s*$/i, "")
          .trim()
          .toLowerCase();
        if (
          (name === "display" && setting === "none") ||
          (name === "visibility" &&
            (setting === "hidden" || setting === "collapse")) ||
          (name === "font-size" && ZERO.test(setting)) ||
          (name === "opacity" && ZERO.test(setting) && !/[a-z]/.test(setting))
        )
          return true;
      }
      start = i + 1;
      colon = -1;
    }
  }
  return false;
}

/**
 * Whether a tag styles its element invisible: only its first attribute
 * named "style" counts, as in a browser (a later one is ignored, and
 * "style=" inside another attribute's value, or "data-style", is no style).
 */
function hidesItself(tag: Tag): boolean {
  const style = tag.attributes.find((a) => a.name.toLowerCase() === "style");
  return !!style?.value && hidingStyle(style.value);
}

/**
 * Spans, divs and paragraphs styled invisible, removed with what they hide
 * (up to their closing tag). Each tag is read as a browser reads it (a
 * quoted value may hold ">", as in `<p style="a:b;>;display:none">`), and
 * the search goes on after it, since nothing inside a tag is another tag:
 * so each part of the text is read once.
 */
function dropInvisibleElements(s: string): string {
  const close = closers(s);
  let out = "";
  let from = 0;
  STYLED_OPEN.lastIndex = 0;
  for (let m; (m = STYLED_OPEN.exec(s));) {
    const tag = readTag(s, m.index);
    // Open to the end of the text: nothing after it is an element (and
    // dropLoadingTags turns it all into text).
    if (tag === "open") break;
    if (!tag) continue;
    STYLED_OPEN.lastIndex = tag.end;
    const name = m[1].toLowerCase();
    // "<p-x>" is another element, and one that doesn't hide stays.
    if (tag.name !== name || !hidesItself(tag)) continue;
    // An element that never closes is left as it is.
    const closing = close(name, tag.end);
    if (!closing) continue;
    out += s.slice(from, m.index);
    from = closing.end;
    STYLED_OPEN.lastIndex = closing.end;
  }
  return out + s.slice(from);
}

/**
 * The tags of elements that load from an address, read the quick way (up
 * to the first `>`), removed wherever they are, even inside another tag.
 */
function dropEmbedTags(s: string): string {
  const gt = finder(s, ">");
  let out = "";
  let from = 0;
  EMBED_START.lastIndex = 0;
  for (let m; (m = EMBED_START.exec(s));) {
    const tagEnd = gt(m.index + m[0].length);
    if (tagEnd < 0) break;
    out += s.slice(from, m.index);
    from = tagEnd + 1;
    EMBED_START.lastIndex = from;
  }
  return out + s.slice(from);
}

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

const isSpace = (c: string | undefined) =>
  c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";
const isMarkdownSpace = (c: string | undefined) =>
  c !== undefined && /\s/.test(c);

/**
 * Where things are in Markdown text, worked out once per text (and only
 * the parts asked for): which characters a backslash escapes, the bracket
 * and parenthesis that close each one opened, and the next space, quote,
 * `>` or line break from any point.
 */
class Marks {
  private escapes?: Uint8Array;
  private pairs = new Map<string, Int32Array>();
  private nexts = new Map<string, Int32Array>();
  constructor(private readonly s: string) {}

  /** Whether the character at `k` follows a backslash that isn't itself escaped. */
  escaped(k: number): boolean {
    if (!this.escapes) {
      const e = new Uint8Array(this.s.length + 1);
      for (let i = 0; i < this.s.length; i++)
        if (this.s[i] === "\\" && !e[i]) e[i + 1] = 1;
      this.escapes = e;
    }
    return this.escapes[k] === 1;
  }

  /** The unescaped `close` that closes the `open` at `i` (nesting counted), or -1. */
  closing(open: "[" | "(", i: number): number {
    let match = this.pairs.get(open);
    if (!match) {
      const close = open === "[" ? "]" : ")";
      match = new Int32Array(this.s.length).fill(-1);
      const stack: number[] = [];
      for (let k = 0; k < this.s.length; k++) {
        const c = this.s[k];
        if ((c !== open && c !== close) || this.escaped(k)) continue;
        if (c === open) stack.push(k);
        else if (stack.length) match[stack.pop()!] = k;
      }
      this.pairs.set(open, match);
    }
    return match[i] ?? -1;
  }

  /** The first place at or after `from` that `test` picks, or -1. */
  private next(
    key: string,
    from: number,
    test: (c: string, k: number) => boolean,
  ): number {
    let next = this.nexts.get(key);
    if (!next) {
      next = new Int32Array(this.s.length + 1);
      let found = -1;
      for (let k = this.s.length; k >= 0; k--) {
        if (k < this.s.length && test(this.s[k], k)) found = k;
        next[k] = found;
      }
      this.nexts.set(key, next);
    }
    return from > this.s.length ? -1 : next[from];
  }

  /** The first unescaped white space at or after `from`, or -1. */
  space(from: number) {
    return this.next(
      "space",
      from,
      (c, k) => isMarkdownSpace(c) && !this.escaped(k),
    );
  }
  /** The first character at or after `from` that isn't white space, or -1. */
  text(from: number) {
    return this.next("text", from, (c) => !isMarkdownSpace(c));
  }
  /** The first unescaped `c` at or after `from`, or -1. */
  unescaped(c: '"' | "'" | ")", from: number) {
    return this.next(`u${c}`, from, (x, k) => x === c && !this.escaped(k));
  }
  /** The first `c` at or after `from`, escaped or not, or -1. */
  plain(c: ">" | "\n", from: number) {
    return this.next(`p${c}`, from, (x) => x === c);
  }
}

/**
 * An inline link's `(destination "title")` starting at the `(` at `i`, as
 * CommonMark reads it: `<…>` (which may hold spaces) or a run with balanced
 * brackets and escapes, then an optional title. null when it isn't one.
 */
function inlineTarget(
  s: string,
  marks: Marks,
  i: number,
): { url: string; end: number } | null {
  const skip = (from: number) => {
    const at = marks.text(from);
    return at < 0 ? s.length : at;
  };
  let j = skip(i + 1);
  let url: string;
  if (s[j] === "<") {
    const close = marks.plain(">", j + 1);
    const line = marks.plain("\n", j + 1);
    if (close < 0 || (line >= 0 && line < close)) return null;
    url = s.slice(j + 1, close);
    j = close + 1;
  } else {
    // The run ends at white space or at the ")" that closes the "(" at i.
    const start = j;
    const space = marks.space(j);
    const paren = marks.closing("(", i);
    const stop = space < 0 ? s.length : space;
    j = paren >= 0 && paren < stop ? paren : stop;
    url = s.slice(start, j);
  }
  j = skip(j);
  const opener = s[j];
  if (opener === '"' || opener === "'" || opener === "(") {
    const closer = marks.unescaped(opener === "(" ? ")" : opener, j + 1);
    if (closer < 0) return null;
    j = skip(closer + 1);
  }
  return s[j] === ")" ? { url, end: j + 1 } : null;
}

/**
 * Every Markdown image in `s` that would load from somewhere other than the
 * web app becomes its description, `[image: …]`, whatever its form: inline
 * (brackets inside the description, escapes, `<…>` addresses), reference or
 * shortcut. A `!` just before the description is escaped, so it can't be
 * read as an image itself. Afterwards no unescaped `![` is left but the web
 * app's own inline images, so no definition elsewhere in the text (`[x]:
 * https://…`) can feed one: definitions stay, as the text they are.
 */
function neutraliseImages(s: string, own: string | null): string {
  if (!s.includes("![")) return s;
  const marks = new Marks(s);
  // The answer in pieces, joined once at the end.
  const out: string[] = [];
  /**
   * Before a `[`: a `!` at the end of the answer so far (not itself
   * escaped) would make what follows an image again, so it is escaped.
   */
  const unbang = () => {
    const p = out.length - 1;
    if (p < 0 || !out[p].endsWith("!")) return;
    // Backslashes just before that "!", across pieces.
    let slashes = 0;
    scan: for (let q = p; q >= 0; q--) {
      const piece = out[q];
      for (let k = piece.length - (q === p ? 2 : 1); k >= 0; k--) {
        if (piece[k] !== "\\") break scan;
        slashes++;
      }
    }
    if (slashes % 2 === 0) out[p] = `${out[p].slice(0, -1)}\\!`;
  };
  const put = (text: string) => {
    if (text) out.push(text);
  };
  let i = 0;
  while (i < s.length) {
    const at = s.indexOf("![", i);
    if (at < 0) {
      put(s.slice(i));
      break;
    }
    // "\![" is an escaped "!" followed by a link, not an image.
    if (marks.escaped(at)) {
      put(s.slice(i, at + 1));
      i = at + 1;
      continue;
    }
    put(s.slice(i, at));
    const close = marks.closing("[", at + 1);
    if (close < 0) {
      put("!\\[");
      i = at + 2;
      continue;
    }
    const alt = altText(s.slice(at + 2, close));
    const placeholder = alt ? `[image: ${alt}]` : "[image removed]";
    if (s[close + 1] === "(") {
      const target = inlineTarget(s, marks, close + 1);
      if (target) {
        const keep = ownImageUrl(target.url, own);
        if (keep) put(`![${alt}](${keep})`);
        else {
          unbang();
          put(placeholder);
        }
        i = target.end;
        continue;
      }
    }
    // A reference image: ![alt][label] or ![alt][] (the label goes too).
    let end = close + 1;
    if (s[end] === "[") {
      const label = marks.closing("[", end);
      if (label > 0) end = label + 1;
    }
    unbang();
    put(placeholder);
    i = end;
  }
  return out.join("");
}

type Tag = {
  end: number;
  name: string;
  /** Each attribute's name as written, and its value (null without "="). */
  attributes: { name: string; value: string | null }[];
};

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
  const attributes: Tag["attributes"] = [];
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
    const attribute: Tag["attributes"][number] = {
      name: s.slice(start, j),
      value: null,
    };
    attributes.push(attribute);
    while (isSpace(s[j])) j++;
    if (s[j] !== "=") continue;
    j++;
    while (isSpace(s[j])) j++;
    const quote = s[j];
    if (quote === '"' || quote === "'") {
      const close = s.indexOf(quote, j + 1);
      if (close < 0) return "open";
      attribute.value = s.slice(j + 1, close);
      j = close + 1;
    } else {
      const from = j;
      while (j < s.length && !isSpace(s[j]) && s[j] !== ">") j++;
      attribute.value = s.slice(from, j);
    }
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
      tag.attributes.some((a) => ACTIVE_ATTRIBUTE.test(a.name));
    if (!loads) out += raw;
    i = tag.end;
  }
}

/**
 * One round of cleaning: comments, hidden elements and whatever loads from
 * an address removed, and images from other hosts replaced by their
 * description.
 */
function scrub(s: string, own: string | null): string {
  const markup = dropLoadingTags(
    dropEmbedTags(
      dropInvisibleElements(dropHiddenElements(s.replace(HTML_COMMENT, ""))),
    ),
  );
  return neutraliseImages(markup, own);
}

/**
 * Text as an agent may see it: control, invisible and direction characters
 * removed, HTML comments, hidden elements and anything that loads from an
 * address gone, images from other hosts replaced by their description, and
 * cut to `max` characters. Ordinary text is left as it was written. A
 * removal can join the halves of another tag or image around it
 * (`<im<img>g src=…>`), so cleaning runs again until nothing changes; and a
 * tag left open at the end (or by the cut) is escaped, so text that follows
 * can't close it. Each round reads the text once (see above).
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

/** A fence's tag inside text (spaces allowed), read without looking back. */
const FENCE_OPEN = /<\s*(?:\/\s*)?untrusted-content/gi;

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

/** Characters an email address's local part (before the @) is made of. */
const LOCAL_PART = /[A-Za-z0-9._%+-]/;
/** An email address's domain, read from just after its @. */
const EMAIL_DOMAIN = /[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/y;

/**
 * `text` with every email address hidden, so a booking guest's contact
 * details stay out. Found from each @, reading back over the local part
 * and forward over the domain, so every character is read a few times at
 * most, however the text is built (a pattern tried from every position
 * would read a long run of letters once per letter).
 */
export function maskEmails(text: string): string {
  let out = "";
  let from = 0;
  for (let at = text.indexOf("@"); at >= 0;) {
    let start = at;
    while (start > from && LOCAL_PART.test(text[start - 1])) start--;
    if (start < at) {
      EMAIL_DOMAIN.lastIndex = at + 1;
      const domain = EMAIL_DOMAIN.exec(text);
      if (domain) {
        out += `${text.slice(from, start)}[email hidden]`;
        from = at + 1 + domain[0].length;
        at = text.indexOf("@", from);
        continue;
      }
    }
    at = text.indexOf("@", at + 1);
  }
  return out + text.slice(from);
}

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
 * The neutral name an item whose title came from outside goes by: a
 * booking's event (its title made from what the guest typed) is "Booking",
 * and a task or event sent in by email (its subject, which anyone could
 * have written) is "Task from email" or "Event from email". null for other
 * sources.
 */
export const outsideHeading = (source: Provenance | string, kind?: string) =>
  source === "booking_guest"
    ? "Booking"
    : source === "inbound_email"
      ? kind === "event"
        ? "Event from email"
        : "Task from email"
      : null;

/**
 * A title as an agent sees it: cleaned, and without a guest's email address.
 * Titles made from outside text are only their neutral name (see
 * outsideHeading) when the connection hides outside content. `kind` is the
 * item's kind ("event", "task", …).
 */
export const titleFor = (
  title: unknown,
  source: Provenance | string,
  hideOutside = false,
  kind?: string,
) => {
  const heading = outsideHeading(source, kind);
  if (!heading) return cleanTitle(title);
  if (hideOutside) return heading;
  const text = cleanTitle(title);
  return (source === "booking_guest" ? maskEmails(text) : text) || heading;
};

/**
 * A title fenced on its line of Markdown: for a title from outside Orbyn in
 * a list, where a fence of its own lines would break the list.
 */
export function fencedTitle(title: string, source: Provenance | string) {
  const body = cleanTitle(title).replace(FENCE_OPEN, "&lt;untrusted-content");
  const label = source.replace(/["<>\n]/g, "");
  return `<untrusted-content source="${label}">${body}</untrusted-content>`;
}

/**
 * An item's title (linked when there's a url) for one line of Markdown.
 * The person's own, or a teammate's, is as it is. One made from outside
 * text (see outsideHeading) goes by its neutral name, and the text itself
 * follows, fenced; when the connection hides outside content, the title
 * already is that name and nothing follows.
 */
export function lineTitle(
  title: string,
  url: string | null,
  source: Provenance | string,
  kind?: string,
): string {
  const link = (text: string) => (url ? mdLink(text, url) : text);
  const name = outsideHeading(source, kind);
  if (!name) return link(title);
  // Already a neutral name (the connection hides outside content), whatever
  // kind it was given for: nothing follows it.
  return title === name ||
    title === outsideHeading(source, "task") ||
    title === outsideHeading(source, "event")
    ? link(title)
    : `${link(name)} ${fencedTitle(title, source)}`;
}

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
