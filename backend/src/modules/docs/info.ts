import type { FastifyInstance } from "fastify";
import {
  fail,
  hasTeamPermission,
  INFO_VERSIONS,
  type DocInfo,
  type DocVersion,
  type TeamRole,
} from "@orbyn/core";
import { reader } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { docVisibleTo } from "../../lib/doc-visibility.js";
import { idParam } from "../../lib/params.js";
import { linksHere } from "../links/service.js";
import { pageSources } from "../sources/service.js";

type InfoRow = {
  id: string;
  kind: DocInfo["kind"];
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  role: TeamRole | null;
  project_id: string | null;
  project_name: string | null;
  item_id: string | null;
  event_title: string | null;
  event_due: Date | null;
  folder_id: string | null;
  folder_name: string | null;
  tags: DocInfo["tags"];
  updated_at: Date;
  reviewed_at: Date | null;
  version_count: number;
};

/**
 * A page's Info panel (NAV-04) in one request: what it belongs to (team,
 * project, event, folder), its tags, how many places link to it, its kept
 * versions and when it was last changed or confirmed still true. Only for
 * a page you can open (404 otherwise, as for a page that never existed); the
 * link count leaves out places you can't open, as "Linked here" does.
 */
export async function docInfoRoutes(app: FastifyInstance) {
  app.get("/docs/:id/info", async (r): Promise<DocInfo> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const row = (
      await db.query<InfoRow>(
        `SELECT d.id, d.kind, d.user_id, d.team_id, t.name AS team_name,
                tm.role, d.project_id, p.name AS project_name,
                ev.id AS item_id, ev.title AS event_title, ev.due_at AS event_due,
                f.id AS folder_id, f.name AS folder_name,
                coalesce((SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name,
                                                            'color', tg.color)
                                       ORDER BY lower(tg.name), tg.name)
                            FROM doc_tags dt JOIN tags tg ON tg.id = dt.tag_id
                           WHERE dt.doc_id = d.id), '[]'::json) AS tags,
                d.updated_at, d.reviewed_at,
                (SELECT count(*)::int FROM doc_versions v WHERE v.doc_id = d.id)
                  AS version_count
           FROM docs d
           LEFT JOIN teams t ON t.id = d.team_id
           LEFT JOIN team_members tm ON tm.team_id = d.team_id AND tm.user_id = $1
           LEFT JOIN projects p ON p.id = d.project_id
           -- The event a meeting note is for; a task a page hangs off too.
           LEFT JOIN items ev ON ev.id = d.item_id
           LEFT JOIN folders f ON f.id = d.folder_id
          WHERE d.id = $2 AND ${docVisibleTo("$1")}`,
        [u.id, id],
      )
    ).rows[0];
    if (!row) fail(404, "Document not found");
    const recent = (
      await db.query<DocVersion>(
        `SELECT v.version, v.title, v.created_at, v.user_id, us.name AS author,
                jsonb_array_length(v.content) AS blocks
           FROM doc_versions v LEFT JOIN users us ON us.id = v.user_id
          WHERE v.doc_id = $1 ORDER BY v.version DESC LIMIT ${INFO_VERSIONS}`,
        [id],
      )
    ).rows;
    const [linked, sources] = await Promise.all([
      linksHere(db, u.id, { kind: "doc", id }),
      pageSources(db, id),
    ]);
    return {
      id: row.id,
      kind: row.kind,
      team:
        row.team_id && row.team_name
          ? { id: row.team_id, name: row.team_name }
          : null,
      project:
        row.project_id && row.project_name
          ? { id: row.project_id, name: row.project_name }
          : null,
      event:
        row.item_id && row.event_title !== null
          ? {
              id: row.item_id,
              title: row.event_title,
              due_at: row.event_due?.toISOString() ?? null,
            }
          : null,
      folder:
        row.folder_id && row.folder_name
          ? { id: row.folder_id, name: row.folder_name }
          : null,
      tags: row.tags,
      linked_here: linked.count,
      versions: { count: row.version_count, recent },
      updated_at: row.updated_at.toISOString(),
      reviewed_at: row.reviewed_at?.toISOString() ?? null,
      can_write: row.team_id
        ? !!row.role && hasTeamPermission(row.role, "items:write")
        : row.user_id === u.id,
      sources,
    };
  });
}
