import {
  addDays,
  dayTime,
  dueDay,
  fail,
  localDateKey,
  type ViewContext,
  type ViewDefinition,
} from "@orbyn/core";
import type { ViewExtraFilters } from "./extra-filters.js";
import type { Queryable } from "../../db/pool.js";

export type TaskNarrowing = { where: string[]; values: unknown[] };
export type TaskViewClock = ViewContext & {
  plannedTodayIds: Set<string>;
  extra?: ViewExtraFilters;
};

/** Same captured viewer day for due and owned session overlap. */
export function taskViewWindow(
  ctx: Pick<ViewContext, "now" | "timeZone">,
  bucket: NonNullable<ViewDefinition["filters"]["due_bucket"]>,
) {
  const today = localDateKey(ctx.now, ctx.timeZone);
  const start = bucket === "tomorrow" ? 1 : bucket === "soon" ? 2 : 0;
  const last =
    bucket === "tomorrow"
      ? 1
      : bucket === "soon"
        ? 6
        : bucket === "week"
          ? 6 - new Date(`${today}T12:00:00Z`).getUTCDay()
          : 0;
  return { today, first: addDays(today, start), last: addDays(today, last) };
}

/** Cheap task filters run before the existing candidate admission limit. */
export function narrowTaskScalars(n: TaskNarrowing, def: ViewDefinition) {
  const add = (v: unknown) => {
    n.values.push(v);
    return `$${n.values.length + 1}`;
  };
  const f = def.filters;
  const status = f.task_status ? "any" : (f.status ?? "open");
  if (f.task_status) n.where.push(`i.status = ${add(f.task_status)}`);
  if (status === "open") n.where.push("i.status NOT IN ('done', 'cancelled')");
  if (status === "done") n.where.push("i.status = 'done'");
  if (f.text)
    for (const word of f.text.toLocaleLowerCase().split(/\s+/).filter(Boolean))
      n.where.push(
        `strpos(lower(i.title || '  ' || coalesce(i.notes,'')),${add(word)}) > 0`,
      );
  if (f.priority) n.where.push(`i.priority = ${add(f.priority)}`);
  if (f.size === "none") n.where.push("coalesce(i.estimate_minutes,0) = 0");
  if (f.size === "quick")
    n.where.push("i.estimate_minutes > 0 AND i.estimate_minutes <= 15");
  if (f.size === "short")
    n.where.push("i.estimate_minutes > 15 AND i.estimate_minutes <= 60");
  if (f.size === "long") n.where.push("i.estimate_minutes > 60");
  if (f.list === "none") n.where.push("i.list_id IS NULL");
  else if (f.list) n.where.push(`i.list_id = ${add(f.list)}`);
  if (f.tag)
    n.where.push(
      `EXISTS (SELECT 1 FROM item_tags x WHERE x.item_id = i.id AND x.tag_id = ${add(f.tag)})`,
    );
  if (f.assignee === "none")
    n.where.push("i.team_id IS NOT NULL AND i.assignee_id IS NULL");
  else if (f.assignee)
    n.where.push(
      `i.assignee_id = ${f.assignee === "me" ? "$1" : add(f.assignee)}`,
    );
}

/**
 * Resolve only the all-day/no-end dates whose implicit midnight needs core's
 * DST disambiguation. A bounded metadata read avoids replacing that rule with
 * PostgreSQL's different ambiguous-midnight policy or filtering after LIMIT.
 * `relation` is a server-owned, already-authorized FROM/WHERE fragment.
 */
export async function narrowTaskBucket(
  db: Queryable,
  userId: string,
  def: ViewDefinition,
  n: TaskNarrowing,
  ctx: TaskViewClock,
  relation: string,
  candidates: number,
): Promise<string> {
  const priorWhereCount = n.where.length;
  const f = def.filters,
    bucket = f.due_bucket;
  const add = (v: unknown) => {
    n.values.push(v);
    return `$${n.values.length + 1}`;
  };
  if (f.updated_within_days !== undefined)
    n.where.push(
      `i.updated_at >= ${add(new Date(ctx.now.getTime() - f.updated_within_days * 86400000))}`,
    );
  if (f.no_due) n.where.push("i.due_at IS NULL");
  const hasDate = !!(
    bucket ||
    f.due_after ||
    f.due_before ||
    f.overdue ||
    f.due_within_days !== undefined
  );
  if (!hasDate) return "false";
  const today = localDateKey(ctx.now, ctx.timeZone),
    window = bucket ? taskViewWindow(ctx, bucket) : null;
  const after = window?.first ?? f.due_after;
  const before = window?.last ?? f.due_before;
  const wanted = (day: string | null) =>
    !!day &&
    (!after || day >= after) &&
    (!before || day <= before) &&
    (!f.overdue || day < today) &&
    (f.due_within_days === undefined ||
      (day >= today && day <= addDays(today, f.due_within_days)));
  const metadataRelation =
    relation +
    n.where
      .slice(priorWhereCount)
      .map((w) => ` AND ${w}`)
      .join("");
  const metadataValues = [...n.values];
  const datePairs = (
    await db.query<{ at: string; zone: string }>(
      `SELECT DISTINCT i.due_at::text AS at, coalesce(nullif(i.timezone,''),'UTC') AS zone
      ${metadataRelation} AND i.all_day AND i.end_at IS NULL AND i.due_at IS NOT NULL
      ORDER BY at, zone LIMIT ${candidates + 1}`,
      [userId, ...metadataValues],
    )
  ).rows;
  if (datePairs.length > candidates)
    fail(
      422,
      "Too many distinct all-day dates to evaluate this view. Narrow its filters first.",
    );
  const accepted = datePairs.filter((pair) => {
    const day = dueDay(
      { kind: "task", due_at: pair.at, all_day: true, timezone: pair.zone },
      ctx.timeZone,
    );
    return wanted(day);
  });
  const pairs = add(JSON.stringify(accepted));
  const zone = add(ctx.timeZone);
  const implicit = `EXISTS (SELECT 1 FROM jsonb_to_recordset(${pairs}::jsonb) AS dp(at text, zone text)
    WHERE i.due_at = dp.at::timestamptz AND coalesce(nullif(i.timezone,''),'UTC') = dp.zone)`;
  // Database timestamps are normalized to JS Date precision, like the final row.
  const anchor = `date_trunc('milliseconds',coalesce(i.end_at,i.due_at)) - CASE WHEN i.all_day THEN interval '1 minute' ELSE interval '0' END`;
  const date = `((${anchor}) AT TIME ZONE ${zone})::date`;
  const conditions: string[] = [];
  if (after) conditions.push(`${date} >= ${add(after)}::date`);
  if (before) conditions.push(`${date} <= ${add(before)}::date`);
  if (f.overdue) conditions.push(`${date} < ${add(today)}::date`);
  if (f.due_within_days !== undefined)
    conditions.push(
      `${date} BETWEEN ${add(today)}::date AND ${add(addDays(today, f.due_within_days))}::date`,
    );
  const dated = `(i.due_at IS NOT NULL AND CASE WHEN i.all_day AND i.end_at IS NULL THEN ${implicit} ELSE ${conditions.map((c) => `(${c})`).join(" AND ")} END)`;
  if (f.overdue) n.where.push("i.status NOT IN ('done','cancelled')");
  if (bucket !== "today") {
    n.where.push(dated);
    return "false";
  }
  const start = add(dayTime(today, 0, ctx.timeZone).toISOString());
  const end = add(dayTime(addDays(today, 1), 0, ctx.timeZone).toISOString());
  const planned = `EXISTS (SELECT 1 FROM time_blocks tb WHERE tb.user_id = $1 AND tb.item_id = i.id AND tb.start_at < ${end}::timestamptz AND tb.end_at > ${start}::timestamptz)`;
  n.where.push(bucket === "today" ? `(${dated} OR ${planned})` : dated);
  return bucket === "today" ? planned : "false";
}
