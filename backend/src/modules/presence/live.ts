import type { FastifyReply } from "fastify";
import pg from "pg";
import { env } from "../../config/env.js";

/**
 * Live news for a person's own devices and their teams: something changed
 * (so refresh), a focus session started or stopped, someone came or went.
 *
 * Like live documents, it goes through a Postgres channel rather than process
 * memory, so an event raised on one copy of the API reaches readers connected
 * to any other. The news is small — what kind, for whom — and the app
 * re-reads what it needs, so a missed event is caught up by the next one.
 */

const CHANNEL = "orbyn_live";

export const LIVE_KINDS = [
  "changed",
  "focus",
  "presence",
  "doc_presence",
] as const;
export type LiveKind = (typeof LIVE_KINDS)[number];

/** Who the news is for: one person, or everyone on a team. */
export type LiveAudience = { user_id?: string | null; team_id?: string | null };

export type LiveEvent = {
  kind: LiveKind;
  user?: string;
  team?: string;
  /** The document, for `doc_presence`. */
  doc?: string;
  /** The device that caused it, so it can ignore its own news. */
  by?: string;
};

type Reader = {
  userId: string;
  teams: Set<string>;
  send: (event: LiveEvent) => void;
};

const readers = new Set<Reader>();
let client: pg.Client | null = null;
let connecting: Promise<void> | null = null;

async function ensureListening(): Promise<void> {
  if (client) return;
  if (connecting) return connecting;
  connecting = (async () => {
    const next = new pg.Client({
      connectionString: env.DATABASE_LISTEN_URL || env.DATABASE_URL,
    });
    next.on("notification", (message) => {
      if (message.channel !== CHANNEL || !message.payload) return;
      let event: LiveEvent;
      try {
        event = JSON.parse(message.payload);
      } catch {
        return;
      }
      for (const reader of readers)
        if (
          (event.user && event.user === reader.userId) ||
          (event.team && reader.teams.has(event.team))
        )
          reader.send(event);
    });
    next.on("error", () => {
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
 * Raise news for one person or a team. Inside a transaction it is sent when
 * the transaction commits, and never if it rolls back.
 */
export async function announceTo(
  db: { query: pg.Pool["query"] },
  audience: LiveAudience,
  kind: LiveKind,
  extra: { doc?: string; by?: string } = {},
): Promise<void> {
  const event: LiveEvent = {
    kind,
    ...(audience.team_id
      ? { team: audience.team_id }
      : audience.user_id
        ? { user: audience.user_id }
        : {}),
    ...extra,
  };
  if (!event.user && !event.team) return;
  await db.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(event)]);
}

/**
 * Stream a person's news as server-sent events. `teams` are the teams they
 * are on when the stream opens; the app reconnects now and then, which picks
 * up a team joined since.
 */
export async function streamLive(
  reply: FastifyReply,
  userId: string,
  teams: string[],
): Promise<() => void> {
  await ensureListening();
  const carried: Record<string, string> = {};
  for (const [name, value] of Object.entries(reply.getHeaders?.() ?? {}))
    if (value !== undefined && name.toLowerCase().startsWith("access-control-"))
      carried[name] = String(value);
  reply.raw.writeHead(200, {
    ...carried,
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  reply.raw.write(": open\n\n");

  const reader: Reader = {
    userId,
    teams: new Set(teams),
    send: (event) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`),
  };
  readers.add(reader);
  const beat = setInterval(() => reply.raw.write(": beat\n\n"), 25_000);
  // Close after a while so the app reconnects with today's teams.
  const cycle = setTimeout(() => reply.raw.end(), 15 * 60_000);
  return () => {
    clearInterval(beat);
    clearTimeout(cycle);
    readers.delete(reader);
  };
}

/** Only for tests: how many streams this copy is serving. */
export const liveReaderCount = () => readers.size;

export async function closeLiveNews(): Promise<void> {
  const open = client;
  client = null;
  readers.clear();
  await open?.end().catch(() => {});
}
