import type { FastifyInstance } from "fastify";
import {
  addDays,
  dayTime,
  localDateKey,
  newId,
  planPreviewInput,
  REALITY_MIN_MINUTES,
  weekdayOf,
  whatIfInput,
  whatIfVerdict,
  type PlanReality,
  type WhatIfResult,
  type WhatIfSide,
} from "@orbyn/core";
import { reader, transaction, type Queryable } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { loadPrefs } from "../planner/calendar.js";
import { keptBlocks } from "../planner/learning.js";
import { computePlan } from "../planner/plans.js";

const WINDOW_DAYS = 28;

/**
 * How plans have gone lately: of the time set aside for tasks on each past
 * day, how much went into them. A session counts in full when its task was
 * finished by the end of that day; otherwise the focus time logged on the
 * task that day counts, up to the session's length.
 */
export async function planReality(
  db: Queryable,
  userId: string,
  now = new Date(),
): Promise<PlanReality> {
  const { timezone } = await loadPrefs(db, userId);
  const today = localDateKey(now, timezone);
  const from = dayTime(addDays(today, -WINDOW_DAYS), 0, timezone);
  const to = dayTime(today, 0, timezone);
  const { blocks } = await keptBlocks(db, userId, from, to, timezone);
  type Day = { planned: number; kept: number };
  const days = new Map<string, Day>();
  for (const b of blocks) {
    const day = localDateKey(b.start_at, timezone);
    const d = days.get(day) ?? { planned: 0, kept: 0 };
    d.planned += (b.end_at.getTime() - b.start_at.getTime()) / 60_000;
    d.kept += b.kept;
    days.set(day, d);
  }
  const by_weekday = Array.from({ length: 7 }, (_, weekday) => {
    const mine = [...days].filter(([day]) => weekdayOf(day) === weekday);
    const planned = mine.reduce((n, [, d]) => n + d.planned, 0);
    const kept = mine.reduce((n, [, d]) => n + d.kept, 0);
    return {
      weekday,
      days: mine.length,
      planned_minutes: Math.round(planned),
      kept_minutes: Math.round(kept),
      rate: planned >= 60 ? Math.min(1, kept / planned) : null,
    };
  });
  const planned = by_weekday.reduce((n, w) => n + w.planned_minutes, 0);
  const kept = by_weekday.reduce((n, w) => n + w.kept_minutes, 0);
  const enough = planned >= REALITY_MIN_MINUTES;
  return {
    window_days: WINDOW_DAYS,
    enough,
    rate: enough ? Math.min(1, kept / planned) : null,
    by_weekday,
  };
}

/** What a stretch of days looked like: plans kept, focus, tasks finished. */
export async function periodMeasures(
  db: Queryable,
  userId: string,
  from: Date,
  to: Date,
) {
  const [kept, focus, done] = await Promise.all([
    db.query<{ planned: number; kept: number }>(
      `WITH b AS (
         SELECT tb.item_id, tb.start_at,
                extract(epoch FROM tb.end_at - tb.start_at) / 60 AS minutes,
                (SELECT min(created_at) FROM item_updates u
                  WHERE u.item_id = tb.item_id AND u.status = 'done') AS done_at
           FROM time_blocks tb
          WHERE tb.user_id = $1 AND tb.start_at >= $2 AND tb.start_at < $3
       )
       SELECT coalesce(sum(minutes), 0)::float AS planned,
              coalesce(sum(CASE WHEN done_at IS NOT NULL
                AND done_at < date_trunc('day', start_at) + interval '1 day'
                THEN minutes ELSE 0 END), 0)::float AS kept
         FROM b`,
      [userId, from, to],
    ),
    db.query<{ minutes: number }>(
      `SELECT coalesce(sum(minutes), 0)::int AS minutes FROM focus_sessions
        WHERE user_id = $1 AND kind = 'work' AND started_at >= $2 AND started_at < $3`,
      [userId, from, to],
    ),
    db.query<{ n: number }>(
      `SELECT count(DISTINCT u.item_id)::int AS n FROM item_updates u
         JOIN items i ON i.id = u.item_id
        WHERE u.user_id = $1 AND u.status = 'done' AND i.kind = 'task'
          AND u.created_at >= $2 AND u.created_at < $3`,
      [userId, from, to],
    ),
  ]);
  const weeks = Math.max(1, (to.getTime() - from.getTime()) / (7 * 86_400_000));
  const planned = kept.rows[0].planned;
  return {
    /** Share of planned time that got done (0–1), when enough was planned. */
    kept_rate: planned >= 60 ? Math.min(1, kept.rows[0].kept / planned) : null,
    focus_minutes_per_week: Math.round(focus.rows[0].minutes / weeks),
    tasks_done_per_week: Math.round((done.rows[0].n / weeks) * 10) / 10,
  };
}

/**
 * Plan reality and what-if: how plans have gone, and what a change would do
 * to the coming days before anything is changed.
 */
export async function realityRoutes(app: FastifyInstance) {
  app.get("/planner/reality", async (r): Promise<PlanReality> => {
    const u = await authenticate(r);
    return planReality(reader(r.headers), u.id);
  });

  // "What if I take this on / take Friday off / push that deadline?" Two
  // plans are worked out, as things are and with the change; neither is kept.
  app.post("/planner/what-if", async (r): Promise<WhatIfResult> => {
    const u = await authenticate(r);
    const d = whatIfInput.parse(r.body);
    const scenario = {
      add_tasks: d.add_tasks.map((t) => ({ ...t, id: newId() })),
      days_off: d.days_off,
      move_due: d.move_due,
      drop_item_ids: d.drop_item_ids,
    };
    const titles = new Map(scenario.add_tasks.map((t) => [t.id, t.title]));
    return transaction(async (db) => {
      const side = async (withChange: boolean): Promise<WhatIfSide> => {
        const { result } = await computePlan(
          db,
          u.id,
          planPreviewInput.parse({ days: d.days }),
          new Date(),
          withChange ? scenario : {},
        );
        const name = (t: { item_id: string; title: string }) => ({
          item_id: t.item_id,
          title: titles.get(t.item_id) ?? t.title,
        });
        return {
          planned_minutes: Math.round(result.planned_minutes),
          capacity_minutes: Math.round(result.capacity_minutes),
          at_risk: result.at_risk.map(name),
          unplaced: result.unplaced.map(name),
        };
      };
      const before = await side(false);
      const after = await side(true);
      return { before, after, ...whatIfVerdict(before, after) };
    });
  });
}
