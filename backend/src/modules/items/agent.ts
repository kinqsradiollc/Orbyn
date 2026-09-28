import { fail, isClosed, MAX_AGENT_TASKS, type Item } from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { announceTo } from "../presence/live.js";
import {
  AssistantPausedError,
  assistantPrincipal,
} from "../agents/assistant.js";
import { visibleOwned } from "../../lib/visibility.js";
import { loadItem, lockItem, requireItemAccess } from "./service.js";

/**
 * Handing a task to the person's own agent (W3), and taking it back. The
 * worker (worker/assistant-tasks.ts) runs what is handed over; these only
 * record it, so the request path never waits on a model.
 */

/** The person's agent name (agent_settings), "Orbyn" when never named. */
export async function agentNameOf(db: Queryable, userId: string) {
  return (
    (
      await db.query<{ name: string }>(
        "SELECT name FROM agent_settings WHERE user_id = $1",
        [userId],
      )
    ).rows[0]?.name || "Orbyn"
  );
}

/**
 * Hand a task to the person's own agent: it waits in the worker's queue.
 * Refused for events and finished tasks, tasks in a project kept out of
 * the assistant, a paused assistant, and a sixth task at once.
 */
export async function handTaskToAgent(
  db: Db,
  u: UserRow,
  id: string,
): Promise<Item> {
  const item = await lockItem(db, id);
  await requireItemAccess(u, item, "items:write", db);
  const name = await agentNameOf(db, u.id);
  if (item.kind !== "task") fail(422, `Only tasks can be handed to ${name}.`);
  if (isClosed(item.status))
    fail(409, `This task is finished, so there's nothing to hand to ${name}.`);
  const keptOut = item.project_id
    ? (
        await db.query<{ name: string }>(
          "SELECT name FROM projects WHERE id = $1 AND assistant_off",
          [item.project_id],
        )
      ).rows[0]
    : undefined;
  if (keptOut)
    fail(
      409,
      `${keptOut.name} is kept out of ${name}, so its tasks can't be handed over.`,
    );
  let grantId: string;
  try {
    grantId = (await assistantPrincipal(u, { refusePaused: true })).grant_id!;
  } catch (error) {
    if (error instanceof AssistantPausedError)
      fail(
        409,
        `${name} is paused in Connected agents. Resume it there to hand over tasks.`,
      );
    throw error;
  }
  if (item.agent_grant_id === grantId) return loadItem(db, id);
  if (item.agent_grant_id)
    fail(409, "Someone else's agent has this task. They can take it back.");
  // One hand-over at a time per person, so the limit holds under a race.
  await db.query("SELECT id FROM agent_grants WHERE id = $1 FOR UPDATE", [
    grantId,
  ]);
  const held = (
    await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM items WHERE agent_grant_id = $1",
      [grantId],
    )
  ).rows[0].n;
  if (held >= MAX_AGENT_TASKS)
    fail(
      409,
      `${name} already has ${MAX_AGENT_TASKS} tasks. Take one back or wait for one to finish.`,
    );
  await db.query(
    `UPDATE items SET agent_grant_id = $2, agent_state = 'queued',
       agent_job_id = NULL, agent_result = NULL, agent_claimed_at = NULL,
       agent_attempts = 0, updated_at = now()
     WHERE id = $1`,
    [id, grantId],
  );
  await announceTo(
    db as never,
    { user_id: item.user_id, team_id: item.team_id },
    "changed",
    { entity_type: "task", entity_id: id },
  );
  return loadItem(db, id);
}

/** A connected agent that worked on tasks lately, for its board lane. */
export type AgentWork = { grant_id: string; name: string; item_ids: string[] };

/**
 * Connected agents (never the person's own assistant) that made or changed
 * tasks the person can see in the last day, each with those tasks.
 */
export async function recentAgentWork(
  db: Queryable,
  userId: string,
): Promise<AgentWork[]> {
  return (
    await db.query<AgentWork>(
      `SELECT g.id AS grant_id,
              coalesce(nullif(g.client_name, ''), nullif(g.name, ''), 'An agent') AS name,
              array_agg(DISTINCT i.id::text ORDER BY i.id::text) AS item_ids
         FROM agent_activity a
         JOIN agent_grants g ON g.id = a.grant_id AND g.kind <> 'assistant'
         CROSS JOIN LATERAL unnest(a.target_ids) t(ref)
         JOIN items i ON 'task:' || i.id = t.ref
        WHERE a.at > now() - interval '24 hours'
          AND a.tier <> 'R' AND a.outcome = 'ok' AND a.undone_at IS NULL
          AND ${visibleOwned("i", "user_id")}
        GROUP BY g.id, g.name, g.client_name
        ORDER BY name, g.id`,
      [userId],
    )
  ).rows;
}
