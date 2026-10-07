import { createHash, randomUUID } from "node:crypto";
import type { AiModelUsage } from "@orbyn/core";
import { query } from "../../../db/pool.js";
import type { ResolvedAi } from "./adapters.js";

/** Persist response counters independently of run checkpoints; repeat IDs deduplicate. */
export function managedUsageRecorder(
  owner: string,
  jobId: string,
  ai: ResolvedAi,
) {
  return async (usage: AiModelUsage, responseId?: unknown) => {
    const identity =
      typeof responseId === "string" &&
      responseId.length > 0 &&
      responseId.length <= 200
        ? responseId
        : randomUUID();
    const key = createHash("sha256")
      .update(JSON.stringify([jobId, ai.providerId, ai.model, identity]))
      .digest("hex");
    await query(
      `INSERT INTO managed_ai_usage(event_key,user_id,job_id,input_tokens,output_tokens,
      reasoning_tokens,cached_input_tokens,cache_write_tokens)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8 FROM ai_jobs j JOIN users u ON u.id=j.user_id
      WHERE j.id=$3 AND j.user_id=$2 AND NOT u.analytics_opt_out
      ON CONFLICT(event_key) DO NOTHING`,
      [
        key,
        owner,
        jobId,
        usage.input_tokens,
        usage.output_tokens,
        usage.reasoning_tokens,
        usage.cached_input_tokens,
        usage.cache_write_tokens,
      ],
    );
  };
}

/** Only complete observed aggregates are totals; missing or overflowing counters stay unknown. */
export async function managedUsageSummary(owner: string) {
  const columns = [
    "input_tokens",
    "output_tokens",
    "reasoning_tokens",
    "cached_input_tokens",
    "cache_write_tokens",
  ] as const;
  const row = (
    await query<Record<string, string | null>>(
      `SELECT count(*)::text AS requests,
    ${columns.map((c) => `CASE WHEN count(*)=count(${c}) AND count(*)>0 THEN sum(${c})::text ELSE NULL END AS ${c}`).join(",")}
    FROM managed_ai_usage WHERE user_id=$1 AND completed_at >= now()-interval '30 days'`,
      [owner],
    )
  ).rows[0];
  const usage = Object.fromEntries(
    columns.map((c) => {
      const n = row[c] === null ? null : Number(row[c]);
      return [c, n !== null && Number.isSafeInteger(n) ? n : null];
    }),
  ) as AiModelUsage;
  return { requests: Number(row.requests), usage };
}
