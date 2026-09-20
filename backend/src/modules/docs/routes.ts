import type { FastifyInstance } from "fastify";
import {
  docInput,
  docPreview,
  docUpdate,
  fail,
  serializeDoc,
  type Doc,
  type DocBlock,
  type DocSummary,
} from "@orbyn/core";
import { reader, transaction, type Db } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";

/**
 * Documents: notes, briefs and agendas. Personal documents belong to their
 * author; team documents follow the same team roles as team items (viewers
 * read, members and above write). Edits carry the version they were made
 * against, so two open tabs can't silently overwrite each other.
 */

const COLUMNS = `d.id, d.user_id, d.team_id, t.name AS team_name, d.title, d.kind,
  d.item_id, d.version, d.created_at, d.updated_at`;

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
          `INSERT INTO docs (user_id, team_id, title, kind, content, item_id)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`,
          [
            u.id,
            data.team_id,
            data.title || "Untitled",
            data.kind,
            JSON.stringify(data.content),
            data.item_id,
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
    return doc;
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

  app.put("/docs/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = docUpdate.parse(r.body);
    return transaction(async (db) => {
      const current = await requireDoc(db, id, u, "items:write");
      if (current.version !== body.version)
        fail(
          409,
          "This document changed somewhere else. Refresh and try again.",
        );
      await db.query(
        `UPDATE docs SET
           title = coalesce($2, title),
           content = coalesce($3::jsonb, content),
           version = version + 1,
           updated_at = now()
         WHERE id = $1`,
        [
          id,
          body.title ?? null,
          body.content === undefined ? null : JSON.stringify(body.content),
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
