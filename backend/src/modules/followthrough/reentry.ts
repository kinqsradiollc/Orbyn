import type { FastifyInstance } from "fastify";
import {
  dateLabel,
  deadlineOf,
  REENTRY_AWAY_HOURS,
  type ReentryBrief,
  type ReentryLine,
} from "@orbyn/core";
import { pool, reader, type Queryable } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";

/** A brief stays up for this long after coming back, unless dismissed. */
const SHOW_DAYS = 3;
const LIMIT = 5;

/**
 * Note that someone is here. After a gap of 36 hours or more, the stretch
 * they were away is kept, so the app can say what happened meanwhile.
 * Called with each check-in from an app in use.
 */
export async function noteActive(db: Queryable, userId: string) {
  await db.query(
    `INSERT INTO reentry (user_id, last_active_at) VALUES ($1, now())
     ON CONFLICT (user_id) DO UPDATE SET
       away_from = CASE WHEN reentry.last_active_at < now() - make_interval(hours => $2)
         THEN reentry.last_active_at ELSE reentry.away_from END,
       away_until = CASE WHEN reentry.last_active_at < now() - make_interval(hours => $2)
         THEN now() ELSE reentry.away_until END,
       dismissed_at = CASE WHEN reentry.last_active_at < now() - make_interval(hours => $2)
         THEN NULL ELSE reentry.dismissed_at END,
       last_active_at = now()`,
    [userId, REENTRY_AWAY_HOURS],
  );
}

const snippet = (s: string, n = 90) =>
  s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

/**
 * Coming back after time away: what was handed to you, what moved on your
 * tasks, what's waiting for your answer, where you were mentioned, what's
 * due now, and which of your teams' pages changed. Five of each at most.
 */
export async function reentryRoutes(app: FastifyInstance) {
  app.get("/me/reentry", async (r): Promise<ReentryBrief | null> => {
    const u = await authenticate(r);
    const db = reader(r.headers);
    const state = (
      await db.query<{ away_from: Date | null; away_until: Date | null }>(
        `SELECT away_from, away_until FROM reentry
          WHERE user_id = $1 AND dismissed_at IS NULL
            AND away_until > now() - make_interval(days => $2)`,
        [u.id, SHOW_DAYS],
      )
    ).rows[0];
    if (!state?.away_from || !state.away_until) return null;
    const since = state.away_from;
    const mine = `(i.assignee_id = $1 OR (i.user_id = $1 AND i.assignee_id IS NULL))`;
    const [assigned, changed, asks, mentions, due, pages] = await Promise.all([
      db.query<{ id: string; title: string; who: string; due_at: Date | null }>(
        `SELECT i.id, i.title, o.name AS who, i.due_at FROM items i
           JOIN users o ON o.id = i.user_id
          WHERE i.assignee_id = $1 AND i.user_id <> $1
            AND i.status NOT IN ('done', 'cancelled') AND i.updated_at >= $2
          ORDER BY i.updated_at DESC LIMIT ${LIMIT}`,
        [u.id, since],
      ),
      db.query<{
        id: string;
        title: string;
        who: string;
        body: string;
        status: string | null;
      }>(
        `SELECT DISTINCT ON (i.id) i.id, i.title, w.name AS who, x.body, x.status
           FROM item_updates x JOIN items i ON i.id = x.item_id
           JOIN users w ON w.id = x.user_id
          WHERE x.created_at >= $2 AND x.user_id <> $1 AND ${mine}
          ORDER BY i.id, x.created_at DESC LIMIT ${LIMIT}`,
        [u.id, since],
      ),
      db.query<{ id: string; title: string; who: string; status: string }>(
        `SELECT a.id, i.title, b.name AS who, a.status FROM task_asks a
           JOIN items i ON i.id = a.item_id JOIN users b ON b.id = a.asked_by
          WHERE (a.asked_of = $1 AND a.status = 'open')
             OR (a.asked_by = $1 AND a.status = 'countered')
          ORDER BY a.updated_at DESC LIMIT ${LIMIT}`,
        [u.id],
      ),
      db.query<{ title: string; body: string }>(
        `SELECT title, body FROM notifications
          WHERE user_id = $1 AND kind = 'mention' AND channel = 'inapp'
            AND created_at >= $2
          ORDER BY created_at DESC LIMIT ${LIMIT}`,
        [u.id, since],
      ),
      db.query<{
        id: string;
        title: string;
        due_at: Date;
        end_at: Date | null;
        all_day: boolean;
        timezone: string;
      }>(
        `SELECT i.id, i.title, i.due_at, i.end_at, i.all_day, i.timezone FROM items i
          WHERE ${mine} AND i.kind = 'task'
            AND i.status NOT IN ('done', 'cancelled')
            AND i.due_at IS NOT NULL AND i.due_at < now() + interval '3 days'
          ORDER BY i.due_at LIMIT ${LIMIT}`,
        [u.id],
      ),
      db.query<{ id: string; title: string; team: string }>(
        `SELECT d.id, d.title, t.name AS team FROM docs d JOIN teams t ON t.id = d.team_id
          WHERE d.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
            AND d.updated_at >= $2 AND d.kind = 'doc'
          ORDER BY d.updated_at DESC LIMIT ${LIMIT}`,
        [u.id, since],
      ),
    ]);
    const now = Date.now();
    const brief: ReentryBrief = {
      away_from: since.toISOString(),
      away_until: state.away_until.toISOString(),
      days_away: Math.max(
        1,
        Math.round((state.away_until.getTime() - since.getTime()) / 86_400_000),
      ),
      assigned: assigned.rows.map((x): ReentryLine => ({
        item_id: x.id,
        title: x.title,
        detail: `From ${x.who}${x.due_at ? ` · due ${dateLabel(x.due_at.toISOString())}` : ""}`,
      })),
      changed: changed.rows.map((x) => ({
        item_id: x.id,
        title: x.title,
        detail:
          x.status === "done"
            ? `${x.who} finished it`
            : x.status
              ? `${x.who} set it to ${x.status.replace("_", " ")}`
              : `${x.who}: ${snippet(x.body)}`,
      })),
      asks: asks.rows.map((x) => ({
        ask_id: x.id,
        title: x.title,
        detail:
          x.status === "countered"
            ? "Suggested another date — your call"
            : `${x.who} asked you`,
      })),
      mentions: mentions.rows.map((x) => ({
        title: x.title,
        detail: snippet(x.body),
      })),
      due: due.rows.map((x) => ({
        item_id: x.id,
        title: x.title,
        detail:
          // Overdue once the deadline has passed (`deadlineOf`): an all-day
          // task is due by the end of its day.
          Date.parse(deadlineOf(x)!) < now
            ? `Overdue since ${dateLabel(x.due_at.toISOString())}`
            : `Due ${dateLabel(x.due_at.toISOString())}`,
      })),
      pages: pages.rows.map((x) => ({
        doc_id: x.id,
        title: x.title || "Untitled",
        detail: `Changed in ${x.team}`,
      })),
    };
    return brief;
  });

  app.post("/me/reentry/dismiss", async (r) => {
    const u = await authenticate(r);
    await pool.query(
      "UPDATE reentry SET dismissed_at = now() WHERE user_id = $1",
      [u.id],
    );
    return { ok: true };
  });
}
