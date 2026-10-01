import type { FastifyReply } from "fastify";
import pg from "pg";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";

/**
 * Live document changes.
 *
 * When a document is saved, the API announces it on a Postgres channel; every
 * API copy listens on one shared connection and forwards the news to whoever
 * has that document open. Going through Postgres rather than process memory
 * means this keeps working when more than one copy of the API is running,
 * which is how Orbyn is deployed.
 */

const CHANNEL = "doc_changed";

/** The channel CRDT update hints ride on. */
const UPDATE_CHANNEL = "doc_updated";

type Listener = (payload: {
  docId: string;
  version: number;
  by: string;
  /** Set when the page was moved to Trash. */
  trashed?: boolean;
  /** Set when a private Memory note was permanently forgotten. */
  forgotten?: boolean;
  /** Set when only the page's tags changed; its words are as they were. */
  tags?: boolean;
  /** Set when only a field value changed; its words are as they were. */
  fields?: boolean;
}) => void;

/** Who is watching which document, in this copy of the API. */
const watchers = new Map<string, Set<Listener>>();

/** Who is streaming a page's CRDT updates, by page. */
const updateWatchers = new Map<
  string,
  Set<(updates: { seq: number; update: string; by: string }[]) => void>
>();

let client: pg.Client | null = null;
let connecting: Promise<void> | null = null;

/** One long-lived connection for LISTEN; it reconnects if the link drops. */
async function ensureListening(): Promise<void> {
  if (client) return;
  if (connecting) return connecting;
  connecting = (async () => {
    const next = new pg.Client({
      connectionString: env.DATABASE_LISTEN_URL || env.DATABASE_URL,
    });
    next.on("notification", (message) => {
      if (!message.payload) return;
      if (message.channel === CHANNEL) {
        let parsed: Parameters<Listener>[0];
        try {
          parsed = JSON.parse(message.payload);
        } catch {
          return;
        }
        for (const listener of watchers.get(parsed.docId) ?? [])
          listener(parsed);
        return;
      }
      if (message.channel === UPDATE_CHANNEL) {
        // A knock, not the parcel: read the new rows from the log and hand
        // them to this copy's streamers. A race — two knocks before either
        // has read — is harmless, because each reader tracks its own seq
        // and skips rows it already has.
        let parsed: { docId?: string } = {};
        try {
          parsed = JSON.parse(message.payload);
        } catch {
          return;
        }
        const waiting = updateWatchers.get(parsed.docId ?? "");
        if (!waiting?.size) return;
        const docId = parsed.docId as string;
        // Each reader has its own watermark, so each is served its own
        // missing stretch; one query per reader keeps the bookkeeping
        // honest (a page with a handful of readers is a handful of rows).
        for (const deliver of waiting) void deliverUpdates(docId, deliver);
      }
    });
    next.on("error", () => {
      // Drop the connection so the next watcher rebuilds it.
      client = null;
    });
    await next.connect();
    await next.query(`LISTEN ${CHANNEL}`);
    await next.query(`LISTEN ${UPDATE_CHANNEL}`);
    client = next;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

/**
 * Tell everyone watching this document that it moved on, or with `trashed`
 * that it went to Trash, so an editor that has it open lets it go rather
 * than finding out from a save that fails. With `tags`, only its tags
 * changed: the version stays, and open editors refresh the tag row. With
 * `fields`, only a field value changed, and open Info panels read it afresh.
 */
export async function announceDocChange(
  db: { query: pg.Pool["query"] },
  docId: string,
  version: number,
  by: string,
  news: {
    trashed?: boolean;
    forgotten?: boolean;
    tags?: boolean;
    fields?: boolean;
  } = {},
): Promise<void> {
  await db.query("SELECT pg_notify($1, $2)", [
    CHANNEL,
    JSON.stringify({
      docId,
      version,
      by,
      ...(news.trashed ? { trashed: true } : {}),
      ...(news.forgotten ? { forgotten: true } : {}),
      ...(news.tags ? { tags: true } : {}),
      ...(news.fields ? { fields: true } : {}),
    }),
  ]);
}

/**
 * Tell every copy of the API that a page's CRDT log moved on. The payload
 * is only the page's id and who wrote: the bytes themselves live in
 * `doc_updates`, and each copy SELECTs the rows its readers have not seen
 * (see streamDocUpdates). NOTIFY payloads cap at 8000 bytes, so the news
 * travels by table, the notification stays a knock on the door.
 */
export async function announceCrdtUpdate(
  db: { query: pg.Pool["query"] },
  docId: string,
  by: string,
): Promise<void> {
  await db.query("SELECT pg_notify($1, $2)", [
    UPDATE_CHANNEL,
    JSON.stringify({ docId, by }),
  ]);
}

/**
 * Read a page's log rows past the reader's watermark and hand them over,
 * then remember how far it got. Rows arrive in seq order; a reader that
 * re-asks (a hiccup, a beat race) is served nothing it already has.
 */
type UpdateSink = (
  updates: {
    seq: number;
    update: string;
    by: string;
  }[],
) => void;

const watermarks = new Map<UpdateSink, number>();

async function deliverUpdates(docId: string, sink: UpdateSink): Promise<void> {
  const since = watermarks.get(sink) ?? 0;
  const rows = (
    await pool.query<{ seq: string; update: Buffer; editor_id: string }>(
      `SELECT seq, update, editor_id FROM doc_updates
        WHERE doc_id = $1 AND seq > $2 ORDER BY seq LIMIT 500`,
      [docId, since],
    )
  ).rows;
  if (!rows.length) return;
  watermarks.set(sink, Math.max(since, ...rows.map((row) => Number(row.seq))));
  sink(
    rows.map((row) => ({
      seq: Number(row.seq),
      update: row.update.toString("base64"),
      by: row.editor_id,
    })),
  );
}

/**
 * Stream a page's CRDT updates to one reader as server-sent events. The
 * reader says which seq it has; everything later comes as it lands, and a
 * `: seq` comment carries the watermark so a reconnecting reader knows
 * where to pick up. Returns a function that stops the stream.
 */
export async function streamDocUpdates(
  reply: FastifyReply,
  docId: string,
  since: number,
): Promise<() => void> {
  await ensureListening();
  const sink: UpdateSink = (updates) => {
    try {
      for (const row of updates)
        reply.raw.write(`data: ${JSON.stringify(row)}\n\n`);
    } catch {
      // The reader is gone; its close handler stops the stream.
    }
  };
  watermarks.set(sink, since);
  const set = updateWatchers.get(docId) ?? new Set();
  set.add(sink);
  updateWatchers.set(docId, set);
  // Anything the log already holds beyond the reader's watermark goes out
  // first, so a page busy before the reader joined is caught up at once.
  void deliverUpdates(docId, sink).catch(() => {});
  const beat = setInterval(() => {
    try {
      const at = watermarks.get(sink) ?? 0;
      reply.raw.write(`: seq ${at}\n\n`);
    } catch {
      // As above: the close handler ends things.
    }
  }, 25_000);
  return () => {
    clearInterval(beat);
    watermarks.delete(sink);
    const current = updateWatchers.get(docId);
    current?.delete(sink);
    if (current && current.size === 0) updateWatchers.delete(docId);
  };
}

/**
 * Stream changes for one document to a reader as server-sent events. Returns
 * a function that stops the stream.
 */
export async function streamDocChanges(
  reply: FastifyReply,
  docId: string,
  /** The reader's own id: their own saves are not news to them. */
  selfId: string,
): Promise<() => void> {
  await ensureListening();

  // Writing to the raw socket goes around Fastify, so anything it had
  // already set — the CORS headers above all — has to be carried over by
  // hand. Without this the stream is unreadable from any origin other than
  // the API's own, which is every phone and every split deployment.
  const carried: Record<string, string> = {};
  for (const [name, value] of Object.entries(reply.getHeaders?.() ?? {}))
    if (value !== undefined && name.toLowerCase().startsWith("access-control-"))
      carried[name] = String(value);

  reply.raw.writeHead(200, {
    ...carried,
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // Nginx buffers by default, which would hold events back.
    "x-accel-buffering": "no",
  });
  reply.raw.write(": open\n\n");

  const listener: Listener = (payload) => {
    if (payload.by === selfId) return;
    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const set = watchers.get(docId) ?? new Set<Listener>();
  set.add(listener);
  watchers.set(docId, set);

  // A comment every 25s keeps proxies from closing an idle stream.
  const beat = setInterval(() => reply.raw.write(": beat\n\n"), 25_000);

  return () => {
    clearInterval(beat);
    const current = watchers.get(docId);
    current?.delete(listener);
    if (current && current.size === 0) watchers.delete(docId);
  };
}

/**
 * Hears a page's saves on this copy, for a stream other than an editor's
 * (an agent following the page with subscriptions/listen). Returns a way
 * to stop.
 */
export async function watchDoc(
  docId: string,
  onChange: () => void,
): Promise<() => void> {
  await ensureListening();
  const listener: Listener = () => onChange();
  const set = watchers.get(docId) ?? new Set<Listener>();
  set.add(listener);
  watchers.set(docId, set);
  return () => {
    const current = watchers.get(docId);
    current?.delete(listener);
    if (current && current.size === 0) watchers.delete(docId);
  };
}

/** Only for tests: how many readers this copy is serving. */
export const watcherCount = (docId: string) => watchers.get(docId)?.size ?? 0;

/** Let go of the listening connection, so a test run or a shutdown can end. */
export async function closeLive(): Promise<void> {
  const open = client;
  client = null;
  watchers.clear();
  updateWatchers.clear();
  watermarks.clear();
  await open?.end().catch(() => {});
}
