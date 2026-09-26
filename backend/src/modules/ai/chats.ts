import type { FastifyInstance } from "fastify";
import {
  chatTitle,
  fail,
  projectChatInput,
  type ProjectChat,
  type ProjectChatSummary,
} from "@orbyn/core";
import { pool, reader, transaction, type Queryable } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { KeptOutError } from "../../lib/assistant-off.js";

/**
 * Saved project chats: each person's own conversations with the assistant
 * about a project. A chat is only ever seen by the person who had it, and
 * only while they can still see its project. The newest 50 per project are
 * kept; the sweeper removes chats a year after they were last used.
 */

const PER_PROJECT = 50;

const SUMMARY = `c.id, c.project_id, c.title, jsonb_array_length(c.turns)::int AS turn_count,
  c.created_at, c.updated_at`;

/** SQL: the project on `p` is visible to `$1`. */
const VISIBLE = `((p.team_id IS NULL AND p.user_id = $1)
  OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

async function visibleProject(db: Queryable, userId: string, id: string) {
  const row = (
    await db.query<{ assistant_off: boolean }>(
      `SELECT p.assistant_off FROM projects p WHERE p.id = $2 AND ${VISIBLE}`,
      [userId, id],
    )
  ).rows[0];
  if (!row) fail(404, "Project not found");
  return row;
}

export async function projectChatRoutes(app: FastifyInstance) {
  app.get(
    "/ai/projects/:id/chats",
    async (r): Promise<ProjectChatSummary[]> => {
      const u = await authenticate(r);
      const id = idParam(r);
      const db = reader(r.headers);
      await visibleProject(db, u.id, id);
      return (
        await db.query<ProjectChatSummary>(
          `SELECT ${SUMMARY} FROM project_chats c
            WHERE c.user_id = $1 AND c.project_id = $2
            ORDER BY c.updated_at DESC LIMIT ${PER_PROJECT}`,
          [u.id, id],
        )
      ).rows;
    },
  );

  app.get("/ai/chats/:id", async (r): Promise<ProjectChat> => {
    const u = await authenticate(r);
    const chat = (
      await reader(r.headers).query<ProjectChat>(
        `SELECT ${SUMMARY}, c.turns FROM project_chats c
           JOIN projects p ON p.id = c.project_id
          WHERE c.id = $2 AND c.user_id = $1 AND ${VISIBLE}`,
        [u.id, idParam(r)],
      )
    ).rows[0];
    if (!chat) fail(404, "Chat not found");
    return chat;
  });

  app.put("/ai/chats/:id", async (r): Promise<ProjectChatSummary> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = projectChatInput.parse(r.body);
    return transaction(async (db) => {
      const project = await visibleProject(db, u.id, d.project_id);
      if (project.assistant_off) fail(422, new KeptOutError().message);
      const saved = (
        await db.query<ProjectChatSummary & { user_id: string }>(
          `INSERT INTO project_chats (id, user_id, project_id, title, turns)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (id) DO UPDATE SET turns = EXCLUDED.turns,
             title = coalesce($6, project_chats.title), updated_at = now()
             WHERE project_chats.user_id = EXCLUDED.user_id
               AND project_chats.project_id = EXCLUDED.project_id
           RETURNING ${SUMMARY.replaceAll("c.", "")}`,
          [
            id,
            u.id,
            d.project_id,
            d.title ?? chatTitle(d.turns),
            JSON.stringify(d.turns),
            d.title ?? null,
          ],
        )
      ).rows[0];
      if (!saved) fail(404, "Chat not found");
      // Only the newest chats per project are kept.
      await db.query(
        `DELETE FROM project_chats WHERE user_id = $1 AND project_id = $2
           AND id NOT IN (SELECT id FROM project_chats
                           WHERE user_id = $1 AND project_id = $2
                           ORDER BY updated_at DESC LIMIT ${PER_PROJECT})`,
        [u.id, d.project_id],
      );
      return saved;
    });
  });

  app.delete("/ai/chats/:id", async (r, reply) => {
    const u = await authenticate(r);
    const gone = await pool.query(
      "DELETE FROM project_chats WHERE id = $1 AND user_id = $2",
      [idParam(r), u.id],
    );
    if (!gone.rowCount) fail(404, "Chat not found");
    reply.code(204);
  });
}
