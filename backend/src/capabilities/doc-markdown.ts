import {
  docContent,
  isEmbed,
  isLiveList,
  linkMarkdown,
  parseDoc,
  parseEmbed,
  parseLiveList,
  plainText,
  type DocBlock,
} from "@orbyn/core";
import { Params, scopeFor, visibleDocs } from "../lib/visibility.js";
import { CapabilityError, type CapabilityContext } from "./registry.js";

/**
 * Reading the Markdown an agent writes (H3), for create_doc and edit_doc:
 * Orbyn's dialect with anchors (MARKDOWN_SPEC), so callouts, tables,
 * footnotes, diagrams, embeds and live lists become real blocks. On top of
 * what the page itself keeps, `[[Page]]`, `[[Page#Heading]]` and
 * `[[Page#^b…]]` become links to pages (and lines) this connection can
 * read, and pictures and files may only be ones the person can already
 * read. Anything that can't be kept as written is refused with what to
 * change, so a write is all or nothing. Nothing here calls any AI.
 */

/** A page this Markdown goes into, for `[[#Heading]]` and its own files. */
export type MarkdownHome = { id: string; blocks: DocBlock[] } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `[[target#part|shown]]`. */
const WIKI = /\[\[([^\]\n]{1,300}?)\]\]/g;
/** Inline code and maths, where `[[` is just text. */
const LITERAL = /`[^`\n]+`|\$[^$\n]+?\$/g;

/** The most different pages one write may link with `[[ ]]`. */
const MAX_WIKI_TARGETS = 50;

const norm = (s: string) =>
  plainText(s).replace(/\s+/g, " ").trim().toLowerCase();

function invalid(message: string, fix?: string): never {
  throw new CapabilityError("INVALID", message, fix);
}

type Wiki = {
  start: number;
  end: number;
  target: string;
  part: string | null;
  shown: string | null;
};

/** The `[[ ]]` links in a line's words, outside code and maths. */
function wikisIn(text: string): Wiki[] {
  if (!text.includes("[[")) return [];
  const literal = [...text.matchAll(LITERAL)].map((m) => [
    m.index ?? 0,
    (m.index ?? 0) + m[0].length,
  ]);
  const out: Wiki[] = [];
  for (const m of text.matchAll(WIKI)) {
    const start = m.index ?? 0;
    if (literal.some(([a, b]) => start >= a && start < b)) continue;
    const [link, shown] = splitOnce(m[1], "|");
    const [target, part] = splitOnce(link, "#");
    out.push({
      start,
      end: start + m[0].length,
      target: target.trim(),
      part: part?.trim() || null,
      shown: shown?.trim() || null,
    });
  }
  return out;
}

function splitOnce(s: string, sep: string): [string, string | null] {
  const at = s.indexOf(sep);
  return at < 0 ? [s, null] : [s.slice(0, at), s.slice(at + 1)];
}

/** Lines whose words are read as Markdown (not code, maths or cells). */
const hasWords = (b: DocBlock): b is DocBlock & { text: string } =>
  "text" in b &&
  b.type !== "code" &&
  b.type !== "math" &&
  b.type !== "table" &&
  b.type !== "image" &&
  b.type !== "file";

/** The line in `blocks` a link's `#part` names: an anchor, or a heading's words. */
function lineIn(
  blocks: DocBlock[],
  part: string,
  title: string,
): { id: string; heading: string | null } {
  const anchor = part.replace(/^\^/, "");
  const byId = blocks.find((b) => b.id === anchor);
  if (byId) return { id: byId.id!, heading: null };
  const want = norm(part.replace(/^#{1,6}\s+/, ""));
  const heading = blocks.find(
    (b) => b.type === "heading" && b.id && norm(b.text) === want,
  );
  if (!heading)
    invalid(
      `“${title}” has no heading or line “${part}”.`,
      "Fetch that page and link a heading's words or a line's ^b… anchor.",
    );
  return {
    id: heading!.id!,
    heading: plainText((heading as { text: string }).text).trim(),
  };
}

/**
 * `[[ ]]` links made into Orbyn links. A title must name exactly one page
 * this connection can read; `[[#Heading]]` points into `home`.
 */
async function resolveWikis(
  ctx: CapabilityContext,
  blocks: DocBlock[],
  home: MarkdownHome,
): Promise<DocBlock[]> {
  const found = blocks.map((b) => (hasWords(b) ? wikisIn(b.text) : []));
  const all = found.flat();
  if (!all.length) return blocks;
  const titles = new Set<string>();
  const ids = new Set<string>();
  for (const w of all) {
    if (!w.target) continue;
    const bare = w.target.replace(/^doc:/i, "");
    if (UUID.test(bare)) ids.add(bare.toLowerCase());
    else titles.add(w.target.toLowerCase());
  }
  if (titles.size + ids.size > MAX_WIKI_TARGETS)
    invalid(
      `Link at most ${MAX_WIKI_TARGETS} different pages with [[ ]] in one write.`,
    );
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const pages =
    titles.size || ids.size
      ? (
          await ctx.db.query<{
            id: string;
            title: string;
            content: DocBlock[] | null;
          }>(
            `SELECT d.id, d.title, d.content FROM docs d
              WHERE (lower(btrim(d.title)) = ANY (${params.add([...titles])}::text[])
                     OR d.id = ANY (${params.add([...ids])}::uuid[]))
                AND ${visibleDocs("d", scope)}
              ORDER BY d.updated_at DESC`,
            params.values,
          )
        ).rows
      : [];
  const page = (target: string) => {
    const bare = target.replace(/^doc:/i, "");
    if (UUID.test(bare)) {
      const hit = pages.find((p) => p.id === bare.toLowerCase());
      if (!hit)
        invalid(
          `There is no page ${bare} this connection can read.`,
          "Search for the page and use its id.",
        );
      return hit!;
    }
    const hits = pages.filter(
      (p) => p.title.trim().toLowerCase() === target.toLowerCase(),
    );
    if (!hits.length)
      invalid(
        `No page called “${target}” is reachable, so [[${target}]] can't be a link.`,
        "Search for the page, or write the words without [[ ]].",
      );
    if (hits.length > 1)
      invalid(
        `Several pages are called “${target}”: ${hits
          .slice(0, 5)
          .map((p) => `doc:${p.id}`)
          .join(", ")}.`,
        "Write [[doc:<id>]] (or [[doc:<id>#Heading]]) for the one you mean.",
      );
    return hits[0];
  };
  return blocks.map((b, n) => {
    const links = found[n];
    if (!links.length || !hasWords(b)) return b;
    let text = "";
    let at = 0;
    for (const w of links) {
      let id: string;
      let title: string;
      let content: DocBlock[];
      if (!w.target) {
        if (!home)
          invalid(
            "[[#…]] points into this page, which doesn't exist yet.",
            "Make the page first, then add those links with edit_doc.",
          );
        if (!w.part) invalid("[[#]] needs a heading or an anchor after #.");
        id = home!.id;
        title = "";
        content = home!.blocks;
      } else {
        const p = page(w.target);
        id = p.id;
        title = p.title.trim() || "Untitled";
        content = Array.isArray(p.content) ? p.content : [];
      }
      const line = w.part
        ? lineIn(content, w.part, title || "This page")
        : null;
      const words =
        w.shown ??
        ([title, line?.heading].filter(Boolean).join(" › ") || "this page");
      text +=
        b.text.slice(at, w.start) +
        linkMarkdown(
          { kind: "doc", id, ...(line ? { block: line.id } : {}) },
          words,
        );
      at = w.end;
    }
    return { ...b, text: text + b.text.slice(at) };
  });
}

/** An own-line picture from anywhere but Orbyn's file store. */
const OUTSIDE_PICTURE = /^!\[[^\]\n]*\]\((?!orbyn:\/\/file\/)[^)\s]+\)$/;

/** Blocks the apps couldn't draw as written, refused with what to change. */
function checkBlocks(blocks: DocBlock[]) {
  for (const b of blocks) {
    if (isEmbed(b) && !parseEmbed(b.type === "code" ? b.text : ""))
      invalid(
        "An orbyn-embed block holds orbyn://doc/<id> (optionally #<line>) or tasks: linked.",
      );
    if (isLiveList(b) && !parseLiveList(b.type === "code" ? b.text : ""))
      invalid(
        "An orbyn-list block holds view:<id> or a view definition as JSON (see orbyn://spec/views).",
      );
    if (b.type === "paragraph" && OUTSIDE_PICTURE.test(b.text.trim()))
      invalid(
        "Pictures can only be files already in Orbyn.",
        "Use ![caption](orbyn://file/<id>) with a file from a page you can read (fetch shows them).",
      );
  }
  const valid = docContent.safeParse(blocks);
  if (!valid.success) {
    const issue = valid.error.issues[0];
    const at = typeof issue.path[0] === "number" ? issue.path[0] : null;
    if (at === null && issue.code === "too_big")
      invalid(
        `That's ${blocks.length} lines; at most ${String(issue.maximum)} go in at once.`,
        "Send the text in parts with append_doc (each part up to that many lines).",
      );
    invalid(
      `Line ${at === null ? "?" : at + 1} of that Markdown can't be kept: ${issue.message}.`,
      "Shorten it or split it into several lines (a code block's language is at most 20 characters).",
    );
  }
}

/**
 * Pictures and files the lines show must be ones the person can already
 * read through this connection: on a page it can read, or their own
 * upload not yet on a page. `known` are ids the page already shows.
 */
async function checkFiles(
  ctx: CapabilityContext,
  blocks: DocBlock[],
  known: Set<string>,
) {
  const ids = [
    ...new Set(
      blocks.flatMap((b) =>
        (b.type === "image" || b.type === "file") && !known.has(b.file)
          ? [b.file]
          : [],
      ),
    ),
  ];
  if (!ids.length) return;
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const ok = new Set(
    (
      await ctx.db.query<{ id: string }>(
        `SELECT f.id FROM page_files f
          WHERE f.id = ANY (${params.add(ids)}::uuid[])
            AND ((f.user_id = ${scope.user} AND f.doc_id IS NULL)
              OR EXISTS (SELECT 1 FROM docs fd
                          WHERE fd.id = f.doc_id AND ${visibleDocs("fd", scope)})
              OR EXISTS (SELECT 1 FROM page_file_refs fr
                           JOIN docs fs ON fs.id = fr.doc_id
                          WHERE fr.file_id = f.id AND ${visibleDocs("fs", scope)}))`,
        params.values,
      )
    ).rows.map((r) => r.id),
  );
  const missing = ids.find((id) => !ok.has(id));
  if (missing)
    invalid(
      `There is no picture or file ${missing} this connection can read.`,
      "Show only files already on a page you can read (orbyn://file/<id> from fetch); adding new files isn't possible here.",
    );
}

/** The file ids a page's lines already show. */
export const filesOn = (blocks: DocBlock[]): Set<string> =>
  new Set(
    blocks.flatMap((b) =>
      b.type === "image" || b.type === "file" ? [b.file] : [],
    ),
  );

/**
 * An agent's Markdown as the blocks it stands for, anchors read as ids,
 * links resolved and everything checked; INVALID otherwise.
 */
export async function readMarkdown(
  ctx: CapabilityContext,
  markdown: string,
  home: MarkdownHome,
): Promise<DocBlock[]> {
  const blocks = await resolveWikis(
    ctx,
    parseDoc(markdown, { anchors: true }),
    home,
  );
  checkBlocks(blocks);
  await checkFiles(ctx, blocks, home ? filesOn(home.blocks) : new Set());
  return blocks;
}
