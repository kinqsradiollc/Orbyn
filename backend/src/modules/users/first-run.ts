import type { FastifyInstance } from "fastify";
import {
  firstRunInput,
  parseDoc,
  starterBrief,
  starterById,
  type FirstRunResult,
} from "@orbyn/core";
import { pool, transaction, type Db } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { authenticate, publicUser } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import { strictRateLimit } from "../../lib/params.js";
import { actAs } from "../../lib/actor.js";

const insertDoc = async (
  db: Db,
  userId: string,
  teamId: string | null,
  projectId: string | null,
  title: string,
  markdown: string,
) =>
  (
    await db.query<{ id: string }>(
      `INSERT INTO docs (user_id, team_id, title, kind, content, project_id)
         VALUES ($1, $2, $3, 'doc', $4::jsonb, $5) RETURNING id`,
      [userId, teamId, title, JSON.stringify(parseDoc(markdown)), projectId],
    )
  ).rows[0].id;

/**
 * The guided first run (DSN-02). Finishing it makes the starter chosen (a
 * project, its pages and a brief that links them) and records what Orbyn is
 * for; skipping it just records that it was seen. Either way it is shown
 * once. A calendar is connected by the app with the usual subscription
 * route, so nothing here fetches an outside address.
 */
export async function firstRunRoutes(app: FastifyInstance) {
  app.post("/me/first-run", strictRateLimit, async (r) => {
    const u = await authenticate(r);
    const d = firstRunInput.parse(r.body ?? {});
    const done = (
      await pool.query<{ first_run_at: Date | null }>(
        "SELECT first_run_at FROM users WHERE id = $1",
        [u.id],
      )
    ).rows[0];
    const starter = starterById(d.starter);
    if (d.team_id) await requireTeam(d.team_id, u, "items:write");
    const result = await transaction(async (db): Promise<FirstRunResult> => {
      await actAs(db, u.id);
      const out: FirstRunResult = {
        project_id: null,
        brief_id: null,
        team_id: null,
      };
      // Made once: a second call (a double tap, another device) only
      // records the purpose.
      if (starter.id !== "none" && !done?.first_run_at) {
        let teamId: string | null = null;
        if (starter.id === "sprint") {
          if (d.team_id) teamId = d.team_id;
          else {
            const name =
              d.team_name ?? `${u.name.split(" ")[0] || "My"}'s team`;
            teamId = (
              await db.query<{ id: string }>(
                "INSERT INTO teams (name, created_by) VALUES ($1, $2) RETURNING id",
                [name.slice(0, 80), u.id],
              )
            ).rows[0].id;
            await db.query(
              "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')",
              [teamId, u.id],
            );
            await audit(
              {
                actorId: u.id,
                action: "team.created",
                targetType: "team",
                targetId: teamId,
                details: { name, first_run: true },
              },
              db,
            );
          }
        }
        const projectId = (
          await db.query<{ id: string }>(
            `INSERT INTO projects (user_id, team_id, name, summary)
               VALUES ($1, $2, $3, $4) RETURNING id`,
            [u.id, teamId, starter.project.name, starter.project.summary],
          )
        ).rows[0].id;
        for (const [position, name] of starter.project.stages.entries())
          await db.query(
            "INSERT INTO project_stages (project_id, name, position) VALUES ($1, $2, $3)",
            [projectId, name, position],
          );
        const pages: { id: string; title: string }[] = [];
        for (const page of starter.pages)
          pages.push({
            id: await insertDoc(
              db,
              u.id,
              teamId,
              projectId,
              page.title,
              page.body,
            ),
            title: page.title,
          });
        const briefId = await insertDoc(
          db,
          u.id,
          teamId,
          projectId,
          starter.brief.title,
          starterBrief(starter, pages, projectId),
        );
        for (const title of starter.tasks)
          await db.query(
            `INSERT INTO items (user_id, team_id, title, kind, project_id)
               VALUES ($1, $2, $3, 'task', $4)`,
            [u.id, teamId, title, projectId],
          );
        Object.assign(out, {
          project_id: projectId,
          brief_id: briefId,
          team_id: teamId,
        });
      }
      await db.query(
        `UPDATE users SET purpose = $2, first_run_at = coalesce(first_run_at, now())
          WHERE id = $1`,
        [u.id, d.purpose],
      );
      return out;
    });
    const user = (await pool.query("SELECT * FROM users WHERE id = $1", [u.id]))
      .rows[0];
    return { ...result, user: publicUser(user) };
  });

  // Not now: the first run is not shown again.
  app.post("/me/first-run/skip", async (r) => {
    const u = await authenticate(r);
    const user = (
      await pool.query(
        `UPDATE users SET first_run_at = coalesce(first_run_at, now())
          WHERE id = $1 RETURNING *`,
        [u.id],
      )
    ).rows[0];
    return publicUser(user);
  });
}
