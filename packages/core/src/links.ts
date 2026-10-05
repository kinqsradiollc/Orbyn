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
import {
  parseDocInline,
  docReferenceLinks,
  docReferenceDefinition,
  docReferenceSpans,
  plainText,
  type DocBlock,
  type DocHeadingLevel,
} from "./docs.js";

import { docInlineLinks } from "./doc-inline-links.js";
import { docInlineLiterals } from "./doc-inline-literals.js";

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

/**
 * One thing a link points to. A date's id is its day, `2026-09-26`. A link
 * to one heading or line of a page (LNK-04) carries that line's id as
 * `block`; the page is still what it points to.
 */
export type ObjectRef = { kind: LinkKind; id: string; block?: string };

/** The shape of a line's id in a link (`#b…`). */
export const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `id` is the right shape for a link of this kind. */
export const validLinkId = (kind: LinkKind, id: string): boolean =>
  kind === "date"
    ? DAY.test(id) && !isNaN(Date.parse(`${id}T00:00:00Z`))
    : UUID.test(id);

/** The address a link is stored with. */
export const linkHref = (ref: ObjectRef): string =>
  `orbyn://${ref.kind}/${ref.id.toLowerCase()}${
    ref.kind === "doc" && ref.block && BLOCK_ID.test(ref.block)
      ? `#${ref.block}`
      : ""
  }`;

/** The thing an `orbyn://` link points to, or null for any other link. */
export function parseObjectHref(
  href: string | null | undefined,
): ObjectRef | null {
  const m =
    /^orbyn:\/\/([a-z]+)\/([^/?#\s]+)(?:#([A-Za-z0-9_-]{1,64}))?$/i.exec(
      href ?? "",
    );
  if (!m) return null;
  const kind = m[1].toLowerCase() as LinkKind;
  if (!(LINK_KINDS as readonly string[]).includes(kind)) return null;
  // Only a page has lines to point at.
  if (m[3] && kind !== "doc") return null;
  const id = m[2].toLowerCase();
  if (!validLinkId(kind, id)) return null;
  return m[3] ? { kind, id, block: m[3] } : { kind, id };
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
  if (app?.kind === "doc")
    return app.block
      ? { kind: "doc", id: app.id, block: app.block }
      : { kind: "doc", id: app.id };
  return app && (app.kind === "task" || app.kind === "project")
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
  const references = docReferenceLinks(blocks);
  blocks.forEach((b, n) => {
    if (b.type === "code" || b.type === "math" || b.type === "divider") return;
    for (const run of parseDocInline(b.text, references)) {
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
  references?: ReadonlyMap<string, string>,
): LinkContext {
  const runs = parseDocInline(source ?? "", references);
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
 * "/" typed at the start of a line or after a space, and the letters after
 * it up to the caret (MOB-13): the phone offers the kinds of line under the
 * line being edited. Null once anything but letters, digits or a space
 * follows, or past 24 characters, so a slash in "and/or" or a web address
 * stays plain text.
 */
export function slashQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const upTo = text.slice(0, caret);
  const m = /(^|\s)\/([a-z0-9 ]{0,24})$/i.exec(upTo);
  if (!m) return null;
  const query = m[2];
  // Two spaces in a row, or a trailing space before any letter, ends it.
  if (/^\s|\s\s/.test(query)) return null;
  return { start: upTo.length - query.length - 1, query };
}

/**
 * Whether a choice in the "/" list answers what was typed: every word is at
 * the start of a word in its label, or in its other words.
 */
export function slashMatches(
  query: string,
  choice: { label: string; keywords?: string },
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${choice.label} ${choice.keywords ?? ""}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.every((w) => hay.some((h) => h.startsWith(w)));
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
  return replaceObjectLinks(text, (whole, label, href, match) => {
    const ref = parseObjectHref(href);
    if (!ref) return whole;
    if (ref.kind === "person") return label;
    if (ref.kind === "date") return dateTitle(ref.id);
    const kind = ref.kind === "event" ? "task" : ref.kind;
    const line = ref.block ? `#${ref.block}` : "";
    return `[${label}](${base}/app/${kind}/${ref.id}${line}${titleSuffix(match.title)})`;
  });
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
    /orbyn:\/\//i.test(b.text)
      ? { ...b, text: webLinks(b.text, origin) }
      : b,
  );

/** Export safe labels without retaining private destination IDs or definition names. */
export function blocksWithExportLinks(
  blocks: DocBlock[],
  origin: string,
  hidden: (ref: ObjectRef) => boolean,
): DocBlock[] {
  const visible = redactDocumentReferences(blocks, hidden);
  const references = docReferenceLinks(visible);
  const publicBlocks = visible.map((block) => {
    if (
      block.type === "code" ||
      block.type === "math" ||
      block.type === "divider"
    )
      return block;
    const definition = docReferenceDefinition(block.text);
    const destination = definition && refFromUrl(definition.href);
    if (destination && destination.kind !== "date" && hidden(destination))
      return { ...block, text: "" };
    let at = 0;
    const parts: string[] = [];
    for (const span of docReferenceSpans(block.text, references)) {
      const ref = refFromUrl(span.href);
      if (!ref || ref.kind === "date" || !hidden(ref)) continue;
      parts.push(
        block.text.slice(at, span.start),
        PRIVATE_LINK_LABELS[ref.kind],
      );
      at = span.end;
    }
    const text = at ? parts.join("") + block.text.slice(at) : block.text;
    return {
      ...block,
      text: replaceObjectLinks(text, (whole, label, href) => {
        const ref = refFromUrl(href);
        return ref && ref.kind !== "date" && hidden(ref)
          ? PRIVATE_LINK_LABELS[ref.kind]
          : whole;
      }),
    };
  });
  return blocksWithWebLinks(publicBlocks, origin);
}

// --------------------------------------------------------------- privacy ---

/**
 * What a link's words say to a reader who can't open the thing it points
 * to. A picker link keeps the title it had when it was made in its
 * brackets, so a page shared with a team can carry the title of someone's
 * private page or of another team's task. Every place that shows a page's
 * words to a reader swaps those words for these first; nothing in them
 * comes from the thing's id, so they tell the reader nothing about it.
 */
export const PRIVATE_LINK_LABELS: Record<LinkKind, string> = {
  doc: "Private page",
  task: "Private task",
  event: "Private event",
  project: "Private project",
  person: "Someone",
  date: "Date",
};

/** Reference privacy is scoped to a single structured page, never a batch of pages. */
function documentBlocks(value: unknown): value is DocBlock[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (block) =>
        block &&
        typeof block === "object" &&
        typeof block.type === "string" &&
        (block.type === "divider" || typeof block.text === "string"),
    )
  );
}

function privateReference(ref: ObjectRef): string {
  return `private-${targetKey(ref)}`;
}

function redactDocumentReferences(
  blocks: DocBlock[],
  hidden: (ref: ObjectRef) => boolean,
): DocBlock[] {
  const references = docReferenceLinks(blocks);
  let changed = false;
  const result = blocks.map((block) => {
    if (
      block.type === "code" ||
      block.type === "math" ||
      block.type === "divider"
    )
      return block;
    const text = redactLine(block.text, hidden, references).text;
    if (text === block.text) return block;
    changed = true;
    return { ...block, text } as DocBlock;
  });
  return changed ? result : blocks;
}

/** Restore only server-generated private placeholders against the original page. */
function keepDocumentReferenceLabels(
  next: DocBlock[],
  before: DocBlock[],
  hidden: (ref: ObjectRef) => boolean,
): DocBlock[] {
  const originalReferences = docReferenceLinks(before);
  const nextReferences = docReferenceLinks(next);
  for (const href of originalReferences.values()) {
    const ref = parseObjectHref(href);
    if (ref && hidden(ref)) nextReferences.set(privateReference(ref), href);
  }
  const projection = redactDocumentReferences(before, hidden);
  let changed = false;
  const result = next.map((block, index) => {
    if (
      block.type === "code" ||
      block.type === "math" ||
      block.type === "divider"
    )
      return block;
    const originalIndex = block.id
      ? before.findIndex((old) => old.id === block.id)
      : index;
    const original = before[originalIndex];
    const projected = projection[originalIndex];
    if (
      !original ||
      original.type === "divider" ||
      !projected ||
      projected.type === "divider"
    )
      return block;
    let text = block.text;
    if (text === projected.text && text !== original.text) text = original.text;
    else {
      const sources = new Map<string, string[]>();
      for (const span of docReferenceSpans(original.text, originalReferences)) {
        const ref = parseObjectHref(span.href);
        if (!ref || !hidden(ref)) continue;
        const key = targetKey(ref);
        const list = sources.get(key) ?? [];
        list.push(original.text.slice(span.start, span.end));
        sources.set(key, list);
      }
      // Work in source order to preserve multiple different labels for one target.
      let at = 0;
      const pieces: string[] = [];
      for (const span of docReferenceSpans(text, nextReferences)) {
        const ref = parseObjectHref(span.href);
        if (
          !ref ||
          !hidden(ref) ||
          span.reference !== privateReference(ref) ||
          span.label !== PRIVATE_LINK_LABELS[ref.kind]
        )
          continue;
        const source = sources.get(targetKey(ref))?.shift();
        if (!source) continue;
        pieces.push(text.slice(at, span.start), source);
        at = span.end;
      }
      if (at) text = pieces.join("") + text.slice(at);
    }
    if (text === block.text) return block;
    changed = true;
    return { ...block, text } as DocBlock;
  });
  return changed ? result : next;
}

function restoreReferenceValues(
  next: unknown,
  before: unknown,
  hidden: (ref: ObjectRef) => boolean,
): unknown {
  if (documentBlocks(next) && documentBlocks(before))
    return keepDocumentReferenceLabels(next, before, hidden);
  if (Array.isArray(next) && Array.isArray(before)) {
    let copy: unknown[] | null = null;
    next.forEach((value, index) => {
      const restored = restoreReferenceValues(value, before[index], hidden);
      if (restored !== value) (copy ??= next.slice())[index] = restored;
    });
    return copy ?? next;
  }
  if (
    next &&
    before &&
    typeof next === "object" &&
    typeof before === "object" &&
    !(next instanceof Date)
  ) {
    let copy: Record<string, unknown> | null = null;
    for (const [key, value] of Object.entries(next)) {
      const restored = restoreReferenceValues(
        value,
        (before as Record<string, unknown>)[key],
        hidden,
      );
      if (restored !== value) (copy ??= { ...next })[key] = restored;
    }
    return copy ?? next;
  }
  return next;
}

/** A picker link in a line's words: `[words](orbyn://kind/id)`. */
type ObjectLinkMatch = [string, string, string] & {
  index: number;
  labelEnd: number;
  title?: string;
};

/** The same balanced syntax rendered by Docs, excluding literal code, math and escaped markers. */
function objectLinkMatches(text: string): ObjectLinkMatch[] {
  const masked = text.split("");
  for (const literal of docInlineLiterals(text))
    for (let at = literal.start; at < literal.end; at++)
      masked[at] = literal.run.break ? " " : "x";
  return docInlineLinks(masked.join(""), text)
    .filter((link) => !link.image && parseObjectHref(link.href) !== null)
    .map((link) =>
      Object.assign(
        [
          text.slice(link.start, link.end),
          text.slice(link.labelStart, link.labelEnd),
          link.href,
        ] as [string, string, string],
        {
          index: link.start,
          labelEnd: link.labelEnd,
          ...(link.title !== undefined ? { title: link.title } : {}),
        },
      ),
    );
}

const titleSuffix = (title?: string) =>
  title === undefined
    ? ""
    : ` "${title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function replaceObjectLinks(
  text: string,
  replace: (
    whole: string,
    label: string,
    href: string,
    match: ObjectLinkMatch,
  ) => string,
): string {
  let at = 0;
  const parts: string[] = [];
  for (const match of objectLinkMatches(text)) {
    parts.push(
      text.slice(at, match.index),
      replace(match[0], match[1], match[2], match),
    );
    at = match.index + match[0].length;
  }
  return parts.join("") + text.slice(at);
}

/** The key a link's target is judged by: the thing, never one line of it. */
export const targetKey = (r: ObjectRef): string =>
  `${r.kind === "event" ? "task" : r.kind}:${r.id.toLowerCase()}`;

/** Every thing the picker links in `text` point to (with repeats). */
export function objectRefsIn(text: string): ObjectRef[] {
  const out: ObjectRef[] = [];
  if (!/orbyn:\/\//i.test(text)) return out;
  const definition = docReferenceDefinition(text);
  const target = definition && parseObjectHref(definition.href);
  if (target) out.push(target);
  for (const m of objectLinkMatches(text)) {
    const ref = parseObjectHref(m[2]);
    if (ref) out.push(ref);
  }
  return out;
}

/** One link's words as written, and as a reader is shown them. */
type LabelSwap = {
  /** Where the words start and end in the stored line. */
  from: number;
  to: number;
  /** Where they start and end in the line as shown. */
  viewFrom: number;
  viewTo: number;
};

/**
 * A line as one reader sees it: the words of each link to something
 * `hidden` says they can't open swapped for {@link PRIVATE_LINK_LABELS},
 * with a way to carry a place in the line between the two (for comments
 * and proposals made on the words shown).
 */
export type RedactedLine = {
  text: string;
  changed: boolean;
  /** A place in the shown line, as a place in the stored one. */
  toStored(at: number, end?: boolean): number;
  /** A place in the stored line, as a place in the shown one. */
  toShown(at: number, end?: boolean): number;
};

export function redactLine(
  text: string,
  hidden: (ref: ObjectRef) => boolean,
  references?: ReadonlyMap<string, string>,
): RedactedLine {
  const swaps: LabelSwap[] = [];
  const changes: { from: number; to: number; text: string }[] = [];
  let out = "";
  let last = 0;
  const definition = docReferenceDefinition(text);
  const definedTarget = definition && parseObjectHref(definition.href);
  if (definedTarget && definedTarget.kind !== "date" && hidden(definedTarget)) {
    const replacement = `[${privateReference(definedTarget)}]: ${definition!.href}`;
    if (replacement !== text)
      changes.push({ from: 0, to: text.length, text: replacement });
  } else {
    if (/orbyn:\/\//i.test(text))
      for (const m of objectLinkMatches(text)) {
        const ref = parseObjectHref(m[2]);
        if (!ref || ref.kind === "date" || !hidden(ref)) continue;
        const label = PRIVATE_LINK_LABELS[ref.kind];
        if (m[1] !== label)
          changes.push({ from: m.index + 1, to: m.labelEnd, text: label });
        if (m.title !== undefined)
          changes.push({
            from: m.labelEnd + 1,
            to: m.index + m[0].length,
            text: `(${m[2]})`,
          });
      }
    if (references)
      for (const span of docReferenceSpans(text, references)) {
        const ref = parseObjectHref(span.href);
        if (!ref || ref.kind === "date" || !hidden(ref)) continue;
        const from = span.start + 1;
        const to = from + span.label.length;
        if (span.label !== PRIVATE_LINK_LABELS[ref.kind])
          changes.push({ from, to, text: PRIVATE_LINK_LABELS[ref.kind] });
        const tail = `][${privateReference(ref)}]`;
        if (text.slice(to, span.end) !== tail)
          changes.push({ from: to, to: span.end, text: tail });
      }
  }
  for (const change of changes.sort((a, b) => a.from - b.from)) {
    if (change.from < last) continue;
    out += text.slice(last, change.from);
    const viewFrom = out.length;
    out += change.text;
    swaps.push({
      from: change.from,
      to: change.to,
      viewFrom,
      viewTo: out.length,
    });
    last = change.to;
  }
  if (!swaps.length)
    return {
      text,
      changed: false,
      toStored: (at) => at,
      toShown: (at) => at,
    };
  out += text.slice(last);
  const move = (
    at: number,
    end: boolean,
    a: (s: LabelSwap) => [number, number],
    b: (s: LabelSwap) => [number, number],
  ) => {
    let shift = 0;
    for (const s of swaps) {
      const [aFrom, aTo] = a(s);
      const [bFrom, bTo] = b(s);
      if (at <= aFrom) break;
      if (at >= aTo) {
        shift = bTo - aTo;
        continue;
      }
      // Inside a link's words: the whole of them.
      return end ? bTo : bFrom;
    }
    return at + shift;
  };
  const stored = (s: LabelSwap): [number, number] => [s.from, s.to];
  const shown = (s: LabelSwap): [number, number] => [s.viewFrom, s.viewTo];
  return {
    text: out,
    changed: true,
    toStored: (at, end = false) => move(at, end, shown, stored),
    toShown: (at, end = false) => move(at, end, stored, shown),
  };
}

/** {@link redactLine}'s words alone. */
export const redactLinkLabels = (
  text: string,
  hidden: (ref: ObjectRef) => boolean,
): string => redactLine(text, hidden).text;

/**
 * Every string in a value (a page's lines, a comment, a search hit) with
 * {@link redactLinkLabels} applied. Only strings that hold a link are
 * copied; the rest of the value is shared, never changed in place.
 */
export function redactValue<T>(
  value: T,
  hidden: (ref: ObjectRef) => boolean,
): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string")
      return /orbyn:\/\//i.test(v) ? redactLinkLabels(v, hidden) : v;
    if (Array.isArray(v)) {
      const projected = documentBlocks(v)
        ? redactDocumentReferences(v, hidden)
        : v;
      let copy: unknown[] | null = projected !== v ? projected.slice() : null;
      projected.forEach((x, i) => {
        const y = walk(x);
        if (y !== x) (copy ??= v.slice())[i] = y;
      });
      return copy ?? v;
    }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      let copy: Record<string, unknown> | null = null;
      for (const [k, x] of Object.entries(v)) {
        const y = walk(x);
        if (y !== x) (copy ??= { ...(v as Record<string, unknown>) })[k] = y;
      }
      return copy ?? v;
    }
    return v;
  };
  return walk(value) as T;
}

/** Every link target named in any string of a value, each once. */
export function objectRefsInValue(value: unknown): ObjectRef[] {
  const found = new Map<string, ObjectRef>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      for (const r of objectRefsIn(v))
        found.set(targetKey(r), { kind: r.kind, id: r.id });
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object" && !(v instanceof Date))
      Object.values(v).forEach(walk);
  };
  walk(value);
  return [...found.values()];
}

/**
 * A save from someone who was shown "Private page" in place of a link's
 * words hands those words back. Keep the words the page had for that link
 * instead, so the people who can open it still read its title.
 * `before` is the stored value (a page's lines, or one line).
 *
 * `shownPrivate` says which links the saver was shown as "Private page"
 * (their {@link redactLine} rule). Only those are put back: someone who can
 * open a target and writes "Private page" as its words on purpose keeps
 * them. Left out, every such link is put back.
 */
export function keepLinkLabels<T>(
  next: T,
  before: unknown,
  shownPrivate: (ref: ObjectRef) => boolean = () => true,
  blockId?: string | null,
): T {
  if (typeof next === "string" && documentBlocks(before) && blockId) {
    const original = before.find((block) => block.id === blockId);
    if (original && original.type !== "divider") {
      const restored = keepDocumentReferenceLabels(
        [{ ...original, text: next }],
        before,
        shownPrivate,
      );
      next = restored[0].type === "divider" ? next : (restored[0].text as T);
    }
  }
  next = restoreReferenceValues(next, before, shownPrivate) as T;
  const labels = new Map<
    string,
    { label: string; title?: string; href: string; source: string }
  >();
  const collect = (v: unknown) => {
    if (typeof v === "string") {
      if (!/orbyn:\/\//i.test(v)) return;
      for (const m of objectLinkMatches(v)) {
        const ref = parseObjectHref(m[2]);
        if (!ref || m[1] === PRIVATE_LINK_LABELS[ref.kind]) continue;
        const key = targetKey(ref);
        if (!labels.has(key))
          labels.set(key, {
            label: m[1],
            href: m[2],
            source: m[0],
            ...(m.title !== undefined ? { title: m.title } : {}),
          });
      }
    } else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  collect(before);
  if (!labels.size) return next;
  const fix = (v: unknown): unknown => {
    if (typeof v === "string")
      return /orbyn:\/\//i.test(v)
        ? replaceObjectLinks(v, (whole, label, href) => {
            const ref = parseObjectHref(href);
            if (!ref || label !== PRIVATE_LINK_LABELS[ref.kind]) return whole;
            if (!shownPrivate(ref)) return whole;
            const kept = labels.get(targetKey(ref));
            if (!kept) return whole;
            return kept.href === href
              ? kept.source
              : `[${kept.label}](${href}${titleSuffix(kept.title)})`;
          })
        : v;
    if (Array.isArray(v)) {
      let copy: unknown[] | null = null;
      v.forEach((x, i) => {
        const y = fix(x);
        if (y !== x) (copy ??= v.slice())[i] = y;
      });
      return copy ?? v;
    }
    if (v && typeof v === "object") {
      let copy: Record<string, unknown> | null = null;
      for (const [k, x] of Object.entries(v)) {
        const y = fix(x);
        if (y !== x) (copy ??= { ...(v as Record<string, unknown>) })[k] = y;
      }
      return copy ?? v;
    }
    return v;
  };
  return fix(next) as T;
}

/**
 * The words hidden links carry in `value`, each with what a reader is shown
 * instead ("Zebra Secret" → "Private page"), for {@link redactQuote}.
 */
export function hiddenLinkLabels(
  value: unknown,
  hidden: (ref: ObjectRef) => boolean,
): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (v: unknown) => {
    if (documentBlocks(v)) {
      const references = docReferenceLinks(v);
      for (const block of v) {
        if (
          block.type === "divider" ||
          block.type === "code" ||
          block.type === "math"
        )
          continue;
        for (const span of docReferenceSpans(block.text, references)) {
          const ref = parseObjectHref(span.href);
          if (ref && ref.kind !== "date" && hidden(ref) && span.label.trim())
            out.set(span.label, PRIVATE_LINK_LABELS[ref.kind]);
        }
        const definition =
          block.type === "paragraph"
            ? docReferenceDefinition(block.text)
            : null;
        const ref = definition && parseObjectHref(definition.href);
        if (definition && ref && ref.kind !== "date" && hidden(ref)) {
          out.set(definition.label, PRIVATE_LINK_LABELS[ref.kind]);
          if (definition.title?.trim())
            out.set(definition.title, PRIVATE_LINK_LABELS[ref.kind]);
        }
      }
    }
    if (typeof v === "string") {
      if (!/orbyn:\/\//i.test(v)) return;
      for (const m of objectLinkMatches(v)) {
        const ref = parseObjectHref(m[2]);
        if (!ref || ref.kind === "date" || !hidden(ref)) continue;
        const label = PRIVATE_LINK_LABELS[ref.kind];
        if (m[1] !== label && m[1].trim()) {
          out.set(m[1], label);
          const visible = plainText(m[1]);
          if (visible.trim()) out.set(visible, label);
        }
        if (m.title?.trim()) out.set(m.title, label);
      }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object" && !(v instanceof Date))
      Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}

/** A link cut off before its closing parenthesis, at the end of words. */
const CUT_LINK = /\[([^\]\n]+)\]\((orbyn:\/\/[^)\s]*)$/;

/** The shortest piece of a hidden link's words treated as naming it. */
const LABEL_PIECE = 4;

/**
 * Words quoted from a page (a remark's or a proposal's `quote`) as a reader
 * may see them, when they can't be read off the reader's own line: the
 * line has gone, or the words no longer match it, or the quote was cut
 * short (a whole line's first 400 characters). Whole links to what the
 * reader can't open read "Private page"; a link cut off mid-address counts
 * as hidden unless its target (whole, or the one page link in `known`
 * its address began) is open to them — when no link in `known` begins
 * that address, it reads "Private page" even to someone who could open it,
 * since only the address's first characters are left to go on; any of
 * `labels`
 * (from {@link hiddenLinkLabels}) is swapped wherever it appears. Words
 * that begin or end partway into one of them, or lie inside one, can't be
 * told apart from it, so the quote is dropped (null).
 */
export function redactQuote(
  quote: string | null | undefined,
  hidden: (ref: ObjectRef) => boolean,
  labels: Map<string, string>,
  /** The links on the page, to tell whose address a cut-off link began. */
  known: ObjectRef[] = [],
): string | null {
  if (quote == null) return null;
  let q = redactLinkLabels(quote, hidden);
  const cut = CUT_LINK.exec(q);
  if (cut) {
    const begun = known.filter((r) =>
      `orbyn://${r.kind}/${r.id}`.startsWith(cut[2].toLowerCase()),
    );
    const ref =
      parseObjectHref(cut[2]) ??
      (begun.length && begun.every((r) => !hidden(r)) ? begun[0] : null);
    const kind =
      ref?.kind ??
      (LINK_KINDS as readonly string[]).find((k) =>
        cut[2].startsWith(`orbyn://${k}/`),
      ) ??
      "doc";
    if (!ref || hidden(ref)) {
      const label = PRIVATE_LINK_LABELS[kind as LinkKind];
      q = `${q.slice(0, cut.index)}[${label}](${cut[2]}`;
    }
  }
  if (!labels.size) return q;
  // Longest first, so a title holding another is swapped whole.
  const byLength = [...labels].sort((a, b) => b[0].length - a[0].length);
  for (const [words, label] of byLength) q = q.split(words).join(label);
  const shown = new Set(labels.values());
  for (const [words] of byLength) {
    if (q.length >= LABEL_PIECE && !shown.has(q) && words.includes(q))
      return null;
    for (let k = Math.min(words.length - 1, q.length); k >= LABEL_PIECE; k--)
      if (q.endsWith(words.slice(0, k)) || q.startsWith(words.slice(-k)))
        return null;
  }
  return q;
}

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
  /** For a link to one line of a page (LNK-04): the line's id and words. */
  block?: string;
  /** The heading or line's words as they read now; null once it's gone. */
  block_title?: string | null;
  /**
   * A page merged into another (ORG-05): the page it went into, which the
   * pill opens and whose title it shows.
   */
  moved_to?: string;
};

/**
 * What a hover card on a link shows (LNK-07, GET /links/card): enough to
 * tick, reschedule or open the thing without leaving the page.
 *
 * - a page: its folder, project and first lines (or the linked line);
 * - a task: its tick, deadline, estimate, project and your next session;
 * - an event: its time, and the meeting note it has;
 * - a project: how far along it is and the next task due.
 */
export type LinkCard = {
  kind: "doc" | "task" | "event" | "project";
  id: string;
  state: "ok" | "deleted" | "missing";
  title: string | null;
  /** Whether you may change it (tick, reschedule). */
  can_write: boolean;
  /** Its project, when it has one. */
  project?: { id: string; name: string } | null;
  // A page.
  /** The merged page the link named, when this is the page it went into. */
  moved_from?: string;
  folder?: string | null;
  /** "Page", "Note", "Meeting note" or "Agenda". */
  kind_label?: string;
  /** Its first lines, or the linked line's section, as words. */
  preview?: string;
  /** The linked heading or line's words, for a link to one line. */
  section?: string | null;
  // A task.
  done?: boolean;
  due_at?: string | null;
  all_day?: boolean;
  estimate_minutes?: number | null;
  /** Your next session on it, if one is planned. */
  planned?: { start_at: string; end_at: string } | null;
  /** A repeating task moves its dates from the task itself. */
  repeats?: boolean;
  /** Your account's time zone, for moving a task's deadline by day. */
  time_zone?: string;
  // An event.
  start_at?: string | null;
  end_at?: string | null;
  /** The meeting note it has, to open; null when it has none yet. */
  note_id?: string | null;
  // A project.
  progress?: { done: number; total: number };
  next?: { id: string; title: string; due_at: string | null } | null;
  /** The project's latest date for its tasks. */
  deadline?: string | null;
};

/** GET /links/card: one link's hover card. */
export const linkCardQuery = z
  .object({
    kind: z.enum(["doc", "task", "event", "project"]),
    id: z.uuid(),
    block: z.string().regex(BLOCK_ID).optional(),
  })
  .strict();

/**
 * A page that says another's name (or one of its other names) without
 * linking to it (LNK-06): "Mentioned without a link", with the line it says
 * it on, so one click can make the words a link.
 */
export type UnlinkedMention = {
  doc_id: string;
  title: string;
  hint: string | null;
  block_id: string | null;
  /** The name as it was found in the line. */
  matched: string;
  context: LinkContext;
  /** Whether you can change that page (the Link button needs to). */
  can_link: boolean;
};

/** A page that reads like this one (LNK-06 "Related"). */
export type RelatedPage = {
  doc_id: string;
  title: string;
  hint: string | null;
  /** Why it's related, in a few words: "Same tags", "Similar words". */
  reason: string;
};

/** GET /links/mentions and /links/related: for a page or a project. */
export const mentionsQuery = z
  .object({
    kind: z.enum(["doc", "project"]),
    id: z.uuid(),
  })
  .strict();

/**
 * POST /links/mentions/link: make the words a mention found into a link
 * (the page it's in is saved as a new version).
 */
export const linkMentionInput = z
  .object({
    doc_id: z.uuid(),
    block_id: z.string().min(1).max(64),
    matched: z.string().min(1).max(200),
    target: z.object({ kind: z.enum(["doc", "project"]), id: z.uuid() }),
  })
  .strict();

/** A heading or line of a page the link picker can point at (LNK-04). */
export type HeadingOption = {
  /** Null for a line that has no id yet: picking it names it first. */
  block_id: string | null;
  index: number;
  level: DocHeadingLevel | null;
  text: string;
};

/** GET /links/headings: a page's headings, for `[[Page#`. */
export const headingsQuery = z
  .object({
    doc: z.uuid(),
    q: z.string().trim().max(200).default(""),
  })
  .strict();

/** What `[[Page#words` asks for: the page's words and the heading's. */
export function splitHeadingQuery(
  query: string,
): { page: string; heading: string } | null {
  const at = query.indexOf("#");
  if (at < 1) return null;
  return { page: query.slice(0, at).trim(), heading: query.slice(at + 1) };
}

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
          const [kind, rest = ""] = part.split(":");
          const [id, block] = rest.split("#");
          if (
            !(LINK_KINDS as readonly string[]).includes(kind) ||
            !validLinkId(kind as LinkKind, id.toLowerCase()) ||
            (block !== undefined && (kind !== "doc" || !BLOCK_ID.test(block)))
          ) {
            ctx.addIssue({ code: "custom", message: `Not a link: ${part}` });
            return z.NEVER;
          }
          refs.push(
            block
              ? { kind: kind as LinkKind, id: id.toLowerCase(), block }
              : { kind: kind as LinkKind, id: id.toLowerCase() },
          );
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
  [
    ...new Set(
      refs.map(
        (r) =>
          `${r.kind}:${r.id.toLowerCase()}${r.kind === "doc" && r.block ? `#${r.block}` : ""}`,
      ),
    ),
  ].join(",");

/** One key for a link's pill: a thing, or one line of a page. */
export const refKey = (r: ObjectRef): string =>
  `${r.kind === "event" ? "task" : r.kind}:${r.id.toLowerCase()}${
    r.kind === "doc" && r.block ? `#${r.block}` : ""
  }`;

// ---------------------------------------------------------------- mentions ---

/** Letters and digits in any script, for telling where a word ends. */
const WORDISH = /[\p{L}\p{N}_]/u;

/**
 * Where a name is said in a line as words of its own (not part of a longer
 * word), outside links, code and maths: the first such place, or null. The
 * name is matched without regard to case; names shorter than three letters
 * are never looked for, since "AI" or "Q3" would be found everywhere.
 */
export function findMention(
  source: string,
  name: string,
): { start: number; end: number; matched: string } | null {
  const want = name.trim();
  if (want.length < 3) return null;
  const lower = want.toLowerCase();
  for (const run of parseDocInline(source)) {
    if (run.link || run.code || run.math || run.footnote) continue;
    const text = run.text.toLowerCase();
    let at = text.indexOf(lower);
    while (at >= 0) {
      const before = run.text[at - 1];
      const after = run.text[at + want.length];
      if (
        (!before || !WORDISH.test(before)) &&
        (!after || !WORDISH.test(after))
      ) {
        const start = run.start + at;
        return {
          start,
          end: start + want.length,
          matched: source.slice(start, start + want.length),
        };
      }
      at = text.indexOf(lower, at + 1);
    }
  }
  return null;
}

/**
 * The line with the first mention of `matched` made a link to `ref`, or null
 * when the words are no longer there as a mention.
 */
export function linkMention(
  source: string,
  matched: string,
  ref: ObjectRef,
): string | null {
  const found = findMention(source, matched);
  if (!found) return null;
  const words = found.matched.replace(/[[\]]/g, "");
  return (
    source.slice(0, found.start) +
    `[${words}](${linkHref(ref)})` +
    source.slice(found.end)
  );
}

/** Other names as they're kept: trimmed, each once, no more than eight. */
export const MAX_ALIASES = 8;
export const aliasesInput = z
  .array(z.string().trim().min(1).max(80))
  .max(MAX_ALIASES)
  .transform((list) => {
    const seen = new Set<string>();
    return list.filter((a) => {
      const k = a.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });
