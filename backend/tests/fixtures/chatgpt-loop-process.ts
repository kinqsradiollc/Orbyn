import "../setup.js";
import { runAgent } from "../../src/modules/ai/agent/loop.js";
import { resolveUserAi } from "../../src/modules/ai/providers/user-choice.js";
import { pool } from "../../src/db/pool.js";
const [owner, jobId, mode] = process.argv.slice(2);
try {
  const row = (
    await pool.query(
      "SELECT run_state FROM ai_jobs WHERE id=$1 AND user_id=$2",
      [jobId, owner],
    )
  ).rows[0];
  const ai = await resolveUserAi(owner, jobId, async () => {});
  if (!ai) throw new Error("Missing fixture provider");
  const result = await runAgent(
    ai,
    {
      user: { id: owner, role: "member" },
      timezone: "UTC",
      intentText: "Process recovery",
      actions: [],
      clarification: null,
    },
    "Process recovery",
    [],
    {},
    undefined,
    undefined,
    {
      resume: row.run_state?.loop,
      checkpoint: async (loop) => {
        if (
          mode === "hold_raw" &&
          loop.pending_provider?.raw_reply !== undefined
        ) {
          process.send?.({ stage: "raw_received" });
          await new Promise(() => {});
        }
        await pool.query("UPDATE ai_jobs SET run_state=$2 WHERE id=$1", [
          jobId,
          { loop },
        ]);
      },
    },
  );
  process.send?.({ stage: "finished", summary: result.summary });
} catch (error) {
  process.send?.({
    stage: "error",
    message: error instanceof Error ? error.message : "error",
  });
  process.exitCode = 1;
} finally {
  await pool.end();
  process.disconnect?.();
}
