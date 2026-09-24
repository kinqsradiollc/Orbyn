import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import {
  addDays,
  blockDuplicateInput,
  blockInput,
  blockRescheduleInput,
  blockUpdate,
  calendarFeedCreateInput,
  calendarFeedSettingsInput,
  calendarSearchQuery,
  clockMinutes,
  dayTime,
  fail,
  type CalendarFeed,
  type CalendarFeedSettings,
  type CalendarSearch,
  type CalendarSearchResult,
  digestTestInput,
  frameInput,
  frameSkipInput,
  frameUpdate,
  habitApplyInput,
  habitInput,
  habitPlanInput,
  habitUpdate,
  localDateKey,
  placeInput,
  placeUpdate,
  plannerPrefsInput,
  planApplyInput,
  planPreviewInput,
  planTuneInput,
  rangeQuery,
  rollForwardInput,
  type CalendarView,
  type EstimateModel,
  type ItemSessions,
  type PlannerLearning,
  type UpNext,
  estimateModelOf,
  type Frame,
  type FrameOccurrence,
  type Habit,
  type HabitBlock,
  type HabitPlan,
  type Place,
  type Plan,
  type PlanApplied,
  type PlanMove,
  type PlannerAnalytics,
  type PlannerPrefs,
  type PlannerReview,
  type PlanStaleness,
  type TimeBlock,
} from "@orbyn/core";
import { z } from "zod";
import { pool, reader, transaction, type Db } from "../../db/pool.js";
import { authenticate, digest } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";
import { queueWebhooks } from "../../lib/webhooks.js";
import {
  busyIntervals,
  calendarEntries,
  derivedBlocks,
  loadPlaces,
  loadPrefs,
  PLACE_COLUMNS,
  timeBlocks,
} from "./calendar.js";
import { adoptDeviceZone } from "./timezone.js";
import { itemSessions, withSessionFacts } from "./sessions.js";
import {
  daysForRule,
  FRAME_COLUMNS,
  frameSpans,
  loadFrames,
} from "./frames.js";
import {
  makePlan,
  planById,
  planStale,
  reviewFor,
  tunePlan,
  workingFree,
} from "./plans.js";
import { icsFeed } from "./ics.js";
import { externalEntries } from "./subscriptions.js";
import { buildEvening, buildMorning } from "../../worker/digest.js";
import { loadEstimateModel } from "./estimates.js";
import { loadLearning } from "./learning.js";
import { upNext } from "./next.js";
import { emailEnabled, sendEmail } from "../../worker/channels/email.js";
import {
  createHabit,
  habitBlocksIn,
  habitById,
  loadHabits,
  placeHabits,
} from "./habits.js";
import { settings } from "../../lib/settings.js";

const DAY_MS = 86_400_000;

/** What someone's feed links are and include. */
async function feedSettings(db: Db | typeof pool, userId: string) {
  const row = (
    await db.query<{
      full: boolean;
      busy: boolean;
      options: { include_blocks?: boolean };
    }>(
      `SELECT calendar_feed_hash IS NOT NULL AS full, calendar_busy_feed_hash IS NOT NULL AS busy,
              calendar_feed_options AS options FROM users WHERE id = $1`,
      [userId],
    )
  ).rows[0];
  return {
    enabled: row.full,
    busy_enabled: row.busy,
    include_blocks: !!row.options.include_blocks,
  } satisfies CalendarFeedSettings;
}

async function ownBlock(db: Db, id: string, userId: string) {
  const row = (
    await db.query<{
      id: string;
      start_at: Date;
      end_at: Date;
      item_id: string;
    }>(
      "SELECT id, start_at, end_at, item_id FROM time_blocks WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [id, userId],
    )
  ).rows[0];
  if (!row) fail(404, "Session not found");
  return row;
}

/** One of your sessions as stored, with its task's title and status. */
async function plainBlockById(
  db: Db,
  id: string,
  userId: string,
): Promise<TimeBlock> {
  const b = (
    await db.query<TimeBlock>(
      `SELECT b.id, b.item_id, b.user_id, b.start_at, b.end_at, b.source, b.plan_id,
              i.title, i.status, i.kind, i.priority, i.team_id, i.list_id, i.estimate_minutes
       FROM time_blocks b JOIN items i ON i.id = b.item_id WHERE b.id = $1 AND b.user_id = $2`,
      [id, userId],
    )
  ).rows[0];
  return {
    ...b,
    start_at: new Date(b.start_at).toISOString(),
    end_at: new Date(b.end_at).toISOString(),
  };
}

/** One of your sessions, with its deadline, number and project (see sessions.ts). */
async function blockById(db: Db, id: string, userId: string) {
  return (
    await withSessionFacts(db, userId, [await plainBlockById(db, id, userId)])
  )[0];
}

/** Where the API can be reached from outside, for links in responses. */
function publicOrigin(r: FastifyRequest) {
  const host =
    (r.headers["x-forwarded-host"] as string | undefined) ?? r.headers.host;
  const proto =
    (r.headers["x-forwarded-proto"] as string | undefined) ?? r.protocol;
  const prefix = (r.headers["x-forwarded-prefix"] as string | undefined) ?? "";
  return `${proto}://${host}${prefix.replace(/\/$/, "")}`;
}

export async function plannerRoutes(app: FastifyInstance) {
  // ---- preferences, frames, places -------------------------------------------

  app.get("/planner/prefs", async (r) => {
    const u = await authenticate(r);
    return loadPrefs(reader(r.headers), u.id);
  });

  /**
   * The apps say which zone the device is in, each time they start. It's
   * adopted unless you picked a zone yourself (see timezone.ts).
   */
  app.post("/me/timezone", async (r) => {
    const u = await authenticate(r);
    const { timezone } = z
      .object({ timezone: z.string().trim().min(1).max(64) })
      .parse(r.body ?? {});
    const result = await adoptDeviceZone(u.id, timezone);
    return { ...result, timezone: (await loadPrefs(pool, u.id)).timezone };
  });

  app.put("/planner/prefs", async (r) => {
    const u = await authenticate(r);
    const d = plannerPrefsInput.parse(r.body);
    return transaction(async (db) => {
      const current = await loadPrefs(db, u.id);
      const alerts = current.default_alerts!;
      const next: PlannerPrefs = {
        ...current,
        ...d,
        planner_notices: {
          push: d.planner_notices?.push ?? current.planner_notices!.push,
          email: d.planner_notices?.email ?? current.planner_notices!.email,
        },
        default_alerts: {
          event: d.default_alerts?.event ?? alerts.event,
          task: d.default_alerts?.task ?? alerts.task,
          all_day: d.default_alerts?.all_day ?? alerts.all_day,
        },
        digest: { ...current.digest!, ...d.digest },
        learn_estimates: d.learn_estimates ?? current.learn_estimates,
        learn_rhythm: d.learn_rhythm ?? current.learn_rhythm,
        balance_load: d.balance_load ?? current.balance_load,
      };
      if (next.work_end <= next.work_start)
        fail(422, "Working hours must end after they start.");
      // Pinned people must share a team with you.
      if (d.pinned_user_ids?.length) {
        next.pinned_user_ids = (
          await db.query<{ user_id: string }>(
            `SELECT DISTINCT m.user_id FROM team_members m
             WHERE m.user_id = ANY ($2::uuid[]) AND m.user_id <> $1
               AND m.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)`,
            [u.id, d.pinned_user_ids],
          )
        ).rows
          .map((x) => x.user_id)
          .filter((id) => d.pinned_user_ids!.includes(id));
      }
      await db.query(
        `INSERT INTO planner_prefs (user_id, timezone, work_days, work_start, work_end,
           pad_percent, split_after_minutes, min_block_minutes, break_level, horizon_days,
           buffer_before_minutes, buffer_after_minutes, adaptive_buffers,
           default_travel_minutes, extra_timezones, calendar_sets, pinned_user_ids,
           deadline_notice_days, planner_notices, default_alerts, count_blocks_as_spent,
           buffer_scope, travel_padding_minutes, digest, learn_estimates,
           learn_rhythm, balance_load, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
           $21,$22,$23,$24,$25,$26,$27, now())
         ON CONFLICT (user_id) DO UPDATE SET timezone=$2, work_days=$3, work_start=$4,
           work_end=$5, pad_percent=$6, split_after_minutes=$7, min_block_minutes=$8,
           break_level=$9, horizon_days=$10, buffer_before_minutes=$11,
           buffer_after_minutes=$12, adaptive_buffers=$13, default_travel_minutes=$14,
           extra_timezones=$15, calendar_sets=$16, pinned_user_ids=$17,
           deadline_notice_days=$18, planner_notices=$19, default_alerts=$20,
           count_blocks_as_spent=$21, buffer_scope=$22, travel_padding_minutes=$23,
           digest=$24, learn_estimates=$25, learn_rhythm=$26, balance_load=$27,
           updated_at=now()`,
        [
          u.id,
          next.timezone,
          next.work_days,
          next.work_start,
          next.work_end,
          next.pad_percent,
          next.split_after_minutes,
          next.min_block_minutes,
          next.break_level,
          next.horizon_days,
          next.buffer_before_minutes,
          next.buffer_after_minutes,
          next.adaptive_buffers,
          next.default_travel_minutes,
          next.extra_timezones,
          JSON.stringify(next.calendar_sets),
          next.pinned_user_ids,
          next.deadline_notice_days,
          JSON.stringify(next.planner_notices),
          JSON.stringify(next.default_alerts),
          next.count_blocks_as_spent ?? false,
          JSON.stringify(next.buffer_scope),
          next.travel_padding_minutes ?? 0,
          JSON.stringify(next.digest),
          next.learn_estimates ?? false,
          next.learn_rhythm ?? true,
          next.balance_load ?? true,
        ],
      );
      // Picking a zone here is a choice: the apps stop adopting the
      // device's zone from now on.
      if (d.timezone !== undefined)
        await db.query(
          "UPDATE planner_prefs SET timezone_chosen = true WHERE user_id = $1",
          [u.id],
        );
      // Subscribed calendars are read in your zone (whole days, times with
      // no zone), so a new zone means reading them again from scratch.
      if (next.timezone !== current.timezone)
        await db.query(
          `UPDATE calendar_subscriptions SET etag = NULL, last_modified = NULL,
             content_hash = NULL, last_fetched_at = NULL
           WHERE user_id = $1`,
          [u.id],
        );
      return loadPrefs(db, u.id);
    });
  });

  // Send yourself a digest now, to preview it. Uses your live planner data.
  app.post("/planner/digest/test", async (r, reply) => {
    const u = await authenticate(r);
    const { kind } = digestTestInput.parse(r.body);
    if (!(await emailEnabled()))
      fail(
        503,
        "No mail server is set up yet. An admin can add one in Admin → System.",
      );
    const prefs = await loadPrefs(pool, u.id);
    const build = kind === "evening" ? buildEvening : buildMorning;
    const { subject, lines } = await build(
      u.id,
      u.name,
      new Date(),
      prefs.timezone,
    );
    await sendEmail({
      id: randomBytes(8).toString("hex"),
      destination: u.email,
      title: `${subject} (preview)`,
      body: lines.filter(Boolean).join("\n\n"),
    });
    return reply.code(204).send();
  });

  // What the planner has learned about how long tasks really take.
  app.get("/planner/estimates", async (r): Promise<EstimateModel> => {
    const u = await authenticate(r);
    const db = reader(r.headers);
    const prefs = await loadPrefs(db, u.id);
    return loadEstimateModel(db, u.id, !!prefs.learn_estimates);
  });

  // Everything the planner has learned from your history: how long tasks
  // take, the hours that usually go well, and how much a day usually holds.
  app.get("/planner/learning", async (r): Promise<PlannerLearning> => {
    const u = await authenticate(r);
    const db = reader(r.headers);
    const prefs = await loadPrefs(db, u.id);
    const l = await loadLearning(db, u.id, prefs.timezone);
    return {
      estimates: estimateModelOf(l.durations, !!prefs.learn_estimates),
      rhythm: { ...l.rhythm, applied: prefs.learn_rhythm !== false },
      load: { ...l.load, applied: prefs.balance_load !== false },
    };
  });

  // What to do now: the free time until your next event and the tasks worth
  // starting in it, with the reasons.
  app.get("/planner/next", async (r): Promise<UpNext> => {
    const u = await authenticate(r);
    return upNext(reader(r.headers), u.id);
  });

  // Where your set-aside time went: totals, by list and by tag, over a window.
  app.get("/planner/analytics", async (r): Promise<PlannerAnalytics> => {
    const u = await authenticate(r);
    const db = reader(r.headers);
    const days = Math.min(
      365,
      Math.max(1, Number((r.query as { days?: string }).days) || 30),
    );
    const from = new Date(Date.now() - days * 86_400_000);
    const mins = `sum(extract(epoch FROM (b.end_at - b.start_at)) / 60)::int`;
    const [planned, byList, byTag, completed] = await Promise.all([
      db.query<{ minutes: number | null }>(
        `SELECT ${mins} AS minutes FROM time_blocks b WHERE b.user_id=$1 AND b.start_at >= $2`,
        [u.id, from.toISOString()],
      ),
      db.query<{ name: string | null; minutes: number }>(
        `SELECT (SELECT name FROM lists l WHERE l.id = i.list_id) AS name, ${mins} AS minutes
           FROM time_blocks b JOIN items i ON i.id = b.item_id
          WHERE b.user_id=$1 AND b.start_at >= $2
          GROUP BY i.list_id ORDER BY minutes DESC NULLS LAST LIMIT 12`,
        [u.id, from.toISOString()],
      ),
      db.query<{ name: string; minutes: number }>(
        `SELECT t.name, ${mins} AS minutes
           FROM time_blocks b JOIN item_tags it ON it.item_id = b.item_id
           JOIN tags t ON t.id = it.tag_id
          WHERE b.user_id=$1 AND b.start_at >= $2
          GROUP BY t.name ORDER BY minutes DESC LIMIT 12`,
        [u.id, from.toISOString()],
      ),
      db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM items
          WHERE user_id=$1 AND status='done' AND updated_at >= $2`,
        [u.id, from.toISOString()],
      ),
    ]);
    return {
      from: from.toISOString(),
      to: new Date().toISOString(),
      days,
      planned_minutes: planned.rows[0].minutes ?? 0,
      completed: completed.rows[0].n,
      by_list: byList.rows.map((x) => ({
        name: x.name ?? "No list",
        minutes: x.minutes,
      })),
      by_tag: byTag.rows.map((x) => ({ name: x.name, minutes: x.minutes })),
    };
  });

  app.get("/planner/frames", async (r) => {
    const u = await authenticate(r);
    return loadFrames(reader(r.headers), u.id);
  });

  app.post("/planner/frames", async (r, reply) => {
    const u = await authenticate(r);
    const d = frameInput.parse(r.body);
    const rrule = d.rrule ?? null;
    const tz = d.timezone ?? (await loadPrefs(pool, u.id)).timezone;
    const frame = (
      await pool.query<Frame>(
        `INSERT INTO frames (user_id, name, days, start_time, end_time, filters, color, position,
           rrule, series_start, busy, exdates, timezone)
         VALUES ($1, $2, $3, $4, $5, $6, coalesce($7, '#9ab68c'),
           (SELECT coalesce(max(position), -1) + 1 FROM frames WHERE user_id = $1),
           $8, $9, $10, $11::date[], $12)
         RETURNING ${FRAME_COLUMNS}`,
        [
          u.id,
          d.name,
          rrule ? daysForRule(rrule) : d.days,
          d.start_time,
          d.end_time,
          JSON.stringify(d.filters),
          d.color ?? null,
          rrule,
          rrule ? localDateKey(new Date(), tz) : null,
          d.busy,
          d.exdates,
          d.timezone ?? null,
        ],
      )
    ).rows[0];
    reply.code(201);
    return { ...frame, days: frame.days.map(Number) };
  });

  app.put("/planner/frames/:id", async (r) => {
    const u = await authenticate(r);
    const d = frameUpdate.parse(r.body);
    return transaction(async (db) => {
      const current = (
        await db.query<Frame>(
          `SELECT ${FRAME_COLUMNS} FROM frames WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [idParam(r), u.id],
        )
      ).rows[0];
      if (!current) fail(404, "Frame not found");
      const next = { ...current, ...d };
      if (next.end_time <= next.start_time)
        fail(422, "A frame ends after it starts.");
      // A new rule starts today; its weekdays are kept in `days` for older apps.
      const ruleChanged = d.rrule !== undefined && d.rrule !== current.rrule;
      let seriesStart = current.series_start ?? null;
      if (ruleChanged && next.rrule) {
        const tz = next.timezone ?? (await loadPrefs(db, u.id)).timezone;
        seriesStart = localDateKey(new Date(), tz);
      }
      // A rule decides the weekdays; `days` mirrors it for older apps.
      if (next.rrule) next.days = daysForRule(next.rrule);
      const frame = (
        await db.query<Frame>(
          `UPDATE frames SET name=$2, days=$3, start_time=$4, end_time=$5, filters=$6,
             color=$7, position=$8, rrule=$9, series_start=$10, busy=$11,
             exdates=$12::date[], timezone=$13
           WHERE id=$1 RETURNING ${FRAME_COLUMNS}`,
          [
            current.id,
            next.name,
            next.days,
            next.start_time,
            next.end_time,
            JSON.stringify(next.filters),
            next.color,
            next.position,
            next.rrule ?? null,
            next.rrule ? seriesStart : null,
            next.busy ?? false,
            next.exdates ?? [],
            next.timezone ?? null,
          ],
        )
      ).rows[0];
      return { ...frame, days: frame.days.map(Number) };
    });
  });

  // Skip one date of a frame ("not this Friday"), or bring it back.
  for (const [path, add] of [
    ["/planner/frames/:id/skip", true],
    ["/planner/frames/:id/unskip", false],
  ] as const)
    app.post(path, async (r) => {
      const u = await authenticate(r);
      const d = frameSkipInput.parse(r.body);
      const frame = (
        await pool.query<Frame>(
          `UPDATE frames SET exdates = CASE WHEN $3
             THEN (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(array_append(exdates, $4::date)) x)
             ELSE array_remove(exdates, $4::date) END
           WHERE id = $1 AND user_id = $2 RETURNING ${FRAME_COLUMNS}`,
          [idParam(r), u.id, add, d.date],
        )
      ).rows[0];
      if (!frame) fail(404, "Frame not found");
      return { ...frame, days: frame.days.map(Number) };
    });

  app.delete("/planner/frames/:id", async (r, reply) => {
    const u = await authenticate(r);
    const deleted = await pool.query(
      "DELETE FROM frames WHERE id = $1 AND user_id = $2",
      [idParam(r), u.id],
    );
    if (!deleted.rowCount) fail(404, "Frame not found");
    return reply.code(204).send();
  });

  // ---- habits: flexible routines the planner fits into free time ----------

  app.get("/planner/habits", async (r): Promise<Habit[]> => {
    const u = await authenticate(r);
    return loadHabits(reader(r.headers), u.id);
  });

  app.post("/planner/habits", async (r, reply): Promise<Habit> => {
    const u = await authenticate(r);
    const d = habitInput.parse(r.body);
    const habit = await createHabit(pool, u.id, d);
    reply.code(201);
    return habit;
  });

  app.put("/planner/habits/:id", async (r): Promise<Habit> => {
    const u = await authenticate(r);
    const d = habitUpdate.parse(r.body);
    return transaction(async (db) => {
      const current = await habitById(db, idParam(r), u.id);
      if (!current) fail(404, "Habit not found");
      const start =
        d.window_start === undefined ? current.window_start : d.window_start;
      const end =
        d.window_end === undefined ? current.window_end : d.window_end;
      if (start && end && end <= start)
        fail(422, "A habit's window ends after it starts");
      await db.query(
        `UPDATE habits SET name = $3, cadence = $4, period = $5,
           duration_minutes = $6, days = $7, window_start = $8, window_end = $9,
           priority = $10, active = $11, position = $12, updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [
          current.id,
          u.id,
          d.name ?? current.name,
          d.cadence ?? current.cadence,
          d.period ?? current.period,
          d.duration_minutes ?? current.duration_minutes,
          d.days ?? current.days,
          start,
          end,
          d.priority ?? current.priority,
          d.active ?? current.active,
          d.position ?? current.position,
        ],
      );
      return (await habitById(db, current.id, u.id))!;
    });
  });

  app.delete("/planner/habits/:id", async (r, reply) => {
    const u = await authenticate(r);
    const deleted = await pool.query(
      "DELETE FROM habits WHERE id = $1 AND user_id = $2",
      [idParam(r), u.id],
    );
    if (!deleted.rowCount) fail(404, "Habit not found");
    return reply.code(204).send();
  });

  // Propose sessions for the active habits over the next few days. Nothing is
  // saved; the client shows them and applies the ones the user keeps.
  app.post("/planner/habits/plan", async (r): Promise<HabitPlan> => {
    const u = await authenticate(r);
    const d = habitPlanInput.parse(r.body);
    const now = new Date();
    const prefs = await loadPrefs(pool, u.id);
    const start = d.start_date ?? localDateKey(now, prefs.timezone);
    const days = Array.from({ length: d.days }, (_, i) => addDays(start, i));
    const from = dayTime(days[0], 0, prefs.timezone);
    const to = dayTime(addDays(days.at(-1)!, 1), 0, prefs.timezone);
    const habits = await loadHabits(pool, u.id, true);
    if (!habits.length) return { blocks: [], summary: [] };
    const [busy, existing] = await Promise.all([
      busyIntervals(pool, u.id, from, to),
      habitBlocksIn(pool, u.id, from, to),
    ]);
    return placeHabits({
      habits,
      busy: busy.map((b) => ({
        start: Date.parse(b.start_at),
        end: Date.parse(b.end_at),
      })),
      days,
      timezone: prefs.timezone,
      workStart: clockMinutes(prefs.work_start),
      workEnd: clockMinutes(prefs.work_end),
      existing: existing.map((b) => ({
        habit_id: b.habit_id,
        start: Date.parse(b.start_at),
      })),
      now: now.getTime(),
    });
  });

  // Save proposed sessions, skipping any that now clash with busy time.
  app.post("/planner/habits/plan/apply", async (r): Promise<HabitBlock[]> => {
    const u = await authenticate(r);
    const d = habitApplyInput.parse(r.body);
    return transaction(async (db) => {
      const mine = new Set((await loadHabits(db, u.id)).map((h) => h.id));
      const starts = d.blocks.map((b) => Date.parse(b.start_at));
      const ends = d.blocks.map((b) => Date.parse(b.end_at));
      const busy = await busyIntervals(
        db,
        u.id,
        new Date(Math.min(...starts)),
        new Date(Math.max(...ends)),
      );
      const created: string[] = [];
      for (const b of d.blocks) {
        if (!mine.has(b.habit_id)) continue;
        if (Date.parse(b.end_at) <= Date.parse(b.start_at)) continue;
        const clash = busy.some(
          (x) => x.start_at < b.end_at && b.start_at < x.end_at,
        );
        if (clash) continue;
        const { id } = (
          await db.query<{ id: string }>(
            `INSERT INTO habit_blocks (habit_id, user_id, start_at, end_at)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [b.habit_id, u.id, b.start_at, b.end_at],
          )
        ).rows[0];
        created.push(id);
        busy.push({ start_at: b.start_at, end_at: b.end_at });
      }
      return habitBlocksIn(
        db,
        u.id,
        new Date(Math.min(...starts)),
        new Date(Math.max(...ends) + 1),
      );
    });
  });

  app.delete("/planner/habits/blocks/:id", async (r, reply) => {
    const u = await authenticate(r);
    const deleted = await pool.query(
      "DELETE FROM habit_blocks WHERE id = $1 AND user_id = $2",
      [idParam(r), u.id],
    );
    if (!deleted.rowCount) fail(404, "Habit session not found");
    return reply.code(204).send();
  });

  app.get("/planner/places", async (r) => {
    const u = await authenticate(r);
    return loadPlaces(reader(r.headers), u.id);
  });

  app.post("/planner/places", async (r, reply) => {
    const u = await authenticate(r);
    const d = placeInput.parse(r.body);
    const place = (
      await pool.query<Place>(
        `INSERT INTO places (user_id, label, match, travel_minutes, mode, peak_minutes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PLACE_COLUMNS}`,
        [u.id, d.label, d.match, d.travel_minutes, d.mode, d.peak_minutes],
      )
    ).rows[0];
    reply.code(201);
    return place;
  });

  app.put("/planner/places/:id", async (r) => {
    const u = await authenticate(r);
    const d = placeUpdate.parse(r.body);
    const place = (
      await pool.query<Place>(
        `UPDATE places SET label = coalesce($3, label), match = coalesce($4, match),
           travel_minutes = coalesce($5, travel_minutes),
           mode = CASE WHEN $6 THEN $7 ELSE mode END,
           peak_minutes = CASE WHEN $8 THEN $9::smallint ELSE peak_minutes END
         WHERE id = $1 AND user_id = $2 RETURNING ${PLACE_COLUMNS}`,
        [
          idParam(r),
          u.id,
          d.label ?? null,
          d.match ?? null,
          d.travel_minutes ?? null,
          d.mode !== undefined,
          d.mode ?? null,
          d.peak_minutes !== undefined,
          d.peak_minutes ?? null,
        ],
      )
    ).rows[0];
    if (!place) fail(404, "Place not found");
    return place;
  });

  app.delete("/planner/places/:id", async (r, reply) => {
    const u = await authenticate(r);
    const deleted = await pool.query(
      "DELETE FROM places WHERE id = $1 AND user_id = $2",
      [idParam(r), u.id],
    );
    if (!deleted.rowCount) fail(404, "Place not found");
    return reply.code(204).send();
  });

  // ---- the calendar ---------------------------------------------------------

  app.get("/calendar", async (r): Promise<CalendarView> => {
    const u = await authenticate(r);
    const q = rangeQuery.parse(r.query);
    const db = reader(r.headers);
    const from = new Date(q.from);
    const to = new Date(q.to);
    const prefs = await loadPrefs(db, u.id);
    const [entries, blocks, places, frameRows, external, habit_blocks] =
      await Promise.all([
        calendarEntries(db, u.id, from, to),
        timeBlocks(db, u.id, from, to).then((b) =>
          withSessionFacts(db, u.id, b),
        ),
        loadPlaces(db, u.id),
        loadFrames(db, u.id),
        externalEntries(db, u.id, from, to, { visible: true }),
        habitBlocksIn(db, u.id, from, to),
      ]);
    const frames: FrameOccurrence[] = frameRows
      .flatMap((f) =>
        frameSpans(f, from.getTime(), to.getTime(), prefs.timezone).map(
          (s) => ({
            frame_id: f.id,
            name: f.name,
            color: f.color,
            start_at: new Date(s.start).toISOString(),
            end_at: new Date(s.end).toISOString(),
            busy: f.busy ?? false,
            date: s.date,
          }),
        ),
      )
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: prefs.timezone });
    const derived = derivedBlocks(entries, prefs, places, (at) =>
      day.format(new Date(at)),
    ).filter((d) => d.end_at > q.from && d.start_at < q.to);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      timezone: prefs.timezone,
      entries,
      blocks,
      derived,
      frames,
      external,
      habit_blocks,
    };
  });

  // Find events by words: yours (each occurrence, with its own changes) and
  // those from calendars you subscribe to. A year either side by default.
  app.get("/calendar/search", async (r): Promise<CalendarSearch> => {
    const u = await authenticate(r);
    const q = calendarSearchQuery.parse(r.query);
    const db = reader(r.headers);
    const now = Date.now();
    const from = q.from ? new Date(q.from) : new Date(now - 365 * DAY_MS);
    const to = q.to ? new Date(q.to) : new Date(now + 365 * DAY_MS);
    if (to <= from) fail(422, "End must be after start");
    const words = q.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    const patterns = words.map(
      (w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
    );
    // Items whose own words, or an occurrence's, match every word.
    const matched = (
      await db.query<{ id: string; notes: string }>(
        `SELECT i.id, i.notes FROM items i
         WHERE ${VISIBLE_ITEMS} AND i.due_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM unnest($2::text[]) w
             WHERE (i.title || ' ' || i.notes || ' ' || i.location) NOT ILIKE w
               AND NOT EXISTS (SELECT 1 FROM item_overrides o WHERE o.item_id = i.id
                 AND (coalesce(o.data->>'title', '') || ' ' || coalesce(o.data->>'location', '')) ILIKE w))
         LIMIT 500`,
        [u.id, patterns],
      )
    ).rows;
    const notes = new Map(matched.map((m) => [m.id, m.notes]));
    const entries = matched.length
      ? await calendarEntries(db, u.id, from, to, [...notes.keys()])
      : [];
    const results: CalendarSearchResult[] = [
      ...entries
        .filter((e) => {
          const text =
            `${e.title} ${e.location} ${notes.get(e.item_id) ?? ""}`.toLowerCase();
          return words.every((w) => text.includes(w));
        })
        .map((e) => ({ source: "item" as const, ...e })),
      ...(
        await externalEntries(db, u.id, from, to, {
          visible: true,
          words: patterns,
        })
      ).map((e) => ({ source: "external" as const, ...e })),
    ];
    return {
      q: q.q,
      from: from.toISOString(),
      to: to.toISOString(),
      results: results
        .sort((a, b) => a.start_at.localeCompare(b.start_at))
        .slice(0, 100),
    };
  });

  // ---- time blocks ------------------------------------------------------------

  app.get("/blocks", async (r) => {
    const u = await authenticate(r);
    const q = rangeQuery.parse(r.query);
    const db = reader(r.headers);
    return withSessionFacts(
      db,
      u.id,
      await timeBlocks(db, u.id, new Date(q.from), new Date(q.to)),
    );
  });

  // One task's sessions (yours), with its deadline and how much of the time
  // still to come ends by it. Reading them never makes a plan.
  app.get("/items/:id/sessions", async (r): Promise<ItemSessions> => {
    const u = await authenticate(r);
    return itemSessions(reader(r.headers), u.id, idParam(r));
  });

  app.post("/blocks", async (r, reply) => {
    const u = await authenticate(r);
    const d = blockInput.parse(r.body);
    const block = await transaction(async (db) => {
      const item = (
        await db.query<{ id: string; kind: string }>(
          `SELECT i.id, i.kind FROM items i WHERE i.id = $2 AND ${VISIBLE_ITEMS}`,
          [u.id, d.item_id],
        )
      ).rows[0];
      if (!item) fail(404, "Item not found");
      if (item.kind !== "task") fail(422, "Only tasks can have sessions.");
      const { id } = (
        await db.query<{ id: string }>(
          `INSERT INTO time_blocks (item_id, user_id, start_at, end_at) VALUES ($1, $2, $3, $4) RETURNING id`,
          [d.item_id, u.id, d.start_at, d.end_at],
        )
      ).rows[0];
      const created = await blockById(db, id, u.id);
      await queueWebhooks(
        db,
        "block.scheduled",
        { user_id: u.id, team_id: null },
        created,
      );
      return created;
    });
    reply.code(201);
    return block;
  });

  app.put("/blocks/:id", async (r) => {
    const u = await authenticate(r);
    const d = blockUpdate.parse(r.body);
    return transaction(async (db) => {
      const b = await ownBlock(db, idParam(r), u.id);
      // Placed by hand now: a later plan offers to move it only unticked.
      await db.query(
        "UPDATE time_blocks SET start_at = $2, end_at = $3, source = 'manual' WHERE id = $1",
        [b.id, d.start_at, d.end_at],
      );
      // A moved block no longer has the conflict it was flagged for.
      await db.query(
        "UPDATE notifications SET read = true WHERE kind = 'conflict' AND ref = $1",
        [b.id],
      );
      const moved = await blockById(db, b.id, u.id);
      // Other devices and webhooks hear about it, so a "Planned" time
      // shown elsewhere doesn't go stale.
      await queueWebhooks(
        db,
        "block.updated",
        { user_id: u.id, team_id: null },
        moved,
      );
      return moved;
    });
  });

  app.delete("/blocks/:id", async (r, reply) => {
    const u = await authenticate(r);
    await transaction(async (db) => {
      const gone = (
        await db.query<{
          id: string;
          item_id: string;
          start_at: Date;
          end_at: Date;
        }>(
          `DELETE FROM time_blocks WHERE id = $1 AND user_id = $2
           RETURNING id, item_id, start_at, end_at`,
          [idParam(r), u.id],
        )
      ).rows[0];
      if (!gone) fail(404, "Session not found");
      await queueWebhooks(
        db,
        "block.deleted",
        { user_id: u.id, team_id: null },
        {
          id: gone.id,
          item_id: gone.item_id,
          start_at: gone.start_at.toISOString(),
          end_at: gone.end_at.toISOString(),
        },
      );
    });
    return reply.code(204).send();
  });

  // Move a block to the next free working time of the same length, one that
  // ends by its task's deadline when there is one (only such a time with
  // `before_deadline`). Past the deadline, any free time will do.
  app.post("/blocks/:id/reschedule", async (r) => {
    const u = await authenticate(r);
    const d = blockRescheduleInput.parse(r.body ?? {});
    return transaction(async (db) => {
      const b = await ownBlock(db, idParam(r), u.id);
      const minutes = (b.end_at.getTime() - b.start_at.getTime()) / 60000;
      const now = new Date();
      const { deadline_at } = await blockById(db, b.id, u.id);
      const by =
        deadline_at && Date.parse(deadline_at) > now.getTime()
          ? new Date(deadline_at)
          : null;
      let slot = by
        ? await workingFree(db, u.id, minutes, [b.id], now, undefined, by)
        : null;
      if (!slot && d.before_deadline)
        fail(
          409,
          by
            ? "There's no free working time for it before the deadline."
            : "Its deadline has passed, so there's no time before it.",
        );
      slot ??= await workingFree(db, u.id, minutes, [b.id], now);
      if (!slot) fail(409, "There's no free working time in the next 7 days.");
      await db.query(
        "UPDATE time_blocks SET start_at = $2, end_at = $3 WHERE id = $1",
        [b.id, slot.start_at, slot.end_at],
      );
      await db.query(
        "UPDATE notifications SET read = true WHERE kind = 'conflict' AND ref = $1",
        [b.id],
      );
      const moved = await blockById(db, b.id, u.id);
      await queueWebhooks(
        db,
        "block.updated",
        { user_id: u.id, team_id: null },
        moved,
      );
      return moved;
    });
  });

  // Another block for the same task and length: at `start_at`, or the next
  // free working time after the original.
  app.post("/blocks/:id/duplicate", async (r, reply) => {
    const u = await authenticate(r);
    const d = blockDuplicateInput.parse(r.body ?? {});
    const block = await transaction(async (db) => {
      const b = await ownBlock(db, idParam(r), u.id);
      const open = await db.query(
        `SELECT 1 FROM items i WHERE i.id = $2 AND i.status NOT IN ('done', 'cancelled') AND ${VISIBLE_ITEMS}`,
        [u.id, b.item_id],
      );
      if (!open.rowCount) fail(409, "This task is done or no longer yours.");
      const length = b.end_at.getTime() - b.start_at.getTime();
      let slot: { start_at: string; end_at: string } | null;
      if (d.start_at)
        slot = {
          start_at: new Date(d.start_at).toISOString(),
          end_at: new Date(Date.parse(d.start_at) + length).toISOString(),
        };
      else {
        slot = await workingFree(
          db,
          u.id,
          length / 60000,
          [],
          new Date(),
          b.end_at,
        );
        if (!slot)
          fail(409, "There's no free working time in the 7 days after it.");
      }
      const { id } = (
        await db.query<{ id: string }>(
          `INSERT INTO time_blocks (item_id, user_id, start_at, end_at) VALUES ($1, $2, $3, $4) RETURNING id`,
          [b.item_id, u.id, slot!.start_at, slot!.end_at],
        )
      ).rows[0];
      const created = await blockById(db, id, u.id);
      await queueWebhooks(
        db,
        "block.scheduled",
        { user_id: u.id, team_id: null },
        created,
      );
      return created;
    });
    reply.code(201);
    return block;
  });

  // ---- plans ---------------------------------------------------------------------

  app.post("/planner/preview", async (r): Promise<Plan> => {
    const u = await authenticate(r);
    const d = planPreviewInput.parse(r.body ?? {});
    return makePlan(pool, u.id, d);
  });

  app.get("/planner/plans/:id", async (r) => {
    const u = await authenticate(r);
    return planById(reader(r.headers), idParam(r), u.id);
  });

  // Tune a plan before applying it; returns a new plan that replaces it.
  app.patch("/planner/plans/:id", async (r): Promise<Plan> => {
    const u = await authenticate(r);
    const d = planTuneInput.parse(r.body ?? {});
    return transaction((db) => tunePlan(db, u, idParam(r), d));
  });

  // Whether the calendar or tasks changed since the plan was made.
  app.get("/planner/plans/:id/stale", async (r): Promise<PlanStaleness> => {
    const u = await authenticate(r);
    // The primary: a replica a moment behind would miss the change being asked about.
    return { stale: await planStale(pool, idParam(r), u.id) };
  });

  // Save a plan's blocks, and move the late sessions asked for (the ones the
  // planner ticked when `moves` is omitted) before their deadline. Blocks
  // that now clash with something are left out, and so is a move whose
  // session changed or went since the plan was made.
  app.post("/planner/plans/:id/apply", async (r): Promise<PlanApplied> => {
    const u = await authenticate(r);
    const d = planApplyInput.parse(r.body ?? {});
    return transaction(async (db) => {
      const plan = (
        await db.query<{
          id: string;
          blocks: Plan["blocks"];
          moves: PlanMove[] | null;
          applied: boolean;
          expires_at: Date;
        }>(
          `SELECT id, blocks, options->'moves' AS moves, applied, expires_at
           FROM plans WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [idParam(r), u.id],
        )
      ).rows[0];
      if (!plan) fail(404, "Plan not found");
      if (plan.applied) fail(409, "This plan was already applied.");
      if (plan.expires_at <= new Date())
        fail(409, "This plan expired. Make a new one.");
      const offered = plan.moves ?? [];
      const unknown = (d.moves ?? []).filter(
        (id) => !offered.some((m) => m.block_id === id),
      );
      if (unknown.length)
        fail(422, "Those sessions aren't among the moves this plan offers.");
      const moves = d.moves
        ? offered.filter((m) => d.moves!.includes(m.block_id))
        : offered.filter((m) => m.selected);
      if (!plan.blocks.length && !moves.length)
        fail(409, "This plan has no sessions to add or move.");
      const dependencies = await db.query(
        "SELECT 1 FROM item_dependencies WHERE item_id=ANY($1::uuid[]) LIMIT 1",
        [[...plan.blocks, ...moves].map((b) => b.item_id)],
      );
      if (dependencies.rowCount && (await planStale(db, plan.id, u.id)))
        fail(
          409,
          "The dependency schedule changed. Refresh the plan before applying it.",
        );
      const spans = [...plan.blocks, ...moves];
      const starts = spans.map((b) => Date.parse(b.start_at));
      const ends = spans.map((b) => Date.parse(b.end_at));
      // The sessions being moved don't stand in their own way.
      const busy = await busyIntervals(
        db,
        u.id,
        new Date(Math.min(...starts)),
        new Date(Math.max(...ends)),
        {
          blocks: true,
          derived: true,
          excludeBlockIds: moves.map((m) => m.block_id),
        },
      );
      const clashes = (b: { start_at: string; end_at: string }) =>
        busy.some((x) => x.start_at < b.end_at && b.start_at < x.end_at);

      // Moves first. Each session is checked again: it's still yours, its
      // task is still open, and it hasn't been moved since.
      const moved: TimeBlock[] = [];
      let movesSkipped = 0;
      for (const m of moves) {
        const same = await db.query(
          `SELECT 1 FROM time_blocks b JOIN items i ON i.id = b.item_id
           WHERE b.id = $1 AND b.user_id = $2 AND b.item_id = $3
             AND b.start_at = $4 AND b.end_at = $5
             AND i.status NOT IN ('done', 'cancelled')
           FOR UPDATE OF b`,
          [m.block_id, u.id, m.item_id, m.from_start_at, m.from_end_at],
        );
        if (!same.rowCount || clashes(m)) {
          movesSkipped++;
          continue;
        }
        await db.query(
          "UPDATE time_blocks SET start_at = $2, end_at = $3 WHERE id = $1",
          [m.block_id, m.start_at, m.end_at],
        );
        await db.query(
          "UPDATE notifications SET read = true WHERE kind = 'conflict' AND ref = $1",
          [m.block_id],
        );
        moved.push(await plainBlockById(db, m.block_id, u.id));
      }

      const created: TimeBlock[] = [];
      let skipped = 0;
      for (const b of plan.blocks) {
        const clash = clashes(b);
        const open = await db.query(
          `SELECT 1 FROM items i WHERE i.id = $2 AND i.status NOT IN ('done', 'cancelled') AND ${VISIBLE_ITEMS}`,
          [u.id, b.item_id],
        );
        if (clash || !open.rowCount) {
          skipped++;
          continue;
        }
        const { id } = (
          await db.query<{ id: string }>(
            `INSERT INTO time_blocks (item_id, user_id, start_at, end_at, source, plan_id)
             VALUES ($1, $2, $3, $4, 'planner', $5) RETURNING id`,
            [b.item_id, u.id, b.start_at, b.end_at, plan.id],
          )
        ).rows[0];
        created.push(await plainBlockById(db, id, u.id));
      }
      // Numbered together, once every session of the plan is in place.
      const facts = await withSessionFacts(db, u.id, [...created, ...moved]);
      const saved = facts.slice(0, created.length);
      const shifted = facts.slice(created.length);
      await db.query("UPDATE plans SET applied = true WHERE id = $1", [
        plan.id,
      ]);
      if (created.length)
        await queueWebhooks(
          db,
          "block.scheduled",
          { user_id: u.id, team_id: null },
          {
            plan_id: plan.id,
            blocks: saved,
          },
        );
      // Other devices and webhooks hear about each moved session.
      for (const b of shifted)
        await queueWebhooks(
          db,
          "block.updated",
          { user_id: u.id, team_id: null },
          b,
        );
      return {
        blocks: saved,
        skipped,
        moved: shifted,
        moves_skipped: movesSkipped,
      };
    });
  });

  app.get("/planner/review", async (r): Promise<PlannerReview> => {
    const u = await authenticate(r);
    return reviewFor(reader(r.headers), u.id);
  });

  // A new plan for unfinished work, to review and apply like any other.
  app.post("/planner/roll-forward", async (r): Promise<Plan> => {
    const u = await authenticate(r);
    const d = rollForwardInput.parse(r.body ?? {});
    const review = await reviewFor(pool, u.id);
    const blocks = d.block_ids
      ? review.unfinished.filter((b) => d.block_ids!.includes(b.id))
      : review.unfinished;
    const itemIds = [...new Set(blocks.map((b) => b.item_id))];
    if (!itemIds.length)
      fail(409, "There's no unfinished work to move forward.");
    const prefs = await loadPrefs(pool, u.id);
    const today = localDateKey(new Date(), prefs.timezone);
    return makePlan(pool, u.id, {
      start_date: today,
      days: Math.max(prefs.horizon_days, 1),
      use_frames: true,
      keep_free: [],
      item_ids: itemIds,
      exclude_item_ids: [],
    });
  });

  // ---- calendar feed: a private link other calendar apps can subscribe to ------

  app.get("/me/calendar-feed", async (r): Promise<CalendarFeedSettings> => {
    const u = await authenticate(r);
    return feedSettings(reader(r.headers), u.id);
  });

  app.put("/me/calendar-feed", async (r): Promise<CalendarFeedSettings> => {
    const u = await authenticate(r);
    const d = calendarFeedSettingsInput.parse(r.body ?? {});
    await pool.query(
      "UPDATE users SET calendar_feed_options = calendar_feed_options || $2::jsonb WHERE id = $1",
      [u.id, JSON.stringify(d)],
    );
    return feedSettings(pool, u.id);
  });

  // The full link, or `{ "busy": true }` for one that only shows when you're
  // busy (safe to share). Each is shown once; making it again replaces it.
  app.post("/me/calendar-feed", async (r): Promise<CalendarFeed> => {
    const u = await authenticate(r);
    const d = calendarFeedCreateInput.parse(r.body ?? {});
    const token = randomBytes(24).toString("base64url");
    await pool.query(
      `UPDATE users SET ${d.busy ? "calendar_busy_feed_hash" : "calendar_feed_hash"} = $2 WHERE id = $1`,
      [u.id, digest(token)],
    );
    return {
      url: `${publicOrigin(r)}/calendar/feed/${token}.ics`,
      busy: d.busy,
    };
  });

  app.delete("/me/calendar-feed", async (r, reply) => {
    const u = await authenticate(r);
    const { busy } = z
      .object({ busy: z.enum(["0", "1", "true", "false"]).optional() })
      .parse(r.query);
    const column =
      busy === "1" || busy === "true"
        ? "calendar_busy_feed_hash"
        : "calendar_feed_hash";
    await pool.query(`UPDATE users SET ${column} = NULL WHERE id = $1`, [u.id]);
    return reply.code(204).send();
  });

  app.get("/calendar/feed/:file", strictRateLimit, async (r, reply) => {
    const { file } = z
      .object({ file: z.string().regex(/^[A-Za-z0-9_-]{20,64}\.ics$/) })
      .parse(r.params);
    const { busy } = z.object({ busy: z.string().optional() }).parse(r.query);
    const hash = digest(file.slice(0, -4));
    const user = (
      await pool.query<{
        id: string;
        name: string;
        disabled: boolean;
        busy_link: boolean;
        options: { include_blocks?: boolean };
      }>(
        `SELECT id, name, disabled, calendar_busy_feed_hash = $1 AS busy_link,
                calendar_feed_options AS options
         FROM users WHERE calendar_feed_hash = $1 OR calendar_busy_feed_hash = $1`,
        [hash],
      )
    ).rows[0];
    if (!user || user.disabled) fail(404, "Calendar not found");
    const from = (await settings()).smtp.from;
    const body = await icsFeed(pool, user.id, user.name, {
      // The busy link never shows more; the full link can ask for less.
      busyOnly: user.busy_link || busy === "1" || busy === "true",
      includeBlocks: !!user.options.include_blocks,
      organizer: {
        name: user.name,
        email: (from.match(/<([^>]+)>/)?.[1] ?? from).trim(),
      },
    });
    return reply
      .header("Content-Type", "text/calendar; charset=utf-8")
      .header("Cache-Control", "private, max-age=300")
      .send(body);
  });
}
