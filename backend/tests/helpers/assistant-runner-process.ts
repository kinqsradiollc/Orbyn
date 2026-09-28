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

const stop = startAssistantRunner(Fastify({ logger: false }).log);
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
