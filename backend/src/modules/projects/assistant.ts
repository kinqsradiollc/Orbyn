import { fail } from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import { actAs } from "../../lib/actor.js";
import type { UserRow } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import { requireProject } from "./service.js";

/**
 * Search by meaning: a project kept out loses its pages' measurements (and
 * nothing of it is queued); let back in, its pages are measured again.
 * Nothing to do where the extension isn't installed.
 */
async function forgetMeasured(db: Db, projectId: string, off: boolean) {
  const vectors = await db.query(
    "SELECT 1 FROM pg_extension WHERE extname = 'vector'",
  );
  if (!vectors.rowCount) return;
  if (off) {
    await db.query(
      `DELETE FROM doc_embeddings e USING docs d
        WHERE d.id = e.doc_id AND d.project_id = $1`,
      [projectId],
    );
    await db.query(
      `DELETE FROM doc_embedding_queue q USING docs d
        WHERE d.id = q.doc_id AND d.project_id = $1`,
      [projectId],
    );
  } else
    await db.query(
      `INSERT INTO doc_embedding_queue (doc_id)
       SELECT id FROM docs WHERE project_id = $1 ON CONFLICT DO NOTHING`,
      [projectId],
    );
}

/**
 * Keep a project out of the assistant and agents, or let it back in, in
 * `db`'s transaction: the owner of a personal project, or a team's owners
 * and admins. Whether it changed (it may already be so).
 */
export async function setAssistantOff(
  db: Db,
  u: UserRow,
  id: string,
  off: boolean,
): Promise<boolean> {
  await actAs(db, u.id);
  const project = await requireProject(db, id, u, "items:read");
  if (project.team_id) {
    const { effective } = await requireTeam(
      project.team_id,
      u,
      "items:read",
      db,
    );
    if (!["owner", "admin"].includes(effective))
      fail(403, "Only the team's owners and admins can change this.");
  } else if (project.user_id !== u.id) fail(404, "Project not found");
  const changed = (
    await db.query(
      `UPDATE projects SET assistant_off = $2, updated_at = now()
          WHERE id = $1 AND assistant_off <> $2 RETURNING id`,
      [id, off],
    )
  ).rowCount;
  if (changed) {
    await db.query(
      // The full project state, as the time machine reads the latest
      // project row for a point in its history.
      `INSERT INTO project_activity (project_id, actor_id, kind, entity_type,
           entity_id, summary, before_state, after_state)
         SELECT p.id, $2, 'project_changed', 'project', p.id, $3,
           x.state || jsonb_build_object('assistant_off', NOT $4::boolean),
           x.state || jsonb_build_object('assistant_off', $4::boolean)
           FROM projects p CROSS JOIN LATERAL (SELECT jsonb_build_object(
             'name', p.name, 'status', p.status,
             'deadline', to_jsonb(p)->>'deadline', 'summary', p.summary) AS state) x
          WHERE p.id = $1`,
      [
        id,
        u.id,
        off ? "Kept out of the assistant" : "Back in the assistant",
        off,
      ],
    );
    await forgetMeasured(db, id, off);
  }
  return !!changed;
}
