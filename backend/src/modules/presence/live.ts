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
  "agent_task",
  "agent_inbox",
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

/**
 * What a "changed" is about, when it's one thing: agents following it
 * (subscriptions/listen) hear which page, project or record moved, and the
 * apps can ignore it. `agent_task` is an agent's long job (the Tasks
 * extension), heard only by that agent's streams.
 */
export const LIVE_ENTITIES = [
  "task",
  "doc",
  "project",
  "record",
  "template",
  "view",
  "folder",
  "import",
  "agent_task",
] as const;
export type LiveEntity = (typeof LIVE_ENTITIES)[number];

export type LiveEvent = {
  kind: LiveKind;
  area?: LiveArea;
  /** The one thing that changed, when there is one. */
  entity_type?: LiveEntity;
  entity_id?: string;
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
  /** Kinds this reader never wants (the apps skip agents' own jobs). */
  skip?: ReadonlySet<LiveKind>;
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
          !reader.skip?.has(event.kind) &&
          ((event.user && event.user === reader.userId) ||
            (event.team && reader.teams.has(event.team)))
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
  extra: {
    doc?: string;
    by?: string;
    area?: LiveArea;
    entity_type?: LiveEntity;
    entity_id?: string;
  } = {},
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
    // The apps ignore which thing moved, and a team member may not be able
    // to see it: they get the news without it.
    send: ({ entity_type: _type, entity_id: _id, ...event }) =>
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`),
    skip: APP_SKIPS,
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

/**
 * What the apps' stream leaves out: agents' own long jobs, and news that
 * an agent's inbox has something new (`entity_id` is the connection; its
 * listen streams tell the agent, raised by agent_inbox_emit()).
 */
const APP_SKIPS: ReadonlySet<LiveKind> = new Set(["agent_task", "agent_inbox"]);

/**
 * Hears a person's news (and their teams') on this copy, for a stream
 * other than the apps' (an agent's subscriptions/listen). Returns a way to
 * stop; `teams` can be changed in place.
 */
export async function onLive(
  userId: string,
  teams: Set<string>,
  send: (event: LiveEvent) => void,
): Promise<() => void> {
  await ensureListening();
  const reader: Reader = { userId, teams, send };
  readers.add(reader);
  return () => {
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
export function announceWrites(
  app: FastifyInstance,
  area: LiveArea,
  entity?: LiveEntity,
) {
  const seen = new WeakMap<FastifyRequest, { team?: string; id?: string }>();
  app.addHook("onSend", async (request, reply, payload) => {
    if (
      WRITES.has(request.method) &&
      reply.statusCode < 300 &&
      typeof payload === "string" &&
      (payload.includes('"team_id"') || (entity && payload.includes('"id"')))
    ) {
      try {
        const body = JSON.parse(payload) as { team_id?: unknown; id?: unknown };
        seen.set(request, {
          ...(typeof body?.team_id === "string" ? { team: body.team_id } : {}),
          ...(typeof body?.id === "string" ? { id: body.id } : {}),
        });
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
    const found = seen.get(request);
    const team = found?.team ?? (typeof asked === "string" ? asked : null);
    // The one thing changed: the route's own :id (/templates/:id, and
    // actions on it such as /templates/:id/use, whose answer is something
    // else), or for a route that makes one, the answer's id.
    const param = (request.params as { id?: unknown } | null)?.id;
    const own =
      /^\/[^/]+\/:id(\/|$)/.test(request.routeOptions?.url ?? "") &&
      typeof param === "string" &&
      /^[0-9a-f-]{36}$/i.test(param);
    const id = own ? (param as string) : found?.id;
    const extra = {
      area,
      ...(entity && id ? { entity_type: entity, entity_id: id } : {}),
    };
    await announceTo(pool, { user_id: user }, "changed", extra).catch(() => {});
    if (team)
      await announceTo(pool, { team_id: team }, "changed", extra).catch(
        () => {},
      );
  });
}
