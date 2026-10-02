// A disposable process for hard-kill and post-commit recovery tests.
import "../setup.js";
import Fastify from "fastify";
import { pool } from "../../src/db/pool.js";
import { startAssistantRunner } from "../../src/modules/ai/agent/runner.js";

if (process.env.RUNNER_TEST_PAUSE_AFTER_APPLY === "true") {
  const wrapped = new WeakSet<object>();
  let locks = 0;
  pool.on("connect", (client) => {
    if (!wrapped.has(client)) {
      wrapped.add(client);
      const query = client.query.bind(client);
      client.query = ((...args: unknown[]) => {
        const text = args[0];
        if (
          typeof text === "string" &&
          text.startsWith("SELECT id FROM ai_jobs") &&
          text.includes("FOR UPDATE") &&
          ++locks === 2
        ) {
          // The apply transaction committed. Pause before the completion transaction.
          process.send?.({ kind: "after-apply" });
          return new Promise(() => {});
        }
        return (query as (...args: unknown[]) => unknown)(...args);
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
