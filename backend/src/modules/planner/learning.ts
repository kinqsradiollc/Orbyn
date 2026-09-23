import {
  addDays,
  dayTime,
  learnDurations,
  learnLoad,
  learnRhythm,
  localDateKey,
  zonedParts,
  type DurationLearning,
  type DurationSample,
  type LoadModel,
  type PlannerPrefs,
  type RhythmModel,
  type RhythmSample,
} from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";
import type { SmartPlacement } from "./scheduler.js";

/**
 * What the planner learns from someone's own history, loaded from the
 * database. The models themselves are pure and live in @orbyn/core
 * (learning.ts), where the reasoning behind them is written down.
 *
 * Nothing here is stored: every plan works it out again from the rows, so
 * deleting a task or a focus session also takes it out of what was learned,
 * and nothing learned about one person is ever used for another.
 */

/** Finished tasks from this far back feed the duration model (weights halve every 45 days). */
const DURATION_WINDOW_DAYS = 180;
/** Past blocks and focus sessions from this far back feed rhythm and load. */
const RHYTHM_WINDOW_DAYS = 56;

export type Learning = {
  durations: DurationLearning;
  rhythm: RhythmModel;
  load: LoadModel;
};

/** Finished tasks with time logged: what they were, estimated and took. */
async function durationSamples(
  db: Db,
  userId: string,
  now: Date,
): Promise<{
  samples: DurationSample[];
  names: { tags: Map<string, string>; lists: Map<string, string> };
}> {
  const rows = (
    await db.query<{
      title: string;
      estimate_minutes: number | null;
      spent_minutes: number;
      finished_at: Date;
      list_id: string | null;
      tag_ids: string[];
    }>(
      `SELECT i.title, i.estimate_minutes, i.spent_minutes, i.list_id,
              coalesce((SELECT min(u.created_at) FROM item_updates u
                         WHERE u.item_id = i.id AND u.status = 'done'), i.updated_at) AS finished_at,
              coalesce((SELECT array_agg(x.tag_id) FROM item_tags x WHERE x.item_id = i.id), '{}') AS tag_ids
         FROM items i
        WHERE (i.assignee_id = $1 OR (i.assignee_id IS NULL AND i.user_id = $1))
          AND i.kind = 'task' AND i.status = 'done'
          AND i.spent_minutes > 0
          AND i.updated_at > $2::timestamptz - ($3 || ' days')::interval
        ORDER BY i.updated_at DESC
        LIMIT 1000`,
      [userId, now, String(DURATION_WINDOW_DAYS)],
    )
  ).rows;
  const tagIds = [...new Set(rows.flatMap((r) => r.tag_ids))];
  const listIds = [
    ...new Set(rows.map((r) => r.list_id).filter((id): id is string => !!id)),
  ];
  const [tags, lists] = await Promise.all([
    db.query<{ id: string; name: string }>(
      "SELECT id, name FROM tags WHERE id = ANY($1::uuid[])",
      [tagIds],
    ),
    db.query<{ id: string; name: string }>(
      "SELECT id, name FROM lists WHERE id = ANY($1::uuid[])",
      [listIds],
    ),
  ]);
  return {
    samples: rows.map((r) => ({
      title: r.title,
      estimate_minutes: r.estimate_minutes,
      actual_minutes: r.spent_minutes,
      finished_at: new Date(r.finished_at).toISOString(),
      list_id: r.list_id,
      tag_ids: r.tag_ids,
    })),
    names: {
      tags: new Map(tags.rows.map((t) => [t.id, t.name])),
      lists: new Map(lists.rows.map((l) => [l.id, l.name])),
    },
  };
}

export type KeptBlock = {
  item_id: string;
  start_at: Date;
  end_at: Date;
  /** Minutes of the block that went into its task. */
  kept: number;
};

/**
 * Past time blocks and how much of each went into its task: all of it when
 * the task was finished by the end of that day, otherwise the focus time
 * logged on the task that day, shared out over its blocks in order. Shared
 * with plan reality (`GET /planner/reality`).
 */
export async function keptBlocks(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
  timezone: string,
): Promise<{
  blocks: KeptBlock[];
  focus: { item_id: string | null; started_at: Date; minutes: number }[];
}> {
  const blocks = (
    await db.query<{ item_id: string; start_at: Date; end_at: Date }>(
      `SELECT item_id, start_at, end_at FROM time_blocks
        WHERE user_id = $1 AND start_at >= $2 AND start_at < $3
        ORDER BY start_at, id`,
      [userId, from, to],
    )
  ).rows;
  const ids = [...new Set(blocks.map((b) => b.item_id))];
  const [done, focus] = await Promise.all([
    db.query<{ item_id: string; at: Date }>(
      `SELECT item_id, min(created_at) AS at FROM item_updates
        WHERE status = 'done' AND item_id = ANY($1::uuid[]) GROUP BY item_id`,
      [ids],
    ),
    db.query<{ item_id: string | null; started_at: Date; minutes: number }>(
      `SELECT item_id, started_at, minutes FROM focus_sessions
        WHERE user_id = $1 AND kind = 'work' AND minutes > 0
          AND started_at >= $2 AND started_at < $3
        ORDER BY started_at`,
      [userId, from, to],
    ),
  ]);
  const doneAt = new Map(done.rows.map((r) => [r.item_id, r.at.getTime()]));
  const worked = new Map<string, number>();
  for (const f of focus.rows) {
    if (!f.item_id) continue;
    const key = `${f.item_id}|${localDateKey(f.started_at, timezone)}`;
    worked.set(key, (worked.get(key) ?? 0) + f.minutes);
  }
  const out: KeptBlock[] = [];
  for (const b of blocks) {
    const day = localDateKey(b.start_at, timezone);
    const minutes = (b.end_at.getTime() - b.start_at.getTime()) / 60_000;
    const endOfDay = dayTime(addDays(day, 1), 0, timezone).getTime();
    let kept = 0;
    if ((doneAt.get(b.item_id) ?? Infinity) <= endOfDay) kept = minutes;
    else {
      const key = `${b.item_id}|${day}`;
      const left = worked.get(key) ?? 0;
      kept = Math.min(minutes, left);
      worked.set(key, left - kept);
    }
    out.push({ ...b, kept });
  }
  return { blocks: out, focus: focus.rows };
}

/** Spread `minutes` starting at `start` over the local hours they fall in. */
function byHour(
  start: Date,
  minutes: number,
  timezone: string,
  add: (hour: number, minutes: number) => void,
) {
  const p = zonedParts(start, timezone);
  let hour = p.hour;
  let into = p.minute;
  let left = minutes;
  while (left > 0.5) {
    const take = Math.min(left, 60 - into);
    add(hour % 24, take);
    left -= take;
    hour += 1;
    into = 0;
  }
}

/** What someone's finished tasks say about how long work takes them. */
export async function loadDurations(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<DurationLearning> {
  const { samples, names } = await durationSamples(db, userId, now);
  return learnDurations(samples, names, now);
}

/** Load and work out everything the planner has learned about someone. */
export async function loadLearning(
  db: Db,
  userId: string,
  timezone: string,
  now = new Date(),
): Promise<Learning> {
  const today = localDateKey(now, timezone);
  const from = dayTime(addDays(today, -RHYTHM_WINDOW_DAYS), 0, timezone);
  const to = dayTime(today, 0, timezone);
  const [durations, kept] = await Promise.all([
    loadDurations(db, userId, now),
    keptBlocks(db, userId, from, to, timezone),
  ]);

  // Rhythm: each block's minutes by hour, with the share that was kept; and
  // focus sessions outside any block (inside one, the block already counts).
  const rhythm: RhythmSample[] = [];
  for (const b of kept.blocks) {
    const minutes = (b.end_at.getTime() - b.start_at.getTime()) / 60_000;
    const share = minutes > 0 ? b.kept / minutes : 0;
    byHour(b.start_at, minutes, timezone, (hour, m) =>
      rhythm.push({ hour, planned: m, kept: m * share }),
    );
  }
  for (const f of kept.focus) {
    const start = f.started_at.getTime();
    const end = start + f.minutes * 60_000;
    const inBlock = kept.blocks.some(
      (b) => b.start_at.getTime() < end && b.end_at.getTime() > start,
    );
    if (inBlock) continue;
    byHour(f.started_at, f.minutes, timezone, (hour, m) =>
      rhythm.push({ hour, planned: m, kept: m }),
    );
  }

  // Load: planned and kept minutes per day.
  const days = new Map<string, { planned: number; kept: number }>();
  for (const b of kept.blocks) {
    const day = localDateKey(b.start_at, timezone);
    const d = days.get(day) ?? { planned: 0, kept: 0 };
    d.planned += (b.end_at.getTime() - b.start_at.getTime()) / 60_000;
    d.kept += b.kept;
    days.set(day, d);
  }

  return {
    durations,
    rhythm: learnRhythm(rhythm),
    load: learnLoad([...days.values()]),
  };
}

/** The scheduler's learned placement, as the person's settings allow. */
export function smartPlacementOf(
  learning: Learning,
  prefs: PlannerPrefs,
): SmartPlacement {
  const rhythmOn =
    prefs.learn_rhythm !== false && learning.rhythm.confidence > 0;
  return {
    rhythm: rhythmOn
      ? learning.rhythm.hours.map((h) => h * learning.rhythm.confidence)
      : null,
    peak: rhythmOn ? learning.rhythm.peak : null,
    dayMinutes:
      prefs.balance_load !== false ? learning.load.typical_day_minutes : null,
    batch: true,
  };
}
