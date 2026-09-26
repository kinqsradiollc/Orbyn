import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  FOCUS_RHYTHMS,
  OPEN_TIMER,
  estimateModelOf,
  frameInput,
  frameUpdate,
  habitInput,
  habitUpdate,
  learningSummary,
  placeInput,
  placeUpdate,
  plannerPrefsInput,
  whatIfInput,
} from "@orbyn/core";
import { Params, scopeFor, visibleItems } from "../lib/visibility.js";
import {
  whatIf as runWhatIf,
  planReality,
} from "../modules/followthrough/reality.js";
import {
  clearFocus,
  currentFocus,
  focusSummary,
  logFocusSession,
  setFocus,
} from "../modules/focus/service.js";
import { logTime } from "../modules/items/progress.js";
import { loadPlaces, loadPrefs } from "../modules/planner/calendar.js";
import { loadFrames } from "../modules/planner/frames.js";
import { loadHabits } from "../modules/planner/habits.js";
import { loadLearning } from "../modules/planner/learning.js";
import { createHabit } from "../modules/planner/habits.js";
import {
  createFrame,
  createPlace,
  plannerAnalytics,
  savePrefs,
  skipFrame,
  updateFrame,
  updateHabit,
  updatePlace,
} from "../modules/planner/routines.js";
import { READ } from "./common.js";
import { both, cleanTitle } from "./format.js";
import { minutesText } from "./common.js";
import { appUrl, refs } from "./refs.js";
import { CapabilityError, defineCapability } from "./registry.js";
import { entryOf, seeItem } from "./shared.js";
import type { UndoOp } from "./undo.js";
import {
  ADDS,
  EDITS,
  MAX_BATCH,
  actorOf,
  clientRefInput,
  dbOf,
  destination,
  finishWrite,
  idField,
  isoTime,
  refuseSecrets,
  writeOutput,
  type DoneEntry,
} from "./write.js";

/**
 * The planner toolset: how the person really works (learned durations,
 * best hours, planned against done, focus, unfinished sessions), what-if
 * plans that keep nothing, logging focus and time, the focus timer shared
 * across devices, routines (frames, habits, places) and the planner's
 * settings. Routines and settings are the person's own: Personal only.
 */

const personalOnly = (ctx: Parameters<typeof destination>[0]) => {
  if (destination(ctx, null, "W1") === "review")
    throw new CapabilityError(
      "FORBIDDEN",
      "This connection can only suggest changes, and planner settings and routines don't go through review.",
      "Ask the person to change them in Orbyn.",
    );
};

// --- get_work_patterns -------------------------------------------------

export const getWorkPatterns = defineCapability({
  name: "get_work_patterns",
  title: "How you work",
  description:
    "What the planner has learned: how long tasks really take against their estimates, the hours that usually go well, how much a day usually holds, planned against done over four weeks by weekday, focus totals (and the timer, if running), where planned time went, unfinished sessions from the last two weeks, and the person's routines (frames, habits, places, with ids).",
  input: z
    .object({ days: z.number().int().min(7).max(90).default(28) })
    .strict(),
  output: z.object({
    summary: z.object({
      estimates: z.string(),
      rhythm: z.string(),
      load: z.string(),
    }),
    estimates: z.object({
      ratio: z.number(),
      samples: z.number(),
      typical_minutes: z.number().nullable(),
      applied: z.boolean(),
    }),
    best_hours: z
      .object({ start_hour: z.number(), end_hour: z.number() })
      .nullable(),
    planned_vs_done: z.object({
      rate: z.number().nullable(),
      by_weekday: z.array(
        z.object({
          weekday: z.number(),
          planned_minutes: z.number(),
          kept_minutes: z.number(),
        }),
      ),
    }),
    focus: z.object({
      work_minutes: z.number(),
      completed: z.number(),
      cut_short: z.number(),
    }),
    time: z.object({
      planned_minutes: z.number(),
      completed_tasks: z.number(),
      by_list: z.array(z.object({ name: z.string(), minutes: z.number() })),
      by_tag: z.array(z.object({ name: z.string(), minutes: z.number() })),
    }),
    unfinished: z.array(
      z.object({
        task: z.string(),
        title: z.string(),
        start: z.object({ at: z.string(), local: z.string() }),
        minutes: z.number(),
      }),
    ),
    routines: z.object({
      frames: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          days: z.array(z.number()),
          start: z.string(),
          end: z.string(),
        }),
      ),
      habits: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          cadence: z.number(),
          period: z.string(),
          minutes: z.number(),
          active: z.boolean(),
        }),
      ),
      places: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          travel_minutes: z.number(),
        }),
      ),
    }),
    focus_running: z
      .object({
        task: z.string().nullable(),
        phase: z.string(),
        ends: z.string().nullable(),
      })
      .nullable(),
  }),
  annotations: READ,
  access: "read",
  toolset: "planner",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const me = ctx.principal.user.id;
    const prefs = await loadPrefs(ctx.db as never, me);
    const learning = await loadLearning(
      ctx.db as never,
      me,
      ctx.timezone,
      ctx.now,
    );
    const estimates = estimateModelOf(
      learning.durations,
      !!prefs.learn_estimates,
    );
    const summary = learningSummary({
      estimates,
      rhythm: { ...learning.rhythm, applied: prefs.learn_rhythm !== false },
      load: { ...learning.load, applied: prefs.balance_load !== false },
    });
    const reality = await planReality(ctx.db, me, ctx.now);
    const from = new Date(ctx.now.getTime() - a.days * 86_400_000);
    const focus = await focusSummary(ctx.db, me, {
      from: from.toISOString(),
      to: ctx.now.toISOString(),
    });
    const time = await plannerAnalytics(ctx.db, me, a.days, ctx.now);
    // Unfinished sessions: past sessions whose task is still open, only for
    // tasks this connection can see.
    const p = new Params();
    const scope = scopeFor(ctx.spaces, p);
    const unfinished = (
      await ctx.db.query<{
        item_id: string;
        title: string;
        start_at: Date;
        end_at: Date;
      }>(
        `SELECT b.item_id, i.title, b.start_at, b.end_at
           FROM time_blocks b JOIN items i ON i.id = b.item_id
          WHERE b.user_id = ${scope.user} AND b.end_at < ${p.add(ctx.now)}
            AND b.start_at > ${p.add(new Date(ctx.now.getTime() - 14 * 86_400_000))}
            AND i.status NOT IN ('done', 'cancelled') AND ${visibleItems("i", scope)}
          ORDER BY b.start_at DESC LIMIT 30`,
        p.values,
      )
    ).rows;
    const [frames, habits, places, running] = await Promise.all([
      loadFrames(ctx.db as never, me),
      loadHabits(ctx.db as never, me),
      loadPlaces(ctx.db as never, me),
      currentFocus(me, ctx.db),
    ]);
    const peak = learning.rhythm.peak;
    const structured = {
      summary,
      estimates: {
        ratio: estimates.overall.ratio,
        samples: estimates.overall.samples,
        typical_minutes: estimates.typical_minutes ?? null,
        applied: estimates.applied,
      },
      best_hours: peak
        ? { start_hour: peak.start_hour, end_hour: peak.end_hour }
        : null,
      planned_vs_done: {
        rate: reality.rate,
        by_weekday: reality.by_weekday.map((w) => ({
          weekday: w.weekday,
          planned_minutes: w.planned_minutes,
          kept_minutes: w.kept_minutes,
        })),
      },
      focus: {
        work_minutes: focus.work_minutes,
        completed: focus.completed,
        cut_short: focus.cut_short,
      },
      time: {
        planned_minutes: time.planned_minutes,
        completed_tasks: time.completed,
        // List and tag names are the person's own (and their teams').
        by_list: time.by_list.map((x) => ({
          name: cleanTitle(x.name),
          minutes: x.minutes,
        })),
        by_tag: time.by_tag.map((x) => ({
          name: cleanTitle(x.name),
          minutes: x.minutes,
        })),
      },
      unfinished: unfinished.map((b) => ({
        task: refs({ type: "task", id: b.item_id }).id,
        title: cleanTitle(b.title) || "Untitled",
        start: both(b.start_at, ctx.timezone)!,
        minutes: Math.round(
          (b.end_at.getTime() - b.start_at.getTime()) / 60_000,
        ),
      })),
      routines: {
        frames: frames.map((f) => ({
          id: f.id,
          name: cleanTitle(f.name),
          days: f.days.map(Number),
          start: f.start_time,
          end: f.end_time,
        })),
        habits: habits.map((h) => ({
          id: h.id,
          name: cleanTitle(h.name),
          cadence: h.cadence,
          period: h.period,
          minutes: h.duration_minutes,
          active: h.active,
        })),
        places: places.map((p) => ({
          id: p.id,
          label: cleanTitle(p.label),
          travel_minutes: p.travel_minutes,
        })),
      },
      focus_running: running
        ? {
            task: running.state.item_id
              ? refs({ type: "task", id: running.state.item_id }).id
              : null,
            phase: running.state.phase,
            ends: running.state.ends_at,
          }
        : null,
    };
    return {
      structured,
      markdown: [
        `- ${summary.estimates}`,
        `- ${summary.rhythm}`,
        `- ${summary.load}`,
        `- Planned against done (4 weeks): ${reality.rate === null ? "not enough planned yet" : `${Math.round(reality.rate * 100)}%`}.`,
        `- Focus (${a.days} days): ${minutesText(focus.work_minutes)}, ${focus.completed} finished, ${focus.cut_short} cut short.`,
        `- Planned time (${a.days} days): ${minutesText(time.planned_minutes)}; ${time.completed} tasks done.`,
        ...(structured.unfinished.length
          ? [
              "Unfinished sessions:",
              ...structured.unfinished.map(
                (u) =>
                  `- ${u.start.local} ${u.minutes} min: ${u.title} · ${u.task}`,
              ),
            ]
          : []),
      ].join("\n"),
    };
  },
});

// --- what_if --------------------------------------------------------------

export const whatIfCapability = defineCapability({
  name: "what_if",
  title: "What if…",
  description:
    "Compares the plan as things are with a scenario (add tasks, days off, a moved deadline, dropped tasks) over up to 14 days, and keeps neither: planned minutes, capacity, and tasks at risk or that don't fit, before and after. At most 10 a minute.",
  input: z
    .object({
      days: z.number().int().min(1).max(14).default(7),
      add_tasks: z
        .array(
          z
            .object({
              title: z.string().trim().min(1).max(200),
              estimate_minutes: z.number().int().min(5).max(10080),
              due_at: isoTime.nullable().default(null),
              priority: z.enum(["low", "medium", "high"]).default("medium"),
            })
            .strict(),
        )
        .max(10)
        .optional(),
      days_off: z
        .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
        .max(14)
        .optional(),
      move_due: z
        .array(
          z
            .object({
              task: z.string().trim().max(300),
              due_at: isoTime.nullable(),
            })
            .strict(),
        )
        .max(20)
        .optional(),
      drop: z.array(z.string().trim().max(300)).max(50).optional(),
    })
    .strict(),
  output: z.object({
    before: z.object({
      planned_minutes: z.number(),
      capacity_minutes: z.number(),
      at_risk: z.array(z.string()),
      unplaced: z.array(z.string()),
    }),
    after: z.object({
      planned_minutes: z.number(),
      capacity_minutes: z.number(),
      at_risk: z.array(z.string()),
      unplaced: z.array(z.string()),
    }),
    verdict: z.string(),
  }),
  annotations: READ,
  access: "read",
  toolset: "planner",
  mode: "read",
  tier: "R",
  limitGroup: "heavy",
  async run(ctx, a) {
    if (!ctx.principal.personal)
      throw new CapabilityError(
        "FORBIDDEN",
        "What-if plans your own calendar, so the connection needs your Personal space.",
      );
    const move = [];
    for (const m of a.move_due ?? [])
      move.push({ item_id: (await seeItem(ctx, m.task)).id, due_at: m.due_at });
    const drop = [];
    for (const t of a.drop ?? []) drop.push((await seeItem(ctx, t)).id);
    const result = await runWhatIf(
      ctx.db,
      ctx.principal.user.id,
      whatIfInput.parse({
        days: a.days,
        add_tasks: a.add_tasks ?? [],
        days_off: a.days_off ?? [],
        move_due: move,
        drop_item_ids: drop,
      }),
      ctx.now,
    );
    const side = (s: typeof result.before) => ({
      planned_minutes: s.planned_minutes,
      capacity_minutes: s.capacity_minutes,
      at_risk: s.at_risk.map((t) => cleanTitle(t.title)),
      unplaced: s.unplaced.map((t) => cleanTitle(t.title)),
    });
    const verdict = cleanTitle(result.verdict);
    const structured = {
      before: side(result.before),
      after: side(result.after),
      verdict,
    };
    return {
      structured,
      markdown: [
        verdict,
        `Before: ${minutesText(structured.before.planned_minutes)} planned of ${minutesText(structured.before.capacity_minutes)}; at risk: ${structured.before.at_risk.join(", ") || "none"}.`,
        `After: ${minutesText(structured.after.planned_minutes)} planned of ${minutesText(structured.after.capacity_minutes)}; at risk: ${structured.after.at_risk.join(", ") || "none"}.`,
        "Nothing was changed.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  },
});

// --- log_focus --------------------------------------------------------------

export const logFocus = defineCapability({
  name: "log_focus",
  title: "Log focus time",
  description:
    "Records a finished focus session (started_at and ended_at, optionally on a task), or adds minutes spent to a task. session_id (a uuid you make) or client_ref makes a retry the same record.",
  input: z
    .object({
      task: z.string().trim().max(300).optional(),
      minutes: z.number().int().min(1).max(600),
      started_at: isoTime.optional(),
      ended_at: isoTime.optional(),
      completed: z.boolean().default(true),
      session_id: idField.optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: ADDS,
  access: "write",
  toolset: "planner",
  mode: "write",
  tier: "W1",
  async run(ctx, a) {
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const item = a.task ? await seeItem(ctx, a.task) : null;
    if (
      destination(ctx, item?.team_id ?? null, item?.team_id ? "W2" : "W1") ===
      "review"
    )
      throw new CapabilityError(
        "FORBIDDEN",
        "This connection can only suggest changes there.",
      );
    if (!a.started_at && !a.ended_at) {
      if (!item)
        throw new CapabilityError(
          "INVALID",
          "Name the task to add time to, or give started_at and ended_at.",
        );
      const detail = await logTime(db, actor, item.id, a.minutes);
      return finishWrite(ctx, "Logging time", {
        done: [
          entryOf(
            "task",
            item.id,
            detail.title,
            detail.version,
            `${a.minutes} min logged`,
          ),
        ],
        teamId: item.team_id,
      });
    }
    if (!a.started_at || !a.ended_at)
      throw new CapabilityError(
        "INVALID",
        "Give both started_at and ended_at.",
      );
    if (!ctx.principal.personal)
      throw new CapabilityError(
        "FORBIDDEN",
        "Focus sessions are the person's own: the connection needs Personal.",
      );
    const { session, fresh } = await logFocusSession(db, actor, {
      id: a.session_id ?? randomUUID(),
      item_id: item?.id ?? null,
      kind: "work",
      started_at: a.started_at,
      ended_at: a.ended_at,
      planned_minutes: a.minutes,
      minutes: a.minutes,
      completed: a.completed,
    });
    return finishWrite(ctx, "Logging focus", {
      done: [
        {
          id: `focus:${session.id}`,
          title: item ? cleanTitle(item.title) : "Focus session",
          url: item
            ? refs({ type: "task", id: item.id }).url
            : `${appUrl()}/app/today`,
          version: null,
          change: fresh ? `${a.minutes} min of focus logged` : "Already logged",
        },
      ],
      teamId: item?.team_id ?? null,
    });
  },
});

// --- set_focus_timer ------------------------------------------------------

export const setFocusTimer = defineCapability({
  name: "set_focus_timer",
  title: "Start or stop the focus timer",
  description:
    'Starts the focus timer shown on all the person\'s devices (rhythm "25-5", "50-10", "45-15" or "open"; optionally on a task), or stops it.',
  input: z
    .object({
      action: z.enum(["start", "stop"]),
      task: z.string().trim().max(300).optional(),
      rhythm: z.string().trim().max(20).default("25-5"),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "write",
  toolset: "planner",
  mode: "write",
  tier: "W1",
  async run(ctx, a) {
    personalOnly(ctx);
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    if (a.action === "stop") {
      await clearFocus(db, ctx.principal.user.id);
      return finishWrite(ctx, "The focus timer", {
        done: [
          {
            id: "focus:current",
            title: "Focus timer",
            url: `${appUrl()}/app/today`,
            version: null,
            change: "Stopped",
          },
        ],
      });
    }
    const rhythm =
      a.rhythm === "open"
        ? OPEN_TIMER
        : FOCUS_RHYTHMS.find((r) => r.id === a.rhythm);
    if (!rhythm)
      throw new CapabilityError(
        "INVALID",
        `Unknown rhythm. Use ${[...FOCUS_RHYTHMS.map((r) => r.id), "open"].join(", ")}.`,
      );
    const item = a.task ? await seeItem(ctx, a.task) : null;
    const now = ctx.now;
    const ms = rhythm.work * 60_000;
    const current = await setFocus(db, actor, {
      state: {
        rhythm: rhythm.id,
        phase: "work",
        round: 1,
        ends_at: rhythm.work
          ? new Date(now.getTime() + ms).toISOString()
          : null,
        remaining_ms: ms,
        run_started_at: now.toISOString(),
        ran_ms: 0,
        item_id: item?.id ?? null,
        ...(item ? { item_title: item.title.slice(0, 200) } : {}),
      },
      device: ctx.principal.client.name.slice(0, 60),
    });
    return finishWrite(ctx, "The focus timer", {
      done: [
        {
          id: "focus:current",
          title: item ? cleanTitle(item.title) : "Focus timer",
          url: item
            ? refs({ type: "task", id: item.id }).url
            : `${appUrl()}/app/today`,
          version: null,
          change: `Started (${rhythm.label}${current.state.ends_at ? `, until ${both(current.state.ends_at, ctx.timezone)!.local}` : ""})`,
        },
      ],
    });
  },
});

// --- manage_routines ------------------------------------------------------

const ROUTINE_FIELDS =
  'frame: name, days (0-6, Sunday 0) or rrule, start_time, end_time ("HH:MM"), busy, filters; habit: name, cadence, period (day or week), duration_minutes, days, window_start, window_end, priority, active; place: label, match (text in an event\'s location), travel_minutes, mode, peak_minutes.';

export const manageRoutines = defineCapability({
  name: "manage_routines",
  title: "Frames, habits and places",
  description: `Up to 25 changes to the person's routines: add or change a frame (a part of the week kept for something), a habit or a place, or skip or unskip one date of a frame. Fields: ${ROUTINE_FIELDS} Deleting goes through propose_changes; habit sessions are previewed with plan_schedule.`,
  input: z
    .object({
      changes: z
        .array(
          z
            .object({
              do: z.enum(["add", "change", "skip_date", "unskip_date"]),
              kind: z.enum(["frame", "habit", "place"]),
              id: idField.optional(),
              date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .optional(),
              fields: z.record(z.string(), z.unknown()).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(MAX_BATCH),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "write",
  toolset: "planner",
  mode: "write",
  tier: "W1",
  async run(ctx, a) {
    personalOnly(ctx);
    const db = dbOf(ctx);
    const me = ctx.principal.user.id;
    const done: DoneEntry[] = [];
    for (const c of a.changes) {
      refuseSecrets(JSON.stringify(c.fields ?? {}));
      const f = c.fields ?? {};
      const need = () => {
        if (!c.id)
          throw new CapabilityError(
            "INVALID",
            `Changing a ${c.kind} needs its id.`,
          );
        return c.id;
      };
      if (c.kind === "frame") {
        if (c.do === "add") {
          const made = await createFrame(db, me, frameInput.parse(f));
          done.push(entryOf("frame", made.id, made.name, null, "Added"));
        } else if (c.do === "change") {
          const made = await updateFrame(db, me, need(), frameUpdate.parse(f));
          done.push(entryOf("frame", made.id, made.name, null, "Changed"));
        } else {
          if (!c.date)
            throw new CapabilityError("INVALID", "Name the date to skip.");
          const made = await skipFrame(
            db,
            me,
            need(),
            c.date,
            c.do === "skip_date",
          );
          done.push(
            entryOf(
              "frame",
              made.id,
              made.name,
              null,
              c.do === "skip_date" ? `Skipped ${c.date}` : `Back on ${c.date}`,
            ),
          );
        }
      } else if (c.kind === "habit") {
        if (c.do === "add") {
          const made = await createHabit(db, me, habitInput.parse(f));
          done.push(entryOf("habit", made.id, made.name, null, "Added"));
        } else if (c.do === "change") {
          const made = await updateHabit(db, me, need(), habitUpdate.parse(f));
          done.push(entryOf("habit", made.id, made.name, null, "Changed"));
        } else throw new CapabilityError("INVALID", "Only frames skip dates.");
      } else {
        if (c.do === "add") {
          const made = await createPlace(db, me, placeInput.parse(f));
          done.push(entryOf("place", made.id, made.label, null, "Added"));
        } else if (c.do === "change") {
          const made = await updatePlace(db, me, need(), placeUpdate.parse(f));
          done.push(entryOf("place", made.id, made.label, null, "Changed"));
        } else throw new CapabilityError("INVALID", "Only frames skip dates.");
      }
    }
    return finishWrite(ctx, "Routines", { done });
  },
});

// --- update_planner_settings -------------------------------------------

/** The settings an agent may change (not the time zone or digest emails). */
export const AGENT_PREFS = plannerPrefsInput.pick({
  work_days: true,
  work_start: true,
  work_end: true,
  horizon_days: true,
  pad_percent: true,
  split_after_minutes: true,
  min_block_minutes: true,
  break_level: true,
  buffer_before_minutes: true,
  buffer_after_minutes: true,
  adaptive_buffers: true,
  default_travel_minutes: true,
  deadline_notice_days: true,
  learn_estimates: true,
  learn_rhythm: true,
  balance_load: true,
});

export const updatePlannerSettings = defineCapability({
  name: "update_planner_settings",
  title: "Change planner settings",
  description:
    'Changes working days and hours ("HH:MM"), the planning horizon, padding, splitting, minimum session length, breaks, buffers, default travel time, deadline notices and the learning switches. The time zone and digest emails stay in the app. Undo puts the old values back.',
  input: z
    .object({ settings: AGENT_PREFS, client_ref: clientRefInput })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "write",
  toolset: "planner",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    personalOnly(ctx);
    const db = dbOf(ctx);
    const me = ctx.principal.user.id;
    const keys = Object.keys(a.settings) as (keyof typeof a.settings)[];
    if (!keys.length)
      throw new CapabilityError("INVALID", "Name a setting to change.");
    const before = await loadPrefs(db, me);
    const old: Record<string, unknown> = {};
    for (const k of keys) old[k] = (before as Record<string, unknown>)[k];
    await savePrefs(db, me, a.settings);
    const undo: UndoOp[] = [{ op: "prefs.restore", fields: old }];
    return finishWrite(ctx, "Planner settings", {
      done: [
        {
          id: "settings:planner",
          title: "Planner settings",
          url: `${appUrl()}/app`,
          version: null,
          change: `Changed ${keys.join(", ")}`,
        },
      ],
      undo,
    });
  },
});
