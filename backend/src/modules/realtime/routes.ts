import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fail } from "@orbyn/core";
import { pool, reader } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import {
  closeLive,
  streamDocChanges,
  streamDocUpdates,
} from "../documents/live.js";
import { closeLiveNews, streamLive } from "../presence/live.js";
import { readableDocs, visibleDocs } from "../../lib/visibility.js";

/** Documents `$1` can see: their own, and their teams'. */
const VISIBLE_DOC = visibleDocs("d");
const READABLE_DOC = readableDocs("d");

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
  const u = await authenticate(r);
  const id = idParam(r);
  const doc = (
    await reader(r.headers).query<{ id: string }>(
      `SELECT d.id FROM docs d
        WHERE d.id = $2 AND ${VISIBLE_DOC}`,
      [u.id, id],
    )
  ).rows[0];
  if (!doc) fail(404, "Document not found");
  const editor =
    typeof r.headers["x-orbyn-editor"] === "string"
      ? r.headers["x-orbyn-editor"].slice(0, 64)
      : "";
  // One stream, two kinds of news: the version hint that makes an editor
  // re-read, and — since the page went CRDT — the binary updates open
  // editors merge as they land. A reader that sent `since` wants the
  // update log too; older apps, which never do, are none the wiser.
  const since = Number(r.query && (r.query as { since?: string }).since) || 0;
  // Legacy clients discard drafts on a Trash hint. Only clients explicitly
  // preserving them receive terminal state; admission remains visible-only.
  const preserveDrafts =
    typeof r.query === "object" &&
    r.query !== null &&
    "terminal" in r.query &&
    r.query.terminal === "preserve-drafts-v1";
  const ongoingVisibility = preserveDrafts ? READABLE_DOC : VISIBLE_DOC;
  let closed = false;
  const isClosed = () =>
    closed || reply.raw.destroyed || reply.raw.writableEnded;
  const close = () => {
    if (!isClosed()) {
      closed = true;
      reply.raw.end();
    }
    return false;
  };
  r.raw.on("close", () => {
    closed = true;
  });
  const allowed = async (notice?: { trashed?: boolean }) => {
    if (isClosed()) return false;
    try {
      const current = await authenticate(r);
      if (isClosed()) return false;
      const readable = (
        await pool.query<{ version: number; deleted_at: string | null }>(
          `SELECT d.version,d.deleted_at FROM docs d
            WHERE d.id=$2 AND ${ongoingVisibility}`,
          [current.id, id],
        )
      ).rows[0];
      // Document and CRDT callbacks may authorize concurrently. A terminal
      // decision owns the response before any other pending guard resumes.
      if (isClosed()) return false;
      if (!readable) return close();
      if (readable.deleted_at) {
        if (!preserveDrafts) return close();
        closed = true;
        try {
          reply.raw.write(
            `data: ${JSON.stringify({ version: readable.version, trashed: true })}\n\n`,
          );
        } finally {
          reply.raw.end();
        }
        return false;
      }
      // NOTIFY can arrive after restore. Opted-in clients use current state;
      // legacy clients retain their previous notification forwarding behavior.
      return !preserveDrafts || !notice?.trashed;
    } catch {
      // Closed credentials or failed authority reads release no metadata/body.
      return close();
    }
  };
  const stops: (() => void)[] = [
    await streamDocChanges(reply, id, editor, allowed),
  ];
  if (since > 0 && !isClosed())
    stops.push(await streamDocUpdates(reply, id, since, allowed));
  const stop = () => stops.forEach((dispose) => dispose());
  r.raw.on("close", stop);
  // A disconnect/terminal guard may finish during asynchronous subscription setup.
  if (isClosed()) stop();
  return reply;
}
