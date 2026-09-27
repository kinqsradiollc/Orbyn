import { pool } from "../../db/pool.js";
import { visibleDocs } from "../../lib/visibility.js";
import { emitInbox } from "./emit.js";

/**
 * Study news for agents (H0), which no notification carries: cards due
 * for review (once a day per space, with how many) and an exam within
 * three days (once per exam). Only for people with a live connection that
 * hasn't muted study, so it costs nothing for everyone else. Run by the
 * worker with the other daily notices.
 */

/** People with a connection that hears study, as SQL on `alias`.user_id. */
const LISTENING = (alias: string) =>
  `EXISTS (SELECT 1 FROM agent_grants g
     WHERE g.user_id = ${alias}.user_id AND g.revoked_at IS NULL
       AND g.suspended_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
       AND NOT ('study' = ANY (g.inbox_mutes)))`;

export async function scanAgentStudy(): Promise<number> {
  let added = 0;
  // Due cards, by the space of the page they're written in; pages in a
  // project kept out of the assistant don't count.
  const due = (
    await pool.query<{
      user_id: string;
      team_id: string | null;
      n: number;
      day: string;
    }>(
      `SELECT c.user_id, d.team_id, count(*)::int AS n,
              to_char(now() AT TIME ZONE coalesce(p.timezone, 'UTC'), 'YYYY-MM-DD') AS day
         FROM study_cards c
         JOIN docs d ON d.id = c.doc_id
         LEFT JOIN planner_prefs p ON p.user_id = c.user_id
        WHERE c.due_at <= now() AND ${LISTENING("c")}
          AND ${visibleDocs("d", { user: "c.user_id", ai: true })}
        GROUP BY c.user_id, d.team_id, p.timezone
        LIMIT 5000`,
    )
  ).rows;
  for (const r of due)
    added += await emitInbox(pool, {
      userId: r.user_id,
      kind: "study",
      key: `study:due:${r.team_id ?? "personal"}:${r.day}`,
      title: `${r.n} study card${r.n === 1 ? " is" : "s are"} due for review`,
      body: "get_study lists them; update_study records how each went.",
      teamId: r.team_id,
    });
  // Exams in the next three days, each told once.
  const exams = (
    await pool.query<{
      user_id: string;
      exam_key: string;
      title: string;
      starts_at: Date;
    }>(
      `SELECT e.user_id, e.exam_key, e.title, e.starts_at FROM study_exams e
        WHERE e.starts_at > now() AND e.starts_at <= now() + interval '3 days'
          AND ${LISTENING("e")}
        LIMIT 5000`,
    )
  ).rows;
  for (const e of exams)
    added += await emitInbox(pool, {
      userId: e.user_id,
      kind: "study",
      key: `study:exam:${e.exam_key}:${e.starts_at.toISOString()}`,
      title: `An exam starts ${e.starts_at.toISOString()}: plan_revision suggests sessions before it`,
      // Its name may come from a subscribed calendar: fenced for the agent.
      body: e.title,
      source: "subscribed_feed",
      entity: { type: "exam", id: null },
    });
  return added;
}
