import {
  blockPlainText,
  docPreview,
  fail,
  findMention,
  isEmbed,
  isLiveList,
  linkMention,
  plainText,
  sectionOf,
  type DocBlock,
  type HeadingOption,
  type LinkCard,
  type LinkContext,
  type RelatedPage,
  type UnlinkedMention,
} from "@orbyn/core";
import { pool, transaction, type Db, type Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { docArchived, docVisibleTo } from "../../lib/doc-visibility.js";
import {
  readableDocs,
  visibleItems,
  visibleProjects,
  writableOwned,
} from "../../lib/visibility.js";
import { hasVectors, semanticOn } from "../search/semantic.js";
import { announceDocChange } from "../docs/live.js";
import { loadPrefs } from "../planner/calendar.js";
import { requireDoc, snapshot } from "../docs/service.js";
import { linkPrivacy, readableLinks } from "./privacy.js";
import { actAs } from "../../lib/actor.js";

/**
 * More about links (D4b): the hover card a link opens (LNK-07), the pages
 * that say a page's name without linking to it and the pages that read like
 * it (LNK-06), making such a mention a link in one click, and a page's
 * headings for `[[Page#` (LNK-04). The same rule as the rest of links: a
 * row is shown only when it is yours to open.
 */

/** SQL true when `$1` may change the thing with this team and owner. */
const writable = (alias: string) => writableOwned(alias, "user_id");

const DOC_KIND = `CASE d.kind WHEN 'note' THEN 'Note' WHEN 'meeting' THEN 'Meeting note'
  WHEN 'agenda' THEN 'Agenda' ELSE 'Page' END`;

const iso = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString() : null;

/** One link's hover card (LNK-07). */
export async function linkCard(
  db: Queryable,
  userId: string,
  q: {
    kind: LinkCard["kind"];
    id: string;
    block?: string;
    moved_from?: string;
  },
): Promise<LinkCard> {
  const gone = (state: "deleted" | "missing"): LinkCard => ({
    kind: q.kind,
    id: q.id,
    state,
    title: null,
    can_write: false,
  });
  if (q.kind === "doc") {
    const d = (
      await db.query<{
        title: string;
        kind_label: string;
        content: DocBlock[] | null;
        folder: string | null;
        project_id: string | null;
        project_name: string | null;
        deleted: boolean;
        can_write: boolean;
        moved_to: string | null;
      }>(
        `SELECT d.title, ${DOC_KIND} AS kind_label, d.content, f.name AS folder,
                p.id AS project_id, p.name AS project_name,
                d.deleted_at IS NOT NULL AS deleted, ${writable("d")} AS can_write,
                CASE WHEN d.deleted_at IS NOT NULL THEN mi.id END AS moved_to
           FROM docs d
           LEFT JOIN folders f ON f.id = d.folder_id
           LEFT JOIN projects p ON p.id = d.project_id
           LEFT JOIN docs mi ON mi.id = d.merged_into
                AND ${docVisibleTo("$1", "mi")}
          WHERE d.id = $2
            AND ${readableDocs("d")}`,
        [userId, q.id],
      )
    ).rows[0];
    if (!d) return gone("missing");
    // A page merged into another shows the page it went into, as its
    // link's pill does (a line keeps its name there unless it was taken).
    if (d.deleted && d.moved_to && !q.moved_from) {
      const into = await linkCard(db, userId, {
        kind: "doc",
        id: d.moved_to,
        block: q.block,
        moved_from: q.id,
      });
      if (into.state === "ok") return { ...into, moved_from: q.id };
    }
    if (d.deleted) return { ...gone("deleted"), title: d.title || "Untitled" };
    // Its own links show only what this reader may see (D3aF).
    const content = await readableLinks(db, userId, d.content ?? []);
    const section = q.block ? sectionOf(content, q.block) : null;
    return {
      kind: "doc",
      id: q.id,
      state: "ok",
      title: d.title || "Untitled",
      can_write: d.can_write,
      kind_label: d.kind_label,
      folder: d.folder,
      project: d.project_id
        ? { id: d.project_id, name: d.project_name ?? "" }
        : null,
      section: section
        ? section.length
          ? plainText(
              section[0].type === "divider" ? "" : section[0].text,
            ).slice(0, 160)
          : null
        : undefined,
      preview: docPreview(section?.length ? section : content, 280),
    };
  }
  if (q.kind === "task" || q.kind === "event") {
    const i = (
      await db.query<{
        title: string;
        kind: string;
        status: string;
        due_at: Date | null;
        end_at: Date | null;
        all_day: boolean;
        estimate_minutes: number | null;
        repeats: boolean;
        project_id: string | null;
        project_name: string | null;
        can_write: boolean;
        next_start: Date | null;
        next_end: Date | null;
        note_id: string | null;
      }>(
        `SELECT i.title, i.kind, i.status, i.due_at, i.end_at, i.all_day,
                i.estimate_minutes, i.rrule IS NOT NULL AS repeats,
                p.id AS project_id, p.name AS project_name,
                ${writable("i")} AS can_write,
                b.start_at AS next_start, b.end_at AS next_end,
                (SELECT d.id FROM docs d
                  WHERE d.item_id = i.id AND d.kind = 'meeting'
                    AND ${docVisibleTo("$1")}
                  ORDER BY d.occurrence IS NOT NULL, d.updated_at DESC
                  LIMIT 1) AS note_id
           FROM items i
           LEFT JOIN projects p ON p.id = i.project_id
           LEFT JOIN LATERAL (
             SELECT tb.start_at, tb.end_at FROM time_blocks tb
              WHERE tb.item_id = i.id AND tb.user_id = $1 AND tb.end_at > now()
              ORDER BY tb.start_at LIMIT 1) b ON true
          WHERE i.id = $2 AND ${visibleItems("i")}`,
        [userId, q.id],
      )
    ).rows[0];
    if (!i) return gone("missing");
    const project = i.project_id
      ? { id: i.project_id, name: i.project_name ?? "" }
      : null;
    if (i.kind === "event")
      return {
        kind: "event",
        id: q.id,
        state: "ok",
        title: i.title || "Untitled",
        can_write: i.can_write,
        project,
        start_at: iso(i.due_at),
        end_at: iso(i.end_at),
        all_day: i.all_day,
        repeats: i.repeats,
        note_id: i.note_id,
      };
    return {
      kind: "task",
      id: q.id,
      state: "ok",
      title: i.title || "Untitled",
      can_write: i.can_write,
      project,
      done: i.status === "done",
      due_at: iso(i.due_at),
      all_day: i.all_day,
      estimate_minutes: i.estimate_minutes,
      repeats: i.repeats,
      // Your account's time zone, which views move deadlines in too.
      time_zone: (await loadPrefs(db as unknown as Db, userId)).timezone,
      planned:
        i.next_start && i.next_end
          ? { start_at: iso(i.next_start)!, end_at: iso(i.next_end)! }
          : null,
    };
  }
  const p = (
    await db.query<{
      name: string;
      deadline: Date | null;
      total: string;
      done: string;
      can_write: boolean;
    }>(
      `SELECT p.name, p.deadline, ${writable("p")} AS can_write,
              (SELECT count(*) FROM items i WHERE i.project_id = p.id
                 AND i.kind = 'task' AND i.status <> 'cancelled') AS total,
              (SELECT count(*) FROM items i WHERE i.project_id = p.id
                 AND i.kind = 'task' AND i.status = 'done') AS done
         FROM projects p
        WHERE p.id = $2 AND ${visibleProjects("p")}`,
      [userId, q.id],
    )
  ).rows[0];
  if (!p) return gone("missing");
  const next = (
    await db.query<{ id: string; title: string; due_at: Date | null }>(
      `SELECT i.id, i.title, i.due_at FROM items i
        WHERE i.project_id = $2 AND i.kind = 'task'
          AND i.status NOT IN ('done', 'cancelled') AND ${visibleItems("i")}
        ORDER BY i.due_at ASC NULLS LAST, i.created_at
        LIMIT 1`,
      [userId, q.id],
    )
  ).rows[0];
  return {
    kind: "project",
    id: q.id,
    state: "ok",
    title: p.name || "Untitled",
    can_write: p.can_write,
    deadline: iso(p.deadline),
    progress: { done: Number(p.done), total: Number(p.total) },
    next: next
      ? { id: next.id, title: next.title, due_at: iso(next.due_at) }
      : null,
  };
}

/** The names a page or project goes by, long enough to look for. */
async function namesOf(
  db: Queryable,
  userId: string,
  target: { kind: "doc" | "project"; id: string },
): Promise<string[]> {
  const row =
    target.kind === "doc"
      ? (
          await db.query<{ title: string; aliases: string[] }>(
            `SELECT d.title, d.aliases FROM docs d
              WHERE d.id = $2 AND ${docVisibleTo("$1")}`,
            [userId, target.id],
          )
        ).rows[0]
      : (
          await db.query<{ title: string; aliases: string[] }>(
            `SELECT p.name AS title, p.aliases FROM projects p
              WHERE p.id = $2 AND ${visibleProjects("p")}`,
            [userId, target.id],
          )
        ).rows[0];
  if (!row) fail(404, "Not found");
  const seen = new Set<string>();
  return [row.title, ...(row.aliases ?? [])]
    .map((n) => (n ?? "").trim())
    .filter((n) => {
      const k = n.toLowerCase();
      if (n.length < 3 || k === "untitled" || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

const clipStart = (s: string, n: number) =>
  s.length <= n ? s : "…" + s.slice(s.length - n).replace(/^\S*\s/, "");
const clipEnd = (s: string, n: number) =>
  s.length <= n ? s : s.slice(0, n).replace(/\s\S*$/, "") + "…";

/** The line around a mention, with the name picked out. */
function mentionContext(
  source: string,
  start: number,
  end: number,
): LinkContext {
  return {
    before: clipStart(
      plainText(source.slice(0, start)).replace(/\s+/g, " ").trimStart(),
      60,
    ),
    linked: source.slice(start, end),
    after: clipEnd(
      plainText(source.slice(end)).replace(/\s+/g, " ").trimEnd(),
      60,
    ),
  };
}

/** The most pages "Mentioned without a link" lists. */
const MENTIONS_LIMIT = 20;

/**
 * Pages that say a page's or project's name (or one of its other names)
 * without linking to it (LNK-06): one entry per page, at the first line
 * that says it. Pages that already link to it are left out.
 */
export async function unlinkedMentions(
  db: Queryable,
  userId: string,
  target: { kind: "doc" | "project"; id: string },
): Promise<UnlinkedMention[]> {
  const names = await namesOf(db, userId, target);
  if (!names.length) return [];
  const patterns = names.map(
    (n) => `%${n.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
  );
  const rows = (
    await db.query<{
      id: string;
      title: string;
      hint: string;
      content: DocBlock[] | null;
      can_link: boolean;
    }>(
      `SELECT d.id, d.title, coalesce(p.name, ${DOC_KIND}) AS hint, d.content,
              ${writable("d")} AS can_link
         FROM docs d
         LEFT JOIN projects p ON p.id = d.project_id
        WHERE ${docVisibleTo("$1")} AND NOT ${docArchived("d")}
          AND d.id::text <> $2
          AND doc_words(d.content, NULL) ILIKE ANY ($3::text[])
          AND NOT EXISTS (
            SELECT 1 FROM object_links l
             WHERE l.source_kind = 'doc' AND l.source_id = d.id
               AND l.link_kind = 'link' AND l.target_kind = $4
               AND l.target_id = $2)
        ORDER BY d.updated_at DESC
        LIMIT 100`,
      [userId, target.id, patterns, target.kind],
    )
  ).rows;
  const out: UnlinkedMention[] = [];
  // The words around a mention show only the links this reader may see.
  const links = await linkPrivacy(
    db,
    userId,
    rows.map((d) => d.content),
  );
  for (const d of rows) {
    let hit: UnlinkedMention | null = null;
    for (const b of d.content ?? []) {
      if (
        b.type === "divider" ||
        b.type === "code" ||
        b.type === "math" ||
        b.type === "table" ||
        b.type === "image" ||
        b.type === "file" ||
        isLiveList(b) ||
        isEmbed(b)
      )
        continue;
      for (const name of names) {
        const found = findMention(b.text, name);
        if (!found) continue;
        const line = links.line(b.text);
        hit = {
          doc_id: d.id,
          title: d.title || "Untitled",
          hint: d.hint,
          block_id: b.id ?? null,
          matched: found.matched,
          context: mentionContext(
            line.text,
            line.toShown(found.start),
            line.toShown(found.end, true),
          ),
          // A line without a name can't be pointed at to link it.
          can_link: d.can_link && !!b.id,
        };
        break;
      }
      if (hit) break;
    }
    if (hit) out.push(hit);
    if (out.length >= MENTIONS_LIMIT) break;
  }
  return out;
}

/** The most pages "Related" lists. */
const RELATED_LIMIT = 6;

/**
 * Pages that read like this one (LNK-06 "Related"), not already linked
 * either way: by meaning when the workspace measures pages (from the
 * page's own stored measurements; no provider is asked), then pages with
 * the same tags, pages that link to the same things, and similar titles.
 */
export async function relatedPages(
  db: Queryable,
  userId: string,
  docId: string,
): Promise<RelatedPage[]> {
  const me = (
    await db.query<{ title: string }>(
      `SELECT d.title FROM docs d WHERE d.id = $2 AND ${docVisibleTo("$1")}`,
      [userId, docId],
    )
  ).rows[0];
  if (!me) fail(404, "Document not found");
  const linked = `NOT EXISTS (SELECT 1 FROM object_links l
      WHERE l.link_kind = 'link' AND l.source_kind = 'doc' AND l.target_kind = 'doc'
        AND ((l.source_id = $2 AND l.target_id = d.id::text)
          OR (l.source_id = d.id AND l.target_id = $2::text)))`;
  const out = new Map<string, RelatedPage>();
  const add = (
    rows: { id: string; title: string; hint: string }[],
    reason: string,
  ) => {
    for (const r of rows)
      if (!out.has(r.id) && out.size < RELATED_LIMIT)
        out.set(r.id, {
          doc_id: r.id,
          title: r.title || "Untitled",
          hint: r.hint,
          reason,
        });
  };
  const columns = `d.id, d.title, coalesce(p.name, ${DOC_KIND}) AS hint`;
  const from = `FROM docs d LEFT JOIN projects p ON p.id = d.project_id`;
  if ((await hasVectors(db)) && (await semanticOn(db))) {
    try {
      add(
        (
          await db.query(
            `WITH mine AS (SELECT avg(embedding) AS v FROM doc_embeddings
                            WHERE doc_id = $2)
             SELECT ${columns} ${from}
               JOIN LATERAL (SELECT min(e.embedding <=> (SELECT v FROM mine)) AS far
                               FROM doc_embeddings e WHERE e.doc_id = d.id) n ON true
              WHERE (SELECT v FROM mine) IS NOT NULL AND n.far IS NOT NULL
                AND d.id <> $2 AND ${docVisibleTo("$1")} AND ${linked}
              ORDER BY n.far LIMIT $3`,
            [userId, docId, RELATED_LIMIT],
          )
        ).rows,
        "Says similar things",
      );
    } catch {
      // Meaning is a bonus; the other signals still answer.
    }
  }
  add(
    (
      await db.query(
        `SELECT ${columns}, count(*) AS n ${from}
           JOIN doc_tags dt ON dt.doc_id = d.id
          WHERE dt.tag_id IN (SELECT tag_id FROM doc_tags WHERE doc_id = $2)
            AND d.id <> $2 AND ${docVisibleTo("$1")} AND ${linked}
          GROUP BY d.id, d.title, p.name, d.kind, d.updated_at
          ORDER BY n DESC, d.updated_at DESC LIMIT $3`,
        [userId, docId, RELATED_LIMIT],
      )
    ).rows,
    "Same tags",
  );
  add(
    (
      await db.query(
        `SELECT ${columns}, count(DISTINCT o.target_id) AS n ${from}
           JOIN object_links o ON o.source_kind = 'doc' AND o.source_id = d.id
                              AND o.link_kind = 'link'
          WHERE (o.target_kind, o.target_id) IN (
                  SELECT target_kind, target_id FROM object_links
                   WHERE source_kind = 'doc' AND source_id = $2
                     AND link_kind = 'link')
            AND d.id <> $2 AND ${docVisibleTo("$1")} AND ${linked}
          GROUP BY d.id, d.title, p.name, d.kind, d.updated_at
          ORDER BY n DESC, d.updated_at DESC LIMIT $3`,
        [userId, docId, RELATED_LIMIT],
      )
    ).rows,
    "Links to the same things",
  );
  if (me.title.trim().length >= 3)
    add(
      (
        await db.query(
          `SELECT ${columns} ${from}
            WHERE d.id <> $2 AND ${docVisibleTo("$1")} AND ${linked}
              AND similarity(d.title, $4) > 0.35
            ORDER BY similarity(d.title, $4) DESC, d.updated_at DESC LIMIT $3`,
          [userId, docId, RELATED_LIMIT, me.title],
        )
      ).rows,
      "Similar title",
    );
  return [...out.values()];
}

/**
 * Make a mention a link (LNK-06's Link button): the first place the words
 * are said as words of their own in that line becomes a link to the page
 * or project, saved as a new version of the page it's in.
 */
type MentionLink = {
  doc_id: string;
  block_id: string;
  matched: string;
  target: { kind: "doc" | "project"; id: string };
};

/**
 * Make an unlinked mention a link in `db`'s transaction (a new version of
 * the page it's in). Returns the version before and after, for undo.
 */
export async function linkMentionIn(
  db: Db,
  u: UserRow,
  input: MentionLink,
  /** Always keep the state before (an agent's change, so it can be undone). */
  always = false,
): Promise<{ before: number; version: number }> {
  // The thing linked to has to be yours to open, as with any link.
  const visible =
    input.target.kind === "doc"
      ? await db.query(
          `SELECT 1 FROM docs d WHERE d.id = $2 AND ${docVisibleTo("$1")}`,
          [u.id, input.target.id],
        )
      : await db.query(
          `SELECT 1 FROM projects p WHERE p.id = $2 AND ${visibleProjects("p")}`,
          [u.id, input.target.id],
        );
  if (!visible.rowCount) fail(404, "Not found");
  await actAs(db, u.id);
  const doc = await requireDoc(db, input.doc_id, u, "items:write");
  const content =
    (
      await db.query<{ content: DocBlock[] | null }>(
        "SELECT content FROM docs WHERE id = $1",
        [input.doc_id],
      )
    ).rows[0].content ?? [];
  const at = content.findIndex((b) => b.id === input.block_id);
  const block = content[at];
  const text =
    block && block.type !== "divider"
      ? linkMention(block.text, input.matched, input.target)
      : null;
  if (!block || block.type === "divider" || text === null)
    fail(409, "Those words aren't on that line any more.");
  const next = content.slice();
  next[at] = { ...block, text } as DocBlock;
  await snapshot(db, input.doc_id, u.id, always);
  const version = (
    await db.query<{ version: number }>(
      `UPDATE docs SET content = $2::jsonb, version = version + 1,
           updated_at = now() WHERE id = $1 RETURNING version`,
      [input.doc_id, JSON.stringify(next)],
    )
  ).rows[0].version;
  return { before: doc.version, version };
}

export async function linkUnlinkedMention(
  u: UserRow,
  input: MentionLink,
): Promise<{ doc_id: string; version: number }> {
  const saved = (await transaction((db) => linkMentionIn(db, u, input)))
    .version;
  await announceDocChange(pool, input.doc_id, saved, "link").catch(() => {});
  return { doc_id: input.doc_id, version: saved };
}

/** The most headings and lines `[[Page#` offers. */
const HEADINGS_LIMIT = 30;

/**
 * A page's headings, for `[[Page#` (LNK-04); with words typed after the
 * `#`, the headings and then the other lines that say them.
 */
export async function pageHeadings(
  db: Queryable,
  userId: string,
  docId: string,
  q: string,
): Promise<HeadingOption[]> {
  const d = (
    await db.query<{ content: DocBlock[] | null }>(
      `SELECT d.content FROM docs d WHERE d.id = $2 AND ${docVisibleTo("$1")}`,
      [userId, docId],
    )
  ).rows[0];
  if (!d) fail(404, "Document not found");
  const want = q.trim().toLowerCase();
  const words = (b: DocBlock) => blockPlainText(b).replace(/\s+/g, " ").trim();
  const content = await readableLinks(db, userId, d.content ?? []);
  const headings: HeadingOption[] = [];
  const lines: HeadingOption[] = [];
  content.forEach((b, index) => {
    const text = words(b);
    if (!text || (want && !text.toLowerCase().includes(want))) return;
    const option = {
      block_id: b.id ?? null,
      index,
      level: b.type === "heading" ? b.level : null,
      text: text.slice(0, 160),
    };
    if (b.type === "heading") headings.push(option);
    else if (want && b.type !== "code" && b.type !== "math") lines.push(option);
  });
  return [...headings, ...lines].slice(0, HEADINGS_LIMIT);
}
