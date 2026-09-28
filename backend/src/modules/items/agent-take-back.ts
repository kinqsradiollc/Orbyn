import type { Item } from "@orbyn/core";
import type { FastifyBaseLogger } from "fastify";
import { transaction } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { announceTo } from "../presence/live.js";
import { stopAssistantJob } from "../ai/agent/run.js";
import { loadItem, lockItem, requireItemAccess } from "./service.js";

/*
 * Taking a task back from the person's agent (W3). Kept apart from
 * agent.ts, which the capabilities use: stopping a run reaches Orbyn's own
 * AI engine, which no agent path may import.
 */

/**
 * Take a task back from the agent: it's the person's again at once, and a
 * run working on it is stopped (a stop never applies anything).
 */
export async function takeTaskBack(
  u: UserRow,
  id: string,
  log: FastifyBaseLogger,
): Promise<Item> {
  const taken = await transaction(async (db) => {
    const item = await lockItem(db, id);
    await requireItemAccess(u, item, "items:write", db);
    if (!item.agent_grant_id) return { item: await loadItem(db, id) };
    const run = item.agent_job_id
      ? (
          await db.query<{
            id: string;
            name: string;
            role: UserRow["role"];
          }>(
            `SELECT u.id, u.name, u.role FROM ai_jobs j JOIN users u ON u.id = j.user_id
              WHERE j.id = $1 AND j.state IN ('running', 'waiting')`,
            [item.agent_job_id],
          )
        ).rows[0]
      : undefined;
    await db.query(
      `UPDATE items SET agent_grant_id = NULL, agent_state = NULL,
         agent_result = NULL, agent_claimed_at = NULL, updated_at = now()
       WHERE id = $1`,
      [id],
    );
    await announceTo(
      db as never,
      { user_id: item.user_id, team_id: item.team_id },
      "changed",
      { entity_type: "task", entity_id: id },
    );
    return {
      item: await loadItem(db, id),
      stop: run ? { job: item.agent_job_id!, user: run } : null,
    };
  });
  if (taken.stop)
    await stopAssistantJob(
      taken.stop.job,
      taken.stop.user as UserRow,
      log,
    ).catch((error) =>
      log.error({ err: error }, "A taken-back task's run could not be stopped"),
    );
  return taken.item;
}
