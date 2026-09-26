import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import {
  blockDuplicateInput,
  blockInput,
  blockOnDayInput,
  blockRescheduleInput,
  sessionCheckInInput,
  blockUpdate,
  calendarFeedCreateInput,
  calendarFeedSettingsInput,
  calendarSearchQuery,
  clockMinutes,
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
  plannedQuery,
  planPreviewInput,
  planTuneInput,
  rangeQuery,
  rollForwardInput,
  todayQuery,
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
  type PlannedFeed,
  type PlannerAnalytics,
  type PlannerPrefs,
  type PlannerReview,
  type PlanStaleness,
  type TimeBlock,
  type TodayList,
} from "@orbyn/core";
import { z } from "zod";
import { pool, reader, transaction, type Db } from "../../db/pool.js";
import { authenticate, digest } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
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
import { checkIn, pendingCheckIns, startSession } from "./check-in.js";
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
import {
  applyHabitPlan,
  createFrame,
  createPlace,
  deleteFrame,
  deleteHabit,
  deleteHabitBlock,
  deletePlace,
  habitPlan,
  plannerAnalytics,
  savePrefs,
  skipFrame,
  updateFrame,
  updateHabit,
  updatePlace,
} from "./routines.js";
import { plannedFeed } from "./planned.js";
import { todayFor } from "./today.js";
import { validationMessage } from "../../services/http.js";
import { emailEnabled, sendEmail } from "../../worker/channels/email.js";
import {
  createHabit,
  habitBlocksIn,
  habitById,
  loadHabits,
  placeHabits,
} from "./habits.js";
import { settings } from "../../lib/settings.js";
import { inMyTeams, visibleItems } from "../../lib/visibility.js";
import {
  addSession,
  blockById,
  plainBlockById,
  placeSessions,
  moveSession,
  ownBlock,
  removeSession,
} from "./blocks.js";

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

/** Where the API can be reached from outside, for links in responses. */
function publicOrigin(r: FastifyRequest) {
  const host =
    (r.headers["x-forwarded-host"] as string | undefined) ?? r.headers.host;
  const proto =
    (r.headers["x-forwarded-proto"] as string | undefined) ?? r.protocol;
  const prefix = (r.headers["x-forwarded-prefix"] as string | undefined) ?? "";
  return `${proto}://${host}${prefix.replace(/\/$/, "")}`;
}

/**
 * A query string checked by `schema`. A malformed one is refused with 400
 * (the request itself is wrong, not the data it would send).
 */
function queryOf<T extends z.ZodType>(
  schema: T,
  r: FastifyRequest,
): z.output<T> {
  const parsed = schema.safeParse(r.query ?? {});
  if (!parsed.success) fail(400, validationMessage(parsed.error.issues));
  return parsed.data;
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
    return transaction((db) => savePrefs(db, u.id, d));
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

  // Today, planned and due in one list: the day's events, your sessions,
  // your tasks due today and late ones (one row, two chips, when a task is
  // both planned and due), and unfinished sessions from earlier days. The
  // day is `timezone`'s (the device's), or the planner's.
  app.get("/today", async (r): Promise<TodayList> => {
    const u = await authenticate(r);
    const q = queryOf(todayQuery, r);
    return todayFor(reader(r.headers), u.id, new Date(), q.timezone);
  });

  // Your planned time, task by task, with each task's "does it fit?"
  // status: some tasks (`item_ids`), or every open task that's yours to plan
  // plus any with a session in the window (`from`, `to`), whose sessions
  // each task lists. Kept out of the task itself (see planned.ts).
  app.get("/planned", async (r): Promise<PlannedFeed> => {
    const u = await authenticate(r);
    const q = queryOf(plannedQuery, r);
    return plannedFeed(reader(r.headers), u.id, q);
  });

  // Where your set-aside time went: totals, by list and by tag, over a window.
  app.get("/planner/analytics", async (r): Promise<PlannerAnalytics> => {
    const u = await authenticate(r);
    const days = Math.min(
      365,
      Math.max(1, Number((r.query as { days?: string }).days) || 30),
    );
    return plannerAnalytics(reader(r.headers), u.id, days);
  });

  app.get("/planner/frames", async (r) => {
    const u = await authenticate(r);
    return loadFrames(reader(r.headers), u.id);
  });

  app.post("/planner/frames", async (r, reply) => {
    const u = await authenticate(r);
    const d = frameInput.parse(r.body);
    const frame = await createFrame(pool, u.id, d);
    reply.code(201);
    return frame;
  });

  app.put("/planner/frames/:id", async (r) => {
    const u = await authenticate(r);
    const d = frameUpdate.parse(r.body);
    return transaction((db) => updateFrame(db, u.id, idParam(r), d));
  });

  // Skip one date of a frame ("not this Friday"), or bring it back.
  for (const [path, add] of [
    ["/planner/frames/:id/skip", true],
    ["/planner/frames/:id/unskip", false],
  ] as const)
    app.post(path, async (r) => {
      const u = await authenticate(r);
      const d = frameSkipInput.parse(r.body);
      return skipFrame(pool, u.id, idParam(r), d.date, add);
    });

  app.delete("/planner/frames/:id", async (r, reply) => {
    const u = await authenticate(r);
    await deleteFrame(pool, u.id, idParam(r));
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
    return transaction((db) => updateHabit(db, u.id, idParam(r), d));
  });

  app.delete("/planner/habits/:id", async (r, reply) => {
    const u = await authenticate(r);
    await deleteHabit(pool, u.id, idParam(r));
    return reply.code(204).send();
  });

  // Propose sessions for the active habits over the next few days. Nothing is
  // saved; the client shows them and applies the ones the user keeps.
  app.post("/planner/habits/plan", async (r): Promise<HabitPlan> => {
    const u = await authenticate(r);
    const d = habitPlanInput.parse(r.body);
    return habitPlan(pool, u.id, d);
  });

  // Save proposed sessions, skipping any that now clash with busy time.
  app.post("/planner/habits/plan/apply", async (r): Promise<HabitBlock[]> => {
    const u = await authenticate(r);
    const d = habitApplyInput.parse(r.body);
    return transaction((db) => applyHabitPlan(db, u.id, d));
  });

  app.delete("/planner/habits/blocks/:id", async (r, reply) => {
    const u = await authenticate(r);
    await deleteHabitBlock(pool, u.id, idParam(r));
    return reply.code(204).send();
  });

  app.get("/planner/places", async (r) => {
    const u = await authenticate(r);
    return loadPlaces(reader(r.headers), u.id);
  });

  app.post("/planner/places", async (r, reply) => {
    const u = await authenticate(r);
    const d = placeInput.parse(r.body);
    const place = await createPlace(pool, u.id, d);
    reply.code(201);
    return place;
  });

  app.put("/planner/places/:id", async (r) => {
    const u = await authenticate(r);
    const d = placeUpdate.parse(r.body);
    return updatePlace(pool, u.id, idParam(r), d);
  });

  app.delete("/planner/places/:id", async (r, reply) => {
    const u = await authenticate(r);
    await deletePlace(pool, u.id, idParam(r));
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
         WHERE ${visibleItems()} AND i.due_at IS NOT NULL
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

  // Sessions that ended and wait for "how did it go?".
  app.get("/blocks/check-ins", async (r) => {
    const u = await authenticate(r);
    return pendingCheckIns(reader(r.headers), u.id);
  });

  app.post("/blocks/:id/check-in", async (r) => {
    const u = await authenticate(r);
    const d = sessionCheckInInput.parse(r.body);
    return transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      const result = await checkIn(
        db,
        u.id,
        idParam(r),
        d.outcome,
        d.more_minutes,
      );
      await queueWebhooks(
        db,
        "block.updated",
        { user_id: u.id, team_id: null },
        await blockById(db, result.id, u.id),
      );
      return result;
    });
  });

  // "Start" from a session's reminder, or its menu while it's on.
  app.post("/blocks/:id/start", async (r) => {
    const u = await authenticate(r);
    const { from } = z
      .object({ from: z.enum(["app", "reminder"]).default("app") })
      .strict()
      .parse(r.body ?? {});
    return transaction(async (db) => {
      await db.query(
        "SELECT set_config('orbyn.user_id', $1, true), set_config('orbyn.origin', $2, true)",
        [u.id, from],
      );
      return startSession(db, u.id, idParam(r));
    });
  });

  // One task's sessions (yours), with its deadline and how much of the time
  // still to come ends by it. Reading them never makes a plan.
  app.get("/items/:id/sessions", async (r): Promise<ItemSessions> => {
    const u = await authenticate(r);
    return itemSessions(reader(r.headers), u.id, idParam(r));
  });

  // A session at a time, or (with `day` instead of times: a task dropped on
  // a calendar day) at the first free working time that day. A day's
  // session may end after the task's deadline: it is flagged late, never
  // refused, and the deadline is never touched.
  app.post("/blocks", async (r, reply) => {
    const u = await authenticate(r);
    const body = (r.body ?? {}) as Record<string, unknown>;
    const onDay = "day" in body ? blockOnDayInput.parse(body) : null;
    const d = onDay ?? blockInput.parse(body);
    const block = await transaction((db) => addSession(db, u.id, d));
    reply.code(201);
    return block;
  });

  app.put("/blocks/:id", async (r) => {
    const u = await authenticate(r);
    const d = blockUpdate.parse(r.body);
    return transaction((db) =>
      moveSession(db, u.id, idParam(r), d.start_at, d.end_at),
    );
  });

  app.delete("/blocks/:id", async (r, reply) => {
    const u = await authenticate(r);
    await transaction((db) => removeSession(db, u.id, idParam(r)));
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
      const { planning_deadline_at } = await blockById(db, b.id, u.id);
      const by =
        planning_deadline_at && Date.parse(planning_deadline_at) > now.getTime()
          ? new Date(planning_deadline_at)
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
      // The planner chose the new time, so a project's History says so.
      await db.query(
        `SELECT set_config('orbyn.user_id', $1, true),
                set_config('orbyn.origin',
                  coalesce(nullif(current_setting('orbyn.origin', true), ''), 'planner'), true)`,
        [u.id],
      );
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
        `SELECT 1 FROM items i WHERE i.id = $2 AND i.status NOT IN ('done', 'cancelled') AND ${visibleItems()}`,
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
      // A project's History says the planner placed these sessions. An
      // origin set by the caller (the assistant applying its plan) stays.
      await db.query(
        `SELECT set_config('orbyn.user_id', $1, true),
                set_config('orbyn.origin',
                  coalesce(nullif(current_setting('orbyn.origin', true), ''), 'planner'), true)`,
        [u.id],
      );
      const plan = (
        await db.query<{
          id: string;
          blocks: Plan["blocks"];
          moves: PlanMove[] | null;
          project_id: string | null;
          applied: boolean;
          expires_at: Date;
        }>(
          `SELECT id, blocks, options->'moves' AS moves,
                  options->'input'->>'project_id' AS project_id, applied, expires_at
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
      if (
        (plan.project_id || dependencies.rowCount) &&
        (await planStale(db, plan.id, u.id))
      )
        fail(
          409,
          "The dependency schedule changed. Refresh the plan before applying it.",
        );
      const placed = await placeSessions(db, u.id, plan.id, plan.blocks, moves);
      await db.query("UPDATE plans SET applied = true WHERE id = $1", [
        plan.id,
      ]);
      return placed;
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
