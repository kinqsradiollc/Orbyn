// A disposable process for hard-kill and post-commit recovery tests.
import "../setup.js";
import Fastify from "fastify";
import { pool } from "../../src/db/pool.js";
import { startAssistantRunner } from "../../src/modules/ai/agent/runner.js";
import { assistantRunLimits } from "../../src/modules/ai/agent/run.js";

if (process.env.RUNNER_TEST_MAX_RUN_MS) {
  const max = Number(process.env.RUNNER_TEST_MAX_RUN_MS);
  if (!Number.isInteger(max) || max < 1 || max > 600_000)
    throw new Error("Invalid test runtime deadline");
  assistantRunLimits.maxRunMs = max;
}

if (
  process.env.RUNNER_TEST_PAUSE_AFTER_APPLY === "true" ||
  process.env.RUNNER_TEST_LOSE_APPLY_ACK === "true" ||
  process.env.RUNNER_TEST_PAUSE_AFTER_MARKER === "true"
) {
  const wrapped = new WeakSet<object>();
  let observed = false;
  let markerObserved = false;
  pool.on("connect", (client) => {
    if (!wrapped.has(client)) {
      wrapped.add(client);
      const query = client.query.bind(client);
      let wroteApplyReceipt = false;
      let wroteApplyMarker = false;
      client.query = ((...args: unknown[]) => {
        const input = args[0];
        const text =
          typeof input === "string"
            ? input
            : input && typeof input === "object" && "text" in input
              ? String(input.text)
              : "";
        const applyWrite = /^\s*UPDATE\s+ai_jobs\s+SET\s+apply_result\b/i.test(
          text,
        );
        const markerWrite =
          /^\s*UPDATE\s+ai_jobs\s+SET\s+apply_started_at\b/i.test(text);
        const writeStopCheck =
          process.env.RUNNER_TEST_PAUSE_AFTER_MARKER === "true" &&
          /^\s*SELECT\s+cancel_requested(?:\s*,\s*cancel_reason)?\s+FROM\s+ai_jobs\b/i.test(
            text,
          ) &&
          text.includes("FOR UPDATE");
        const commit = /^\s*COMMIT\s*;?\s*$/i.test(text);
        if (/^\s*(BEGIN|ROLLBACK)\s*;?\s*$/i.test(text)) {
          wroteApplyReceipt = false;
          wroteApplyMarker = false;
        }
        if (
          process.env.RUNNER_TEST_PAUSE_AFTER_MARKER === "true" &&
          /^\s*SELECT\s+cancel_requested\s*,(?:\s*cancel_reason\s*,)?\s*claimed_by\s*,\s*lease_until/i.test(
            text,
          )
        ) {
          // This fixture isolates the transactional stop guard. Keep the lease
          // poll working, but prevent its cancellation observation winning first.
          args[0] = text.replace(
            /SELECT\s+cancel_requested\s*,/i,
            "SELECT false AS cancel_requested,",
          );
        }
        const result = (query as (...args: unknown[]) => unknown)(...args);
        // The runtime's transaction queries use promises. Pool autocommit and
        // unrelated callback queries retain their normal pg behavior.
        if (
          (applyWrite || markerWrite || writeStopCheck || commit) &&
          result &&
          typeof result === "object" &&
          "then" in result
        ) {
          return (result as Promise<unknown>).then((value) => {
            if (applyWrite) wroteApplyReceipt = true;
            if (markerWrite) wroteApplyMarker = true;
            if (
              writeStopCheck &&
              (value as { rows: { cancel_requested: boolean }[] }).rows[0]
                ?.cancel_requested
            )
              process.send?.({ kind: "write-stop-observed" });
            if (!commit) return value;
            const applied = wroteApplyReceipt;
            const marked = wroteApplyMarker;
            wroteApplyReceipt = false;
            wroteApplyMarker = false;
            if (
              marked &&
              !markerObserved &&
              process.env.RUNNER_TEST_PAUSE_AFTER_MARKER === "true"
            ) {
              markerObserved = true;
              return new Promise((resolve) => {
                const resume = (message: unknown) => {
                  if (message !== "resume-marker") return;
                  process.off("message", resume);
                  resolve(value);
                };
                process.on("message", resume);
                process.send?.({ kind: "marker-committed" });
              });
            }
            if (!applied || observed) return value;
            observed = true;
            // The same client's actual effect COMMIT succeeded. The separately
            // committed marker and later completion transactions do not match.
            if (process.env.RUNNER_TEST_LOSE_APPLY_ACK === "true") {
              process.send?.({ kind: "apply-ack-lost" });
              throw new Error("Synthetic lost apply COMMIT acknowledgement");
            }
            process.send?.({ kind: "after-apply" });
            return new Promise(() => {});
          });
        }
        return result;
      }) as typeof client.query;
    }
  });
}

if (process.env.RUNNER_TEST_PAUSE_CHECKPOINT) {
  const wrapped = new WeakSet<object>();
  let paused = false;
  pool.on("connect", (client) => {
    if (wrapped.has(client)) return;
    wrapped.add(client);
    const query = client.query.bind(client);
    client.query = ((...args: unknown[]) => {
      const sql = args[0];
      if (
        !paused &&
        typeof sql === "string" &&
        sql.includes("UPDATE ai_jobs SET run_state = $2::jsonb")
      ) {
        const values = args[1] as unknown[];
        const envelope = JSON.parse(String(values[1]));
        const specialists = Object.values(
          envelope.state.pending_delegate?.specialists ?? {},
        ) as { completed_tool?: unknown }[];
        const boundary = process.env.RUNNER_TEST_PAUSE_CHECKPOINT;
        if (
          (boundary === "delegate" && envelope.state.completed_delegate) ||
          (boundary === "specialist" &&
            specialists.some((row) => row.completed_tool))
        ) {
          paused = true;
          // PostgreSQL has committed this autocommit save when its callback fires.
          // Hold the caller before it can append the tool reply or make another model call.
          if (typeof args[2] === "function") {
            return (query as (...input: unknown[]) => unknown)(
              args[0],
              args[1],
              (error: unknown) => {
                if (error)
                  return (args[2] as (...values: unknown[]) => unknown)(error);
                process.send?.({ kind: "checkpoint-boundary" });
              },
            );
          }
          return (query as (...input: unknown[]) => Promise<unknown>)(
            ...args,
          ).then(() => {
            process.send?.({ kind: "checkpoint-boundary" });
            return new Promise(() => {});
          });
        }
      }
      return (query as (...input: unknown[]) => unknown)(...args);
    }) as typeof client.query;
  });
}

const lane = process.env.RUNNER_TEST_LANE ?? "interactive";
if (lane !== "interactive" && lane !== "background" && lane !== "overnight")
  throw new Error("Invalid test runtime lane");
const stop = startAssistantRunner(Fastify({ logger: false }).log, { lane });
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("message", (message) => {
  if (message === "stop") void shutdown();
});
process.send?.({ kind: "ready" });
