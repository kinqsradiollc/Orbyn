import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import pg from "pg";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { requestUser } from "../../lib/request-log.js";

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

/**
 * What part of the app a "changed" is about, so a screen showing pages or
 * projects re-reads just then; the planner re-reads on any "changed".
 */
export type LiveArea =
  | "items"
  | "docs"
  | "projects"
  | "organize"
  | "templates"
  | "records"
  | "review";

export type LiveEvent = {
  kind: LiveKind;
  area?: LiveArea;
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
  extra: { doc?: string; by?: string; area?: LiveArea } = {},
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

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Every successful change through a route module is announced as
 * "changed" (with its `area`) to the person who made it and, when the
 * thing changed belongs to a team, to that team: open apps showing lists,
 * folders, templates or work records re-read them, whoever (or whatever
 * agent) made the change. The team comes from the answer's `team_id`, or
 * the request's. Registered once per route module (its hooks only see its
 * own routes); announced after the answer is sent, so after the commit.
 */
export function announceWrites(app: FastifyInstance, area: LiveArea) {
  const teams = new WeakMap<FastifyRequest, string>();
  app.addHook("onSend", async (request, reply, payload) => {
    if (
      WRITES.has(request.method) &&
      reply.statusCode < 300 &&
      typeof payload === "string" &&
      payload.includes('"team_id"')
    ) {
      try {
        const team = (JSON.parse(payload) as { team_id?: unknown })?.team_id;
        if (typeof team === "string") teams.set(request, team);
      } catch {
        // Not JSON: nothing to read the team from.
      }
    }
    return payload;
  });
  app.addHook("onResponse", async (request, reply) => {
    if (!WRITES.has(request.method) || reply.statusCode >= 300) return;
    const user = requestUser.get(request);
    if (!user) return;
    const asked = (request.body as { team_id?: unknown } | null)?.team_id;
    const team =
      teams.get(request) ?? (typeof asked === "string" ? asked : null);
    await announceTo(pool, { user_id: user }, "changed", { area }).catch(
      () => {},
    );
    if (team)
      await announceTo(pool, { team_id: team }, "changed", { area }).catch(
        () => {},
      );
  });
}
