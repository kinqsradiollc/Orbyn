/**
 * The Orbyn Clipper (CAP-02, CAP-03, CAP-04): a browser extension that saves
 * what you're reading into Orbyn.
 *
 * - Article: the readable part of a page, cleaned on the server, as a page.
 * - Paper: the same, with its authors, year and DOI at the top, for citing.
 * - Assignment: a task with the page's link, and a deadline when the page
 *   says one plainly ("Due 3 October 2026 11:59pm"); never a guessed one.
 * - Read later: a task with the link and an estimated reading time.
 * - Highlights: passages marked on the page, saved as quotes with the link,
 *   or as cloze study cards on a page of cards.
 *
 * Which shape a site gets is chosen by built-in site rules (papers on arXiv
 * and DOI sites, assignments on course sites) and your own rules, kept in
 * the extension. The extension signs in with a Clipper key (ocl_…) that can
 * only save clips and list where they may go: never a full-power key.
 */
import { z } from "zod";
import type { DocBlock } from "./docs.js";
import { htmlToBlocks } from "./paste.js";

export const CLIP_TYPES = [
  "article",
  "paper",
  "assignment",
  "read_later",
  "highlights",
] as const;
export type ClipType = (typeof CLIP_TYPES)[number];

export const CLIP_TYPE_LABELS: Record<ClipType, string> = {
  article: "Article",
  paper: "Paper",
  assignment: "Assignment",
  read_later: "Read later",
  highlights: "Highlights",
};

/** The prefix of a Clipper key. */
export const CLIP_KEY_PREFIX = "ocl_";

/** The most HTML a clip may send (the page's own, cleaned on the server). */
export const CLIP_HTML_MAX = 2_000_000;

/** One highlighted passage, and the words to hide when it becomes a card. */
export const clipHighlight = z
  .object({
    text: z.string().trim().min(1).max(2000),
    /** Words in `text` to hide on the card; picked for you when left out. */
    hide: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type ClipHighlight = z.infer<typeof clipHighlight>;

/** POST /clips: what the extension sends. */
export const clipInput = z
  .object({
    type: z.enum(CLIP_TYPES),
    url: z
      .string()
      .trim()
      .max(2000)
      .refine((u) => /^https?:\/\//i.test(u), "Only web pages can be clipped."),
    title: z.string().trim().max(200).default(""),
    /** The page's HTML (article and paper). */
    html: z.string().max(CLIP_HTML_MAX).optional(),
    /** Words selected on the page, clipped instead of the whole article. */
    selection: z.string().trim().max(20000).optional(),
    highlights: z.array(clipHighlight).max(100).default([]),
    /** Highlights as quotes on a page, or as study cards. */
    highlights_as: z.enum(["quotes", "cards"]).default("quotes"),
    /** Where it goes: a folder, a project or a team, or a page (cards). */
    folder_id: z.uuid().nullable().default(null),
    project_id: z.uuid().nullable().default(null),
    team_id: z.uuid().nullable().default(null),
    /** A page to add highlights or cards to, instead of a new page. */
    doc_id: z.uuid().nullable().default(null),
    /** A deadline the person set or confirmed for an assignment. */
    due_at: z.iso.datetime({ offset: true }).nullable().optional(),
    /** The person's zone, to read "Due Oct 3 2026 5pm" on their clock. */
    time_zone: z.string().max(64).default("UTC"),
    /** Say what would be saved, and save nothing. */
    dry_run: z.boolean().default(false),
  })
  .strict()
  .refine((c) => c.type !== "highlights" || c.highlights.length > 0, {
    message: "Highlight something on the page first.",
    path: ["highlights"],
  });
export type ClipInput = z.infer<typeof clipInput>;

/** What POST /clips answers. */
export type ClipResult = {
  type: ClipType;
  /** What was made or changed: a page or a task. */
  made: { kind: "doc" | "task"; id: string; title: string } | null;
  title: string;
  /** Lines the page has (or would have). */
  lines: number;
  reading_minutes: number | null;
  /** An assignment's deadline as read from the page (or as set). */
  due_at: string | null;
  /** Why no deadline was read, in words, when none was. */
  due_note: string | null;
  cards: number;
  dry_run: boolean;
};

/** Where a clip may go (GET /clips/destinations). */
export type ClipDestinations = {
  folders: { id: string; name: string; team_id: string | null }[];
  projects: { id: string; name: string; team_id: string | null }[];
  teams: { id: string; name: string }[];
  /** Pages of cards the person has lately made or clipped to. */
  card_pages: { id: string; title: string }[];
};

/** A Clipper key as Settings lists it (the key itself is shown once). */
export type ClipKey = {
  id: string;
  name: string;
  hint: string;
  created_at: string;
  last_used_at: string | null;
};

export const clipKeyInput = z
  .object({ name: z.string().trim().min(1).max(60).default("Orbyn Clipper") })
  .strict();

// ------------------------------------------------------------ site rules ---

/** A rule: pages whose host ends with `host` (and path starts with `path`). */
export type ClipRule = { host: string; path?: string; type: ClipType };

/** Built-in rules; your own come first. */
export const BUILT_IN_CLIP_RULES: ClipRule[] = [
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

const hostMatches = (host: string, rule: string) =>
  rule.includes(".")
    ? host === rule || host.endsWith(`.${rule}`)
    : host.split(".").includes(rule);

/** The clip shape for a page: your rules, then the built-in ones, else Article. */
export function clipTypeFor(url: string, rules: ClipRule[] = []): ClipType {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "article";
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const r of [...rules, ...BUILT_IN_CLIP_RULES]) {
    const h = r.host.toLowerCase().replace(/^www\./, "");
    if (!h || !hostMatches(host, h)) continue;
    if (r.path && !u.pathname.startsWith(r.path)) continue;
    return r.type;
  }
  // A page that says it's a scholarly article is a paper wherever it is.
  return "article";
}

// ------------------------------------------------------------ html → page ---

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
  times: "×",
  deg: "°",
  euro: "€",
  pound: "£",
};

/** Text with its character references read (&amp;, &#39;, &#x2014;). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref: string) => {
    if (ref[0] === "#") {
      const code =
        ref[1] === "x" || ref[1] === "X"
          ? parseInt(ref.slice(2), 16)
          : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      if (code < 32 && code !== 9 && code !== 10) return " ";
      return String.fromCodePoint(code);
    }
    return NAMED[ref.toLowerCase()] ?? m;
  });
}

/** Parts of a page that are never the article. */
const DROP = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "math",
  "iframe",
  "object",
  "embed",
  "canvas",
  "form",
  "button",
  "select",
  "textarea",
  "nav",
  "header",
  "footer",
  "aside",
  "dialog",
  "video",
  "audio",
  "picture",
];

/** The attribute of a tag, read from its source (`href`, `content`…). */
const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : null;
};

/** The HTML with comments and the parts that are never the article taken out. */
function stripNoise(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of DROP)
    s = s.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"),
      " ",
    );
  // Things marked as page furniture by their role or class.
  s = s.replace(
    /<(div|section|ul|p)\b[^>]*\b(?:role\s*=\s*["']?(?:navigation|banner|contentinfo|complementary)|(?:class|id)\s*=\s*["'][^"']*\b(?:cookie|consent|newsletter|share|social|related|promo|advert|sidebar|comments?|breadcrumbs?)\b[^"']*["'])[^>]*>[\s\S]*?<\/\1\s*>/gi,
    " ",
  );
  return s;
}

/** The inner HTML of the first `tag` element with the most text, or null. */
function largest(html: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
  let best: string | null = null;
  let bestLen = 0;
  for (const m of html.matchAll(re)) {
    const len = m[1].replace(/<[^>]+>/g, "").trim().length;
    if (len > bestLen) {
      best = m[1];
      bestLen = len;
    }
  }
  return bestLen > 200 ? best : null;
}

/** The part of a page that holds the article. */
function articleRegion(html: string): string {
  const clean = stripNoise(html);
  const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(clean)?.[1] ?? clean;
  const main =
    largest(body, "article") ??
    largest(body, "main") ??
    /<[a-z]+\b[^>]*\brole\s*=\s*["']?main[^>]*>([\s\S]*)/i.exec(body)?.[1] ??
    body;
  return main;
}

/** A link target that is safe to keep: the web only, made absolute. */
function safeHref(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Text as a line in a page: runs of space made one, and the marks that
 * would make links to things inside Orbyn written harmlessly, so a clipped
 * page never links to (or shows) something by accident.
 */
const tidy = (s: string) =>
  s
    .replace(/[ \t\r\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/orbyn:\/\//gi, "orbyn: //")
    .trim();

/** Links in the article made absolute, so relative ones keep working. */
const absoluteLinks = (html: string, base: string) =>
  html.replace(
    /(<a\b[^>]*?\shref\s*=\s*)("([^"]*)"|'([^']*)')/gi,
    (_m, lead: string, _q: string, dq?: string, sq?: string) => {
      const href = safeHref(decodeEntities(dq ?? sq ?? ""), base);
      return href ? `${lead}"${href.replace(/"/g, "%22")}"` : `${lead}"#"`;
    },
  );

/**
 * The readable part of a page as lines: headings, paragraphs, lists,
 * quotes, code and dividers, with bold, italic, code and web links kept
 * (read by the same HTML reader as pasting). Pictures, scripts, menus,
 * footers and forms are left out. At most `max` lines.
 */
export function articleBlocks(
  html: string,
  baseUrl: string,
  max = 1500,
): DocBlock[] {
  const region = absoluteLinks(articleRegion(html), baseUrl).replace(
    /<img\b[^>]*>/gi,
    " ",
  );
  return htmlToBlocks(region)
    .slice(0, max)
    .map((b) =>
      "text" in b && typeof b.text === "string"
        ? ({
            ...b,
            text:
              b.type === "code"
                ? b.text.replace(/orbyn:\/\//gi, "orbyn: //")
                : tidy(b.text),
          } as DocBlock)
        : b,
    )
    .filter((b) => !("text" in b) || b.type === "code" || !!b.text.trim());
}

/** The page's own title, from its meta tags or <title>. */
export function htmlTitle(html: string): string {
  const meta = (name: string) => {
    const re = new RegExp(
      `<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`,
      "i",
    );
    const tag = re.exec(html)?.[0];
    return tag ? (attr(tag, "content") ?? "").trim() : "";
  };
  const title =
    meta("og:title") ||
    meta("citation_title") ||
    decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  return title.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** A paper's details, from the citation meta tags scholarly sites write. */
export type PaperMeta = {
  authors: string[];
  year: string | null;
  doi: string | null;
  journal: string | null;
};

export function paperMeta(html: string): PaperMeta {
  const all = (name: string) =>
    [
      ...html.matchAll(
        new RegExp(
          `<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`,
          "gi",
        ),
      ),
    ]
      .map((m) => (attr(m[0], "content") ?? "").trim())
      .filter(Boolean);
  const authors = [
    ...new Set([...all("citation_author"), ...all("dc.creator")]),
  ].slice(0, 30);
  const date =
    all("citation_publication_date")[0] ??
    all("citation_date")[0] ??
    all("dc.date")[0] ??
    null;
  const doiRaw = all("citation_doi")[0] ?? all("dc.identifier")[0] ?? null;
  const doi = doiRaw
    ? (/10\.\d{4,9}\/\S+/.exec(doiRaw)?.[0] ?? null)
    : (/\b10\.\d{4,9}\/[^\s"'<>]+/.exec(html)?.[0] ?? null);
  return {
    authors,
    year: date ? (/\b(1[89]\d{2}|2\d{3})\b/.exec(date)?.[1] ?? null) : null,
    doi,
    journal: all("citation_journal_title")[0] ?? null,
  };
}

/** Words in the lines of a page, for its reading time. */
export const wordCount = (blocks: DocBlock[]): number =>
  blocks.reduce(
    (n, b) =>
      n +
      ("text" in b && b.type !== "code"
        ? b.text.split(/\s+/).filter(Boolean).length
        : 0),
    0,
  );

/** Minutes to read this many words (about 230 a minute), at least one. */
export const readingMinutes = (words: number): number =>
  Math.max(1, Math.round(words / 230));

/** "Oct 3" style dates can't be trusted; the date words after "due" or "deadline". */
export function dueWords(text: string): string | null {
  const m =
    /\b(?:due(?:\s+(?:date|by|on|at))?|deadline|submit\s+by|closes?)\s*[:\-–]?\s*((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?([^\n.;|]{4,60})/i.exec(
      text,
    );
  if (!m) return null;
  return `${m[1] ?? ""}${m[2]}`.trim();
}

/** The top of a clipped page: where and when it came from. */
export function clipSourceLine(
  url: string,
  at: Date,
  timeZone = "UTC",
): DocBlock {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* kept as written */
  }
  const day = at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  });
  return {
    type: "callout",
    kind: "note",
    text: `Clipped from [${host}](${url.replace(/[()\s]/g, encodeURIComponent)}) on ${day}`,
  };
}

/** A paper's details as lines under its source line. */
export function paperLines(meta: PaperMeta): DocBlock[] {
  const lines: DocBlock[] = [];
  if (meta.authors.length)
    lines.push({
      type: "paragraph",
      text: `**Authors:** ${meta.authors.join(", ")}`,
    });
  const facts = [
    meta.year ? `**Year:** ${meta.year}` : "",
    meta.journal ? `**In:** ${meta.journal}` : "",
    meta.doi ? `**DOI:** [${meta.doi}](https://doi.org/${meta.doi})` : "",
  ].filter(Boolean);
  if (facts.length) lines.push({ type: "paragraph", text: facts.join(" · ") });
  return lines;
}

const STOP = new Set(
  "about after again against along also among another because been before being between both could every first from have into itself might more most much must other over same should since some such than that their them then there these they this those through under until very were what when where which while whose with within without would your".split(
    " ",
  ),
);

/**
 * A highlighted passage as a cloze card line: the words chosen to hide in
 * {{…}}, or, when none were chosen, its most telling word (a number, a name
 * mid-sentence, or its longest uncommon word). Null when nothing is worth
 * hiding.
 */
export function clozeLine(h: ClipHighlight): string | null {
  const text = h.text.replace(/\s+/g, " ").replace(/[{}]/g, "").trim();
  if (!text) return null;
  if (h.hide) {
    const at = text.toLowerCase().indexOf(h.hide.toLowerCase());
    if (at !== -1)
      return `${text.slice(0, at)}{{${text.slice(at, at + h.hide.length)}}}${text.slice(at + h.hide.length)}`;
  }
  const words = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)];
  const score = (w: RegExpMatchArray) => {
    const word = w[0];
    const lower = word.toLowerCase();
    if (STOP.has(lower) || word.length < 4) return -1;
    let s = word.length;
    if (/\d/.test(word)) s += 6;
    if (w.index! > 0 && /^\p{Lu}/u.test(word)) s += 4;
    return s;
  };
  let best: RegExpMatchArray | null = null;
  for (const w of words) if (score(w) > (best ? score(best) : -1)) best = w;
  if (!best || score(best) < 0) return null;
  const at = best.index!;
  return `${text.slice(0, at)}{{${best[0]}}}${text.slice(at + best[0].length)}`;
}

/** Highlights as quote lines, each with a link back to where it was read. */
export function quoteLines(
  highlights: ClipHighlight[],
  url: string,
): DocBlock[] {
  const safe = url.replace(/[()\s]/g, encodeURIComponent);
  return highlights.map((h) => ({
    type: "quote",
    text: `${tidy(h.text).replace(/\n/g, " ")} ([source](${safe}))`,
  }));
}
