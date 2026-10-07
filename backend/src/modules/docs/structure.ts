import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  aliasesInput,
  mergeDocContents,
  extractDocContent,
  parseVersionedDocContent,
  docContainerBlocks,
  type VersionedDocContent,
  blockPlainText,
  blockText,
  docAnchorInput,
  docReferenceLinks,
  docReferenceEntries,
  docExtractInput,
  docFoldsInput,
  docMergeInput,
  fail,
  lookInput,
  type Look,
  type LookInput,
  linkMarkdown,
  newBlockId,
  plainText,
  parseObjectHref,
  sectionOf,
  type Doc,
  type DocBlock,
} from "@orbyn/core";
import {
  pool,
  reader,
  transaction,
  type Db,
  type Queryable,
} from "../../db/pool.js";
import {
  allowPageFiles,
  coverLetGo,
  requireCoverPicture,
} from "../../lib/page-file-access.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { announceDocChange } from "./live.js";
import { readableLinks, linkPrivacy } from "../links/privacy.js";
import {
  announceDocs,
  COLUMNS,
  JOINS,
  LINKED,
  noteTrash,
  readDoc,
  requireDoc,
  searchTrash,
  snapshot,
  VISIBLE,
  withTaskState,
} from "./service.js";
import { saveVersionedDoc } from "./content-format.js";
import { actAs } from "../../lib/actor.js";
import { writableOwned } from "../../lib/visibility.js";

/**
 * Pages as structure (D4b): a live section of another page to embed
 * (LNK-08), a name for a line so a link can point at it (LNK-04), lines
 * moved to a new page with a link left behind, one page merged into another
 * (ORG-05), the headings each person has folded (EDT-14), and a page's other
 * names (LNK-03). Every write goes through the page's lock and history, as
 * a save does, and open editors are told.
 */

/** The most lines an embed of a whole page shows. */
const EMBED_LINES = 60;

/** A page's words as a title for lines moved out of it: the first heading, or the first words. */
function titleFor(blocks: DocBlock[]): string {
  const heading = blocks.find((b) => b.type === "heading");
  const words = plainText(
    heading
      ? blockText(heading)
      : (blocks.map(blockText).find((t) => t.trim()) ?? ""),
  )
    .replace(/\s+/g, " ")
    .trim();
  return words.slice(0, 200) || "Untitled";
}

/** The pictures and files these lines show. */
function filesOf(blocks: DocBlock[]): string[] {
  return [
    ...new Set(
      blocks.flatMap((b) =>
        (b.type === "image" || b.type === "file") && b.file
          ? [b.file.toLowerCase()]
          : [],
      ),
    ),
  ];
}

/**
 * Take a page's remarks, proposed changes, task lines and pictures and
 * files on `ids` over to another page, so they go where the lines went.
 * `rename` gives a line a new id where the page it goes to already had one
 * of that name.
 */
async function carryLines(
  db: Db,
  from: string,
  to: string,
  ids: string[],
  rename: Map<string, string> = new Map(),
  files: string[] = [],
) {
  // A picture or file belongs to the page its line is now on, so it lives
  // as long as that page does (and is listed in its Info).
  if (files.length)
    await db.query(
      `UPDATE page_files SET doc_id = $2
        WHERE doc_id = $1 AND id = ANY ($3::uuid[])`,
      [from, to, files],
    );
  if (!ids.length) return;
  const renamed = (id: string) => rename.get(id) ?? id;
  const moved = (
    await db.query<{ id: string; block_id: string }>(
      `UPDATE doc_comments SET doc_id = $2
        WHERE doc_id = $1 AND block_id = ANY ($3::text[])
        RETURNING id, block_id`,
      [from, to, ids],
    )
  ).rows;
  for (const c of moved)
    if (rename.has(c.block_id))
      await db.query("UPDATE doc_comments SET block_id = $2 WHERE id = $1", [
        c.id,
        renamed(c.block_id),
      ]);
  const roots = moved.map((c) => c.id);
  // Replies follow the remark they answer.
  const replies = roots.length
    ? (
        await db.query<{ id: string }>(
          `UPDATE doc_comments SET doc_id = $2
            WHERE doc_id = $1 AND parent_id = ANY ($3::uuid[])
            RETURNING id`,
          [from, to, roots],
        )
      ).rows.map((r) => r.id)
    : [];
  const comments = [...roots, ...replies].map(String);
  if (comments.length)
    await db.query(
      `UPDATE object_links SET source_id = $2
        WHERE source_kind = 'doc' AND source_id = $1 AND link_kind = 'mention'
          AND source_block = ANY ($3::text[])`,
      [from, to, comments],
    );
  const suggestions = (
    await db.query<{ id: string; block_id: string }>(
      `UPDATE doc_suggestions SET doc_id = $2
        WHERE doc_id = $1 AND block_id = ANY ($3::text[])
        RETURNING id, block_id`,
      [from, to, ids],
    )
  ).rows;
  for (const g of suggestions)
    if (rename.has(g.block_id))
      await db.query("UPDATE doc_suggestions SET block_id = $2 WHERE id = $1", [
        g.id,
        renamed(g.block_id),
      ]);
  // Task lines are made again rather than moved, so the link index (kept
  // by triggers on insert and delete) follows them.
  const tasks = (
    await db.query<{ block_id: string; item_id: string; done: boolean | null }>(
      `DELETE FROM doc_task_links WHERE doc_id = $1 AND block_id = ANY ($2::text[])
        RETURNING block_id, item_id, done`,
      [from, ids],
    )
  ).rows;
  for (const t of tasks)
    await db.query(
      `INSERT INTO doc_task_links (doc_id, block_id, item_id, done)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (doc_id, block_id) DO UPDATE SET item_id = $3, done = $4`,
      [to, renamed(t.block_id), t.item_id, t.done],
    );
}

/**
 * "Move to new page" (ORG-05) in `db`'s transaction: the lines become a new
 * page beside this one, with their remarks, proposals and task lines, and a
 * link takes their place. The route and agents (organize, H6b) share it.
 */
export async function extractLines(
  db: Db,
  u: UserRow,
  id: string,
  body: z.output<typeof docExtractInput>,
  /** Always keep the state before (an agent's change, so it can be undone). */
  always = false,
) {
  await actAs(db, u.id);
  const current = await requireDoc(db, id, u, "items:write");
  if (current.version !== body.version)
    fail(409, "This document changed somewhere else. Refresh and try again.");
  const source = (
    await db.query<{
      content: DocBlock[] | null;
      content_format: 1 | 2;
      content_nodes: unknown;
      project_id: string | null;
      folder_id: string | null;
    }>(
      "SELECT content, content_format, content_nodes, project_id, folder_id FROM docs WHERE id = $1",
      [id],
    )
  ).rows[0];
  const document = parseVersionedDocContent(
    source.content_format === 2
      ? { format: 2, nodes: source.content_nodes }
      : { format: 1, blocks: source.content ?? [] },
  );
  const content =
    document.format === 2
      ? docContainerBlocks(document.nodes)
      : document.blocks;
  const wanted = new Set(body.block_ids);
  const moved = content.filter((b) => b.id && wanted.has(b.id));
  if (!moved.length || moved.length !== wanted.size)
    fail(409, "Those lines aren't on the page any more.");
  // Named from its lines as the mover reads them (D3aF).
  const title =
    body.title?.trim() || titleFor(await readableLinks(db, u.id, moved));
  // The pictures and files go with their lines (read through this page).
  await allowPageFiles(db, u.id, moved);
  const newId = randomUUID();
  const link: DocBlock = {
    type: "paragraph",
    id: newBlockId(),
    text: linkMarkdown({ kind: "doc", id: newId }, title),
  };
  const split = extractDocContent(document, body.block_ids, link, {
    sourceId: id,
    destinationId: newId,
    freshId: newBlockId,
  });
  const rest =
    split.source.format === 2
      ? docContainerBlocks(split.source.nodes)
      : split.source.blocks;
  await db.query(
    `INSERT INTO docs (id, user_id, team_id, title, kind, content, project_id,
         folder_id, content_format, content_nodes)
       VALUES ($1, $2, $3, $4, 'doc', $5::jsonb, $6, $7, $8, $9::jsonb)`,
    [
      newId,
      u.id,
      current.team_id,
      title,
      JSON.stringify(
        split.extracted.format === 2
          ? docContainerBlocks(split.extracted.nodes)
          : split.extracted.blocks,
      ),
      source.project_id,
      source.folder_id,
      split.extracted.format,
      split.extracted.format === 2
        ? JSON.stringify(split.extracted.nodes)
        : null,
    ],
  );
  await carryLines(
    db,
    id,
    newId,
    moved.map((b) => b.id!),
    undefined,
    // Unless a line left behind still shows it.
    filesOf(moved).filter((f) => !filesOf(rest).includes(f)),
  );
  if (always) await snapshot(db, id, u.id, true);
  await saveVersionedDoc(db, u, id, current.version, split.source, [1, 2]);
  return {
    doc: await readableLinks(
      db,
      u.id,
      (
        await db.query<Doc>(
          `SELECT ${COLUMNS}, d.content, ${LINKED} FROM docs d ${JOINS}
              WHERE d.id = $1`,
          [newId],
        )
      ).rows[0],
    ),
    source: await readDoc(db, id, u.id),
  };
}

/**
 * "Merge into…" (ORG-05) in `db`'s transaction: this page's lines go to the
 * end of the other, links to it are pointed there and it goes to Trash.
 * The route and agents (organize, H6b) share it.
 */
export async function mergePages(
  db: Db,
  u: UserRow,
  id: string,
  body: z.output<typeof docMergeInput>,
  /** Always keep the state before (an agent's change, so it can be undone). */
  always = false,
) {
  if (body.into === id) fail(400, "A page can't be merged into itself.");
  await actAs(db, u.id);
  // Locked in one order, so two merges the other way round can't deadlock.
  const [a, b] = [id, body.into].sort();
  const first = await requireDoc(db, a, u, "items:write");
  const second = await requireDoc(db, b, u, "items:write");
  const src = a === id ? first : second;
  const into = a === id ? second : first;
  if (src.version !== body.version)
    fail(409, "This document changed somewhere else. Refresh and try again.");
  if ((src.team_id ?? null) !== (into.team_id ?? null))
    fail(
      422,
      "Pages can only be merged with a page in the same space. Move one first.",
    );
  const rows = (
    await db.query<{
      id: string;
      title: string;
      content: DocBlock[] | null;
      content_format: 1 | 2;
      content_nodes: unknown;
    }>(
      "SELECT id, title, content, content_format, content_nodes FROM docs WHERE id = ANY ($1::uuid[])",
      [[id, body.into]],
    )
  ).rows;
  const source = rows.find((x) => x.id === id)!;
  const target = rows.find((x) => x.id === body.into)!;
  const stored = (row: typeof source): VersionedDocContent =>
    parseVersionedDocContent(
      row.content_format === 2
        ? { format: 2, nodes: row.content_nodes }
        : { format: 1, blocks: row.content ?? [] },
    );
  const sourceDocument = stored(source);
  const { document: merged, renamed: rename } = mergeDocContents(
    stored(target),
    sourceDocument,
    source.title,
    newBlockId,
  );
  const sourceLines =
    sourceDocument.format === 2
      ? docContainerBlocks(sourceDocument.nodes)
      : sourceDocument.blocks;
  // Checked before the source goes to Trash, while it still shows them.
  await allowPageFiles(db, u.id, sourceLines);
  await carryLines(
    db,
    id,
    body.into,
    sourceLines.flatMap((x) => (x.id ? [x.id] : [])),
    rename,
    filesOf(sourceLines),
  );
  if (always) await snapshot(db, body.into, u.id, true);
  await saveVersionedDoc(db, u, body.into, into.version, merged, [1, 2]);
  // Links to the merged page, in pages you can change, now open the
  // other, and a link to one of its lines to that line under its new
  // name if it had to be renamed. Each page keeps its history.
  const linking = (
    await db.query<{
      id: string;
      content: DocBlock[] | null;
      content_format: 1 | 2;
      content_nodes: unknown;
      version: number;
    }>(
      `SELECT d.id, d.content, d.content_format, d.content_nodes, d.version FROM docs d
            WHERE d.id IN (
                    SELECT l.source_id FROM object_links l
                     WHERE l.source_kind = 'doc' AND l.link_kind = 'link'
                       AND l.target_kind = 'doc' AND l.target_id = $2
                     LIMIT 200)
              AND d.id <> $3 AND d.deleted_at IS NULL
              AND ${writableOwned("d", "user_id")}
            ORDER BY d.id
            FOR UPDATE OF d`,
      [u.id, id, id],
    )
  ).rows;
  const pointer = new RegExp(
    `orbyn://doc/${id}(?:#([A-Za-z0-9_-]{1,64}))?`,
    "gi",
  );
  const rewritten: { id: string; version: number }[] = [];
  for (const p of linking) {
    const original: VersionedDocContent = parseVersionedDocContent(
      p.content_format === 2
        ? { format: 2, nodes: p.content_nodes }
        : { format: 1, blocks: p.content ?? [] },
    );
    const before = JSON.stringify(original);
    const after = before.replace(
      pointer,
      (_all, line?: string) =>
        `orbyn://doc/${body.into}${line ? `#${rename.get(line) ?? line}` : ""}`,
    );
    if (after === before) continue;
    const saved = await saveVersionedDoc(
      db,
      u,
      p.id,
      p.version,
      JSON.parse(after),
      [1, 2],
    );
    rewritten.push({ id: p.id, version: saved.version });
  }
  await db.query(
    `UPDATE docs SET deleted_at = now(), deleted_by = $2, merged_into = $3
          WHERE id = $1`,
    [id, u.id, body.into],
  );
  await noteTrash(db, id, u.id, true);
  await searchTrash(db, id, true);
  const doc = await readDoc(db, body.into, u.id);
  return { version: doc.version, rewritten, doc };
}

/**
 * A page's other names (LNK-03), in `db`'s transaction: its version stays.
 * Returns the names it had before, for undo.
 */
export async function setAliases(
  db: Db,
  u: UserRow,
  id: string,
  aliases: string[],
): Promise<{ version: number; before: string[] }> {
  const doc = await requireDoc(db, id, u, "items:write");
  const before =
    (
      await db.query<{ aliases: string[] | null }>(
        "SELECT aliases FROM docs WHERE id = $1",
        [id],
      )
    ).rows[0]?.aliases ?? [];
  await db.query("UPDATE docs SET aliases = $2 WHERE id = $1", [id, aliases]);
  return { version: doc.version, before };
}

/**
 * A page's cover and icon (W6), in `db`'s transaction. Like its other
 * names, they aren't the page's words: its version stays. Whoever may
 * change the page may change them; a new cover is a picture they can see.
 * Returns the look it had before, for undo.
 */
export async function setLook(
  db: Db,
  u: UserRow,
  id: string,
  look: LookInput,
): Promise<{ version: number; before: Look; after: Look }> {
  const doc = await requireDoc(db, id, u, "items:write");
  const before = (
    await db.query<Look>("SELECT cover_file_id, icon FROM docs WHERE id = $1", [
      id,
    ])
  ).rows[0];
  if (look.cover_file_id && look.cover_file_id !== before.cover_file_id)
    await requireCoverPicture(db, u.id, look.cover_file_id);
  const after = (
    await db.query<Look>(
      `UPDATE docs SET
         cover_file_id = CASE WHEN $2::boolean THEN $3::uuid ELSE cover_file_id END,
         icon = CASE WHEN $4::boolean THEN $5::text ELSE icon END
       WHERE id = $1 RETURNING cover_file_id, icon`,
      [
        id,
        look.cover_file_id !== undefined,
        look.cover_file_id ?? null,
        look.icon !== undefined,
        look.icon ?? null,
      ],
    )
  ).rows[0];
  if (before.cover_file_id !== after.cover_file_id)
    await coverLetGo(db, before.cover_file_id);
  // Lists and the library show icons: they read again.
  await announceDocs(db, doc.user_id, doc.team_id, id);
  return { version: doc.version, before, after };
}

/**
 * The headings `userId` folded on a page (EDT-14), set as a whole (an empty
 * list unfolds all). Returns what was folded before, for undo.
 */
export async function setFolds(
  db: Queryable,
  userId: string,
  id: string,
  blockIds: string[],
): Promise<{ before: string[]; after: string[] }> {
  const before =
    (
      await db.query<{ block_ids: string[] }>(
        "SELECT block_ids FROM doc_folds WHERE user_id = $1 AND doc_id = $2",
        [userId, id],
      )
    ).rows[0]?.block_ids ?? [];
  const ids = [...new Set(blockIds)];
  if (!ids.length)
    await db.query("DELETE FROM doc_folds WHERE user_id = $1 AND doc_id = $2", [
      userId,
      id,
    ]);
  else
    await db.query(
      `INSERT INTO doc_folds (user_id, doc_id, block_ids)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, doc_id)
         DO UPDATE SET block_ids = $3, updated_at = now()`,
      [userId, id, ids],
    );
  return { before, after: ids };
}

export async function docStructureRoutes(app: FastifyInstance) {
  /**
   * One heading's section of a page (or one line, or the page's first
   * lines), for a live embed in another page (LNK-08). Read-only: edits
   * happen at the source.
   */
  app.get("/docs/:id/section", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { block } = z
      .object({
        block: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,64}$/)
          .optional(),
      })
      .strict()
      .parse(r.query ?? {});
    const db = reader(r.headers);
    const doc = (
      await db.query<{
        title: string;
        content: DocBlock[] | null;
        team_id: string | null;
      }>(
        `SELECT d.title, d.content, d.team_id FROM docs d
          WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    const content = await withTaskState(db, id, doc.content ?? []);
    // Project the complete source page before slicing: reference definitions
    // outside the selected section still determine its links and privacy.
    const privacy = await linkPrivacy(db, u.id, content);
    const readable = privacy.value(content);
    const lines = block
      ? sectionOf(readable, block)
      : readable.slice(0, EMBED_LINES);
    return {
      doc_id: id,
      title: doc.title || "Untitled",
      block_id: block ?? null,
      // The line it pointed at has gone from the page.
      missing: !!block && !lines.length,
      more: !block && content.length > EMBED_LINES,
      // Words of links this reader can't open read "Private page" (D3aF).
      blocks: lines,
      references: docReferenceEntries(docReferenceLinks(readable)).filter(
        ([, href]) => {
          const target = parseObjectHref(href);
          return !target || !privacy.hidden(target);
        },
      ),
    };
  });

  /**
   * Give a heading or line an id so a link can point at it (LNK-04). Lines
   * the editors have touched already have one; this names the rest, and
   * only when the line still says what the caller saw.
   */
  app.post("/docs/:id/anchor", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { index, text } = docAnchorInput.parse(r.body ?? {});
    const out = await transaction(async (db) => {
      await actAs(db, u.id);
      // Anyone who can read the page may name a line to link to it: the
      // words don't change, and a viewer's "Copy link to this line" works.
      await requireDoc(db, id, u, "items:read");
      const content =
        (
          await db.query<{ content: DocBlock[] | null }>(
            "SELECT content FROM docs WHERE id = $1",
            [id],
          )
        ).rows[0].content ?? [];
      const b = content[index];
      // The line's words as the picker showed them, or its Markdown.
      const shown = b
        ? blockPlainText(b).replace(/\s+/g, " ").trim().slice(0, 160)
        : "";
      if (!b || (blockText(b) !== text && shown !== text))
        fail(409, "This page changed. Open it again to link to that line.");
      if (b.id) return { block_id: b.id, version: null };
      const named = { ...b, id: newBlockId() };
      const next = content.slice();
      next[index] = named;
      // Naming a line isn't an edit anyone would look for in history.
      const version = (
        await db.query<{ version: number }>(
          `UPDATE docs SET content = $2::jsonb, version = version + 1
            WHERE id = $1 RETURNING version`,
          [id, JSON.stringify(next)],
        )
      ).rows[0].version;
      return { block_id: named.id, version };
    });
    if (out.version) await announceDocChange(pool, id, out.version, "anchor");
    return { block_id: out.block_id };
  });

  /**
   * "Move to new page" (ORG-05): the lines become a new page beside this
   * one (same space, project and folder), their remarks, proposals and
   * task lines with them, and a link to the new page takes their place.
   */
  app.post("/docs/:id/extract", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = docExtractInput.parse(r.body ?? {});
    const out = await transaction((db) => extractLines(db, u, id, body));
    await announceDocChange(pool, id, out.source.version, "extract");
    reply.code(201);
    return {
      doc: {
        ...out.doc,
        content: await withTaskState(pool, out.doc.id, out.doc.content),
      },
      source: out.source,
    };
  });

  /**
   * "Merge into…" (ORG-05): this page's lines go to the end of another page
   * in the same space, under its title, with their remarks, proposals and
   * task lines. Links to this page in pages you can change are pointed at
   * the other; this page goes to Trash (and can come back from there), and
   * any link left to it opens the page it went into.
   */
  app.post("/docs/:id/merge", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = docMergeInput.parse(r.body ?? {});
    const out = await transaction((db) => mergePages(db, u, id, body));
    await announceDocChange(pool, id, body.version, "merge", { trashed: true });
    await announceDocChange(pool, body.into, out.version, "merge");
    for (const p of out.rewritten)
      if (p.id !== body.into)
        await announceDocChange(pool, p.id, p.version, "merge").catch(() => {});
    return { doc: out.doc, relinked: out.rewritten.length };
  });

  /** The headings you folded on a page (EDT-14), on every device. */
  app.get("/docs/:id/folds", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const seen = (
      await db.query(`SELECT 1 FROM docs d WHERE d.id = $2 AND ${VISIBLE}`, [
        u.id,
        id,
      ])
    ).rowCount;
    if (!seen) fail(404, "Document not found");
    const row = (
      await db.query<{ block_ids: string[] }>(
        "SELECT block_ids FROM doc_folds WHERE user_id = $1 AND doc_id = $2",
        [u.id, id],
      )
    ).rows[0];
    return { block_ids: row?.block_ids ?? [] };
  });

  app.put("/docs/:id/folds", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { block_ids } = docFoldsInput.parse(r.body ?? {});
    const seen = (
      await pool.query(`SELECT 1 FROM docs d WHERE d.id = $2 AND ${VISIBLE}`, [
        u.id,
        id,
      ])
    ).rowCount;
    if (!seen) fail(404, "Document not found");
    const { after } = await setFolds(pool, u.id, id, block_ids);
    return { block_ids: after };
  });

  /**
   * A page's other names (LNK-03), such as a course code. Like its tags,
   * they aren't the page's words, so its version stays and open editors are
   * only told to read them again.
   */
  /**
   * A page's cover and icon (W6). Its version stays; open editors are told
   * to read them again, as for its other names.
   */
  app.put("/docs/:id/look", async (r): Promise<Look> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const look = lookInput.parse(r.body ?? {});
    const { version, after } = await transaction((db) =>
      setLook(db, u, id, look),
    );
    await announceDocChange(pool, id, version, "look", { tags: true }).catch(
      () => {},
    );
    return after;
  });

  app.put("/docs/:id/aliases", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { aliases } = z
      .object({ aliases: aliasesInput })
      .strict()
      .parse(r.body ?? {});
    const version = await transaction(
      async (db) => (await setAliases(db, u, id, aliases)).version,
    );
    await announceDocChange(pool, id, version, "aliases", { tags: true }).catch(
      () => {},
    );
    return { aliases };
  });
}
