import type { FastifyReply } from "fastify";
import pg from "pg";
import { env } from "../../config/env.js";

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

type Listener = (payload: {
  docId: string;
  version: number;
  by: string;
  /** Set when the page was moved to Trash. */
  trashed?: boolean;
  /** Set when only the page's tags changed; its words are as they were. */
  tags?: boolean;
  /** Set when only a field value changed; its words are as they were. */
  fields?: boolean;
}) => void;

/** Who is watching which document, in this copy of the API. */
const watchers = new Map<string, Set<Listener>>();

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
      if (message.channel !== CHANNEL || !message.payload) return;
      let parsed: Parameters<Listener>[0];
      try {
        parsed = JSON.parse(message.payload);
      } catch {
        return;
      }
      for (const listener of watchers.get(parsed.docId) ?? []) listener(parsed);
    });
    next.on("error", () => {
      // Drop the connection so the next watcher rebuilds it.
      client = null;
    });
    await next.connect();
    await next.query(`LISTEN ${CHANNEL}`);
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
  news: { trashed?: boolean; tags?: boolean; fields?: boolean } = {},
): Promise<void> {
  await db.query("SELECT pg_notify($1, $2)", [
    CHANNEL,
    JSON.stringify({
      docId,
      version,
      by,
      ...(news.trashed ? { trashed: true } : {}),
      ...(news.tags ? { tags: true } : {}),
      ...(news.fields ? { fields: true } : {}),
    }),
  ]);
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
  await open?.end().catch(() => {});
}
