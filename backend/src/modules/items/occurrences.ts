import {
  fail,
  occurrences,
  occurrencesBetween,
  parseRrule,
  type Item,
  type ItemInput,
  type OccurrenceChanges,
} from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import { queueWebhooks } from "../../lib/webhooks.js";
import {
  isOccurrence,
  occurrenceEnd,
  type SeriesRow,
} from "../planner/calendar.js";
import { queueInvites } from "./attendees.js";
import {
  allDayTimes,
  loadItem,
  lockItem,
  mutate,
  requireItemAccess,
  type ItemRow,
} from "./service.js";

/**
 * Changing part of a repeating item: one occurrence ("this"), an occurrence
 * and every later one ("following"), or the whole series ("all", which is a
 * plain edit through `mutate()`). One occurrence's changes are kept in
 * `item_overrides`, keyed by its original start; cancelling one adds it to
 * the item's exdates. "Following" ends the series just before the
 * occurrence and starts a new one there, through `mutate()`.
 */
type Actor = { id: string; role: "admin" | "member" };

const at = (v: Date | string) => new Date(v);

/** The item as a series, with dates as dates. */
export const seriesOf = (item: ItemRow): SeriesRow => ({
  id: item.id,
  kind: item.kind,
  due_at: at(item.due_at!),
  end_at: item.end_at ? at(item.end_at) : null,
  rrule: item.rrule,
  timezone: item.timezone,
  series_start: item.series_start ? at(item.series_start) : null,
  exdates: item.exdates.map(at),
  all_day: item.all_day,
});

/** Lock a repeating item for an edit to part of it, and check the occurrence is one of its. */
async function prepare(
  db: Db,
  actor: Actor,
  id: string,
  version: number | null,
  occurrence: string,
) {
  const item = await lockItem(db, id);
  await requireItemAccess(actor, item, "items:write", db);
  if (version !== null && item.version !== version)
    fail(409, "This item changed. Refresh and try again.");
  if (!item.rrule || !item.due_at)
    fail(409, "Only repeating items have occurrences to change.");
  const series = seriesOf(item);
  const when = new Date(occurrence);
  if (!isOccurrence(series, when))
    fail(422, "That isn't one of this item's occurrences.");
  return { item, series, when };
}

const sameList = (a: number[], b: number[]) =>
  a.length === b.length && a.every((x, i) => x === Number(b[i]));

/** After a change to part of a series: tell webhooks and the people invited. */
async function changed(db: Db, item: ItemRow) {
  const result = await loadItem(db, item.id);
  await queueWebhooks(
    db,
    "item.updated",
    { user_id: item.user_id, team_id: item.team_id },
    result,
  );
  await queueInvites(db, item.id, { updated: true });
  return result;
}

/**
 * Change one occurrence: its title, notes, time, location, meeting link,
 * busy, colour or alerts (other fields belong to the whole series and are
 * left as they are). An edit that matches the series again removes the
 * change.
 */
export async function editOccurrence(
  db: Db,
  actor: Actor,
  id: string,
  version: number,
  occurrence: string,
  data: ItemInput,
): Promise<Item> {
  const { item, series, when } = await prepare(
    db,
    actor,
    id,
    version,
    occurrence,
  );
  const changes: OccurrenceChanges = {};
  if (data.title !== item.title) changes.title = data.title;
  if (data.notes !== item.notes) changes.notes = data.notes;
  if (data.location !== undefined && data.location !== item.location)
    changes.location = data.location;
  if (data.meeting_url !== undefined && data.meeting_url !== item.meeting_url)
    changes.meeting_url = data.meeting_url;
  if (data.busy !== undefined && data.busy !== item.busy)
    changes.busy = data.busy;
  if (data.color !== undefined && data.color !== item.color)
    changes.color = data.color;
  if (data.alerts !== undefined && !sameList(data.alerts, item.alerts))
    changes.alerts = data.alerts;
  if (data.due_at) {
    let start = data.due_at;
    let end = data.end_at;
    if (item.all_day)
      ({ due_at: start, end_at: end } = allDayTimes(
        item.kind,
        start,
        end,
        item.timezone,
      ));
    const usual = occurrenceEnd(series, when);
    if (
      Date.parse(start!) !== when.getTime() ||
      (end ? Date.parse(end) : null) !== (usual ? usual.getTime() : null)
    ) {
      changes.due_at = new Date(start!).toISOString();
      changes.end_at = end ? new Date(end).toISOString() : null;
    }
  }
  if (Object.keys(changes).length)
    await db.query(
      `INSERT INTO item_overrides (item_id, occurrence, data) VALUES ($1, $2, $3)
       ON CONFLICT (item_id, occurrence) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [id, when, JSON.stringify(changes)],
    );
  else
    await db.query(
      "DELETE FROM item_overrides WHERE item_id = $1 AND occurrence = $2",
      [id, when],
    );
  // The current occurrence's reminder follows its new time or alerts.
  await db.query(
    `UPDATE items SET version = version + 1, updated_at = now(),
       reminder_version = CASE WHEN due_at = $2 THEN reminder_version + 1 ELSE reminder_version END
     WHERE id = $1`,
    [id, when],
  );
  return changed(db, item);
}

/** "…;UNTIL=<the second before `before`>", without COUNT or an earlier UNTIL. */
function endBefore(rrule: string, before: Date) {
  const until = new Date(before.getTime() - 1000)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return [
    ...rrule.split(";").filter((p) => p && !/^(COUNT|UNTIL)=/i.test(p)),
    `UNTIL=${until}`,
  ].join(";");
}

/** The rule for the rest of a series from `from`: what's left of its COUNT. */
function restOf(series: SeriesRow, from: Date) {
  const rule = parseRrule(series.rrule!);
  if (!rule?.count) return series.rrule!;
  let before = 0;
  for (const x of occurrences(
    series.series_start ?? series.due_at,
    rule,
    series.timezone,
  )) {
    if (x >= from) break;
    before++;
  }
  return series.rrule!.replace(
    /COUNT=\d+/i,
    `COUNT=${Math.max(1, rule.count - before)}`,
  );
}

/**
 * End a series just before `when`. When its current occurrence is at or
 * after that, it steps back to the last one before. Returns the exdates and
 * occurrence changes from `when` on, which no longer belong to it.
 */
async function endSeries(db: Db, item: ItemRow, series: SeriesRow, when: Date) {
  let dueAt = series.due_at;
  let endAt = series.end_at;
  if (series.due_at >= when) {
    const earlier = occurrencesBetween(
      series.series_start ?? series.due_at,
      series.rrule!,
      series.timezone,
      series.series_start ?? series.due_at,
      when,
      series.exdates,
      5000,
    );
    const last = earlier.at(-1) ?? series.series_start ?? series.due_at;
    dueAt = last;
    endAt = occurrenceEnd(series, last);
  }
  const kept = series.exdates.filter((d) => d < when);
  const later = series.exdates.filter((d) => d >= when);
  await db.query(
    `UPDATE items SET rrule = $2, due_at = $3, end_at = $4, exdates = $5::timestamptz[],
       version = version + 1, reminder_version = reminder_version + 1, updated_at = now()
     WHERE id = $1`,
    [item.id, endBefore(item.rrule!, when), dueAt, endAt, kept],
  );
  const moved = (
    await db.query<{ occurrence: Date; data: OccurrenceChanges }>(
      "DELETE FROM item_overrides WHERE item_id = $1 AND occurrence >= $2 RETURNING occurrence, data",
      [item.id, when],
    )
  ).rows;
  return { later, moved };
}

/**
 * The whole series from its first occurrence (or, for a task, its current
 * one): editing or deleting "following" from there is the same as "all".
 */
const fromTheStart = (item: ItemRow, series: SeriesRow, when: Date) =>
  when.getTime() <=
  (item.kind === "task"
    ? series.due_at
    : (series.series_start ?? series.due_at)
  ).getTime();

/**
 * Change an occurrence and every later one: the series ends before it and a
 * new series, with the changes, starts there. Fields the edit leaves out are
 * carried over (list, tags, assignee, location, alerts, invitees…). When the
 * new series keeps the old times, skipped and changed occurrences carry over
 * too. Returns the new series.
 */
export async function editFollowing(
  db: Db,
  actor: Actor,
  id: string,
  version: number,
  occurrence: string,
  data: ItemInput,
): Promise<Item | null> {
  const { item, series, when } = await prepare(
    db,
    actor,
    id,
    version,
    occurrence,
  );
  if (fromTheStart(item, series, when))
    return mutate(db, actor, {
      operation: "update",
      item_id: id,
      version,
      data,
    });
  const tags = (
    await db.query<{ tag_id: string }>(
      "SELECT tag_id FROM item_tags WHERE item_id = $1",
      [id],
    )
  ).rows.map((r) => r.tag_id);
  const invited = (
    await db.query<{ email: string; name: string }>(
      "SELECT email, name FROM item_attendees WHERE item_id = $1 ORDER BY created_at, email",
      [id],
    )
  ).rows;
  const { later, moved } = await endSeries(db, item, series, when);
  await changed(db, item);

  const start = data.due_at ? new Date(data.due_at) : when;
  const keepsTime = start.getTime() === when.getTime();
  const pick = <T>(value: T | undefined, saved: T) =>
    value === undefined ? saved : value;
  const created = await mutate(db, actor, {
    operation: "create",
    data: {
      ...data,
      due_at: start.toISOString(),
      rrule:
        data.rrule === undefined || data.rrule === item.rrule
          ? restOf(series, when)
          : data.rrule,
      timezone: pick(data.timezone, item.timezone),
      estimate_minutes: pick(data.estimate_minutes, item.estimate_minutes),
      list_id: pick(data.list_id, item.list_id),
      tag_ids: pick(data.tag_ids, tags),
      assignee_id: pick(data.assignee_id, item.assignee_id),
      location: pick(data.location, item.location),
      meeting_url: pick(data.meeting_url, item.meeting_url),
      all_day: pick(data.all_day, item.all_day),
      busy: pick(data.busy, item.busy),
      color: pick(data.color, item.color),
      parent_id: pick(data.parent_id, item.parent_id),
      alerts: pick(data.alerts, item.alerts.map(Number)),
      attendees: pick(
        data.attendees,
        invited.map((a) => (a.name ? a : { email: a.email })),
      ),
    },
  });
  if (created && keepsTime && (later.length || moved.length)) {
    await db.query(
      "UPDATE items SET exdates = $2::timestamptz[] WHERE id = $1",
      [created.id, later],
    );
    for (const m of moved)
      await db.query(
        "INSERT INTO item_overrides (item_id, occurrence, data) VALUES ($1, $2, $3)",
        [created.id, m.occurrence, JSON.stringify(m.data)],
      );
    return loadItem(db, created.id);
  }
  return created;
}

/** Skip one occurrence: it joins the exdates and loses any changes of its own. */
async function cancelOne(db: Db, item: ItemRow, when: Date) {
  await db.query(
    `UPDATE items SET
       exdates = CASE WHEN $2::timestamptz = ANY (exdates) THEN exdates
                 ELSE array_append(exdates, $2::timestamptz) END,
       version = version + 1, updated_at = now(),
       reminder_version = CASE WHEN due_at = $2 THEN reminder_version + 1 ELSE reminder_version END
     WHERE id = $1`,
    [item.id, when],
  );
  await db.query(
    "DELETE FROM item_overrides WHERE item_id = $1 AND occurrence = $2",
    [item.id, when],
  );
  return changed(db, item);
}

/** "Delete this one" from older apps: no version needed, as before. */
export async function skipOccurrence(
  db: Db,
  actor: Actor,
  id: string,
  occurrence: string,
) {
  const item = await lockItem(db, id);
  await requireItemAccess(actor, item, "items:write", db);
  if (!item.rrule) fail(409, "Only repeating items have occurrences to skip.");
  return cancelOne(db, item, new Date(occurrence));
}

/**
 * Delete one occurrence, an occurrence and every later one (the series ends
 * before it), or the whole item.
 */
export async function deleteOccurrences(
  db: Db,
  actor: Actor,
  id: string,
  version: number,
  scope: "this" | "following",
  occurrence: string,
) {
  const { item, series, when } = await prepare(
    db,
    actor,
    id,
    version,
    occurrence,
  );
  if (scope === "this") return cancelOne(db, item, when);
  if (fromTheStart(item, series, when)) {
    await mutate(db, actor, { operation: "delete", item_id: id, version });
    return null;
  }
  await endSeries(db, item, series, when);
  return changed(db, item);
}
