import {
  AGENT_BURST_GAP_MINUTES,
  AGENT_REPORT_THRESHOLD,
  agentJobText,
  mergeAgentKinds,
} from "@orbyn/core";
import { pool, transaction, type Queryable } from "../db/pool.js";
import { actAs } from "../lib/actor.js";
import { announceTo } from "../modules/presence/live.js";

/**
 * A push when an agent finishes a big job (H7, decision 7): more than 20
 * changes in one apply_plan, or in one burst of calls from one connection
 * (calls under two minutes apart; the burst is over once the connection
 * has been quiet that long). One notice per job, in the app and on the
 * person's phones, naming the agent and what it did in plain words, and
 * pointing to Settings → Connected agents, where each change and the whole
 * job can be undone.
 *
 * Worked out here in the notifier from agent_activity, never on the call's
 * own path. Each change row is looked at once (reported_at), whether or not
 * it ends in a notice, so replicas and restarts never tell twice. A person
 * turns it off in Settings → Planning → Daily digest (digest.agent_push).
 */

type Row = {
  id: string;
  at: Date;
  user_id: string;
  client_name: string;
  tool: string;
  request_id: string | null;
  team_id: string | null;
  changes: number;
  kinds: Record<string, number> | null;
};

/** One finished job: a plan's steps, or a burst of calls. */
export type AgentJobGroup = { rows: Row[]; plan: boolean };

const GAP_MS = AGENT_BURST_GAP_MINUTES * 60_000;

/** A plan's job id (apply_plan gives every step it). */
const isPlan = (r: Row) => !!r.request_id && r.request_id.startsWith("plan_");

/**
 * The finished jobs in one connection's rows not looked at yet (oldest
 * first): each plan whole, the rest in bursts. The last burst is left
 * until the connection has been quiet for the gap.
 */
export function finishedJobs(
  rows: Row[],
  now: Date,
): { jobs: AgentJobGroup[]; open: Row[] } {
  const plans = new Map<string, Row[]>();
  const calls: Row[] = [];
  for (const r of rows)
    if (isPlan(r))
      plans.set(r.request_id!, [...(plans.get(r.request_id!) ?? []), r]);
    else calls.push(r);
  const jobs: AgentJobGroup[] = [...plans.values()].map((rows) => ({
    rows,
    plan: true,
  }));
  let burst: Row[] = [];
  for (const r of calls) {
    const last = burst[burst.length - 1];
    if (last && r.at.getTime() - last.at.getTime() > GAP_MS) {
      jobs.push({ rows: burst, plan: false });
      burst = [];
    }
    burst.push(r);
  }
  // Rows of a plan, or of other calls, since the burst began count
  // towards the quiet too: the connection is still at work.
  const latest = rows.reduce((t, r) => Math.max(t, r.at.getTime()), 0);
  const open: Row[] = [];
  if (burst.length) {
    if (now.getTime() - latest >= GAP_MS)
      jobs.push({ rows: burst, plan: false });
    else open.push(...burst);
  }
  return { jobs, open };
}

/** The team a job was all in, by name, or null (Personal, or several). */
async function spaceOf(db: Queryable, rows: Row[]): Promise<string | null> {
  const teams = new Set(
    rows.filter((r) => r.changes > 0).map((r) => r.team_id),
  );
  if (teams.size !== 1) return null;
  const [team] = [...teams];
  if (!team) return null;
  return (
    (
      await db.query<{ name: string }>("SELECT name FROM teams WHERE id = $1", [
        team,
      ])
    ).rows[0]?.name ?? null
  );
}

/** Whether the person still wants a push for big jobs (on by default). */
async function wantsPush(db: Queryable, userId: string): Promise<boolean> {
  const row = (
    await db.query<{ off: boolean }>(
      `SELECT coalesce(p.digest->>'agent_push', 'true') = 'false' AS off
         FROM users u LEFT JOIN planner_prefs p ON p.user_id = u.id
        WHERE u.id = $1 AND NOT u.disabled`,
      [userId],
    )
  ).rows[0];
  return !!row && !row.off;
}

/** The notice for one big job, labelled with the agent (via_grant_id). */
async function noticeJob(
  db: Queryable,
  grantId: string,
  userId: string,
  agent: string,
  text: string,
) {
  // Written as the agent's work, so the notice reads "via <agent>".
  await actAs(db, userId, grantId);
  await db.query(
    `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
       title, body, state, kind, ref)
     SELECT u.id, NULL, 0, c.channel, c.destination, $2, $3,
       CASE WHEN c.channel = 'inapp' THEN 'sent' ELSE 'pending' END, 'agent', $4
     FROM users u
     CROSS JOIN LATERAL (
       SELECT 'inapp' AS channel, u.id::text AS destination
       UNION ALL SELECT 'push', d.token FROM devices d WHERE d.user_id = u.id
     ) c
     WHERE u.id = $1 AND NOT u.disabled
     ON CONFLICT DO NOTHING`,
    [
      userId,
      `${agent} finished a big job`.slice(0, 200),
      `${text} See each change, and undo it or the whole job, in Settings → Connected agents.`.slice(
        0,
        2000,
      ),
      `grant:${grantId}`,
    ],
  );
}

/** Looks at one connection's new changes; returns the notices sent. */
async function scanGrant(grantId: string, now: Date): Promise<number> {
  let sent = 0;
  let userId: string | null = null;
  await transaction(async (db) => {
    const rows = (
      await db.query<Row>(
        `SELECT id::text, at, user_id, client_name, tool, request_id, team_id,
                changes, kinds
           FROM agent_activity
          WHERE grant_id = $1 AND reported_at IS NULL AND tier <> 'R'
          ORDER BY at, id
          FOR UPDATE SKIP LOCKED`,
        [grantId],
      )
    ).rows;
    if (!rows.length) return;
    const { jobs } = finishedJobs(rows, now);
    if (!jobs.length) return;
    userId = rows[0].user_id;
    const push = await wantsPush(db, userId);
    const agent =
      (
        await db.query<{ name: string }>(
          `SELECT coalesce(nullif(client_name, ''), name) AS name
             FROM agent_grants WHERE id = $1`,
          [grantId],
        )
      ).rows[0]?.name ||
      rows[0].client_name ||
      "An agent";
    for (const job of jobs) {
      const changes = job.rows.reduce((n, r) => n + (r.changes ?? 0), 0);
      if (push && changes > AGENT_REPORT_THRESHOLD) {
        const kinds = mergeAgentKinds(job.rows.map((r) => r.kinds));
        const text = agentJobText(agent, kinds, await spaceOf(db, job.rows));
        await noticeJob(db, grantId, userId, agent, text);
        sent++;
      }
    }
    await db.query(
      "UPDATE agent_activity SET reported_at = $2 WHERE id = ANY($1::bigint[])",
      [jobs.flatMap((j) => j.rows.map((r) => r.id)), now],
    );
  });
  if (sent && userId)
    await announceTo(pool, { user_id: userId }, "changed").catch(() => {});
  return sent;
}

/**
 * Every connection with changes not looked at yet: finished jobs over the
 * threshold get their notice. Runs each notifier cycle; cheap when there
 * is nothing new (a partial index holds only unreported changes).
 */
export async function scanAgentJobs(now = new Date()): Promise<number> {
  const grants = (
    await pool.query<{ grant_id: string }>(
      `SELECT grant_id FROM agent_activity
        WHERE reported_at IS NULL AND tier <> 'R' AND grant_id IS NOT NULL
        GROUP BY grant_id
        HAVING min(at) < $1
        LIMIT 200`,
      [now],
    )
  ).rows;
  let sent = 0;
  for (const g of grants) sent += await scanGrant(g.grant_id, now);
  return sent;
}
