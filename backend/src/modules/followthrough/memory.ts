import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  actionSchema,
  docReviewInput,
  FADING_DAYS,
  fail,
  pageFreshness,
  type FadingDoc,
  type Item,
} from "@orbyn/core";
import { reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { mutate } from "../items/service.js";
import { readableDocs } from "../../lib/visibility.js";

/** Pages `$1` can see: their own, and their teams'. */
const VISIBLE = readableDocs("d");

/**
 * Organizational memory decay: pages nobody has changed or confirmed in
 * months may no longer be true. They're listed, oldest first, and anyone who
 * can edit one can say it's still true — or that it needs updating, which
 * gives its author a task.
 */
export async function memoryRoutes(app: FastifyInstance) {
  app.get("/docs/fading", async (r): Promise<FadingDoc[]> => {
    const u = await authenticate(r);
    const q = z
      .object({ team_id: z.uuid().optional() })
      .strict()
      .parse(r.query);
    const rows = (
      await reader(r.headers).query<{
        id: string;
        title: string;
        team_id: string | null;
        team_name: string | null;
        owner_name: string;
        updated_at: Date;
        reviewed_at: Date | null;
      }>(
        `SELECT d.id, d.title, d.team_id, t.name AS team_name, o.name AS owner_name,
                d.updated_at, d.reviewed_at
           FROM docs d JOIN users o ON o.id = d.user_id
           LEFT JOIN teams t ON t.id = d.team_id
          WHERE ${VISIBLE} AND d.kind = 'doc' AND d.deleted_at IS NULL
            AND ($2::uuid IS NULL OR d.team_id = $2)
            AND greatest(d.updated_at, coalesce(d.reviewed_at, d.updated_at))
                < now() - make_interval(days => $3)
          ORDER BY greatest(d.updated_at, coalesce(d.reviewed_at, d.updated_at))
          LIMIT 50`,
        [u.id, q.team_id ?? null, FADING_DAYS],
      )
    ).rows;
    return rows.map((d) => ({
      id: d.id,
      title: d.title || "Untitled",
      team_id: d.team_id,
      team_name: d.team_name,
      owner_name: d.owner_name,
      updated_at: d.updated_at.toISOString(),
      reviewed_at: d.reviewed_at?.toISOString() ?? null,
      freshness: pageFreshness(
        d.updated_at.toISOString(),
        d.reviewed_at?.toISOString(),
      ),
    }));
  });

  app.post("/docs/:id/review", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = docReviewInput.parse(r.body);
    return transaction(async (db) => {
      const doc = (
        await db.query<{
          id: string;
          title: string;
          user_id: string;
          team_id: string | null;
        }>(
          `SELECT id, title, user_id, team_id FROM docs
            WHERE id = $1 AND deleted_at IS NULL`,
          [id],
        )
      ).rows[0];
      if (!doc) fail(404, "Document not found");
      if (doc.team_id) await requireTeam(doc.team_id, u, "items:write", db);
      else if (doc.user_id !== u.id) fail(404, "Document not found");

      if (d.verdict === "still_true") {
        // Confirming changes nothing on the page, so its version stays.
        const row = (
          await db.query<{ reviewed_at: Date }>(
            `UPDATE docs SET reviewed_at = now(), reviewed_by = $2
              WHERE id = $1 RETURNING reviewed_at`,
            [id, u.id],
          )
        ).rows[0];
        return { reviewed_at: row.reviewed_at.toISOString(), task: null };
      }

      // Needs updating: a task for whoever wrote it, if they're still here.
      const authorOnTeam = doc.team_id
        ? (
            await db.query(
              "SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2",
              [doc.team_id, doc.user_id],
            )
          ).rowCount
        : 0;
      const title = doc.title || "Untitled";
      const task = (await mutate(
        db,
        u,
        actionSchema.parse({
          operation: "create",
          data: {
            title: `Update “${title}”`.slice(0, 200),
            notes: [`The page “${title}” may no longer be true.`, d.note]
              .filter(Boolean)
              .join("\n\n"),
            kind: "task",
            team_id: doc.team_id,
            ...(doc.team_id && authorOnTeam && doc.user_id !== u.id
              ? { assignee_id: doc.user_id }
              : {}),
          },
        }),
      )) as Item;
      await db.query(
        "UPDATE docs SET reviewed_at = now(), reviewed_by = $2 WHERE id = $1",
        [id, u.id],
      );
      return { reviewed_at: new Date().toISOString(), task };
    });
  });
}
