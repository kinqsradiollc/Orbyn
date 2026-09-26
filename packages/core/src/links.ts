/**
 * Links between things (LNK-01, LNK-02, LNK-05).
 *
 * A link made with the link picker is kept in the page as an ordinary
 * Markdown link to `orbyn://<kind>/<id>`: `[Lab 3 notes](orbyn://doc/…)`.
 * That reads and writes through `parseDoc`/`serializeDoc` unchanged, never
 * clashes with the `[[ ]]` search puts round matched words or with study's
 * `::` and `{{ }}`, and exports as a plain Markdown link. The words in the
 * brackets are only what the link said when it was made: the app shows the
 * thing's live title, so renaming it never breaks or stales a link.
 *
 * `[[` is only a way to open the picker while typing; it is never stored.
 */
import { z } from "zod";
import { parseAppLink } from "./app-links.js";
import { parseDocInline, plainText, type DocBlock } from "./docs.js";

/** What a link can point to. An event is a task with a time. */
export const LINK_KINDS = [
  "doc",
  "task",
  "project",
  "event",
  "person",
  "date",
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** One thing a link points to. A date's id is its day, `2026-09-26`. */
export type ObjectRef = { kind: LinkKind; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `id` is the right shape for a link of this kind. */
export const validLinkId = (kind: LinkKind, id: string): boolean =>
  kind === "date"
    ? DAY.test(id) && !isNaN(Date.parse(`${id}T00:00:00Z`))
    : UUID.test(id);

/** The address a link is stored with. */
export const linkHref = (ref: ObjectRef): string =>
  `orbyn://${ref.kind}/${ref.id.toLowerCase()}`;

/** The thing an `orbyn://` link points to, or null for any other link. */
export function parseObjectHref(
  href: string | null | undefined,
): ObjectRef | null {
  const m = /^orbyn:\/\/([a-z]+)\/([^/?#\s]+)$/i.exec(href ?? "");
  if (!m) return null;
  const kind = m[1].toLowerCase() as LinkKind;
  if (!(LINK_KINDS as readonly string[]).includes(kind)) return null;
  const id = m[2].toLowerCase();
  return validLinkId(kind, id) ? { kind, id } : null;
}

/**
 * The thing a link dropped or pasted into a page points to: an
 * `orbyn://` link, or the web app's own link to a page, task or project
 * (`https://…/app/task/<id>`). Null for any other address.
 */
export function refFromUrl(url: string | null | undefined): ObjectRef | null {
  const own = parseObjectHref((url ?? "").trim());
  if (own) return own;
  const app = parseAppLink((url ?? "").trim());
  return app &&
    (app.kind === "task" || app.kind === "doc" || app.kind === "project")
    ? { kind: app.kind, id: app.id }
    : null;
}

/** The same thing, whether it was linked as a task or as an event. */
export const sameTarget = (a: ObjectRef, b: ObjectRef): boolean =>
  a.id.toLowerCase() === b.id.toLowerCase() &&
  (a.kind === b.kind ||
    ((a.kind === "task" || a.kind === "event") &&
      (b.kind === "task" || b.kind === "event")));

/** A title made safe to sit inside a link's brackets. */
export const linkLabel = (title: string | null | undefined): string =>
  (title ?? "")
    .replace(/[[\]]/g, (c) => (c === "[" ? "(" : ")"))
    .replace(/[`*$=]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "Untitled";

/** A link as it is written into a page's line. */
export const linkMarkdown = (ref: ObjectRef, title: string): string =>
  `[${linkLabel(title)}](${linkHref(ref)})`;

/** A link found in a page: what it points to, and the line it sits on. */
export type DocObjectLink = {
  ref: ObjectRef;
  /** The block's id, or `#<n>` for a line that has none. */
  block: string;
  label: string;
};

/**
 * Every picker link in a page, one per thing per line. Code and maths are
 * literal, so a link written inside them is text (the same rule the
 * database's index follows).
 */
export function docObjectLinks(blocks: DocBlock[]): DocObjectLink[] {
  const out: DocObjectLink[] = [];
  const seen = new Set<string>();
  blocks.forEach((b, n) => {
    if (b.type === "code" || b.type === "math" || b.type === "divider") return;
    for (const run of parseDocInline(b.text)) {
      const ref = parseObjectHref(run.link);
      if (!ref) continue;
      const block = b.id || `#${n}`;
      const key = `${block}|${ref.kind === "event" ? "task" : ref.kind}|${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ref, block, label: run.text });
    }
  });
  return out;
}

/** The words around a link, with the linked words on their own. */
export type LinkContext = { before: string; linked: string; after: string };

const clip = (s: string, n: number, fromEnd: boolean) => {
  if (s.length <= n) return s;
  if (fromEnd) {
    const cut = s.slice(s.length - n);
    const space = cut.indexOf(" ");
    return "…" + (space > 0 && space < 20 ? cut.slice(space + 1) : cut);
  }
  const cut = s.slice(0, n);
  const space = cut.lastIndexOf(" ");
  return (space > n - 20 ? cut.slice(0, space) : cut) + "…";
};

/**
 * One line of context for "Linked here": the line a link sits on, as words,
 * with the link's own words picked out. A line with no link to `target`
 * (a checklist line, a comment) comes back whole in `before`.
 */
export function linkContext(
  source: string,
  target: ObjectRef | null,
  max = 140,
): LinkContext {
  const runs = parseDocInline(source ?? "");
  const words = (r: { text: string; math?: boolean }) =>
    r.math ? plainText(`$${r.text}$`) : r.text;
  const at = target
    ? runs.findIndex((r) => {
        const ref = parseObjectHref(r.link);
        return ref !== null && sameTarget(ref, target);
      })
    : -1;
  if (at < 0) {
    const all = runs.map(words).join("").replace(/\s+/g, " ").trim();
    return { before: clip(all, max, false), linked: "", after: "" };
  }
  const before = runs.slice(0, at).map(words).join("").replace(/\s+/g, " ");
  const after = runs
    .slice(at + 1)
    .map(words)
    .join("")
    .replace(/\s+/g, " ");
  const linked = runs[at].text;
  const room = Math.max(20, Math.floor((max - linked.length) / 2));
  return {
    before: clip(before.trimStart(), room, true),
    linked,
    after: clip(after.trimEnd(), room, false),
  };
}

/**
 * The `[[` being typed before the caret, and the words after it, or null
 * when the caret isn't in one. It closes at a `]`, a new line or 60
 * characters, so a `[[` left in text doesn't keep the picker open.
 */
export function linkQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const upTo = text.slice(0, caret);
  const start = upTo.lastIndexOf("[[");
  if (start < 0) return null;
  const query = upTo.slice(start + 2);
  if (query.length > 60 || /[\]\n]/.test(query)) return null;
  return { start, query };
}

/**
 * Put a link where `[[words` was typed (from `start` to `caret`), with a
 * space after it. Returns the new line and where the caret goes.
 */
export function insertLink(
  text: string,
  start: number,
  caret: number,
  ref: ObjectRef,
  title: string,
): { text: string; caret: number } {
  const link = linkMarkdown(ref, title);
  const rest = text.slice(caret);
  const space = rest.startsWith(" ") ? "" : " ";
  return {
    text: text.slice(0, start) + link + space + rest,
    caret: start + link.length + 1,
  };
}

// ----------------------------------------------------------------- dates ---

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A day as a pill says it: "Fri 26 Sep 2026". */
export function dateTitle(day: string): string {
  if (!DAY.test(day)) return day;
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const wd = WEEKDAYS[date.getDay()];
  return `${wd[0].toUpperCase()}${wd.slice(1)} ${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * The days the words typed in the picker could mean: today, tomorrow,
 * yesterday, a weekday (the next one) or a written date (2026-10-02).
 */
export function dateOptions(
  q: string,
  now = new Date(),
): { id: string; title: string; hint: string }[] {
  const words = q.trim().toLowerCase();
  if (!words) return [];
  const at = (offset: number) => {
    const d = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
    );
    return dayOf(d);
  };
  const out: { id: string; hint: string }[] = [];
  const named: [string, number][] = [
    ["today", 0],
    ["tomorrow", 1],
    ["yesterday", -1],
  ];
  for (const [name, offset] of named)
    if (name.startsWith(words) && words.length >= 2)
      out.push({ id: at(offset), hint: name[0].toUpperCase() + name.slice(1) });
  const wd = WEEKDAYS.findIndex(
    (w) => words.length >= 3 && words.startsWith(w),
  );
  if (wd >= 0) {
    const ahead = (wd - now.getDay() + 7) % 7 || 7;
    out.push({
      id: at(ahead),
      hint: "Next " + dateTitle(at(ahead)).slice(0, 3),
    });
  }
  if (DAY.test(words) && validLinkId("date", words))
    out.push({ id: words, hint: "Date" });
  const seen = new Set<string>();
  return out
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .map((o) => ({ ...o, title: dateTitle(o.id) }));
}

// ---------------------------------------------------------------- export ---

/**
 * A line with its `orbyn://` links made into links anyone can open: pages,
 * tasks and projects become web app links at `origin`; people and dates,
 * which have no page of their own, become their words.
 */
export function webLinks(text: string, origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return text.replace(
    /\[([^\]\n]+)\]\((orbyn:\/\/[^)\s]+)\)/g,
    (whole, label: string, href: string) => {
      const ref = parseObjectHref(href);
      if (!ref) return whole;
      if (ref.kind === "person") return label;
      if (ref.kind === "date") return dateTitle(ref.id);
      const kind = ref.kind === "event" ? "task" : ref.kind;
      return `[${label}](${base}/app/${kind}/${ref.id})`;
    },
  );
}

/** A page's lines with {@link webLinks} applied, for files to keep. */
export const blocksWithWebLinks = (
  blocks: DocBlock[],
  origin: string,
): DocBlock[] =>
  blocks.map((b) =>
    "text" in b &&
    b.type !== "code" &&
    b.type !== "math" &&
    b.text.includes("orbyn://")
      ? { ...b, text: webLinks(b.text, origin) }
      : b,
  );

// ----------------------------------------------------------------- wire ---

/** A link's pill, as it stands now (GET /links/resolve). */
export type LinkPill = {
  kind: LinkKind;
  id: string;
  /**
   * - ok: there, and yours to open;
   * - deleted: a page in the Trash (`can_restore` when you may restore it);
   * - missing: gone for good, or not yours to see. The two are told apart
   *   by no one, so a private page's title never shows.
   */
  state: "ok" | "deleted" | "missing";
  title: string | null;
  /** A task's tick and deadline, so its pill can show them. */
  done?: boolean;
  due_at?: string | null;
  can_restore?: boolean;
};

/** One thing the link picker offers (GET /links/pick). */
export type LinkOption = {
  kind: LinkKind;
  id: string;
  title: string;
  /** Its project, or what kind of thing it is. */
  hint: string | null;
  done?: boolean;
  due_at?: string | null;
};

/** How a connection was made, in the words "Linked here" uses. */
export const LINK_SOURCES = [
  "link",
  "mention",
  "task_line",
  "dependency",
  "project",
  "meeting",
] as const;
export type LinkSource = (typeof LINK_SOURCES)[number];

export const LINK_SOURCE_LABELS: Record<LinkSource, string> = {
  link: "Link",
  mention: "Mentioned in a comment",
  task_line: "The line this task came from",
  dependency: "Waits for this",
  project: "Page in this project",
  meeting: "Meeting note",
};

/** One place that links here (GET /links/here). */
export type LinkedHere = {
  kind: "doc" | "task";
  id: string;
  title: string;
  /** A page's kind or a task's project, for the row's small print. */
  hint: string | null;
  source: LinkSource;
  /** The line it sits on, to open the page there; null for the whole thing. */
  block_id: string | null;
  context: LinkContext;
};

export type LinkedHereList = { count: number; items: LinkedHere[] };

/** GET /links/here: what links to one page, task, project or person. */
export const linksHereQuery = z
  .object({
    kind: z.enum(["doc", "task", "event", "project", "person"]),
    id: z.uuid(),
  })
  .strict();

/** GET /links/pick: what the link picker offers for the words typed. */
export const linkPickQuery = z
  .object({
    q: z.string().trim().max(200).default(""),
    limit: z.coerce.number().int().min(1).max(30).default(12),
  })
  .strict();

/** The most links one GET /links/resolve answers. */
export const MAX_RESOLVE = 60;

/** GET /links/resolve?refs=doc:<id>,task:<id>: pills as they stand now. */
export const linkResolveQuery = z
  .object({
    refs: z
      .string()
      .max(MAX_RESOLVE * 50)
      .transform((s, ctx) => {
        const refs: ObjectRef[] = [];
        for (const part of s.split(",").filter(Boolean)) {
          const [kind, id = ""] = part.split(":");
          if (
            !(LINK_KINDS as readonly string[]).includes(kind) ||
            !validLinkId(kind as LinkKind, id.toLowerCase())
          ) {
            ctx.addIssue({ code: "custom", message: `Not a link: ${part}` });
            return z.NEVER;
          }
          refs.push({ kind: kind as LinkKind, id: id.toLowerCase() });
        }
        if (refs.length > MAX_RESOLVE) {
          ctx.addIssue({ code: "custom", message: "Too many links at once" });
          return z.NEVER;
        }
        return refs;
      }),
  })
  .strict();

/** The `refs` query value for a set of links, each once. */
export const resolveRefs = (refs: ObjectRef[]): string =>
  [...new Set(refs.map((r) => `${r.kind}:${r.id.toLowerCase()}`))].join(",");
