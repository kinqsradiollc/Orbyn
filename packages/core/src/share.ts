/**
 * Sharing into Orbyn from other apps (the phone's share sheet): a link or
 * some text, and where it should go — an Inbox task "Read: <title>", today's
 * agenda, a page, a new page in a folder, or a project. And the words and
 * lines each of those is made of, so the server and both apps agree.
 */
import { AGENDA_NOTES_ID, agendaNotesAt } from "./agenda.js";
import { linkTarget } from "./doc-editing.js";
import type { DocBlock } from "./docs.js";
import { decodeHtml, textToBlocks } from "./paste.js";
import type { z } from "zod";
import type { captureDestination, captureInput } from "./schemas.js";
import type { Item } from "./types.js";

/** A share as the app sends it (POST /capture). */
export type CaptureRequest = z.input<typeof captureInput>;
/** Where a share goes. */
export type CaptureDestination = z.output<typeof captureDestination>;

/** A link's title and site, looked up on the server (POST /capture/preview). */
export type LinkPreview = { url: string; title: string | null; site: string };

/** What a share became: the task, or the page it went on. */
export type CaptureResult = {
  to: CaptureDestination["kind"];
  /** One sentence saying where it went, for a toast. */
  note: string;
  item?: Item;
  doc?: { id: string; title: string };
};

/** The longest title a task or page takes. */
const TITLE_MAX = 200;
/** The most shared text kept. */
export const SHARE_TEXT_MAX = 10_000;

const clip = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

/** A web address in some text: the first one. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/i;

/** What was shared, as the share sheet hands it over. */
export type SharedPayload = { text?: string | null; url?: string | null };

/** What was shared, read: the link (if any) and the words that came with it. */
export type SharedContent = { url: string | null; text: string };

/**
 * Read what another app shared. A browser shares a link (and sometimes the
 * page's title as text); a social app shares text with a link inside it.
 * The first web address found is the link; the text is what's left, without
 * the address repeated in it.
 */
export function readShared(payloads: SharedPayload[]): SharedContent {
  let url: string | null = null;
  const texts: string[] = [];
  for (const p of payloads) {
    const given = p.url?.trim();
    if (!url && given && /^https?:\/\/\S+$/i.test(given)) url = given;
    if (p.text?.trim()) texts.push(p.text.trim());
  }
  let text = texts.join("\n\n");
  if (!url) url = URL_IN_TEXT.exec(text)?.[0] ?? null;
  if (url) {
    // The address itself isn't worth keeping twice.
    text = text
      .split(url)
      .join(" ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }
  return { url, text: clip(text, SHARE_TEXT_MAX) };
}

/** "https://www.bbc.co.uk/news/1" as "bbc.co.uk": the site a link is on. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/** Words for a title: one line, no runs of spaces, not too long. */
export const cleanTitle = (title: string | null | undefined) =>
  clip((title ?? "").replace(/\s+/g, " ").trim(), TITLE_MAX);

/**
 * A page's title and site from the start of its HTML: its og:title (or the
 * <title>), and its og:site_name (or its address's host). Null title when
 * the page doesn't give one.
 */
export function readLinkPreview(
  html: string,
  url: string,
): { title: string | null; site: string } {
  const head = html.slice(0, 200_000);
  const meta = (name: string) => {
    for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
      const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (key?.toLowerCase() !== name) continue;
      const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
      const value = content?.[1] ?? content?.[2];
      if (value?.trim()) return value;
    }
    return null;
  };
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? null;
  const raw = meta("og:title") ?? meta("twitter:title") ?? titleTag;
  const title = raw ? cleanTitle(decodeHtml(raw)) : "";
  const siteName = meta("og:site_name");
  const site = siteName ? cleanTitle(decodeHtml(siteName)) : siteOf(url);
  return { title: title || null, site: site || siteOf(url) };
}

/** "Read: <title>", the Inbox task a shared link becomes. */
export const readingTitle = (title: string | null, url: string) =>
  clip(`Read: ${cleanTitle(title) || siteOf(url) || url}`, TITLE_MAX);

/** What a share turns into, once its title is known. */
export type Capture = {
  url: string | null;
  /** The linked page's title, if it has one. */
  title: string | null;
  text: string;
};

/**
 * The task a share becomes (Inbox, or a project): a link is "Read: <title>"
 * with the link on the task and any words as its notes; text alone takes
 * its first line as the title and keeps the rest.
 */
export function captureTask(c: Capture): {
  title: string;
  notes: string;
  links: { url: string; title: string }[];
} {
  if (c.url)
    return {
      title: readingTitle(c.title, c.url),
      notes: c.text,
      links: [
        { url: c.url, title: cleanTitle(c.title) || siteOf(c.url) || "" },
      ],
    };
  const lines = c.text.split("\n").map((l) => l.trim());
  const first = lines.findIndex(Boolean);
  if (first < 0) return { title: "Shared", notes: "", links: [] };
  const line = lines[first].replace(/\s+/g, " ");
  // A first line too long for a title keeps all of its words in the notes.
  const notes =
    line.length > TITLE_MAX
      ? c.text.trim()
      : lines
          .slice(first + 1)
          .join("\n")
          .trim();
  return { title: cleanTitle(line), notes, links: [] };
}

/** The link as a page line holds it: "[Title](address)". */
function linkWords(c: Capture): string | null {
  if (!c.url) return null;
  const target = linkTarget(c.url);
  if (!target) return null;
  const words =
    cleanTitle(c.title).replace(/[[\]]/g, "") || siteOf(c.url) || target;
  return `[${words}](${target})`;
}

/**
 * The lines a share adds to a page: the link, then the words shared with
 * it. `list` writes them as list items (today's agenda, where notes are a
 * list), otherwise as plain lines.
 */
export function captureBlocks(c: Capture, list = false): DocBlock[] {
  const link = linkWords(c);
  const words = c.text.trim() ? textToBlocks(c.text, true) : [];
  const lines: DocBlock[] = [
    ...(link ? [{ type: "paragraph", text: link } as DocBlock] : []),
    ...words,
  ];
  if (!list) return lines;
  return lines.map((b) =>
    b.type === "paragraph" ? { type: "bullet", text: b.text } : b,
  );
}

/** The title of a new page made from a share. */
export const capturePageTitle = (c: Capture) =>
  cleanTitle(c.title) ||
  (c.url ? siteOf(c.url) : "") ||
  cleanTitle(c.text.split("\n").find((l) => l.trim()) ?? "") ||
  "Shared";

/**
 * Today's agenda with shared lines added at the end of its Notes, before
 * whatever follows them (the end-of-day questions). A page that lost its
 * Notes heading gets one back at the end, so a rewrite keeps the lines.
 */
export function addToAgendaNotes(
  blocks: DocBlock[],
  added: DocBlock[],
): DocBlock[] {
  const notes = agendaNotesAt(blocks);
  if (notes < 0)
    return [
      ...blocks,
      { type: "heading", level: 2, text: "Notes", id: AGENDA_NOTES_ID },
      ...added,
    ];
  let end = notes + 1;
  while (end < blocks.length && blocks[end].type !== "heading") end++;
  // Tucked in after the last line with words, not after trailing blanks.
  let at = end;
  while (
    at > notes + 1 &&
    blocks[at - 1].type === "paragraph" &&
    !(blocks[at - 1] as { text: string }).text.trim()
  )
    at--;
  return [...blocks.slice(0, at), ...added, ...blocks.slice(at)];
}

/** Where a share goes, as the share sheet remembers it for next time. */
export type ShareChoice =
  | { kind: "inbox" }
  | { kind: "agenda" }
  | { kind: "page"; id: string; label: string }
  | { kind: "new_page"; id: string | null; label: string }
  | { kind: "project"; id: string; label: string };

/** One key per destination, so a chip isn't remembered twice. */
export const choiceKey = (c: ShareChoice) =>
  "id" in c ? `${c.kind}:${c.id ?? ""}` : c.kind;

/** The words on a remembered destination's chip. */
export const choiceLabel = (c: ShareChoice) =>
  c.kind === "inbox"
    ? "Inbox"
    : c.kind === "agenda"
      ? "Today’s agenda"
      : c.kind === "new_page"
        ? `New page in ${c.label}`
        : c.label;

/** Most destinations remembered as chips. */
export const SHARE_CHOICES_KEPT = 3;

/** The last three destinations, the newest first, each once. */
export function rememberChoice(
  kept: ShareChoice[],
  next: ShareChoice,
): ShareChoice[] {
  const key = choiceKey(next);
  return [next, ...kept.filter((c) => choiceKey(c) !== key)].slice(
    0,
    SHARE_CHOICES_KEPT,
  );
}

/** Remembered destinations as they were kept, leaving out anything unreadable. */
export function readChoices(raw: string | null): ShareChoice[] {
  let list: unknown;
  try {
    list = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const uuid = (v: unknown): v is string =>
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const label = (v: unknown) =>
    typeof v === "string" && v.trim() ? cleanTitle(v) : null;
  const out: ShareChoice[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const { kind, id, label: l } = c as Record<string, unknown>;
    if (kind === "inbox" || kind === "agenda") out.push({ kind });
    else if ((kind === "page" || kind === "project") && uuid(id) && label(l))
      out.push({ kind, id, label: label(l)! });
    else if (kind === "new_page" && (id === null || uuid(id)) && label(l))
      out.push({ kind, id, label: label(l)! });
  }
  return out.slice(0, SHARE_CHOICES_KEPT);
}
