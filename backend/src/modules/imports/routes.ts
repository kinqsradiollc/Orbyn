import type { FastifyInstance } from "fastify";
import {
  IMPORT_LIMITS,
  fail,
  importCreateInput,
  importRefusal,
  importTypeOf,
} from "@orbyn/core";
import { pool } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { announceTo } from "../presence/live.js";
import { importsEnabled, uploadToken } from "./tokens.js";
import { importCapabilities, jobs } from "./service.js";

export async function importRoutes(app: FastifyInstance) {
  /** What this server can read, so the apps can say so before an upload. */
  app.get("/imports/capabilities", async (r) => {
    await authenticate(r);
    return importCapabilities();
  });

  /**
   * Start an import: returns the import and a link to upload the file to,
   * good for ten minutes and one upload. The file store queues it for the
   * converter as soon as the upload finishes.
   */
  app.post("/imports", async (r, reply) => {
    const u = await authenticate(r);
    if (!importsEnabled())
      fail(503, "Importing files isn't set up on this server yet.");
    const d = importCreateInput.parse(r.body ?? {});
    const type = importTypeOf(d.file_name, d.mime);
    if (!type) fail(422, importRefusal(d.file_name, d.mime)!);
    let projectTeamId: string | null = null;
    if (d.project_id) {
      if (d.project_team_id === undefined)
        fail(400, "The project's current team is required for an import.");
      const project = (
        await pool.query<{ user_id: string; team_id: string | null }>(
          "SELECT user_id, team_id FROM projects WHERE id = $1",
          [d.project_id],
        )
      ).rows[0];
      if (!project || (!project.team_id && project.user_id !== u.id))
        fail(404, "Project not found");
      if (project.team_id) await requireTeam(project.team_id, u, "items:write");
      if (project.team_id !== d.project_team_id)
        fail(
          409,
          "This project changed teams. Review who can read the file and try again.",
        );
      projectTeamId = project.team_id;
    }
    const active = Number(
      (
        await pool.query<{ n: string }>(
          `SELECT count(*) AS n FROM imports
            WHERE user_id = $1 AND created_at > now() - interval '1 day'
              AND (status IN ('queued','reading','ocr')
                   OR (status = 'waiting'
                       AND created_at > now() - interval '15 minutes'))`,
          [u.id],
        )
      ).rows[0].n,
    );
    if (active >= IMPORT_LIMITS.activePerUser)
      fail(
        429,
        `You have ${active} files importing. Wait for one to finish, then add the next.`,
      );
    const id = (
      await pool.query<{ id: string }>(
        `INSERT INTO imports (user_id, file_name, file_type, bytes,
           project_id, project_team_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [u.id, d.file_name, type, d.bytes, d.project_id ?? null, projectTeamId],
      )
    ).rows[0].id;
    const expires =
      Math.floor(Date.now() / 1000) + IMPORT_LIMITS.uploadLinkMinutes * 60;
    const token = uploadToken({
      i: id,
      u: u.id,
      e: expires,
      m: IMPORT_LIMITS.maxBytes,
      t: type!,
    });
    reply.code(201);
    return {
      import: (await jobs(pool, u.id, id))[0],
      upload_path: `/files/u/${token}`,
      expires_at: new Date(expires * 1000).toISOString(),
    };
  });

  /** Your imports: everything still going, and the last week's finished ones. */
  app.get("/imports", async (r) => {
    const u = await authenticate(r);
    return jobs(pool, u.id);
  });

  app.get("/imports/:id", async (r) => {
    const u = await authenticate(r);
    const job = (await jobs(pool, u.id, idParam(r)))[0];
    if (!job) fail(404, "Import not found");
    return job;
  });

  /**
   * Cancel an import still going, or clear a finished one from the list.
   * A cancelled import's file is deleted by the converter or the file
   * store's sweep, whichever gets there first.
   */
  app.delete("/imports/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const cancelled = (
      await pool.query(
        `UPDATE imports SET status = 'cancelled', finished_at = now()
          WHERE id = $1 AND user_id = $2
            AND status IN ('waiting','queued','reading','ocr')
          RETURNING id`,
        [id, u.id],
      )
    ).rowCount;
    if (cancelled)
      await pool.query(
        "DELETE FROM import_pages WHERE import_id = $1 AND done_at IS NULL",
        [id],
      );
    else {
      const removed = (
        await pool.query(
          "DELETE FROM imports WHERE id = $1 AND user_id = $2 AND object_id IS NULL",
          [id, u.id],
        )
      ).rowCount;
      if (!removed) fail(404, "Import not found");
    }
    await announceTo(pool, { user_id: u.id }, "changed").catch(() => {});
    return reply.code(204).send();
  });
}
