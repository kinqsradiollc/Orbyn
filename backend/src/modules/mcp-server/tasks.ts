import { importStatusLine } from "@orbyn/core";
import { pool, type Queryable } from "../../db/pool.js";
import { errorResult, type ToolResult } from "../../capabilities/execute.js";
import { CapabilityError } from "../../capabilities/registry.js";
import type { Principal } from "../../capabilities/policy.js";
import { appUrl, refs } from "../../capabilities/refs.js";
import { cancelImport, jobs } from "../imports/service.js";
import { announceTo } from "../presence/live.js";

/**
 * Long jobs as MCP tasks (the Tasks extension, io.modelcontextprotocol/tasks,
 * 2026-07-28): a client that declares the extension on a call to
 * start_import, plan_revision or a large plan_schedule gets a task back
 * instead of waiting, then asks after it with tasks/get (any copy of the mcp
 * service answers, because the task is a row in mcp_tasks) or hears of it
 * on its subscriptions/listen stream (notifications/tasks). Clients that
 * don't declare it get the same handle as before (an import id to poll,
 * a plan_token), so nothing changes for them.
 *
 * - An import's task follows the import itself: working while the file is
 *   awaited and read, completed with the page once ready (or with the
 *   reason it couldn't be imported), cancelled with it.
 * - A plan's task runs on the copy that took the call, just after
 *   answering, and keeps its result. One that stops without finishing (the
 *   copy went away) is reported failed after two minutes.
 */

export const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";
const CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";

/** How long a task is kept after it was last touched. */
export const TASK_TTL_MS = 3_600_000;
/** How often a client should ask after a task. */
export const POLL_MS = { plan: 2_000, import: 5_000 } as const;
/** Plans one connection may have running at once as tasks. */
export const PLAN_TASKS_AT_ONCE = 3;
/** A plan still "working" after this long stopped without finishing. */
export const STALE_PLAN_MS = 120_000;

/** The task methods answered here. */
export const TASK_METHODS = new Set([
  "tasks/get",
  "tasks/cancel",
  "tasks/update",
]);

export type TaskKind = "plan" | "import";
export type TaskStatus =
  "working" | "input_required" | "completed" | "failed" | "cancelled";

/** A task on the wire (DetailedTask): its state, and its outcome once done. */
export type WireTask = {
  taskId: string;
  status: TaskStatus;
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number;
  pollIntervalMs: number;
  result?: ToolResult;
  error?: { code: number; message: string };
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether a request's _meta declares the Tasks extension. */
export function declaresTasks(params: unknown): boolean {
  if (!isObject(params) || !isObject(params._meta)) return false;
  const caps = params._meta[CLIENT_CAPABILITIES];
  if (!isObject(caps) || !isObject(caps.extensions)) return false;
  return Object.prototype.hasOwnProperty.call(caps.extensions, TASKS_EXTENSION);
}

/**
 * Whether a call is a long job: every import, every revision plan, and a
 * plan over more than a week or more than 25 named tasks.
 */
export function taskKind(
  tool: string,
  args: Record<string, unknown>,
): TaskKind | null {
  if (tool === "start_import") return "import";
  if (tool === "plan_revision") return "plan";
  if (tool === "plan_schedule") {
    const days = typeof args.days === "number" ? args.days : 7;
    const tasks = Array.isArray(args.tasks) ? args.tasks.length : 0;
    return days > 7 || tasks > 25 ? "plan" : null;
  }
  return null;
}

type Row = {
  id: string;
  user_id: string;
  grant_id: string;
  tool: string;
  kind: TaskKind;
  import_id: string | null;
  status: TaskStatus;
  status_message: string | null;
  result: ToolResult | null;
  error: { code: number; message: string } | null;
  detail: {
    upload_url?: string;
    upload_expires_at?: string;
    structured?: Record<string, unknown>;
    file?: string;
  };
  ttl_ms: number;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = `id, user_id, grant_id, tool, kind, import_id, status,
  status_message, result, error, detail, ttl_ms, created_at, updated_at`;

/** Tells the connection's streams that one of its tasks moved. */
const told = (db: Queryable, row: Pick<Row, "user_id" | "id">) =>
  announceTo(db as never, { user_id: row.user_id }, "agent_task", {
    entity_type: "agent_task",
    entity_id: row.id,
  }).catch(() => {});

/** A new task for `p`'s connection. */
export async function createTask(
  db: Queryable,
  p: Principal,
  tool: string,
  kind: TaskKind,
  extra: {
    importId?: string;
    statusMessage?: string;
    detail?: Row["detail"];
  } = {},
): Promise<Row> {
  const row = (
    await db.query<Row>(
      `INSERT INTO mcp_tasks (user_id, grant_id, tool, kind, import_id,
         status_message, detail, ttl_ms, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(secs => $8::int / 1000))
       RETURNING ${COLUMNS}`,
      [
        p.user.id,
        p.grant_id,
        tool,
        kind,
        extra.importId ?? null,
        extra.statusMessage ?? null,
        JSON.stringify(extra.detail ?? {}),
        TASK_TTL_MS,
      ],
    )
  ).rows[0];
  return row;
}

/** How many plans a connection has running as tasks. */
export async function runningPlans(grantId: string): Promise<number> {
  return (
    await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM mcp_tasks
        WHERE grant_id = $1 AND kind = 'plan' AND status = 'working'
          AND updated_at > now() - make_interval(secs => $2::int / 1000)`,
      [grantId, STALE_PLAN_MS],
    )
  ).rows[0].n;
}

/** The answer to a call that became a task (CreateTaskResult). */
export function created(row: Row) {
  const t = wire(row);
  return {
    resultType: "task" as const,
    taskId: t.taskId,
    status: t.status,
    ...(t.statusMessage ? { statusMessage: t.statusMessage } : {}),
    createdAt: t.createdAt,
    lastUpdatedAt: t.lastUpdatedAt,
    ttlMs: t.ttlMs,
    pollIntervalMs: t.pollIntervalMs,
  };
}

/** A stored task as the wire has it (before an import's own state). */
function wire(row: Row): WireTask {
  const base: WireTask = {
    taskId: row.id,
    status: row.status,
    ...(row.status_message ? { statusMessage: row.status_message } : {}),
    createdAt: row.created_at.toISOString(),
    lastUpdatedAt: row.updated_at.toISOString(),
    ttlMs: row.ttl_ms,
    pollIntervalMs: POLL_MS[row.kind],
  };
  if (
    row.kind === "plan" &&
    row.status === "working" &&
    Date.now() - row.updated_at.getTime() > STALE_PLAN_MS
  )
    return {
      ...base,
      status: "failed",
      statusMessage: "The plan stopped before it finished.",
      error: {
        code: -32603,
        message:
          "The plan stopped before it finished. Call the tool again to make a new one.",
      },
    };
  if (row.status === "completed" && row.result)
    return { ...base, result: row.result };
  if (row.status === "failed")
    return {
      ...base,
      error: row.error ?? {
        code: -32603,
        message: "The job failed. Call the tool again.",
      },
    };
  return base;
}

/** An import task, from the import's own state. */
async function importTask(row: Row): Promise<WireTask> {
  const base = wire(row);
  if (row.status === "cancelled" || !row.import_id)
    return { ...base, status: "cancelled", statusMessage: "Cancelled" };
  const job = (await jobs(pool, row.user_id, row.import_id))[0];
  if (!job) return { ...base, status: "cancelled", statusMessage: "Cancelled" };
  const updated = new Date(
    Math.max(
      row.updated_at.getTime(),
      job.finished_at ? Date.parse(job.finished_at) : 0,
    ),
  ).toISOString();
  const file = row.detail.file ?? job.file_name;
  switch (job.status) {
    case "waiting":
      return {
        ...base,
        status: "working",
        lastUpdatedAt: updated,
        statusMessage: row.detail.upload_url
          ? `Waiting for the file: PUT its bytes to ${row.detail.upload_url} before ${row.detail.upload_expires_at}.`
          : "Waiting for the file.",
      };
    case "queued":
    case "reading":
    case "ocr":
      return {
        ...base,
        status: "working",
        lastUpdatedAt: updated,
        statusMessage: importStatusLine(job),
      };
    case "cancelled":
      return {
        ...base,
        status: "cancelled",
        lastUpdatedAt: updated,
        statusMessage: "Cancelled",
      };
    case "failed":
      return {
        ...base,
        status: "completed",
        lastUpdatedAt: updated,
        statusMessage: job.error ?? "Couldn't be imported.",
        result: errorResult(
          new CapabilityError(
            "INVALID",
            `${file} couldn't be imported: ${job.error ?? "the file couldn't be read."}`,
            "Check the file, then start the import again.",
          ),
        ),
      };
    case "ready": {
      const page = job.doc_id;
      const url = page
        ? refs({ type: "doc", id: page }).url
        : `${appUrl()}/app`;
      const structured = {
        ...(row.detail.structured ?? {
          status: "done",
          done: [],
          pending: null,
          skipped: [],
        }),
        upload_url: null,
        upload_expires_at: null,
      } as Record<string, unknown>;
      const done = (structured.done as Record<string, unknown>[]) ?? [];
      structured.done = done.map((d) => ({
        ...d,
        url,
        change: page
          ? `Imported as doc:${page}`
          : "Imported (the page is in Trash)",
      }));
      const text = page
        ? `Imported ${file} into Docs: doc:${page} (${url}).`
        : `Imported ${file}; the page it became is in the Trash.`;
      return {
        ...base,
        status: "completed",
        lastUpdatedAt: updated,
        statusMessage: importStatusLine(job),
        result: {
          content: [
            { type: "text", text },
            ...(page
              ? [
                  {
                    type: "resource_link" as const,
                    uri: `orbyn://doc/${page}`,
                    name: file,
                  },
                ]
              : []),
          ],
          structuredContent: structured,
        },
      };
    }
  }
}

/** One stored task, for its own connection only (null: unknown or gone). */
async function stored(
  db: Queryable,
  grantId: string,
  id: string,
): Promise<Row | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (
    (
      await db.query<Row>(
        `SELECT ${COLUMNS} FROM mcp_tasks
          WHERE id = $1 AND grant_id = $2 AND expires_at > now()`,
        [id, grantId],
      )
    ).rows[0] ?? null
  );
}

const view = (row: Row) =>
  row.kind === "import" ? importTask(row) : Promise.resolve(wire(row));

/** A task of `p`'s connection as the wire has it, or null. */
export async function readTask(
  p: Principal,
  id: string,
): Promise<WireTask | null> {
  const row = await stored(pool, p.grant_id!, id);
  return row ? view(row) : null;
}

/** Several tasks of one connection (a listen stream's), by id. */
export async function readTasks(
  grantId: string,
  ids: string[],
): Promise<WireTask[]> {
  const wanted = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!wanted.length) return [];
  const rows = (
    await pool.query<Row>(
      `SELECT ${COLUMNS} FROM mcp_tasks
        WHERE id = ANY ($1::uuid[]) AND grant_id = $2 AND expires_at > now()`,
      [wanted, grantId],
    )
  ).rows;
  return Promise.all(rows.map(view));
}

/** Which of `ids` are tasks of this connection (for a listen filter). */
export async function ownTaskIds(
  grantId: string,
  ids: string[],
): Promise<string[]> {
  return (await readTasks(grantId, ids)).map((t) => t.taskId);
}

/** A plan task's step, while it runs. */
export async function progressTask(id: string, message: string) {
  const row = (
    await pool.query<Pick<Row, "id" | "user_id">>(
      `UPDATE mcp_tasks SET status_message = $2, updated_at = now(),
              expires_at = now() + make_interval(secs => ttl_ms / 1000)
        WHERE id = $1 AND status = 'working' RETURNING id, user_id`,
      [id, message.slice(0, 300)],
    )
  ).rows[0];
  if (row) await told(pool, row);
}

/** A plan task's outcome (ignored when it was cancelled meanwhile). */
export async function finishTask(
  id: string,
  outcome:
    | { status: "completed"; result: ToolResult }
    | { status: "failed"; error: { code: number; message: string } },
) {
  const row = (
    await pool.query<Pick<Row, "id" | "user_id">>(
      `UPDATE mcp_tasks SET status = $2, result = $3, error = $4,
              status_message = $5, updated_at = now(),
              expires_at = now() + make_interval(secs => ttl_ms / 1000)
        WHERE id = $1 AND status = 'working' RETURNING id, user_id`,
      [
        id,
        outcome.status,
        outcome.status === "completed" ? JSON.stringify(outcome.result) : null,
        outcome.status === "failed" ? JSON.stringify(outcome.error) : null,
        outcome.status === "completed"
          ? outcome.result.isError
            ? "Finished with a problem"
            : "Done"
          : outcome.error.message.slice(0, 300),
      ],
    )
  ).rows[0];
  if (row) await told(pool, row);
}

/**
 * Cancels a task of `p`'s connection: an import is cancelled with it (the
 * page it made, if any, stays). "finished" for a task that already ended.
 */
export async function cancelTask(
  p: Principal,
  id: string,
): Promise<WireTask | "finished" | null> {
  const row = await stored(pool, p.grant_id!, id);
  if (!row) return null;
  const now = await view(row);
  if (now.status !== "working" && now.status !== "input_required")
    return "finished";
  if (row.kind === "import" && row.import_id)
    await cancelImport(pool, row.user_id, row.import_id);
  await pool.query(
    `UPDATE mcp_tasks SET status = 'cancelled', status_message = 'Cancelled',
            updated_at = now() WHERE id = $1`,
    [id],
  );
  await told(pool, row);
  return readTask(p, id) as Promise<WireTask>;
}

/** tasks/get's and notifications/tasks' shape: the task and its outcome. */
export function detailed(t: WireTask) {
  const { result, error, ...rest } = t;
  return {
    ...rest,
    ...(t.status === "completed" && result
      ? { result: { resultType: "complete", ...result } }
      : {}),
    ...(t.status === "failed" && error ? { error } : {}),
  };
}
