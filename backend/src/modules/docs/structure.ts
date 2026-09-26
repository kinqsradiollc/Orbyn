import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  aliasesInput,
  blockText,
  docAnchorInput,
  docExtractInput,
  docFoldsInput,
  docMergeInput,
  fail,
  linkMarkdown,
  newBlockId,
  plainText,
  sectionOf,
  type Doc,
  type DocBlock,
} from "@orbyn/core";
import { pool, reader, transaction, type Db } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { announceDocChange } from "./live.js";
import {
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
} from "./routes.js";

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

/**
 * Take a page's remarks, proposed changes and task lines on `ids` over to
 * another page, so they go where the lines went. `rename` gives a line a
 * new id where the page it goes to already had one of that name.
 */
async function carryLines(
  db: Db,
  from: string,
  to: string,
  ids: string[],
  rename: Map<string, string> = new Map(),
) {
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

/** Save a page's lines as one change by `u` (history kept, version moved on). */
async function writeLines(
  db: Db,
  u: UserRow,
  docId: string,
  blocks: DocBlock[],
) {
  await snapshot(db, docId, u.id);
  return (
    await db.query<{ version: number }>(
      `UPDATE docs SET content = $2::jsonb, version = version + 1,
         updated_at = now() WHERE id = $1 RETURNING version`,
      [
        docId,
        JSON.stringify(
          blocks.length ? blocks : [{ type: "paragraph", text: "" }],
        ),
      ],
    )
  ).rows[0].version;
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
    const lines = block
      ? sectionOf(content, block)
      : content.slice(0, EMBED_LINES);
    return {
      doc_id: id,
      title: doc.title || "Untitled",
      block_id: block ?? null,
      // The line it pointed at has gone from the page.
      missing: !!block && !lines.length,
      more: !block && content.length > EMBED_LINES,
      blocks: lines,
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
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      await requireDoc(db, id, u, "items:write");
      const content =
        (
          await db.query<{ content: DocBlock[] | null }>(
            "SELECT content FROM docs WHERE id = $1",
            [id],
          )
        ).rows[0].content ?? [];
      const b = content[index];
      if (!b || blockText(b) !== text)
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
    const out = await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      const current = await requireDoc(db, id, u, "items:write");
      if (current.version !== body.version)
        fail(
          409,
          "This document changed somewhere else. Refresh and try again.",
        );
      const source = (
        await db.query<{
          content: DocBlock[] | null;
          project_id: string | null;
          folder_id: string | null;
        }>("SELECT content, project_id, folder_id FROM docs WHERE id = $1", [
          id,
        ])
      ).rows[0];
      const content = source.content ?? [];
      const wanted = new Set(body.block_ids);
      const moved = content.filter((b) => b.id && wanted.has(b.id));
      if (!moved.length) fail(409, "Those lines aren't on the page any more.");
      const title = body.title?.trim() || titleFor(moved);
      const newId = (
        await db.query<{ id: string }>(
          `INSERT INTO docs (user_id, team_id, title, kind, content, project_id,
             folder_id)
           VALUES ($1, $2, $3, 'doc', $4::jsonb, $5, $6) RETURNING id`,
          [
            u.id,
            current.team_id,
            title,
            JSON.stringify(moved),
            source.project_id,
            source.folder_id,
          ],
        )
      ).rows[0].id;
      // The link sits where the first moved line was.
      const first = content.findIndex((b) => b.id && wanted.has(b.id));
      const link: DocBlock = {
        type: "paragraph",
        id: newBlockId(),
        text: linkMarkdown({ kind: "doc", id: newId }, title),
      };
      const rest = content.flatMap((b, i) =>
        i === first ? [link] : b.id && wanted.has(b.id) ? [] : [b],
      );
      await carryLines(
        db,
        id,
        newId,
        moved.map((b) => b.id!),
      );
      await writeLines(db, u, id, rest);
      return {
        doc: (
          await db.query<Doc>(
            `SELECT ${COLUMNS}, d.content, ${LINKED} FROM docs d ${JOINS}
              WHERE d.id = $1`,
            [newId],
          )
        ).rows[0],
        source: await readDoc(db, id),
      };
    });
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
    if (body.into === id) fail(400, "A page can't be merged into itself.");
    const out = await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      // Locked in one order, so two merges the other way round can't deadlock.
      const [a, b] = [id, body.into].sort();
      const first = await requireDoc(db, a, u, "items:write");
      const second = await requireDoc(db, b, u, "items:write");
      const src = a === id ? first : second;
      const into = a === id ? second : first;
      if (src.version !== body.version)
        fail(
          409,
          "This document changed somewhere else. Refresh and try again.",
        );
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
        }>("SELECT id, title, content FROM docs WHERE id = ANY ($1::uuid[])", [
          [id, body.into],
        ])
      ).rows;
      const source = rows.find((x) => x.id === id)!;
      const target = rows.find((x) => x.id === body.into)!;
      const taken = new Set(
        (target.content ?? []).flatMap((x) => (x.id ? [x.id] : [])),
      );
      // A line whose name the other page already uses gets a new one.
      const rename = new Map<string, string>();
      const lines = (source.content ?? [])
        .filter((x) => !(x.type === "paragraph" && !x.text.trim()))
        .map((x) => {
          if (!x.id || !taken.has(x.id)) return x;
          const fresh = newBlockId();
          rename.set(x.id, fresh);
          return { ...x, id: fresh };
        });
      const heading: DocBlock[] =
        source.title.trim() && lines[0]?.type !== "heading"
          ? [
              {
                type: "heading",
                level: 2,
                id: newBlockId(),
                text: source.title.trim(),
              },
            ]
          : [];
      const merged = [...(target.content ?? []), ...heading, ...lines];
      await carryLines(
        db,
        id,
        body.into,
        (source.content ?? []).flatMap((x) => (x.id ? [x.id] : [])),
        rename,
      );
      const version = await writeLines(db, u, body.into, merged);
      // Links to the merged page, in pages you can change, now open the other.
      const rewritten = (
        await db.query<{ id: string; version: number }>(
          `UPDATE docs d
              SET content = replace(d.content::text, $2, $3)::jsonb,
                  version = d.version + 1, updated_at = now()
            WHERE d.id IN (
                    SELECT l.source_id FROM object_links l
                     WHERE l.source_kind = 'doc' AND l.link_kind = 'link'
                       AND l.target_kind = 'doc' AND l.target_id = $4
                     LIMIT 200)
              AND d.id <> $5 AND d.deleted_at IS NULL
              AND ((d.team_id IS NULL AND d.user_id = $1)
                OR d.team_id IN (SELECT team_id FROM team_members
                                  WHERE user_id = $1
                                    AND role IN ('owner', 'admin', 'member')))
            RETURNING d.id, d.version`,
          [u.id, `orbyn://doc/${id}`, `orbyn://doc/${body.into}`, id, id],
        )
      ).rows;
      await db.query(
        `UPDATE docs SET deleted_at = now(), deleted_by = $2, merged_into = $3
          WHERE id = $1`,
        [id, u.id, body.into],
      );
      await noteTrash(db, id, u.id, true);
      await searchTrash(db, id, true);
      return { version, rewritten, doc: await readDoc(db, body.into) };
    });
    await announceDocChange(pool, id, body.version, "merge", { trashed: true });
    await announceDocChange(pool, body.into, out.version, "merge");
    for (const p of out.rewritten)
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
    const ids = [...new Set(block_ids)];
    if (!ids.length)
      await pool.query(
        "DELETE FROM doc_folds WHERE user_id = $1 AND doc_id = $2",
        [u.id, id],
      );
    else
      await pool.query(
        `INSERT INTO doc_folds (user_id, doc_id, block_ids)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, doc_id)
           DO UPDATE SET block_ids = $3, updated_at = now()`,
        [u.id, id, ids],
      );
    return { block_ids: ids };
  });

  /**
   * A page's other names (LNK-03), such as a course code. Like its tags,
   * they aren't the page's words, so its version stays and open editors are
   * only told to read them again.
   */
  app.put("/docs/:id/aliases", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { aliases } = z
      .object({ aliases: aliasesInput })
      .strict()
      .parse(r.body ?? {});
    const version = await transaction(async (db) => {
      const doc = await requireDoc(db, id, u, "items:write");
      await db.query("UPDATE docs SET aliases = $2 WHERE id = $1", [
        id,
        aliases,
      ]);
      return doc.version;
    });
    await announceDocChange(pool, id, version, "aliases", { tags: true }).catch(
      () => {},
    );
    return { aliases };
  });
}
