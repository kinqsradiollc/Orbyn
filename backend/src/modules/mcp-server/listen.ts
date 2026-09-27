import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AGENT_INBOX_URI } from "@orbyn/core";
import { env } from "../../config/env.js";
import { mcpOriginAllowed } from "../../lib/mcp-origins.js";
import {
  onAuthChange,
  listenAuthChanges,
  type AuthChange,
} from "../../lib/auth-events.js";
import {
  agentRequests,
  requestUser,
  routeLabels,
} from "../../lib/request-log.js";
import { settings } from "../../lib/settings.js";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
  visibleRecords,
  visibleTemplates,
  visibleViews,
} from "../../lib/visibility.js";
import { readTransaction } from "../../db/pool.js";
import { policy, type Principal } from "../../capabilities/policy.js";
import { onLive, type LiveEvent } from "../presence/live.js";
import { watchDoc } from "../docs/live.js";
import { McpAuthError, resolveCaller, type Caller } from "./auth.js";
import { detailed, readTasks, ownTaskIds } from "./tasks.js";

/**
 * Following Orbyn from an agent (subscriptions/listen, MCP 2026-07-28): one
 * long-lived stream per listen request, held by the realtime service (the
 * gateway sends a POST /mcp whose Mcp-Method is subscriptions/listen there),
 * so the mcp service itself stays stateless and short.
 *
 * - The stream opens with notifications/subscriptions/acknowledged, naming
 *   what was agreed: the recent-things list (resourcesListChanged), the
 *   resources it can read (resourceSubscriptions: orbyn://inbox, its own
 *   inbox, told of as soon as something lands in it; orbyn://today,
 *   orbyn://day/<date>, orbyn://<task|doc|project|record|template|view>/<id>)
 *   and its own long jobs (taskIds, the Tasks extension). Anything it can't
 *   read is dropped from the acknowledgement, never reported on; a followed
 *   thing is checked again before each note, and dropped once it can't be
 *   read: silently when it still exists (made private, moved out of a space
 *   the connection was given), after one last resources/updated when it was
 *   deleted or trashed (reading it then says it's gone).
 * - Then notifications/resources/updated, notifications/resources/list_changed
 *   and notifications/tasks as things change, gathered for half a second so
 *   a burst is one note each. They say what moved, never what it says: the
 *   agent reads it again.
 * - A keep-alive comment every 25 s. The stream closes with a "complete"
 *   result at the earlier of 15 minutes and the credential's end, when this
 *   copy shuts down, and when the connection's access changes (orbyn_auth:
 *   revoked, paused, a team role changed): the agent opens it again and is
 *   checked afresh.
 * - The news comes from the same Postgres channel as the apps' (orbyn_live),
 *   only for the person and the teams this connection was given.
 */

/** Tunables (tests shorten them). */
export const LISTEN = {
  keepAliveMs: 25_000,
  maxMs: 15 * 60_000,
  /** Gathering changes before telling, so a burst is one note. */
  gatherMs: 500,
  /** Open streams per connection on one copy, and in all on one copy. */
  perGrant: 3,
  perCopy: 5_000,
  /** Resources and tasks one stream may follow. */
  maxUris: 100,
  maxTasks: 50,
  /**
   * When the access re-check fails (a database blip), the notes wait this
   * long for another try; after this many failures in a row the stream
   * closes and the agent opens it again.
   */
  retryMs: 5_000,
  maxCheckFailures: 3,
};

const MODERN = "2026-07-28";
const SUBSCRIPTION_ID = "io.modelcontextprotocol/subscriptionId";
const SERVER_INFO = "io.modelcontextprotocol/serverInfo";

type Id = string | number;
type Filter = {
  resourcesListChanged?: true;
  resourceSubscriptions?: string[];
  taskIds?: string[];
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const rpcError = (
  id: Id | null,
  code: number,
  message: string,
  data?: Record<string, unknown>,
) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, ...(data ? { data } : {}) },
});

/** A problem with a listen request: the HTTP status and JSON-RPC error. */
type Refusal = { status: number; body: ReturnType<typeof rpcError> };

/**
 * The checks the SDK makes for any 2026-07-28 request, for a listen
 * request (which never reaches the SDK): an id, the revision, the headers
 * agreeing with the body, and a notifications filter.
 */
export function checkListen(
  headers: Record<string, string | string[] | undefined>,
  body: Record<string, unknown>,
): Refusal | null {
  const id =
    typeof body.id === "string" || typeof body.id === "number" ? body.id : null;
  if (id === null)
    return {
      status: 400,
      body: rpcError(
        null,
        -32600,
        "subscriptions/listen is a request: it needs an id.",
      ),
    };
  const version = headers["mcp-protocol-version"];
  if (version !== MODERN)
    return {
      status: 400,
      body: rpcError(id, -32022, "Unsupported protocol version.", {
        supported: [MODERN],
        requested: typeof version === "string" ? version : "unknown",
      }),
    };
  const method = headers["mcp-method"];
  if (method !== undefined && method !== body.method)
    return {
      status: 400,
      body: rpcError(
        id,
        -32020,
        "The Mcp-Method header doesn't match the request.",
      ),
    };
  const params = body.params;
  if (!isObject(params) || !isObject(params.notifications))
    return {
      status: 200,
      body: rpcError(
        id,
        -32602,
        "Invalid params: 'notifications' is required and must be an object.",
      ),
    };
  return null;
}

/** orbyn:// resources a stream can follow, and the type and id in them. */
const THING =
  /^orbyn:\/\/(task|doc|project|record|template|view)\/([0-9a-f-]{36})$/i;
const DAY = /^orbyn:\/\/day\/(\d{4}-\d{2}-\d{2})$/;
/** The connection's inbox (H0), as a resource. */
const INBOX_URI = AGENT_INBOX_URI;

const TABLES = {
  task: ["items", "i", visibleItems],
  doc: ["docs", "d", visibleDocs],
  project: ["projects", "p", visibleProjects],
  record: ["work_records", "w", visibleRecords],
  template: ["project_templates", "t", visibleTemplates],
  view: ["saved_views", "v", visibleViews],
} as const;

/** The orbyn://<type>/<id> resources in `uris`, by type and lower-case id. */
function thingsByType(uris: string[]) {
  const byType = new Map<keyof typeof TABLES, Map<string, string>>();
  for (const uri of uris) {
    const m = THING.exec(uri);
    if (!m) continue;
    const type = m[1].toLowerCase() as keyof typeof TABLES;
    const list = byType.get(type) ?? new Map<string, string>();
    list.set(m[2].toLowerCase(), uri);
    byType.set(type, list);
  }
  return byType;
}

/**
 * The orbyn://<type>/<id> resources in `uris` that `p` can read now. The
 * rest (other kinds of URI included) are left out.
 */
async function readableThings(
  p: Principal,
  uris: string[],
): Promise<Set<string>> {
  const kept = new Set<string>();
  const byType = thingsByType(uris);
  if (byType.size)
    await readTransaction(async (db) => {
      for (const [type, ids] of byType) {
        const [table, alias, visible] = TABLES[type];
        const params = new Params();
        const scope = scopeFor(policy.spaces(p), params);
        const at = params.add([...ids.keys()]);
        const found = (
          await db.query<{ id: string }>(
            `SELECT ${alias}.id FROM ${table} ${alias}
              WHERE ${alias}.id = ANY (${at}::uuid[]) AND ${visible(alias, scope)}`,
            params.values,
          )
        ).rows;
        for (const row of found) kept.add(ids.get(row.id)!);
      }
    });
  return kept;
}

/**
 * The orbyn://<type>/<id> resources in `uris` that were deleted: the row is
 * gone, or (a page) it is in the Trash. One that still exists but can't be
 * read (made private, moved out of a space) is not among them.
 */
async function deletedThings(uris: string[]): Promise<Set<string>> {
  const byType = thingsByType(uris);
  const gone = new Set<string>();
  if (byType.size)
    await readTransaction(async (db) => {
      for (const [type, ids] of byType) {
        const [table, alias] = TABLES[type];
        const trash = type === "doc" ? ` AND ${alias}.deleted_at IS NULL` : "";
        const there = new Set(
          (
            await db.query<{ id: string }>(
              `SELECT ${alias}.id FROM ${table} ${alias}
                WHERE ${alias}.id = ANY ($1::uuid[])${trash}`,
              [[...ids.keys()]],
            )
          ).rows.map((r) => r.id),
        );
        for (const [id, uri] of ids) if (!there.has(id)) gone.add(uri);
      }
    });
  return gone;
}

/**
 * The part of a requested filter this connection gets: the resources it
 * can read now, and its own tasks. Tools and prompts don't change while a
 * connection is open (a change to it closes the stream), so those lists
 * are never followed.
 */
export async function honour(
  p: Principal,
  requested: Record<string, unknown>,
): Promise<Filter> {
  const out: Filter = {};
  if (requested.resourcesListChanged === true) out.resourcesListChanged = true;
  const asked = Array.isArray(requested.resourceSubscriptions)
    ? [
        ...new Set(
          requested.resourceSubscriptions.filter(
            (u): u is string => typeof u === "string",
          ),
        ),
      ].slice(0, LISTEN.maxUris)
    : [];
  const keep = await readableThings(p, asked);
  for (const uri of asked) {
    // The connection's own inbox (H0): new items are told at once.
    if (uri === INBOX_URI) {
      if (p.grant_id) keep.add(uri);
      continue;
    }
    if (uri === "orbyn://today") {
      if (p.personal) keep.add(uri);
      continue;
    }
    if (DAY.test(uri)) {
      if (
        p.personal &&
        !Number.isNaN(Date.parse(`${DAY.exec(uri)![1]}T00:00:00Z`))
      )
        keep.add(uri);
    }
  }
  // In the order they were asked for.
  if (keep.size) out.resourceSubscriptions = asked.filter((u) => keep.has(u));
  const tasks = Array.isArray(requested.taskIds)
    ? requested.taskIds
        .filter((t): t is string => typeof t === "string")
        .slice(0, LISTEN.maxTasks)
    : [];
  if (tasks.length && p.grant_id) {
    const own = await ownTaskIds(p.grant_id, tasks);
    if (own.length) out.taskIds = own;
  }
  return out;
}

/** What a piece of news means for a stream's filter: the notes to send. */
export function notesFor(
  event: LiveEvent,
  filter: Filter,
  p: Pick<Principal, "personal"> & { grant_id?: string | null },
): { updated: string[]; listChanged: boolean; tasks: string[] | "all" } {
  const none = { updated: [], listChanged: false, tasks: [] as string[] };
  // Something new in a connection's inbox: only that connection hears.
  if (event.kind === "agent_inbox")
    return {
      ...none,
      updated:
        !!p.grant_id &&
        event.entity_id === p.grant_id &&
        filter.resourceSubscriptions?.includes(INBOX_URI)
          ? [INBOX_URI]
          : [],
    };
  // Personal news only for a connection given the Personal space; its own
  // jobs always.
  if (!event.team && !p.personal && event.kind !== "agent_task") return none;
  if (event.kind === "agent_task")
    return {
      ...none,
      tasks:
        event.entity_id && filter.taskIds?.includes(event.entity_id)
          ? [event.entity_id]
          : [],
    };
  if (event.kind !== "changed") return none;
  const subs = filter.resourceSubscriptions ?? [];
  const updated = new Set<string>();
  if (event.entity_type && event.entity_id) {
    const uri = `orbyn://${event.entity_type}/${event.entity_id}`;
    if (subs.includes(uri)) updated.add(uri);
  }
  // The day's list moves with tasks, events and sessions (the planner's
  // news carries no area).
  if (!event.area || event.area === "items" || event.entity_type === "task")
    for (const uri of subs)
      if (uri === "orbyn://today" || DAY.test(uri)) updated.add(uri);
  const listChanged =
    !!filter.resourcesListChanged &&
    (event.area === "docs" ||
      event.area === "projects" ||
      event.entity_type === "doc" ||
      event.entity_type === "project" ||
      event.entity_type === "view");
  // Imports move without saying which task: look at the stream's imports.
  const tasks =
    filter.taskIds?.length && (!event.area || event.entity_type === "import")
      ? ("all" as const)
      : [];
  return { updated: [...updated], listChanged, tasks };
}

type Stream = {
  grantId: string;
  userId: string;
  clientId: string | null;
  teams: Set<string>;
  close: (graceful: boolean) => void;
};

/** Streams open on this copy. */
const streams = new Set<Stream>();

/** Only for tests: streams open on this copy. */
export const listenCount = () => streams.size;

/** Whether an access change touches a stream. */
const touches = (s: Stream, c: AuthChange) =>
  !!(
    c.grants?.includes(s.grantId) ||
    c.users?.includes(s.userId) ||
    (s.clientId && c.clients?.includes(s.clientId)) ||
    c.teams?.some((t) => s.teams.has(t))
  );

onAuthChange((change) => {
  for (const s of [...streams]) if (touches(s, change)) s.close(true);
});

/** Closes every stream on this copy with its "complete" result. */
export function closeAllListens() {
  for (const s of [...streams]) s.close(true);
}

/**
 * Opens the stream for a checked listen request from `caller`. The reply
 * belongs to the stream from here.
 */
export async function openListen(
  r: FastifyRequest,
  reply: FastifyReply,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<FastifyReply> {
  const p = caller.principal;
  const id = body.id as Id;
  const grantId = p.grant_id ?? "";
  const mine = [...streams].filter((s) => s.grantId === grantId).length;
  if (mine >= LISTEN.perGrant || streams.size >= LISTEN.perCopy)
    return reply
      .code(429)
      .header("Retry-After", "30")
      .send(
        rpcError(
          id,
          -32029,
          mine >= LISTEN.perGrant
            ? `This connection already has ${LISTEN.perGrant} streams open. Close one first.`
            : "That's a lot at once. Wait a moment and try again.",
          { retry_after: 30 },
        ),
      );
  const params = body.params as { notifications: Record<string, unknown> };
  const filter = await honour(p, params.notifications);

  // CORS headers set by the hooks, carried onto the raw stream.
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
  const stamp = { [SUBSCRIPTION_ID]: id };
  let closed = false;
  const frame = (text: string) => {
    if (!closed) reply.raw.write(text);
  };
  const note = (method: string, params: Record<string, unknown> = {}) =>
    frame(
      `event: message\ndata: ${JSON.stringify({
        jsonrpc: "2.0",
        method,
        params: { ...params, _meta: stamp },
      })}\n\n`,
    );
  note("notifications/subscriptions/acknowledged", { notifications: filter });

  // News, gathered for a moment so a burst is one note each.
  const pending = {
    updated: new Set<string>(),
    list: false,
    tasks: new Set<string>(),
    allTasks: false,
  };
  const lastTask = new Map<string, string>();
  const docWatches = new Map<string, () => void>();
  let timer: NodeJS.Timeout | null = null;
  /** Access re-checks that failed in a row (a database blip). */
  let checkFailures = 0;
  const flush = async () => {
    timer = null;
    const updated = [...pending.updated];
    const list = pending.list;
    const taskIds = pending.allTasks
      ? (filter.taskIds ?? [])
      : [...pending.tasks];
    pending.updated.clear();
    pending.list = false;
    pending.tasks.clear();
    pending.allTasks = false;
    // What it follows may have become private, left a space it was given
    // or been deleted since the stream opened: checked again before telling.
    // One that was deleted is told of a last time (reading it then says it's
    // gone) and dropped; one that still exists but can't be read is dropped
    // silently, never told of again. If the check itself fails, nothing is
    // dropped: the notes wait for the next try, and the stream closes (the
    // agent opens it again) when it keeps failing.
    const things = updated.filter((u) => THING.test(u));
    let held = new Set<string>();
    let gone: string[] = [];
    let deleted = new Set<string>();
    if (things.length)
      try {
        const still = await readableThings(p, things);
        gone = things.filter((u) => !still.has(u));
        if (gone.length) deleted = await deletedThings(gone);
        checkFailures = 0;
      } catch {
        if (closed) return;
        if (++checkFailures >= LISTEN.maxCheckFailures) {
          stream.close(true);
          return;
        }
        // Held back for the next try; nothing is dropped.
        held = new Set(things);
        gone = [];
        for (const uri of things) pending.updated.add(uri);
        timer ??= setTimeout(() => void flush(), LISTEN.retryMs);
      }
    if (gone.length) forget(gone);
    for (const uri of updated) {
      if (held.has(uri)) continue;
      if (gone.includes(uri) && !deleted.has(uri)) continue;
      note("notifications/resources/updated", { uri });
    }
    if (list) note("notifications/resources/list_changed");
    if (taskIds.length) {
      const tasks = await readTasks(grantId, taskIds).catch(() => []);
      for (const t of tasks) {
        // Only what moved since the stream last told of it.
        const key = `${t.status}|${t.lastUpdatedAt}|${t.statusMessage ?? ""}`;
        if (lastTask.get(t.taskId) === key) continue;
        lastTask.set(t.taskId, key);
        note("notifications/tasks", detailed(t));
      }
    }
  };
  const teams = new Set(p.teams.map((t) => t.id));
  const stopNews = await onLive(p.user.id, teams, (event) => {
    const n = notesFor(event, filter, p);
    for (const uri of n.updated) pending.updated.add(uri);
    if (n.listChanged) pending.list = true;
    if (n.tasks === "all") pending.allTasks = true;
    else for (const t of n.tasks) pending.tasks.add(t);
    if (
      !timer &&
      (pending.updated.size ||
        pending.list ||
        pending.tasks.size ||
        pending.allTasks)
    )
      timer = setTimeout(() => void flush(), LISTEN.gatherMs);
  });
  // A followed page's words change on their own channel (doc_changed).
  for (const m of (filter.resourceSubscriptions ?? [])
    .map((uri) => /^orbyn:\/\/doc\/([0-9a-f-]{36})$/i.exec(uri))
    .filter((m): m is RegExpExecArray => !!m))
    docWatches.set(
      m[0],
      await watchDoc(m[1].toLowerCase(), () => {
        pending.updated.add(m[0]);
        timer ??= setTimeout(() => void flush(), LISTEN.gatherMs);
      }),
    );
  /** Stops following resources it can no longer read. */
  function forget(uris: string[]) {
    filter.resourceSubscriptions = (filter.resourceSubscriptions ?? []).filter(
      (u) => !uris.includes(u),
    );
    for (const uri of uris) {
      pending.updated.delete(uri);
      docWatches.get(uri)?.();
      docWatches.delete(uri);
    }
  }
  // Tasks already finished when the stream opened are told at once.
  if (filter.taskIds?.length) {
    pending.allTasks = true;
    timer = setTimeout(() => void flush(), 0);
  }

  const beat = setInterval(() => frame(": keepalive\n\n"), LISTEN.keepAliveMs);
  const until = Math.min(
    LISTEN.maxMs,
    caller.expiresAt ? caller.expiresAt.getTime() - Date.now() : Infinity,
  );
  const stream: Stream = {
    grantId,
    userId: p.user.id,
    clientId: p.client.id ?? null,
    teams,
    close: (graceful) => {
      if (closed) return;
      if (graceful)
        frame(
          `event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              resultType: "complete",
              _meta: {
                ...stamp,
                [SERVER_INFO]: {
                  name: "orbyn",
                  title: "Orbyn",
                  version: env.APP_VERSION,
                },
              },
            },
          })}\n\n`,
        );
      closed = true;
      clearInterval(beat);
      clearTimeout(end);
      if (timer) clearTimeout(timer);
      stopNews();
      for (const stop of docWatches.values()) stop();
      docWatches.clear();
      streams.delete(stream);
      reply.raw.end();
    },
  };
  const end = setTimeout(() => stream.close(true), Math.max(0, until));
  streams.add(stream);
  r.raw.on("close", () => stream.close(false));
  return reply;
}

/**
 * POST /mcp on the realtime service: only subscriptions/listen reaches it
 * (the gateway routes on Mcp-Method). The same door checks as the mcp
 * service: the page's origin, the agents switch, and the credential.
 */
export async function mcpListenRoutes(app: FastifyInstance) {
  let stopListening: (() => Promise<void>) | null = null;
  app.addHook("onReady", async () => {
    stopListening = await listenAuthChanges((err) =>
      app.log.warn({ err }, "Listening for agent access changes failed"),
    );
  });
  app.addHook("preClose", async () => {
    closeAllListens();
  });
  app.addHook("onClose", async () => {
    await stopListening?.();
  });

  app.post("/mcp", { bodyLimit: 65_536 }, async (r, reply) => {
    agentRequests.add(r);
    routeLabels.set(r, "mcp:subscriptions/listen");
    if (!mcpOriginAllowed(r.headers.origin))
      return reply
        .code(403)
        .send(
          rpcError(null, -32003, "Requests from this web page aren't allowed."),
        );
    const s = await settings();
    if (!s.agents.agents_enabled)
      return reply
        .code(503)
        .header("Retry-After", "300")
        .send(
          rpcError(
            null,
            -32002,
            "Outside agents are switched off on this Orbyn for now. Try again later.",
          ),
        );
    let caller: Caller;
    try {
      caller = await resolveCaller(r.headers, s);
    } catch (e) {
      if (!(e instanceof McpAuthError)) throw e;
      if (e.challenge) reply.header("WWW-Authenticate", e.challenge);
      return reply
        .code(e.status)
        .send(rpcError(null, e.status === 401 ? -32001 : -32003, e.message));
    }
    requestUser.set(r, caller.principal.user.id);
    const body = r.body as unknown;
    if (!isObject(body) || body.jsonrpc !== "2.0")
      return reply
        .code(400)
        .send(rpcError(null, -32600, "Send one JSON-RPC 2.0 request object."));
    if (body.method !== "subscriptions/listen")
      return reply.send(
        rpcError(
          typeof body.id === "string" || typeof body.id === "number"
            ? body.id
            : null,
          -32601,
          `Method not found: ${String(body.method)}`,
        ),
      );
    const refused = checkListen(r.headers, body);
    if (refused) return reply.code(refused.status).send(refused.body);
    return openListen(r, reply, caller, body);
  });
}
