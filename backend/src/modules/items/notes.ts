import { occurrences, parseRrule } from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import { isOccurrence, type SeriesRow } from "../planner/calendar.js";

/**
 * A repeating event keeps a meeting note per class, known by the class's
 * first start (`docs.occurrence`, the calendar's `occurrence`). When the
 * series itself changes — split at "this and following", moved as a whole,
 * given a new rule or zone — each note goes with its class: to the new
 * series on a split, and to the class's new time on a move. A note whose
 * class no longer exists stays with the event it was made on, as a note of
 * the whole event (its `occurrence` is cleared, and `class_was` keeps the
 * class it was for) rather than left pointing at a time the event doesn't
 * have, where nothing would find it. It stands in for the event's own note
 * only when the event has none: a former class's note never outranks the
 * real one, and a new series from a split doesn't start out with one.
 */

/** How many of a series' times are walked to match classes up. */
const LIMIT = 20_000;

/** A rule's pattern without its end (COUNT, UNTIL): what makes its times. */
const patternOf = (rrule: string | null) =>
  (rrule ?? "")
    .trim()
    .replace(/^RRULE:/i, "")
    .split(";")
    .filter((p) => p && !/^(COUNT|UNTIL)=/i.test(p))
    .map((p) => p.toUpperCase())
    .sort()
    .join(";");

/** A series' times, skipped ones too, from its start through `to`. */
function timesThrough(s: SeriesRow, to: Date): Date[] {
  const rule = s.rrule ? parseRrule(s.rrule) : null;
  if (!rule) return [];
  const out: Date[] = [];
  for (const at of occurrences(s.series_start ?? s.due_at, rule, s.timezone)) {
    if (at > to || out.length >= LIMIT) break;
    out.push(at);
  }
  return out;
}

/**
 * A series' times, skipped ones too, from its start until `after` more
 * past `anchor`; `at` is where `anchor` is among them (-1 when it isn't one).
 */
function timesPast(s: SeriesRow, anchor: Date, after: number) {
  const rule = s.rrule ? parseRrule(s.rrule) : null;
  const times: Date[] = [];
  let at = -1;
  if (!rule) return { times, at };
  for (const t of occurrences(s.series_start ?? s.due_at, rule, s.timezone)) {
    if (times.length >= LIMIT || (at < 0 && t > anchor)) break;
    times.push(t);
    if (at < 0 && t.getTime() === anchor.getTime()) at = times.length - 1;
    if (at >= 0 && times.length - 1 - at >= after) break;
  }
  return { times, at };
}

/**
 * Where each of `classes` (times of `was`) went in `now`, given one class
 * and where it went (`anchor`). With the same pattern, the n-th class after
 * (or before) the anchor is the n-th after it in the new series, which
 * holds across a move of any size and a change of clocks. With a new
 * pattern there's no such count: each class moves by as much as the anchor
 * did. Null for a class the new series doesn't have.
 */
function classMap(
  was: SeriesRow,
  now: SeriesRow,
  anchor: { was: Date; now: Date },
  classes: Date[],
): (x: Date) => Date | null {
  const shift = anchor.now.getTime() - anchor.was.getTime();
  const shifted = (x: Date) => new Date(x.getTime() + shift);
  const check = (x: Date | null | undefined) =>
    x && isOccurrence(now, x) ? x : null;
  if (patternOf(was.rrule) !== patternOf(now.rrule))
    return (x) => check(shifted(x));
  const last = Math.max(anchor.was.getTime(), ...classes.map((x) => +x));
  const index = new Map(
    timesThrough(was, new Date(last)).map((t, i) => [t.getTime(), i]),
  );
  const from = index.get(anchor.was.getTime());
  if (from === undefined) return (x) => check(shifted(x));
  const ahead = Math.max(
    0,
    ...classes.map((x) => (index.get(x.getTime()) ?? from) - from),
  );
  const { times, at } = timesPast(now, anchor.now, ahead);
  if (at < 0) return (x) => check(shifted(x));
  return (x) => {
    const i = index.get(x.getTime());
    return check(i === undefined ? shifted(x) : times[at + (i - from)]);
  };
}

/** A repeating item as a series, or null when it doesn't repeat (any more). */
export async function seriesRowOf(
  db: Db,
  id: string,
): Promise<SeriesRow | null> {
  const row = (
    await db.query<SeriesRow>(
      `SELECT id, kind, due_at, end_at, rrule, timezone, series_start,
              exdates, all_day
         FROM items WHERE id = $1`,
      [id],
    )
  ).rows[0];
  return row?.rrule && row.due_at ? row : null;
}

/**
 * Keep the class notes of `was` with their classes after the series
 * changed. `now` is the series those classes belong to now (the same item,
 * or the new series a "this and following" edit started; null when it no
 * longer repeats), `anchor` one class and where it went, and `since` the
 * first class that moved (a split moves only the classes from there on).
 * Notes in Trash go too, so bringing one back finds its class.
 */
export async function carryEventNotes(
  db: Db,
  was: SeriesRow,
  now: { id: string; series: SeriesRow | null },
  anchor: { was: Date; now: Date },
  since: Date | null = null,
) {
  const notes = (
    await db.query<{ id: string; occurrence: Date }>(
      `SELECT id, occurrence FROM docs
        WHERE item_id = $1 AND kind = 'meeting' AND occurrence IS NOT NULL
          AND ($2::timestamptz IS NULL OR occurrence >= $2)`,
      [was.id, since],
    )
  ).rows;
  if (!notes.length) return;
  const to = now.series
    ? classMap(
        was,
        now.series,
        anchor,
        notes.map((n) => n.occurrence),
      )
    : () => null;
  const moved = notes.map((n) => ({ id: n.id, at: to(n.occurrence) }));
  if (
    now.id === was.id &&
    moved.every((m, i) => m.at?.getTime() === notes[i].occurrence.getTime())
  )
    return;
  await db.query(
    `UPDATE docs d SET item_id = CASE WHEN x.at IS NULL THEN d.item_id
                                      ELSE $1::uuid END,
            occurrence = x.at,
            class_was = CASE WHEN x.at IS NULL THEN d.occurrence END
       FROM unnest($2::uuid[], $3::timestamptz[]) AS x(id, at)
      WHERE d.id = x.id`,
    [now.id, moved.map((m) => m.id), moved.map((m) => m.at)],
  );
}
