import { chatgptUsageSummary, type ChatgptPlanUsage } from "@orbyn/core";
import { transaction, type Db } from "../../db/pool.js";
import { requireLiveSession } from "./chatgpt-connections.js";

/** Called only inside the transaction that verifies and accepts a signed completion. */
export async function recordCompletedChatgptUsage(
  db: Db,
  owner: string,
  requestId: string,
  model: string,
  usage: ChatgptPlanUsage | null,
) {
  await db.query(
    `INSERT INTO chatgpt_completed_usage(request_id,user_id,model,input_tokens,output_tokens,total_tokens)
     SELECT $1,id,$3,$4,$5,$6 FROM users WHERE id=$2 AND NOT analytics_opt_out`,
    [
      requestId,
      owner,
      model,
      usage?.input_tokens ?? null,
      usage?.output_tokens ?? null,
      usage?.total_tokens ?? null,
    ],
  );
}

/** Exact owner-only 30-day measurements; there is no provider call or conversation content. */
export async function readCompletedChatgptUsage(session: {
  userId: string;
  sessionId: string;
}) {
  return transaction(async (db) => {
    await requireLiveSession(db, session);
    const owner = (
      await db.query(
        "SELECT analytics_opt_out FROM users WHERE id=$1 FOR SHARE",
        [session.userId],
      )
    ).rows[0];
    const window = (
      await db.query(
        "SELECT now() AS until,now()-interval '30 days' AS since,now()::text AS until_sql,(now()-interval '30 days')::text AS since_sql",
      )
    ).rows[0];
    const enabled = !owner.analytics_opt_out;
    const totals = (
      await db.query(
        `WITH eligible AS NOT MATERIALIZED (
          SELECT request_id,model,completed_at,input_tokens,output_tokens,total_tokens FROM chatgpt_completed_usage
          WHERE user_id=$1 AND completed_at>=$2 AND completed_at<=$3 AND $4
        ), recent AS (SELECT * FROM eligible ORDER BY completed_at DESC,request_id DESC LIMIT 10)
        SELECT count(*)::text AS completed_requests,count(total_tokens)::text AS measured_requests,
          coalesce(sum(input_tokens),0)::text AS input_tokens,coalesce(sum(output_tokens),0)::text AS output_tokens,
          coalesce(sum(total_tokens),0)::text AS total_tokens,
          coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.completed_at DESC,r.request_id DESC) FROM recent r),'[]'::jsonb) AS recent
        FROM eligible`,
        [session.userId, window.since_sql, window.until_sql, enabled],
      )
    ).rows[0];
    const recent = (totals.recent as Array<Record<string, unknown>>).map(
      (row) => ({
        request_id: row.request_id,
        model: row.model,
        completed_at: new Date(String(row.completed_at)).toISOString(),
        usage:
          row.total_tokens === null
            ? null
            : {
                input_tokens: Number(row.input_tokens),
                output_tokens: Number(row.output_tokens),
                total_tokens: Number(row.total_tokens),
              },
      }),
    );
    await requireLiveSession(db, session);
    return chatgptUsageSummary.parse({
      ...totals,
      completed_requests: Number(totals.completed_requests),
      measured_requests: Number(totals.measured_requests),
      since: window.since.toISOString(),
      until: window.until.toISOString(),
      recording_enabled: enabled,
      recent,
    });
  });
}
