import type { FastifyInstance } from "fastify";
import {
  fail,
  MAX_SAVED_VIEWS,
  savedViewInput,
  savedViewUpdate,
  viewColumns,
  viewFileName,
  viewPinInput,
  viewRunInput,
  viewTable,
  type SavedView,
  type ViewResult,
} from "@orbyn/core";
import { pool, reader, transaction, type Db } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { loadPrefs } from "../planner/calendar.js";
import { fieldRoutes } from "./fields.js";
import { listViews, loadView, runView } from "./service.js";

/**
 * Saved views (DATA-01): named filters, sorts, groupings and layouts over
 * tasks, pages or projects. A view is yours, or shared with a team (anyone
 * who may change the team's things can share one there); its maker and the
 * team's owners and admins can change it. Everyone pins and stars their
 * own. Running a view always reads as the person looking.
 */
export async function viewRoutes(app: FastifyInstance) {
  await fieldRoutes(app);

  app.get("/views", async (r): Promise<SavedView[]> => {
    const u = await authenticate(r);
    return listViews(reader(r.headers), u.id);
  });

  app.post("/views", async (r, reply): Promise<SavedView> => {
    const u = await authenticate(r);
    const data = savedViewInput.parse(r.body ?? {});
    if (data.team_id) await requireTeam(data.team_id, u, "items:write");
    const view = await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `views:${u.id}`,
      ]);
      const made = (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM saved_views WHERE user_id = $1",
          [u.id],
        )
      ).rows[0].n;
      if (made >= MAX_SAVED_VIEWS)
        fail(
          409,
          `You can keep ${MAX_SAVED_VIEWS} views. Delete one you no longer use first.`,
        );
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO saved_views (user_id, team_id, name, source, definition)
           VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
          [
            u.id,
            data.team_id,
            data.name,
            data.definition.source,
            JSON.stringify(data.definition),
          ],
        )
      ).rows[0].id;
      return loadView(db, u.id, id);
    });
    reply.code(201);
    return view;
  });

  app.put("/views/:id", async (r): Promise<SavedView> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = savedViewUpdate.parse(r.body ?? {});
    return transaction(async (db) => {
      const view = await loadView(db, u.id, id);
      if (!view.can_edit)
        fail(
          403,
          "Only whoever made this view, or the team's owners and admins, can change it.",
        );
      if (body.team_id !== undefined && body.team_id !== view.team_id) {
        // Sharing with a team, or taking it back: only its maker.
        if (view.user_id !== u.id)
          fail(
            403,
            "Only whoever made this view can share it or take it back.",
          );
        if (body.team_id) await requireTeam(body.team_id, u, "items:write", db);
      }
      if (body.definition && body.definition.source !== view.source)
        fail(400, "A view keeps showing what it was made for.");
      await db.query(
        `UPDATE saved_views SET name = coalesce($2, name),
           team_id = CASE WHEN $3::boolean THEN $4::uuid ELSE team_id END,
           definition = coalesce($5::jsonb, definition), updated_at = now()
         WHERE id = $1`,
        [
          id,
          body.name ?? null,
          body.team_id !== undefined,
          body.team_id ?? null,
          body.definition ? JSON.stringify(body.definition) : null,
        ],
      );
      return loadView(db, u.id, id);
    });
  });

  app.delete("/views/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction(async (db) => {
      const view = await loadView(db, u.id, id);
      if (!view.can_edit)
        fail(
          403,
          "Only whoever made this view, or the team's owners and admins, can delete it.",
        );
      await db.query("DELETE FROM saved_views WHERE id = $1", [id]);
      await db.query(
        "DELETE FROM favourites WHERE kind = 'view' AND target_id = $1",
        [id],
      );
    });
    reply.code(204);
  });

  /** Pin a view to your sidebar, or unpin it (your own sidebar only). */
  app.put("/views/:id/pin", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { pinned } = viewPinInput.parse(r.body ?? {});
    await loadView(pool, u.id, id);
    if (pinned)
      await pool.query(
        `INSERT INTO saved_view_pins (user_id, view_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [u.id, id],
      );
    else
      await pool.query(
        "DELETE FROM saved_view_pins WHERE user_id = $1 AND view_id = $2",
        [u.id, id],
      );
    reply.code(204);
  });

  /**
   * A view's rows: a saved one by id, or a definition that isn't saved (a
   * live list in a page, a view being built). POST because a definition is
   * a body; nothing is written.
   */
  app.post("/views/run", async (r): Promise<ViewResult> => {
    const u = await authenticate(r);
    const body = viewRunInput.parse(r.body ?? {});
    const db = reader(r.headers);
    if ("id" in body) {
      const view = await loadView(db, u.id, body.id);
      return {
        ...(await runView(db, u.id, view.definition, { limit: body.limit })),
        view,
      };
    }
    return runView(db, u.id, body.definition, { limit: body.limit });
  });

  /** A view as a CSV file, with the columns it shows. */
  app.get("/views/:id/export.csv", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const view = await loadView(db, u.id, id);
    const timeZone = (await loadPrefs(pool as unknown as Db, u.id)).timezone;
    const result = await runView(db, u.id, view.definition, { timeZone });
    const csv = viewTable(
      result.rows,
      viewColumns(view.definition),
      { now: new Date(), timeZone },
      { fields: result.fields, people: result.people },
    );
    const file = viewFileName(view.name);
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="${file.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file)}`,
      )
      .header("Cache-Control", "no-store")
      .send(csv);
  });
}
