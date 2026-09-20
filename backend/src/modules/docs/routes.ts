import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  agendaTitle,
  buildAgenda,
  docCommentInput,
  docCommentUpdate,
  docInput,
  itemData,
  docPreview,
  docUpdate,
  fail,
  meetingNoteTemplate,
  serializeDoc,
  type Doc,
  type DocBlock,
  type DocComment,
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
import { announceDocChange, closeLive, streamDocChanges } from "./live.js";

/**
 * Documents: notes, briefs and agendas. Personal documents belong to their
 * author; team documents follow the same team roles as team items (viewers
 * read, members and above write). Edits carry the version they were made
 * against, so two open tabs can't silently overwrite each other.
 */

const COLUMNS = `d.id, d.user_id, d.team_id, t.name AS team_name, d.title, d.kind,
  d.item_id, d.folder_id, d.version, d.created_at, d.updated_at`;

/** Documents `$1` can see: their own, and their teams'. */
const VISIBLE = `((d.team_id IS NULL AND d.user_id = $1)
  OR d.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

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
    const rows = (
      await reader(r.headers).query<DocSummary & { content: DocBlock[] }>(
        `SELECT ${COLUMNS}, d.content FROM docs d
           LEFT JOIN teams t ON t.id = d.team_id
          WHERE ${VISIBLE}
          ORDER BY d.updated_at DESC
          LIMIT 200`,
        [u.id],
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
    const doc = await transaction(async (db) => {
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO docs (user_id, team_id, title, kind, content, item_id, folder_id)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id`,
          [
            u.id,
            data.team_id,
            data.title,
            data.kind,
            JSON.stringify(data.content),
            data.item_id,
            data.folder_id,
          ],
        )
      ).rows[0].id;
      return (
        await db.query<Doc>(
          `SELECT ${COLUMNS}, d.content FROM docs d
             LEFT JOIN teams t ON t.id = d.team_id WHERE d.id = $1`,
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
        `SELECT ${COLUMNS}, d.content FROM docs d
           LEFT JOIN teams t ON t.id = d.team_id
          WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    return { ...doc, content: await withTaskState(db, id, doc.content ?? []) };
  });

  /** Export as Markdown, with any LaTeX kept as source. */
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
  app.addHook("onClose", () => closeLive());

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
      const current = await requireDoc(db, id, u, "items:write");
      if (current.version !== body.version)
        fail(
          409,
          "This document changed somewhere else. Refresh and try again.",
        );
      if (body.content) await syncTicks(db, id, body.content);
      await snapshot(db, id, u.id);
      await db.query(
        `UPDATE docs SET
           title = coalesce($2, title),
           content = coalesce($3::jsonb, content),
           folder_id = CASE WHEN $4::boolean THEN $5::uuid ELSE folder_id END,
           version = version + 1,
           updated_at = now()
         WHERE id = $1`,
        [
          id,
          body.title ?? null,
          body.content === undefined ? null : JSON.stringify(body.content),
          body.folder_id !== undefined,
          body.folder_id ?? null,
        ],
      );
      return (
        await db.query<Doc>(
          `SELECT ${COLUMNS}, d.content FROM docs d
             LEFT JOIN teams t ON t.id = d.team_id WHERE d.id = $1`,
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
      await requireDoc(db, id, u, "items:write");
      const past = (
        await db.query<{ title: string; content: DocBlock[] }>(
          "SELECT title, content FROM doc_versions WHERE doc_id = $1 AND version = $2",
          [id, n],
        )
      ).rows[0];
      if (!past) fail(404, "That version is not kept");
      await syncTicks(db, id, past.content);
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
             LEFT JOIN teams t ON t.id = d.team_id WHERE d.id = $1`,
          [id],
        )
      ).rows[0];
    });
    await announceDocChange(pool, id, restored.version, editorOf(r));
    return restored;
  });

  /**
   * A document's changes as they happen, for editors that have it open. The
   * stream carries only the news that the document moved on and to which
   * version; the editor then re-reads it and merges. That keeps the wire
   * small and means a reader that misses an event still catches up on the
   * next one.
   */
  app.get("/docs/:id/live", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const doc = (
      await reader(r.headers).query<{ id: string }>(
        `SELECT d.id FROM docs d WHERE d.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");

    const stop = await streamDocChanges(reply, id, editorOf(r));
    r.raw.on("close", stop);
    // Fastify must not also try to answer: the stream owns the response.
    return reply;
  });

  /**
   * Today's agenda. Generated once per day from the planner and then kept as
   * an ordinary document, so edits survive; asking again the same day returns
   * the same page rather than overwriting what you wrote.
   */
  app.get("/agenda/today", async (r) => {
    const u = await authenticate(r);
    const prefs = await loadPrefs(pool, u.id);
    const tz = prefs.timezone || "UTC";
    const now = new Date();
    const title = agendaTitle(now, tz);

    const existing = (
      await pool.query<Doc>(
        `SELECT ${COLUMNS}, d.content FROM docs d LEFT JOIN teams t ON t.id = d.team_id
          WHERE d.user_id = $1 AND d.kind = 'agenda' AND d.title = $2
          ORDER BY d.created_at DESC LIMIT 1`,
        [u.id, title],
      )
    ).rows[0];
    if (existing) return existing;

    const items = (
      await pool.query<Item>(
        `SELECT i.* FROM items i WHERE ${VISIBLE_ITEMS}
           AND i.due_at IS NOT NULL
         ORDER BY i.due_at LIMIT 500`,
        [u.id],
      )
    ).rows;
    const content = buildAgenda(items, { now, timeZone: tz });
    return transaction(async (db) => {
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO docs (user_id, title, kind, content)
             VALUES ($1,$2,'agenda',$3::jsonb) RETURNING id`,
          [u.id, title, JSON.stringify(content)],
        )
      ).rows[0].id;
      return (
        await db.query<Doc>(
          `SELECT ${COLUMNS}, d.content FROM docs d
             LEFT JOIN teams t ON t.id = d.team_id WHERE d.id = $1`,
          [id],
        )
      ).rows[0];
    });
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
        `SELECT ${COLUMNS}, d.content FROM docs d LEFT JOIN teams t ON t.id = d.team_id
          WHERE d.item_id = $1 AND d.kind = 'meeting'
            AND (d.team_id IS NOT NULL OR d.user_id = $2)
          ORDER BY d.created_at LIMIT 1`,
        [id, u.id],
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
             LEFT JOIN teams t ON t.id = d.team_id WHERE d.id = $1`,
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
           LEFT JOIN teams t ON t.id = d.team_id WHERE d.id = $1`,
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
        `SELECT c.id, c.doc_id, c.user_id, u.name AS author, c.body,
                c.resolved_at, c.created_at
           FROM doc_comments c JOIN users u ON u.id = c.user_id
          WHERE c.doc_id = $1 ORDER BY c.created_at`,
        [id],
      )
    ).rows;
  });

  app.post("/docs/:id/comments", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { body } = docCommentInput.parse(r.body);
    const comment = await transaction(async (db) => {
      // Anyone who can read the document can remark on it.
      await requireDoc(db, id, u, "items:read");
      const made = (
        await db.query<{ id: string }>(
          "INSERT INTO doc_comments (doc_id, user_id, body) VALUES ($1,$2,$3) RETURNING id",
          [id, u.id, body],
        )
      ).rows[0].id;
      return (
        await db.query<DocComment>(
          `SELECT c.id, c.doc_id, c.user_id, u.name AS author, c.body,
                  c.resolved_at, c.created_at
             FROM doc_comments c JOIN users u ON u.id = c.user_id
            WHERE c.id = $1`,
          [made],
        )
      ).rows[0];
    });
    reply.code(201);
    return comment;
  });

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

  app.delete("/docs/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction(async (db) => {
      await requireDoc(db, id, u, "items:write");
      await db.query("DELETE FROM docs WHERE id = $1", [id]);
    });
    reply.code(204);
  });
}
