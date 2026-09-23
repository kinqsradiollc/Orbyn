import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  docCommentInput,
  docCommentUpdate,
  docInput,
  docListQuery,
  itemData,
  docPreview,
  docSuggestionInput,
  docToHtml,
  docToMarkdown,
  docToText,
  docUpdate,
  EXPORT_FORMATS,
  EXPORT_LABELS,
  exportName,
  fail,
  applySuggestion,
  overlaps,
  reanchorComments,
  reanchorSuggestions,
  meetingNoteTemplate,
  serializeDoc,
  type Doc,
  type DocBlock,
  type DocComment,
  type DocSuggestion,
  type DocSummary,
  type DocVersion,
  type Item,
} from "@orbyn/core";
import {
  pool,
  reader,
  transaction,
  type Db,
  type Queryable,
} from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam, VISIBLE_ITEMS } from "../../lib/teams.js";
import { loadPrefs } from "../planner/calendar.js";
import { mutate } from "../items/service.js";
import { announceDocChange } from "./live.js";
import { todaysAgenda } from "./agenda.js";
import { docToDocx } from "./docx.js";
import { docToPdf } from "./pdf.js";

/**
 * Documents: notes, briefs and agendas. Personal documents belong to their
 * author; team documents follow the same team roles as team items (viewers
 * read, members and above write). Edits carry the version they were made
 * against, so two open tabs can't silently overwrite each other.
 */

export const COLUMNS = `d.id, d.user_id, d.team_id, t.name AS team_name, d.title, d.kind,
  d.item_id, d.project_id, p.name AS project_name, d.folder_id, d.version,
  d.created_at, d.updated_at, d.reviewed_at,
  coalesce((SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name,
                                              'color', tg.color) ORDER BY tg.name)
              FROM doc_tags dt JOIN tags tg ON tg.id = dt.tag_id
             WHERE dt.doc_id = d.id), '[]'::json) AS tags`;

/** Joined wherever `COLUMNS` is selected, for the project a note hangs off. */
export const JOINS = `LEFT JOIN teams t ON t.id = d.team_id
  LEFT JOIN projects p ON p.id = d.project_id`;

/**
 * A comment as the clients read it: its anchor, its thread, and the people
 * named in it gathered into one array so a card needs no second request.
 */
const COMMENT_SELECT = `SELECT c.id, c.doc_id, c.user_id, u.name AS author, c.body,
         c.block_id, c.quote, c.range_start, c.range_end, c.parent_id,
         c.detached, c.resolved_at, c.created_at,
         coalesce((SELECT json_agg(json_build_object('user_id', mu.id, 'name', mu.name)
                                   ORDER BY mu.name)
                     FROM doc_comment_mentions m JOIN users mu ON mu.id = m.user_id
                    WHERE m.comment_id = c.id), '[]'::json) AS mentions
    FROM doc_comments c JOIN users u ON u.id = c.user_id`;

/** Documents `$1` can see: their own, and their teams'. */
const VISIBLE = `((d.team_id IS NULL AND d.user_id = $1)
  OR d.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

/**
 * A page may hang off a task, a project or a folder only in its own space:
 * a personal page off the author's own things, a team page off that team's.
 * Anything else is "not found" — the same answer as for an id that doesn't
 * exist, so ids from another space reveal nothing.
 */
async function checkLinks(
  db: Queryable,
  u: UserRow,
  teamId: string | null,
  links: {
    item_id?: string | null;
    project_id?: string | null;
    folder_id?: string | null;
  },
) {
  const inSpace = (alias: string) =>
    `${alias}.team_id IS NOT DISTINCT FROM $2::uuid
       AND (${alias}.team_id IS NOT NULL OR ${alias}.user_id = $1)
       AND (${alias}.team_id IS NULL OR ${alias}.team_id IN
         (SELECT team_id FROM team_members WHERE user_id = $1))`;
  for (const [id, table, alias, name] of [
    [links.item_id, "items", "i", "Task"],
    [links.project_id, "projects", "p", "Project"],
    [links.folder_id, "folders", "f", "Folder"],
  ] as const) {
    if (!id) continue;
    const found = (
      await db.query(
        `SELECT 1 FROM ${table} ${alias} WHERE ${alias}.id = $3 AND ${inSpace(alias)}`,
        [u.id, teamId, id],
      )
    ).rowCount;
    if (!found) fail(404, `${name} not found`);
  }
}

type Owned = {
  id: string;
  user_id: string;
  team_id: string | null;
  version: number;
};

async function requireDoc(
  db: Db,
  id: string,
  u: UserRow,
  permission: "items:read" | "items:write",
): Promise<Owned> {
  const row = (
    await db.query<Owned>(
      "SELECT id, user_id, team_id, version FROM docs WHERE id = $1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Document not found");
  if (row.team_id) await requireTeam(row.team_id, u, permission, db);
  else if (row.user_id !== u.id) fail(404, "Document not found");
  return row;
}

/**
 * Show a document's checklist as its tasks actually stand. A line that became
 * a task follows the task, so ticking it in the planner ticks it here too.
 */
async function withTaskState(
  db: Queryable,
  docId: string,
  content: DocBlock[],
): Promise<DocBlock[]> {
  const ids = content.flatMap((b) => (b.type === "todo" && b.id ? [b.id] : []));
  if (!ids.length) return content;
  const rows = (
    await db.query<{ block_id: string; status: string }>(
      `SELECT l.block_id, i.status FROM doc_task_links l
         JOIN items i ON i.id = l.item_id
        WHERE l.doc_id = $1 AND l.block_id = ANY($2::text[])`,
      [docId, ids],
    )
  ).rows;
  if (!rows.length) return content;
  const done = new Map(rows.map((r) => [r.block_id, r.status === "done"]));
  return content.map((b) =>
    b.type === "todo" && b.id && done.has(b.id)
      ? { ...b, done: done.get(b.id)! }
      : b,
  );
}

/**
 * Ticking a linked line in a document finishes its task, and unticking one
 * reopens it. Only lines whose state actually changed are written, so an
 * ordinary edit doesn't touch the planner.
 */
async function syncTicks(
  db: Db,
  docId: string,
  content: DocBlock[],
): Promise<void> {
  const ticks = new Map(
    content.flatMap((b) =>
      b.type === "todo" && b.id ? [[b.id, b.done] as const] : [],
    ),
  );
  if (!ticks.size) return;
  const rows = (
    await db.query<{ block_id: string; item_id: string; status: string }>(
      `SELECT l.block_id, l.item_id, i.status FROM doc_task_links l
         JOIN items i ON i.id = l.item_id
        WHERE l.doc_id = $1 AND l.block_id = ANY($2::text[])
        FOR UPDATE OF i`,
      [docId, [...ticks.keys()]],
    )
  ).rows;
  for (const row of rows) {
    const wanted = ticks.get(row.block_id);
    if (wanted === undefined) continue;
    const isDone = row.status === "done";
    if (wanted === isDone) continue;
    await db.query(
      `UPDATE items SET status = $2, progress = $3, updated_at = now()
        WHERE id = $1`,
      [row.item_id, wanted ? "done" : "todo", wanted ? 100 : 0],
    );
  }
}

/**
 * Keep every remark pointing at the words it was written about.
 *
 * An edit before a remark's words moves them along the line; an edit that
 * takes the words away leaves the remark with nothing to point at. Rather
 * than throw it away, the remark is marked detached and shown apart with the
 * words it quoted, so a thought survives the sentence it was about. Only the
 * remarks whose anchor actually moved are written.
 */
async function followComments(
  db: Db,
  docId: string,
  content: DocBlock[],
): Promise<void> {
  const comments = (
    await db.query<DocComment>(
      `SELECT id, block_id, quote, range_start, range_end, detached
         FROM doc_comments WHERE doc_id = $1 AND resolved_at IS NULL`,
      [docId],
    )
  ).rows;
  if (!comments.length) return;
  for (const moved of reanchorComments(comments, content))
    await db.query(
      `UPDATE doc_comments SET range_start = $2, range_end = $3, detached = $4
        WHERE id = $1`,
      [moved.id, moved.range_start, moved.range_end, moved.detached],
    );
}

/**
 * Keep open proposals pointing at the words they would change. A proposal
 * whose words have gone cannot be written anywhere sensible, so it comes
 * loose and is shown as needing a fresh look rather than applied blind.
 */
async function followSuggestions(
  db: Db,
  docId: string,
  content: DocBlock[],
): Promise<void> {
  const open = (
    await db.query<DocSuggestion>(
      `SELECT id, block_id, quote, range_start, range_end, detached
         FROM doc_suggestions WHERE doc_id = $1 AND status = 'open'`,
      [docId],
    )
  ).rows;
  if (!open.length) return;
  for (const moved of reanchorSuggestions(open, content))
    await db.query(
      `UPDATE doc_suggestions SET range_start = $2, range_end = $3, detached = $4
        WHERE id = $1`,
      [moved.id, moved.range_start, moved.range_end, moved.detached],
    );
}

/**
 * Put a page's tags where the caller asked, from the vocabulary they can
 * already use: their own tags, or their team's. A tag id that is neither is
 * quietly left out rather than failing the save — the page is what matters.
 */
async function setTags(
  db: Db,
  docId: string,
  u: UserRow,
  teamId: string | null,
  tagIds: string[],
): Promise<void> {
  await db.query("DELETE FROM doc_tags WHERE doc_id = $1", [docId]);
  if (!tagIds.length) return;
  await db.query(
    `INSERT INTO doc_tags (doc_id, tag_id)
       SELECT $1, id FROM tags
        WHERE id = ANY($2::uuid[])
          AND (user_id = $3 OR (team_id IS NOT NULL AND team_id = $4))
     ON CONFLICT DO NOTHING`,
    [docId, [...new Set(tagIds)], u.id, teamId],
  );
}

/** A checklist line as the fields `mutate` needs to create a task. */
function itemFromLine(text: string, teamId: string | null) {
  return itemData.parse({
    title: text.trim().slice(0, 200),
    kind: "task",
    team_id: teamId,
  });
}

export async function docRoutes(app: FastifyInstance) {
  /** The documents someone can see, newest edit first. */
  app.get("/docs", async (r) => {
    const u = await authenticate(r);
    const q = docListQuery.parse(r.query ?? {});
    const rows = (
      await reader(r.headers).query<DocSummary & { content: DocBlock[] }>(
        `SELECT ${COLUMNS}, d.content FROM docs d ${JOINS}
          WHERE ${VISIBLE}
            AND ($2::text IS NULL OR d.kind = $2)
            AND ($3::uuid IS NULL OR d.project_id = $3)
            AND ($4::uuid IS NULL OR EXISTS (
                  SELECT 1 FROM doc_tags dt
                   WHERE dt.doc_id = d.id AND dt.tag_id = $4))
          ORDER BY d.updated_at DESC
          LIMIT 200`,
        [u.id, q.kind ?? null, q.project ?? null, q.tag ?? null],
      )
    ).rows;
    // The preview is derived here so the list stays light on the wire.
    return rows.map(({ content, ...rest }) => ({
      ...rest,
      preview: docPreview(content ?? []),
    }));
  });

  app.post("/docs", async (r, reply) => {
    const u = await authenticate(r);
    const data = docInput.parse(r.body ?? {});
    if (data.team_id) await requireTeam(data.team_id, u, "items:write");
    await checkLinks(pool, u, data.team_id ?? null, data);
    const doc = await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO docs (user_id, team_id, title, kind, content, item_id,
             folder_id, project_id)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING id`,
          [
            u.id,
            data.team_id,
            data.title,
            data.kind,
            JSON.stringify(data.content),
            data.item_id,
            data.folder_id,
            data.project_id,
          ],
        )
      ).rows[0].id;
      await setTags(db, id, u, data.team_id, data.tags);
      return (
        await db.query<Doc>(
          `SELECT ${COLUMNS}, d.content FROM docs d
             ${JOINS} WHERE d.id = $1`,
          [id],
        )
      ).rows[0];
    });
    reply.code(201);
    return doc;
  });

  app.get("/docs/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const doc = (
      await db.query<Doc>(
        `SELECT ${COLUMNS}, d.content FROM docs d ${JOINS}
          WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    return { ...doc, content: await withTaskState(db, id, doc.content ?? []) };
  });

  /** Export as Markdown, with any LaTeX kept as source. */
  /**
   * A page as a file to keep: Markdown, plain words, a web page, Word or
   * PDF. One route rather than five, because the only thing that differs is
   * the shape the same blocks come out in.
   */
  app.get("/docs/:id/export", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { format } = z
      .object({ format: z.enum(EXPORT_FORMATS).default("md") })
      .strict()
      .parse(r.query ?? {});
    const doc = (
      await reader(r.headers).query<{ title: string; content: DocBlock[] }>(
        `SELECT d.title, d.content FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    const title = doc.title || "Untitled";
    const blocks = doc.content ?? [];
    const body =
      format === "docx"
        ? docToDocx(title, blocks)
        : format === "pdf"
          ? docToPdf(title, blocks)
          : format === "html"
            ? docToHtml(title, blocks)
            : format === "txt"
              ? docToText(title, blocks)
              : docToMarkdown(title, blocks);
    return (
      reply
        .type(`${EXPORT_LABELS[format].type}; charset=utf-8`)
        // The name is offered here so every client gets the same file name.
        .header(
          "content-disposition",
          `attachment; filename="${exportName(title, format).replace(/"/g, "")}"`,
        )
        .send(body)
    );
  });

  app.get("/docs/:id/markdown", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const doc = (
      await reader(r.headers).query<{ title: string; content: DocBlock[] }>(
        `SELECT d.title, d.content FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    return reply
      .type("text/markdown; charset=utf-8")
      .send(`# ${doc.title}\n\n${serializeDoc(doc.content ?? [])}`);
  });

  // Let go of the listening connection when the server stops.

  /**
   * Which open editor a request came from. Two tabs belonging to the same
   * person are two editors, so this is the tab's own id rather than the
   * user's; a tab should not be told about the change it just made itself.
   */
  const editorOf = (r: { headers: Record<string, unknown> }) =>
    typeof r.headers["x-orbyn-editor"] === "string"
      ? (r.headers["x-orbyn-editor"] as string).slice(0, 64)
      : "";

  app.put("/docs/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = docUpdate.parse(r.body);
    const saved = await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      const current = await requireDoc(db, id, u, "items:write");
      await checkLinks(db, u, current.team_id, {
        project_id: body.project_id,
        folder_id: body.folder_id,
      });
      if (current.version !== body.version)
        fail(
          409,
          "This document changed somewhere else. Refresh and try again.",
        );
      if (body.content) await syncTicks(db, id, body.content);
      if (body.content) await followComments(db, id, body.content);
      if (body.content) await followSuggestions(db, id, body.content);
      await snapshot(db, id, u.id);
      await db.query(
        `UPDATE docs SET
           title = coalesce($2, title),
           content = coalesce($3::jsonb, content),
           folder_id = CASE WHEN $4::boolean THEN $5::uuid ELSE folder_id END,
           project_id = CASE WHEN $6::boolean THEN $7::uuid ELSE project_id END,
           version = version + 1,
           updated_at = now()
         WHERE id = $1`,
        [
          id,
          body.title ?? null,
          body.content === undefined ? null : JSON.stringify(body.content),
          body.folder_id !== undefined,
          body.folder_id ?? null,
          body.project_id !== undefined,
          body.project_id ?? null,
        ],
      );
      if (body.tags) await setTags(db, id, u, current.team_id, body.tags);
      return (
        await db.query<Doc>(
          `SELECT ${COLUMNS}, d.content FROM docs d
             ${JOINS} WHERE d.id = $1`,
          [id],
        )
      ).rows[0];
    });
    // Announced after the transaction commits, so anyone who comes running
    // to re-read the document finds the new version already there.
    await announceDocChange(pool, id, saved.version, editorOf(r));
    return saved;
  });

  /**
   * Keep the state a save is about to replace. Saves come every second or
   * so while someone types, so a state is kept only when the last kept one
   * is by someone else or older than a sitting; history then reads as a
   * list of sittings, not keystrokes.
   */
  const SITTING = "5 minutes";
  async function snapshot(db: Queryable, docId: string, byUser: string) {
    const current = (
      await db.query<{ version: number; title: string; content: unknown }>(
        "SELECT version, title, content FROM docs WHERE id = $1",
        [docId],
      )
    ).rows[0];
    if (!current) return;
    const last = (
      await db.query<{ user_id: string | null; recent: boolean }>(
        `SELECT user_id, created_at > now() - $2::interval AS recent
           FROM doc_versions WHERE doc_id = $1
           ORDER BY version DESC LIMIT 1`,
        [docId, SITTING],
      )
    ).rows[0];
    if (last && last.recent && last.user_id === byUser) return;
    await db.query(
      `INSERT INTO doc_versions (doc_id, version, title, content, user_id)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (doc_id, version) DO NOTHING`,
      [
        docId,
        current.version,
        current.title,
        JSON.stringify(current.content),
        byUser,
      ],
    );
  }

  const VERSION_COLUMNS = `v.version, v.title, v.created_at, v.user_id,
    us.name AS author, jsonb_array_length(v.content) AS blocks`;

  /** 404 unless the reader may see this document. */
  async function mustSee(db: Queryable, id: string, u: UserRow) {
    const row = (
      await db.query<{ id: string }>(
        `SELECT d.id FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!row) fail(404, "Document not found");
  }

  /** Past states of a document, newest first. */
  app.get("/docs/:id/versions", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await mustSee(reader(r.headers), id, u);
    return (
      await reader(r.headers).query<DocVersion>(
        `SELECT ${VERSION_COLUMNS} FROM doc_versions v
           LEFT JOIN users us ON us.id = v.user_id
           WHERE v.doc_id = $1 ORDER BY v.version DESC LIMIT 200`,
        [id],
      )
    ).rows;
  });

  /** One past state, with its content, to read or compare. */
  app.get("/docs/:id/versions/:version", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const n = Number((r.params as { version: string }).version);
    if (!Number.isInteger(n) || n < 1) fail(422, "Not a version");
    await mustSee(reader(r.headers), id, u);
    const row = (
      await reader(r.headers).query<DocVersion>(
        `SELECT ${VERSION_COLUMNS}, v.content FROM doc_versions v
           LEFT JOIN users us ON us.id = v.user_id
           WHERE v.doc_id = $1 AND v.version = $2`,
        [id, n],
      )
    ).rows[0];
    if (!row) fail(404, "That version is not kept");
    return row;
  });

  /**
   * Put a past state back. It becomes a new version on top, so history is
   * only ever added to; the state being replaced is kept like any other.
   */
  app.post("/docs/:id/versions/:version/restore", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const n = Number((r.params as { version: string }).version);
    if (!Number.isInteger(n) || n < 1) fail(422, "Not a version");
    const restored = await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      await requireDoc(db, id, u, "items:write");
      const past = (
        await db.query<{ title: string; content: DocBlock[] }>(
          "SELECT title, content FROM doc_versions WHERE doc_id = $1 AND version = $2",
          [id, n],
        )
      ).rows[0];
      if (!past) fail(404, "That version is not kept");
      await syncTicks(db, id, past.content);
      // Going back in time moves the words a remark points at, so the same
      // pass a save makes runs here too — a remark left behind by a restore
      // comes loose rather than pointing at the wrong sentence.
      await followComments(db, id, past.content);
      await followSuggestions(db, id, past.content);
      // A restore is a sitting of its own: always keep what it replaces.
      const current = (
        await db.query<{ version: number; title: string; content: unknown }>(
          "SELECT version, title, content FROM docs WHERE id = $1",
          [id],
        )
      ).rows[0];
      await db.query(
        `INSERT INTO doc_versions (doc_id, version, title, content, user_id)
           VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT (doc_id, version) DO NOTHING`,
        [
          id,
          current.version,
          current.title,
          JSON.stringify(current.content),
          u.id,
        ],
      );
      await db.query(
        `UPDATE docs SET title = $2, content = $3::jsonb, version = version + 1,
           updated_at = now() WHERE id = $1`,
        [id, past.title, JSON.stringify(past.content)],
      );
      return (
        await db.query<Doc>(
          `SELECT ${COLUMNS}, d.content FROM docs d
             ${JOINS} WHERE d.id = $1`,
          [id],
        )
      ).rows[0];
    });
    await announceDocChange(pool, id, restored.version, editorOf(r));
    return restored;
  });

  // A document's changes as they happen are streamed by the realtime
  // service (modules/realtime), which holds the long-lived connections.

  /**
   * Today's agenda. Written once per day from the calendar (see agenda.ts)
   * and then kept as an ordinary document, so edits survive; asking again
   * the same day returns the same page rather than overwriting what you
   * wrote. It never waits on the AI provider: the worker writes the morning's
   * page with the assistant's summary, and "Rewrite" asks for one.
   */
  app.get("/agenda/today", async (r) => {
    const u = await authenticate(r);
    return todaysAgenda(u.id);
  });

  /**
   * The note for one event, created from a template the first time it's
   * opened. It belongs to whoever opened it, and to the event's team when it
   * has one, so a shared meeting keeps one shared note.
   */
  app.post("/items/:id/note", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const event = (
      await pool.query<{
        id: string;
        title: string;
        due_at: Date | null;
        location: string;
        team_id: string | null;
        user_id: string;
      }>(
        `SELECT i.id, i.title, i.due_at, i.location, i.team_id, i.user_id
           FROM items i WHERE i.id = $2 AND ${VISIBLE_ITEMS}`,
        [u.id, id],
      )
    ).rows[0];
    if (!event) fail(404, "Item not found");

    const existing = (
      await pool.query<Doc>(
        `SELECT ${COLUMNS}, d.content FROM docs d ${JOINS}
          WHERE d.item_id = $2 AND d.kind = 'meeting'
            AND d.team_id IS NOT DISTINCT FROM $3::uuid AND ${VISIBLE}
          ORDER BY d.created_at LIMIT 1`,
        [u.id, id, event.team_id],
      )
    ).rows[0];
    if (existing) return existing;

    const prefs = await loadPrefs(pool, u.id);
    const content = meetingNoteTemplate({
      title: event.title,
      due_at: event.due_at ? event.due_at.toISOString() : null,
      location: event.location,
      timeZone: prefs.timezone || "UTC",
    });
    const doc = await transaction(async (db) => {
      const newId = (
        await db.query<{ id: string }>(
          `INSERT INTO docs (user_id, team_id, title, kind, content, item_id)
             VALUES ($1,$2,$3,'meeting',$4::jsonb,$5) RETURNING id`,
          [u.id, event.team_id, event.title, JSON.stringify(content), id],
        )
      ).rows[0].id;
      return (
        await db.query<Doc>(
          `SELECT ${COLUMNS}, d.content FROM docs d
             ${JOINS} WHERE d.id = $1`,
          [newId],
        )
      ).rows[0];
    });
    reply.code(201);
    return doc;
  });

  /**
   * Turn a document's unticked checklist lines into real tasks. Blank lines
   * are skipped, and the answer says how many were made, so the page can tell
   * you plainly.
   */
  app.post("/docs/:id/tasks", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const doc = (
      await pool.query<{ content: DocBlock[]; team_id: string | null }>(
        `SELECT d.content, d.team_id FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    const content = doc.content ?? [];
    const wanted = content.filter(
      (b): b is Extract<DocBlock, { type: "todo" }> =>
        b.type === "todo" && !b.done && b.text.trim().length > 0,
    );
    // A line that is already tied to a task is not made again.
    const linked = new Set(
      (
        await pool.query<{ block_id: string }>(
          "SELECT block_id FROM doc_task_links WHERE doc_id = $1",
          [id],
        )
      ).rows.map((r) => r.block_id),
    );
    const lines = wanted.filter((b) => !b.id || !linked.has(b.id));
    if (!lines.length) return { created: 0, items: [], doc: null };

    // Each line gets a stable id, so the link survives later edits.
    const ids = new Map(lines.map((b) => [b, b.id ?? randomUUID()]));
    const made = await transaction(async (db) => {
      const out = [];
      for (const line of lines) {
        const item = await mutate(db, u, {
          operation: "create",
          data: itemFromLine(line.text, doc.team_id),
        });
        if (!item) continue;
        await db.query(
          `INSERT INTO doc_task_links (doc_id, block_id, item_id)
             VALUES ($1,$2,$3)
             ON CONFLICT (doc_id, block_id) DO UPDATE SET item_id = $3`,
          [id, ids.get(line), item.id],
        );
        out.push(item);
      }
      // Write the ids back so the document knows which lines are tied.
      const next = content.map((b) =>
        ids.has(b as Extract<DocBlock, { type: "todo" }>)
          ? { ...b, id: ids.get(b as Extract<DocBlock, { type: "todo" }>) }
          : b,
      );
      await db.query(
        "UPDATE docs SET content = $2::jsonb, version = version + 1, updated_at = now() WHERE id = $1",
        [id, JSON.stringify(next)],
      );
      return out;
    });
    const updated = (
      await pool.query<Doc>(
        `SELECT ${COLUMNS}, d.content FROM docs d
           ${JOINS} WHERE d.id = $1`,
        [id],
      )
    ).rows[0];
    await announceDocChange(pool, id, updated.version, editorOf(r));
    return {
      created: made.length,
      items: made,
      doc: {
        ...updated,
        content: await withTaskState(pool, id, updated.content ?? []),
      },
    };
  });

  /** Everyone's remarks on a document, oldest first. */
  app.get("/docs/:id/comments", async (r) => {
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
    return (
      await db.query<DocComment>(
        `${COMMENT_SELECT} WHERE c.doc_id = $1 ORDER BY c.created_at`,
        [id],
      )
    ).rows;
  });

  /**
   * Who can be named in a comment here: the team, or just the author on a
   * personal page. The picker never offers someone who cannot read it.
   */
  app.get("/docs/:id/people", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const doc = (
      await db.query<{ team_id: string | null; user_id: string }>(
        `SELECT d.team_id, d.user_id FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    return (
      await db.query<{ id: string; name: string; email: string }>(
        doc.team_id
          ? `SELECT u.id, u.name, u.email FROM users u
               JOIN team_members m ON m.user_id = u.id AND m.team_id = $1
              ORDER BY u.name`
          : "SELECT id, name, email FROM users WHERE id = $1",
        [doc.team_id ?? doc.user_id],
      )
    ).rows;
  });

  app.post("/docs/:id/comments", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const input = docCommentInput.parse(r.body);
    const comment = await transaction(async (db) => {
      // Anyone who can read the document can remark on it.
      const doc = await requireDoc(db, id, u, "items:read");
      if (input.parent_id) {
        // A reply belongs to a remark on this page, and threads stay one
        // deep: replying to a reply joins the same thread.
        const parent = (
          await db.query<{ id: string; parent_id: string | null }>(
            "SELECT id, parent_id FROM doc_comments WHERE id = $1 AND doc_id = $2",
            [input.parent_id, id],
          )
        ).rows[0];
        if (!parent) fail(404, "Comment not found");
        input.parent_id = parent.parent_id ?? parent.id;
      }
      const made = (
        await db.query<{ id: string }>(
          `INSERT INTO doc_comments
             (doc_id, user_id, body, block_id, quote,
              range_start, range_end, parent_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            id,
            u.id,
            input.body,
            input.block_id ?? null,
            input.quote ?? null,
            input.range_start ?? null,
            input.range_end ?? null,
            input.parent_id ?? null,
          ],
        )
      ).rows[0].id;
      await nameMentions(db, doc, made, u, input.body, input.mentions);
      return (
        await db.query<DocComment>(`${COMMENT_SELECT} WHERE c.id = $1`, [made])
      ).rows[0];
    });
    reply.code(201);
    return comment;
  });

  /**
   * Record who a comment names, and tell them.
   *
   * Only people who can already see the document can be named: a mention is
   * not a way to show a page to someone who has no business reading it. The
   * notice is kept to one per person per comment by its ref.
   */
  async function nameMentions(
    db: Db,
    doc: Owned,
    commentId: string,
    by: UserRow,
    body: string,
    wanted: string[],
  ) {
    const ids = [...new Set(wanted)].filter((w) => w !== by.id);
    if (!ids.length) return;
    const allowed = (
      await db.query<{ id: string; name: string }>(
        doc.team_id
          ? `SELECT u.id, u.name FROM users u
               JOIN team_members m ON m.user_id = u.id AND m.team_id = $2
              WHERE u.id = ANY($1::uuid[])`
          : `SELECT u.id, u.name FROM users u WHERE u.id = ANY($1::uuid[]) AND u.id = $2`,
        [ids, doc.team_id ?? doc.user_id],
      )
    ).rows;
    if (!allowed.length) return;
    await db.query(
      `INSERT INTO doc_comment_mentions (comment_id, user_id)
         SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [commentId, allowed.map((a) => a.id)],
    );
    const title = (
      await db.query<{ title: string }>(
        "SELECT title FROM docs WHERE id = $1",
        [doc.id],
      )
    ).rows[0]?.title;
    for (const person of allowed)
      await db.query(
        `INSERT INTO notifications (user_id, item_id, item_version, channel,
           destination, title, body, state, kind, ref)
         VALUES ($1, NULL, 0, 'inapp', '', $2, $3, 'sent', 'mention', $4)
         ON CONFLICT DO NOTHING`,
        [
          person.id,
          `${by.name} mentioned you in ${title ?? "a document"}`,
          body.slice(0, 400),
          `doc:${doc.id}:${commentId}`,
        ],
      );
  }

  /** Resolve a remark, or bring it back. */
  app.put("/docs/:id/comments/:commentId", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const commentId = String((r.params as { commentId: string }).commentId);
    const { resolved } = docCommentUpdate.parse(r.body);
    return transaction(async (db) => {
      await requireDoc(db, id, u, "items:read");
      const updated = (
        await db.query<DocComment>(
          `UPDATE doc_comments SET resolved_at = CASE WHEN $3 THEN now() ELSE NULL END
            WHERE id = $1 AND doc_id = $2
            RETURNING id, doc_id, user_id, body, resolved_at, created_at`,
          [commentId, id, resolved],
        )
      ).rows[0];
      if (!updated) fail(404, "Comment not found");
      return updated;
    });
  });

  /** Only the person who wrote a remark can take it back. */
  app.delete("/docs/:id/comments/:commentId", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const commentId = String((r.params as { commentId: string }).commentId);
    await transaction(async (db) => {
      await requireDoc(db, id, u, "items:read");
      const gone = (
        await db.query(
          "DELETE FROM doc_comments WHERE id = $1 AND doc_id = $2 AND user_id = $3",
          [commentId, id, u.id],
        )
      ).rowCount;
      if (!gone) fail(404, "Comment not found");
    });
    reply.code(204);
  });

  // --- Proposed changes --------------------------------------------------

  const SUGGESTION_SELECT = `SELECT s.id, s.doc_id, s.block_id, s.user_id,
         u.name AS author, s.kind, s.range_start, s.range_end, s.text,
         s.quote, s.note, s.status, s.detached, s.created_at
    FROM doc_suggestions s JOIN users u ON u.id = s.user_id`;

  /** Every proposal on a page, oldest first. */
  app.get("/docs/:id/suggestions", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    await mustSee(db, id, u);
    return (
      await db.query<DocSuggestion>(
        `${SUGGESTION_SELECT} WHERE s.doc_id = $1 ORDER BY s.created_at`,
        [id],
      )
    ).rows;
  });

  /**
   * Propose changes to a page. Anyone who can read it may propose, which is
   * the point: a proposal is a way to say something about the words without
   * being trusted to change them.
   */
  app.post("/docs/:id/suggestions", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { changes, note } = docSuggestionInput.parse(r.body);
    const made = await transaction(async (db) => {
      await requireDoc(db, id, u, "items:read");
      const ids: string[] = [];
      for (const c of changes)
        ids.push(
          (
            await db.query<{ id: string }>(
              `INSERT INTO doc_suggestions
                 (doc_id, user_id, block_id, kind, range_start, range_end,
                  text, quote, note)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
              [
                id,
                u.id,
                c.block_id,
                c.kind,
                c.range_start,
                c.range_end,
                c.text,
                c.quote,
                note,
              ],
            )
          ).rows[0].id,
        );
      return (
        await db.query<DocSuggestion>(
          `${SUGGESTION_SELECT} WHERE s.id = ANY($1::uuid[]) ORDER BY s.created_at`,
          [ids],
        )
      ).rows;
    });
    reply.code(201);
    return made;
  });

  /**
   * Take a proposal, or leave it. Only someone who may change the page can
   * decide; proposing is open to every reader, deciding is not.
   *
   * Accepting writes the change into the line and bumps the page's version,
   * so it shows in history as an ordinary edit with the accepter's name on
   * it. Any other open proposal over the same words would then be written
   * against words that are no longer there, so it comes loose and is shown
   * as needing a fresh look.
   */
  app.post("/docs/:id/suggestions/:sid", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const sid = String((r.params as { sid: string }).sid);
    const { take } = z
      .object({ take: z.boolean() })
      .strict()
      .parse(r.body ?? {});
    const out = await transaction(async (db) => {
      await requireDoc(db, id, u, "items:write");
      const s = (
        await db.query<DocSuggestion>(
          `${SUGGESTION_SELECT} WHERE s.id = $1 AND s.doc_id = $2 FOR UPDATE OF s`,
          [sid, id],
        )
      ).rows[0];
      if (!s) fail(404, "Suggestion not found");
      if (s.status !== "open") fail(409, "That suggestion was already decided");
      if (!take) {
        await db.query(
          `UPDATE doc_suggestions SET status = 'rejected', resolved_by = $2,
             resolved_at = now() WHERE id = $1`,
          [sid, u.id],
        );
        return null;
      }
      if (s.detached)
        fail(
          409,
          "The words this was about have gone from the page. Look at it again.",
        );
      const doc = (
        await db.query<{ content: DocBlock[]; title: string }>(
          "SELECT content, title FROM docs WHERE id = $1",
          [id],
        )
      ).rows[0];
      const at = doc.content.findIndex((b) => b.id === s.block_id);
      if (at === -1) fail(409, "That line has gone from the page.");
      const block = doc.content[at];
      if (block.type === "divider") fail(409, "That line has no words.");
      const next = doc.content.slice();
      next[at] = { ...block, text: applySuggestion(block.text, s) };
      await snapshot(db, id, u.id);
      await syncTicks(db, id, next);
      await db.query(
        `UPDATE docs SET content = $2::jsonb, version = version + 1,
           updated_at = now() WHERE id = $1`,
        [id, JSON.stringify(next)],
      );
      await db.query(
        `UPDATE doc_suggestions SET status = 'accepted', resolved_by = $2,
           resolved_at = now() WHERE id = $1`,
        [sid, u.id],
      );
      // Everything else on the page now points at words that may have moved.
      await followComments(db, id, next);
      await followSuggestions(db, id, next);
      // A proposal over the very same words can no longer be written.
      const rivals = (
        await db.query<DocSuggestion>(
          `${SUGGESTION_SELECT} WHERE s.doc_id = $1 AND s.status = 'open'
             AND s.block_id = $2 AND s.id <> $3`,
          [id, s.block_id, sid],
        )
      ).rows;
      for (const rival of rivals)
        if (overlaps(rival, s))
          await db.query(
            "UPDATE doc_suggestions SET detached = true WHERE id = $1",
            [rival.id],
          );
      return (
        await db.query<Doc>(
          `SELECT ${COLUMNS}, d.content FROM docs d
             ${JOINS} WHERE d.id = $1`,
          [id],
        )
      ).rows[0];
    });
    if (out) await announceDocChange(pool, id, out.version, editorOf(r));
    return { doc: out };
  });

  /** Take back a proposal you made. Only its author, and only while open. */
  app.delete("/docs/:id/suggestions/:sid", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const sid = String((r.params as { sid: string }).sid);
    await transaction(async (db) => {
      await requireDoc(db, id, u, "items:read");
      const gone = (
        await db.query(
          `DELETE FROM doc_suggestions
            WHERE id = $1 AND doc_id = $2 AND user_id = $3 AND status = 'open'`,
          [sid, id, u.id],
        )
      ).rowCount;
      if (!gone) fail(404, "Suggestion not found");
    });
    reply.code(204);
  });

  app.delete("/docs/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      await requireDoc(db, id, u, "items:write");
      await db.query("DELETE FROM docs WHERE id = $1", [id]);
    });
    reply.code(204);
  });
}
