import {
  assistantBudgetLane,
  assistantBudgetUpdate,
  assistantBudgetView,
  assistantBudgets,
  fail,
} from "@orbyn/core";
import type { FastifyInstance } from "fastify";
import { readTransaction, transaction, type Queryable } from "../../db/pool.js";
import { firstParty } from "../proposals/service.js";

/** Owner-only estimates; provider-reported and billed usage remain separate. */
export async function readAssistantBudget(
  db: Queryable,
  owner: string,
  lane: "background" | "overnight",
) {
  const row = (
    await db.query<{
      daily_token_limit: number;
      hourly_start_limit: number;
      per_run_token_limit: number;
      revision: number;
      day: string;
      estimated_tokens: string;
      active_reserved_tokens: string;
      starts_last_hour: string;
    }>(
      `SELECT coalesce(s.daily_token_limit,1000000) AS daily_token_limit,
        coalesce(s.hourly_start_limit,10) AS hourly_start_limit,
        coalesce(s.per_run_token_limit,200000) AS per_run_token_limit,
        coalesce(s.revision,1) AS revision,
        assistant_lane_budget_day(u.id,clock_timestamp())::text AS day,
        (SELECT coalesce(sum(coalesce(r.reported_tokens,r.reserved_tokens)),0)::text
         FROM assistant_work_reservations r WHERE r.user_id=u.id AND r.lane=$2
           AND r.budget_day=assistant_lane_budget_day(u.id,clock_timestamp())) AS estimated_tokens,
        (SELECT coalesce(sum(r.reserved_tokens),0)::text FROM assistant_work_reservations r
         WHERE r.user_id=u.id AND r.lane=$2 AND r.state='active') AS active_reserved_tokens,
        (SELECT count(*)::text FROM assistant_work_reservations r WHERE r.user_id=u.id
         AND r.lane=$2 AND r.started_at>clock_timestamp()-interval '1 hour') AS starts_last_hour
       FROM users u LEFT JOIN assistant_lane_budget_settings s ON s.user_id=u.id AND s.lane=$2
       WHERE u.id=$1 AND NOT u.disabled`,
      [owner, lane],
    )
  ).rows[0];
  if (!row) fail(404, "Assistant budget is unavailable.");
  return assistantBudgetView.parse({
    ...row,
    lane,
    estimated_tokens: Number(row.estimated_tokens),
    active_reserved_tokens: Number(row.active_reserved_tokens),
    starts_last_hour: Number(row.starts_last_hour),
  });
}

/** A stale settings editor cannot overwrite a newer allowance. */
export async function replaceAssistantBudget(
  owner: string,
  lane: "background" | "overnight",
  value: unknown,
) {
  const input = assistantBudgetUpdate.parse(value);
  return transaction(async (db) => {
    await db.query(
      `INSERT INTO assistant_lane_budget_settings(user_id,lane) VALUES($1,$2)
       ON CONFLICT DO NOTHING`,
      [owner, lane],
    );
    const current = (
      await db.query<{ revision: number }>(
        "SELECT revision FROM assistant_lane_budget_settings WHERE user_id=$1 AND lane=$2 FOR UPDATE",
        [owner, lane],
      )
    ).rows[0];
    if (!current) fail(404, "Assistant budget is unavailable.");
    if (current.revision !== input.expected_revision)
      fail(409, "This budget changed. Reload before saving.");
    await db.query(
      `UPDATE assistant_lane_budget_settings SET daily_token_limit=$3,
        hourly_start_limit=$4,per_run_token_limit=$5,revision=revision+1,updated_at=now()
       WHERE user_id=$1 AND lane=$2`,
      [
        owner,
        lane,
        input.daily_token_limit,
        input.hourly_start_limit,
        input.per_run_token_limit,
      ],
    );
    return readAssistantBudget(db, owner, lane);
  });
}

export async function assistantBudgetRoutes(app: FastifyInstance) {
  const config = { rateLimit: { max: 60, timeWindow: "1 minute" } };
  app.get("/me/assistant/budgets", { config }, async (request, reply) => {
    const user = await firstParty(request);
    if (Object.keys(request.query as object).length)
      fail(400, "This route takes no query parameters.");
    reply.header("Cache-Control", "private, no-store");
    return readTransaction(
      async (db) =>
        assistantBudgets.parse({
          background: await readAssistantBudget(db, user.id, "background"),
          overnight: await readAssistantBudget(db, user.id, "overnight"),
        }),
      { primary: true },
    );
  });
  app.put("/me/assistant/budgets/:lane", { config }, async (request, reply) => {
    const user = await firstParty(request);
    const lane = assistantBudgetLane.parse(
      (request.params as { lane: string }).lane,
    );
    reply.header("Cache-Control", "private, no-store");
    return replaceAssistantBudget(user.id, lane, request.body);
  });
}
