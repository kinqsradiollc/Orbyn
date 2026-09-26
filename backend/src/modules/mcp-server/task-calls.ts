import { pool } from "../../db/pool.js";
import { execute, type Execution } from "../../capabilities/execute.js";
import { registry } from "../../capabilities/index.js";
import type { Principal } from "../../capabilities/policy.js";
import { argsDigest, type Capability } from "../../capabilities/registry.js";
import type { CallContext } from "./server.js";
import {
  PLAN_TASKS_AT_ONCE,
  cancelTask,
  createTask,
  created,
  detailed,
  finishTask,
  progressTask,
  readTask,
  runningPlans,
  type TaskKind,
} from "./tasks.js";

/**
 * The Tasks extension's calls, answered before the SDK (it has no runtime
 * for them): tasks/get, tasks/cancel and tasks/update, and a long call that
 * becomes a task. See tasks.ts.
 */

type Id = string | number | null;

const rpcResult = (id: Id, result: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id,
  result,
});
const rpcError = (id: Id, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/** tasks/get, tasks/cancel and tasks/update for `p`'s own tasks. */
export async function answerTaskMethod(
  p: Principal,
  id: Id,
  method: string,
  params: Record<string, unknown>,
) {
  const taskId = typeof params.taskId === "string" ? params.taskId : null;
  if (!taskId)
    return rpcError(id, -32602, 'Invalid params: "taskId" is required.');
  const unknown = () =>
    rpcError(
      id,
      -32602,
      "Unknown task: it isn't this connection's, or it has expired.",
    );
  if (method === "tasks/get") {
    const task = await readTask(p, taskId);
    return task
      ? rpcResult(id, { resultType: "complete", ...detailed(task) })
      : unknown();
  }
  if (method === "tasks/cancel") {
    const done = await cancelTask(p, taskId);
    if (!done) return unknown();
    if (done === "finished")
      return rpcError(id, -32602, "That task has already finished.");
    return rpcResult(id, { resultType: "complete" });
  }
  // tasks/update: Orbyn's tasks never wait for input.
  const task = await readTask(p, taskId);
  if (!task) return unknown();
  return rpcError(id, -32602, "This task isn't waiting for any input.");
}

/**
 * A long call from a client that declared the Tasks extension, as a task:
 * an import starts at once and its task follows it; a plan is worked out
 * just after answering. null when it should run as a plain call after all
 * (the connection has too many plans running, or the import didn't start).
 */
export async function startTask(
  call: CallContext,
  cap: Capability,
  kind: TaskKind,
  id: Id,
  args: Record<string, unknown>,
) {
  const p = call.caller.principal;
  if (!p.grant_id) return null;
  const started = Date.now();
  const record = (exec: Execution) =>
    call.onCall(cap, cap.name, exec, Date.now() - started, argsDigest(args));

  if (kind === "import") {
    const exec = await execute(registry, p, cap.name, args, {
      primary: call.primary,
      log: call.log,
      write: (fn) => call.write((db) => fn(db)),
      requestId: call.requestId,
    });
    record(exec);
    const s = exec.result.structuredContent as
      | {
          done?: { id: string; title: string }[];
          upload_url?: string | null;
          upload_expires_at?: string | null;
        }
      | undefined;
    const importId = s?.done?.[0]?.id?.replace(/^import:/, "");
    // Refused, replayed or odd: the plain answer.
    if (exec.result.isError || exec.replayed || !importId || !s?.upload_url)
      return rpcResult(id, { resultType: "complete", ...exec.result });
    const row = await createTask(pool, p, cap.name, "import", {
      importId,
      statusMessage: `Waiting for the file: PUT its bytes to ${s.upload_url} before ${s.upload_expires_at}.`,
      detail: {
        upload_url: s.upload_url,
        upload_expires_at: s.upload_expires_at ?? undefined,
        structured: s as Record<string, unknown>,
        file: s.done?.[0]?.title,
      },
    });
    return rpcResult(id, {
      ...created(row),
      _meta: { "orbyn/import": `import:${importId}` },
    });
  }

  if ((await runningPlans(p.grant_id)) >= PLAN_TASKS_AT_ONCE) return null;
  const row = await createTask(pool, p, cap.name, "plan", {
    statusMessage: "Starting",
  });
  // Worked out after the answer goes; the row holds the outcome.
  setImmediate(() => {
    void (async () => {
      try {
        const exec = await execute(registry, p, cap.name, args, {
          primary: true,
          log: call.log,
          write: (fn) => call.write((db) => fn(db)),
          requestId: call.requestId,
          progress: (_done, _total, message) =>
            void progressTask(row.id, message).catch(call.log),
        });
        record(exec);
        await finishTask(row.id, { status: "completed", result: exec.result });
      } catch (err) {
        call.log(err);
        await finishTask(row.id, {
          status: "failed",
          error: {
            code: -32603,
            message:
              "Something went wrong on Orbyn's side. Call the tool again in a moment.",
          },
        }).catch(call.log);
      }
    })();
  });
  return rpcResult(id, created(row));
}
