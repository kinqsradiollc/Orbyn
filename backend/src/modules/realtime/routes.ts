import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fail } from "@orbyn/core";
import { pool, reader } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { closeLive, streamDocChanges } from "../docs/live.js";
import { closeLiveNews, streamLive } from "../presence/live.js";

/** Documents `$1` can see: their own, and their teams'. */
const VISIBLE_DOC = `((d.team_id IS NULL AND d.user_id = $1)
  OR d.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

/**
 * The realtime service: every long-lived connection lives here, so the API
 * copies stay short-request and scale on CPU while these scale on open
 * connections. Each copy holds one Postgres LISTEN connection and forwards
 * news to the readers connected to it; the API raises the news with NOTIFY,
 * so any API copy reaches readers on any realtime copy.
 */
export async function realtimeRoutes(app: FastifyInstance) {
  app.addHook("onClose", async () => {
    await closeLive();
    await closeLiveNews();
  });

  /**
   * News for the open app: something changed, a focus session moved,
   * someone came or went. The app re-reads what it needs.
   */
  app.get("/events", async (r, reply) => {
    const u = await authenticate(r);
    const teams = (
      await pool.query<{ team_id: string }>(
        "SELECT team_id FROM team_members WHERE user_id = $1",
        [u.id],
      )
    ).rows.map((t) => t.team_id);
    const stop = await streamLive(reply, u.id, teams);
    r.raw.on("close", stop);
    // The stream owns the response.
    return reply;
  });

  /**
   * A document's changes as they happen, for editors that have it open. The
   * stream carries only the news that it moved on and to which version; the
   * editor re-reads and merges, so a missed event is caught up by the next.
   */
  app.get("/events/docs/:id", docStream);
}

/**
 * The same stream at the path older apps use. It's registered here and in
 * the API (see legacyDocStreamRoutes), so an older app keeps working behind
 * an ingress that sends only /events to this service.
 */
export async function legacyDocStreamRoutes(app: FastifyInstance) {
  app.addHook("onClose", () => closeLive());
  app.get("/docs/:id/live", docStream);
}

async function docStream(
  r: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  {
    const u = await authenticate(r);
    const id = idParam(r);
    const doc = (
      await reader(r.headers).query<{ id: string }>(
        `SELECT d.id FROM docs d WHERE d.id = $2 AND ${VISIBLE_DOC}`,
        [u.id, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    const editor =
      typeof r.headers["x-orbyn-editor"] === "string"
        ? r.headers["x-orbyn-editor"].slice(0, 64)
        : "";
    const stop = await streamDocChanges(reply, id, editor);
    r.raw.on("close", stop);
    return reply;
  }
}
