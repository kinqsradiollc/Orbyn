import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Does it fit, and only time before the deadline counts: one status per
 * task, sessions after the deadline never count as planned (so they can't
 * silence the at-risk, due-soon and roll-forward warnings), the planner
 * offers to move them before the deadline (its own ticked, yours unticked),
 * applying re-checks every moved session, plans may hold only moves, and a
 * session moved by hand is warned about but never refused.
 */
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { schedule } = await import("../src/modules/planner/scheduler.js");
const { candidateTasks, unfinishedBlocks, atRiskFor } =
  await import("../src/modules/planner/plans.js");
const { scanPlanningNotices } = await import("../src/worker/planning.js");
const {
  addDays,
  atRiskLine,
  atRiskReason,
  dayTime,
  deadlineFit,
  fitChipShown,
  fitTone,
  lateSessionWarning,
  localDateKey,
  moveLine,
  moveTimes,
  planOutcome,
  remainingOf,
  sessionKindFor,
  shortMinutes,
  splitSessions,
} = await import("@orbyn/core");
const app = await buildApp();

const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.71.${Math.floor(++caller / 250)}.${caller % 250}`;

type Json = Record<string, any>;
async function call(
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  from = address(),
) {
  const r = await app.inject({
    method,
    url,
    remoteAddress: from,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as Json }),
  });
  let body: any = null;
  try {
    body = r.body ? JSON.parse(r.body) : null;
  } catch {
    body = r.body;
  }
  return { status: r.statusCode, body, raw: r };
}

/** A request whose body isn't JSON at all. */
const malformed = (token: string, url: string) =>
  app
    .inject({
      method: "POST",
      url,
      remoteAddress: address(),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: "{",
    })
    .then((r) => ({ status: r.statusCode }));

async function newUser() {
  const r = await call(null, "POST", "/auth/register", {
    email: `fit-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name: "Planner",
  });
  assert.equal(r.status, 201, r.raw.body);
  const token = r.body.token as string;
  const prefs = await call(token, "PUT", "/planner/prefs", {
    timezone: TZ,
    work_days: [0, 1, 2, 3, 4, 5, 6],
    work_start: "09:00",
    work_end: "17:00",
    deadline_notice_days: 1,
  });
  assert.equal(prefs.status, 200, prefs.raw.body);
  return { token, id: r.body.user.id as string };
}

/** A Melbourne wall-clock time on the day `offset` days from today. */
const local = (offset: number, hour: number, minute = 0) =>
  dayTime(
    addDays(localDateKey(new Date(), TZ), offset),
    hour * 60 + minute,
    TZ,
  ).toISOString();
const day = (offset: number) => addDays(localDateKey(new Date(), TZ), offset);
const plus = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

async function newTask(token: string, data: Json) {
  const r = await call(token, "POST", "/items", { kind: "task", ...data });
  assert.equal(r.status, 201, r.raw.body);
  return r.body as Json;
}

/** A session, as the planner or you would have placed it. */
async function session(
  userId: string,
  itemId: string,
  start: string,
  minutes = 60,
  source: "manual" | "planner" = "manual",
) {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO time_blocks (item_id, user_id, start_at, end_at, source)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [itemId, userId, start, plus(start, minutes), source],
    )
  ).rows[0].id;
}

async function blockTimes(id: string) {
  const row = (
    await pool.query<{ start_at: Date; end_at: Date; source: string }>(
      "SELECT start_at, end_at, source FROM time_blocks WHERE id = $1",
      [id],
    )
  ).rows[0];
  return {
    start_at: row.start_at.toISOString(),
    end_at: row.end_at.toISOString(),
    source: row.source,
  };
}

/** A plan for these tasks over two days from the day after tomorrow. */
async function preview(token: string, itemIds: string[], days = 2) {
  const r = await call(token, "POST", "/planner/preview", {
    start_date: day(2),
    days,
    timezone: TZ,
    item_ids: itemIds,
  });
  assert.equal(r.status, 200, r.raw.body);
  return r.body as Json;
}

before(async () => {
  await migrate();
});

after(async () => {
  await app.close();
  await pool.end();
});

// ---- the rule, in core ---------------------------------------------------------

const NOW = new Date("2026-09-28T00:00:00Z");
const at = (days: number, hours = 0) =>
  new Date(NOW.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString();

test("one status per task: on track, short, late session, nothing planned, at risk, passed, none", () => {
  const fit = (x: Partial<Parameters<typeof deadlineFit>[0]>) =>
    deadlineFit({
      deadline_at: at(3),
      needed_minutes: 180,
      planned_minutes: 0,
      estimated: true,
      now: NOW,
      ...x,
    });
  assert.equal(fit({ planned_minutes: 180 }).status, "on_track");
  assert.equal(fit({ planned_minutes: 180 }).label, "On track");
  const short = fit({ planned_minutes: 60 });
  assert.equal(short.status, "short");
  assert.equal(short.label, "Short 2h");
  assert.equal(short.short_minutes, 120);
  assert.equal(
    fit({ planned_minutes: 60, late_minutes: 120 }).status,
    "late_session",
  );
  assert.equal(
    fit({ planned_minutes: 60, late_minutes: 120 }).label,
    "Session after the deadline",
  );
  assert.equal(fit({}).status, "unplanned");
  assert.equal(fit({}).label, "Nothing planned");
  // Not enough free time before the deadline for what's missing.
  const risk = fit({
    planned_minutes: 60,
    late_minutes: 120,
    free_minutes: 45,
  });
  assert.equal(risk.status, "at_risk");
  assert.equal(risk.label, "At risk");
  assert.equal(risk.free_minutes, 45);
  assert.equal(fit({ deadline_at: at(-1) }).status, "overdue");
  assert.equal(fit({ deadline_at: at(-1) }).label, "Deadline passed");
  assert.equal(fit({ deadline_at: null }).status, "no_deadline");
  // "Still needed" is the estimate minus the time logged; nothing left is on track.
  assert.equal(fit({ needed_minutes: 0 }).status, "on_track");
});

test("'Short' needs an estimate or a deadline within a week (30 minutes is a guess)", () => {
  const far = (planned: number) =>
    deadlineFit({
      deadline_at: at(10),
      needed_minutes: 30,
      planned_minutes: planned,
      estimated: false,
      now: NOW,
    });
  assert.equal(far(15).status, "on_track");
  assert.equal(far(0).status, "unplanned");
  const soon = deadlineFit({
    deadline_at: at(3),
    needed_minutes: 30,
    planned_minutes: 15,
    estimated: false,
    now: NOW,
  });
  assert.equal(soon.status, "short");
  assert.equal(soon.label, "Short 15m");
  const estimated = deadlineFit({
    deadline_at: at(10),
    needed_minutes: 90,
    planned_minutes: 30,
    estimated: true,
    now: NOW,
  });
  assert.equal(estimated.label, "Short 1h");
});

test("chips show within a week of the deadline, or when a session falls after it", () => {
  const base = {
    needed_minutes: 60,
    planned_minutes: 0,
    estimated: true,
    now: NOW,
  };
  assert.equal(
    fitChipShown(deadlineFit({ ...base, deadline_at: at(3) }), NOW),
    true,
  );
  assert.equal(
    fitChipShown(deadlineFit({ ...base, deadline_at: at(10) }), NOW),
    false,
  );
  assert.equal(
    fitChipShown(
      deadlineFit({ ...base, deadline_at: at(10), late_minutes: 60 }),
      NOW,
    ),
    true,
  );
  assert.equal(
    fitChipShown(
      deadlineFit({ ...base, deadline_at: at(3), planned_minutes: 60 }),
      NOW,
    ),
    false,
  );
  assert.equal(fitTone("on_track"), "ok");
  assert.equal(fitTone("late_session"), "warn");
  assert.equal(fitTone("no_deadline"), "muted");
});

test("only time that ends by the deadline counts, and past it sessions are catch-up", () => {
  const task = { due_at: at(3), end_at: null, all_day: false, timezone: "UTC" };
  const sessions = [
    { id: "past", start_at: at(-1), end_at: at(-1, 1) },
    { id: "before", start_at: at(1), end_at: at(1, 1) },
    { id: "late", start_at: at(4), end_at: at(4, 2) },
    { id: "straddles", start_at: at(3, -0.5), end_at: at(3, 0.5) },
  ];
  const split = splitSessions(task, sessions, NOW);
  assert.equal(split.planned_minutes, 60);
  assert.equal(split.late_minutes, 180);
  assert.deepEqual(
    split.late.map((s) => s.id),
    ["straddles", "late"],
  );
  assert.equal(split.catch_up, false);
  // Once the deadline has passed, whatever comes next is catching up.
  const later = new Date(Date.parse(at(3, 1)));
  const caught = splitSessions(task, sessions, later);
  assert.equal(caught.catch_up, true);
  assert.equal(caught.planned_minutes, 120);
  assert.equal(caught.late_minutes, 0);
  // No deadline: everything still to come counts.
  assert.equal(
    splitSessions({ ...task, due_at: null }, sessions, NOW).planned_minutes,
    240,
  );
});

test("a repeating task's session after this occurrence's deadline counts toward the next", () => {
  const task = {
    due_at: "2026-09-30T07:00:00.000Z",
    end_at: null,
    all_day: false,
    timezone: "UTC",
    rrule: "FREQ=WEEKLY",
  };
  const kind = sessionKindFor(task, NOW);
  assert.equal(kind({ end_at: "2026-09-29T10:00:00.000Z" }), "planned");
  // Next week's occurrence: neither planned for this one nor late.
  assert.equal(kind({ end_at: "2026-10-02T10:00:00.000Z" }), "other");
  const split = splitSessions(
    task,
    [
      {
        start_at: "2026-10-02T09:00:00.000Z",
        end_at: "2026-10-02T10:00:00.000Z",
      },
    ],
    NOW,
  );
  assert.equal(split.planned_minutes, 0);
  assert.equal(split.late_minutes, 0);
  // A series that has ended: a session after its last occurrence is late.
  const ended = sessionKindFor({ ...task, rrule: "FREQ=WEEKLY;COUNT=1" }, NOW);
  assert.equal(ended({ end_at: "2026-10-02T10:00:00.000Z" }), "late");
});

test("a parent adds up its subtasks; words for the planner", () => {
  assert.equal(
    remainingOf({
      estimate_minutes: null,
      spent_minutes: 0,
      open_children: 2,
      children_remaining: 90,
    }),
    0,
  );
  assert.equal(
    remainingOf({
      estimate_minutes: 240,
      spent_minutes: 30,
      open_children: 2,
      children_remaining: 90,
    }),
    120,
  );
  assert.equal(remainingOf({ estimate_minutes: null, spent_minutes: 0 }), 30);
  assert.equal(shortMinutes(90), "1h 30m");
  assert.equal(shortMinutes(45), "45m");
  assert.equal(shortMinutes(120), "2h");
  assert.equal(
    atRiskReason(120, 45),
    "Needs 2 h more, with 45 min free before it's due.",
  );
  assert.equal(
    atRiskReason(60, 90),
    "Its sessions don't all fit in the free time before it's due.",
  );
  assert.match(
    atRiskLine({
      remaining_minutes: 120,
      free_minutes: 45,
      deadline_at: at(3),
    })!,
    /^needs 2h, 45m free before /,
  );
  assert.equal(atRiskLine({ remaining_minutes: null, free_minutes: 3 }), null);
  const planner = moveLine({
    title: "Quarterly report",
    from_start_at: at(5),
    start_at: at(2),
    source: "planner",
  });
  assert.match(planner, /^Quarterly report: .+ → .+ \(made by the planner\)$/);
  const yours = moveLine({
    title: "Slides",
    from_start_at: at(5),
    start_at: at(2),
    source: "manual",
  });
  assert.match(yours, /^Slides: your .+ session → .+\?$/);
  // The times alone, as a task's Sessions card lists a move.
  const times = moveTimes({ from_start_at: at(5), start_at: at(2) });
  assert.equal(times.split(" → ").length, 2);
  assert.ok(planner.endsWith(`${times} (made by the planner)`));
});

test("the plan result says what it did and what didn't fit", () => {
  const now = new Date();
  const today = new Date(now);
  today.setHours(10, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const block = (id: string, when: Date) => ({
    item_id: id,
    start_at: when.toISOString(),
  });
  const text = planOutcome(
    {
      blocks: [
        block("a", today),
        block("a", tomorrow),
        block("b", today),
        block("c", today),
        block("d", tomorrow),
        block("e", tomorrow),
      ],
      moved: [{}],
      skipped: 0,
    },
    [{ title: "Budget review", remaining_minutes: 120, free_minutes: 45 }],
    now,
  );
  assert.equal(
    text,
    "Planned 5 tasks: 3 today, 2 tomorrow · Moved 1 session before its deadline · Couldn't fit before the deadline: Budget review (needs 2h, 45m free).",
  );
  assert.equal(
    planOutcome({ blocks: [], moved: [{}, {}], skipped: 0 }, [], now),
    "Moved 2 sessions before their deadlines.",
  );
  assert.equal(
    planOutcome({ blocks: [block("a", today)], skipped: 1 }, [], now),
    "Planned 1 task today · 1 session left out because something else is there now.",
  );
  assert.equal(
    planOutcome({ blocks: [], moved: [], skipped: 0 }, [], now),
    "Nothing changed on your calendar.",
  );
});

test("moving a session by hand past the deadline warns, never refuses", () => {
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const text = lateSessionWarning({
    end_at: soon,
    after_deadline: true,
    deadline_at: soon,
  });
  assert.match(text!, /^This session ends after the deadline \(.+\)$/);
  assert.equal(
    lateSessionWarning({
      end_at: soon,
      after_deadline: false,
      deadline_at: soon,
    }),
    null,
  );
  // Past the deadline it's catch-up time: nothing to warn about.
  const passed = new Date(Date.now() - 86_400_000).toISOString();
  assert.equal(
    lateSessionWarning({
      end_at: soon,
      after_deadline: true,
      deadline_at: passed,
    }),
    null,
  );
});

// ---- the scheduler ------------------------------------------------------------

const baseInput = {
  busy: [],
  frames: [],
  useFrames: false,
  days: ["2026-09-28", "2026-09-29", "2026-09-30"],
  timezone: "UTC",
  workDays: [0, 1, 2, 3, 4, 5, 6],
  workStart: "09:00",
  workEnd: "17:00",
  padPercent: 0,
  split: true,
  splitAfterMinutes: 120,
  minBlockMinutes: 15,
  breakLevel: "none" as const,
  now: new Date("2026-09-28T08:00:00Z"),
};
const schedTask = (x: Json) => ({
  id: "t",
  title: "Quarterly report",
  priority: "medium" as const,
  status: "todo" as const,
  due_at: "2026-09-29T17:00:00.000Z",
  deadline_at: "2026-09-29T17:00:00.000Z",
  estimate_minutes: 60,
  spent_minutes: 0,
  scheduled_minutes: 0,
  list_id: null,
  tag_ids: [],
  team_id: null,
  ...x,
});

test("the scheduler moves a late session before the deadline instead of adding time", () => {
  const r = schedule({
    ...baseInput,
    tasks: [
      schedTask({
        late_sessions: [
          {
            id: "late-1",
            start_at: "2026-10-03T10:00:00.000Z",
            end_at: "2026-10-03T11:00:00.000Z",
            source: "planner",
          },
        ],
      }),
    ],
  });
  assert.equal(r.blocks.length, 0);
  assert.equal(r.moves?.length, 1);
  const m = r.moves![0];
  assert.equal(m.block_id, "late-1");
  assert.equal(m.source, "planner");
  assert.equal(m.from_start_at, "2026-10-03T10:00:00.000Z");
  assert.equal(Date.parse(m.end_at) - Date.parse(m.start_at), 3_600_000);
  assert.ok(m.end_at <= "2026-09-29T17:00:00.000Z");
  assert.equal(r.at_risk.length, 0);
  // A late session larger than what's missing still moves whole; only the
  // rest of what's needed becomes new time.
  const more = schedule({
    ...baseInput,
    tasks: [
      schedTask({
        estimate_minutes: 150,
        late_sessions: [
          {
            id: "late-1",
            start_at: "2026-10-03T10:00:00.000Z",
            end_at: "2026-10-03T11:00:00.000Z",
            source: "manual",
          },
        ],
      }),
    ],
  });
  assert.equal(more.moves?.length, 1);
  assert.equal(more.moves![0].source, "manual");
  assert.equal(
    more.blocks.reduce(
      (n, b) => n + (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000,
      0,
    ),
    90,
  );
});

test("a late session that can't fit before the deadline stays, and the task is at risk", () => {
  const r = schedule({
    ...baseInput,
    // Everything before the deadline is taken but for 45 minutes.
    busy: [
      {
        start_at: "2026-09-28T09:00:00.000Z",
        end_at: "2026-09-28T17:00:00.000Z",
      },
      {
        start_at: "2026-09-29T09:45:00.000Z",
        end_at: "2026-09-29T17:00:00.000Z",
      },
    ],
    tasks: [
      schedTask({
        estimate_minutes: 120,
        late_sessions: [
          {
            id: "late-1",
            start_at: "2026-10-03T10:00:00.000Z",
            end_at: "2026-10-03T12:00:00.000Z",
            source: "planner",
          },
        ],
      }),
    ],
  });
  assert.equal(r.moves?.length, 0);
  assert.equal(r.at_risk.length, 1);
  assert.equal(r.at_risk[0].remaining_minutes, 120);
  assert.equal(r.at_risk[0].free_minutes, 45);
  assert.equal(
    r.at_risk[0].reason,
    "Needs 2 h more, with 45 min free before it's due.",
  );
  // The late session that stays holds its time: none is added on top.
  assert.equal(r.blocks.length, 0);
  // It holds only its own length: the rest is still added.
  const more = schedule({
    ...baseInput,
    busy: [
      {
        start_at: "2026-09-28T09:00:00.000Z",
        end_at: "2026-09-28T17:00:00.000Z",
      },
      {
        start_at: "2026-09-29T09:45:00.000Z",
        end_at: "2026-09-29T17:00:00.000Z",
      },
    ],
    splitAfterMinutes: 90,
    tasks: [
      schedTask({
        estimate_minutes: 180,
        late_minutes: 120,
        late_sessions: [
          {
            id: "late-1",
            start_at: "2026-10-03T10:00:00.000Z",
            end_at: "2026-10-03T12:00:00.000Z",
            source: "planner",
          },
        ],
      }),
    ],
  });
  assert.equal(more.moves?.length, 0);
  assert.equal(
    more.blocks.reduce(
      (n, b) => n + (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000,
      0,
    ),
    60,
  );
  assert.equal(more.at_risk.length, 1);
  assert.equal(more.at_risk[0].remaining_minutes, 180);
});

test("past the deadline, time found is catch-up: nothing moves, nothing is flagged", () => {
  const r = schedule({
    ...baseInput,
    tasks: [
      schedTask({
        due_at: "2026-09-27T17:00:00.000Z",
        deadline_at: "2026-09-27T17:00:00.000Z",
        late_sessions: [
          {
            id: "late-1",
            start_at: "2026-10-03T10:00:00.000Z",
            end_at: "2026-10-03T11:00:00.000Z",
            source: "planner",
          },
        ],
      }),
    ],
  });
  assert.equal(r.moves?.length, 0);
  assert.equal(r.at_risk.length, 0);
  assert.equal(r.blocks.length, 1);
});

// ---- plans: preview, moves and apply ------------------------------------------

test("a plan offers to move late sessions: the planner's ticked, yours unticked", async () => {
  const me = await newUser();
  const report = await newTask(me.token, {
    title: "Quarterly report",
    due_at: local(3, 17),
    estimate_minutes: 60,
  });
  const slides = await newTask(me.token, {
    title: "Slides",
    due_at: local(3, 12),
    estimate_minutes: 60,
  });
  const made = await session(me.id, report.id, local(4, 10), 60, "planner");
  const yours = await session(me.id, slides.id, local(5, 11), 60, "manual");

  const plan = await preview(me.token, [report.id, slides.id]);
  const moves = plan.moves as Json[];
  assert.equal(moves.length, 2, plan.summary);
  const of = (id: string) => moves.find((m) => m.block_id === id)!;
  assert.equal(of(made).selected, true);
  assert.equal(of(made).source, "planner");
  assert.equal(of(made).from_start_at, local(4, 10));
  assert.equal(of(made).deadline_at, local(3, 17));
  assert.ok(Date.parse(of(made).end_at) <= Date.parse(local(3, 17)));
  assert.ok(Date.parse(of(made).start_at) >= Date.parse(local(2, 9)));
  assert.equal(of(yours).selected, false);
  assert.equal(of(yours).source, "manual");
  assert.ok(Date.parse(of(yours).end_at) <= Date.parse(local(3, 12)));
  // The moves cover what's needed: no new time on top of them.
  assert.equal(plan.blocks.length, 0);
  assert.match(
    plan.summary,
    /2 sessions after their deadlines can move before them/,
  );
  // Each task says whether it fits as proposed.
  const task = (id: string) =>
    (plan.tasks as Json[]).find((t) => t.item_id === id)!;
  assert.equal(task(report.id).fit.status, "on_track");
  assert.equal(task(report.id).moved_minutes, 60);
  assert.equal(task(report.id).reason, null);
  assert.equal(task(slides.id).fit.status, "late_session");
  // Reading the plan back keeps its moves.
  const again = await call(me.token, "GET", `/planner/plans/${plan.id}`);
  assert.equal(again.status, 200);
  assert.equal((again.body.moves as Json[]).length, 2);

  // A plan of moves alone applies: the ticked one moves, yours stays.
  const applied = await call(
    me.token,
    "POST",
    `/planner/plans/${plan.id}/apply`,
  );
  assert.equal(applied.status, 200, applied.raw.body);
  assert.equal(applied.body.blocks.length, 0);
  assert.equal(applied.body.skipped, 0);
  assert.equal(applied.body.moves_skipped, 0);
  assert.deepEqual(
    (applied.body.moved as Json[]).map((b) => b.id),
    [made],
  );
  assert.equal(applied.body.moved[0].after_deadline, false);
  assert.equal((await blockTimes(made)).start_at, of(made).start_at);
  assert.equal((await blockTimes(yours)).start_at, local(5, 11));
});

test("apply moves the sessions named, and re-checks each one", async () => {
  const me = await newUser();
  const report = await newTask(me.token, {
    title: "Budget",
    due_at: local(3, 17),
    estimate_minutes: 60,
  });
  const notes = await newTask(me.token, {
    title: "Notes",
    due_at: local(3, 17),
    estimate_minutes: 30,
  });
  const made = await session(me.id, report.id, local(4, 10), 60, "planner");
  const yours = await session(me.id, notes.id, local(4, 14), 30, "manual");
  const plan = await preview(me.token, [report.id, notes.id]);
  assert.equal((plan.moves as Json[]).length, 2);

  // Moved by hand since the plan was made: that move is left out.
  const byHand = await call(me.token, "PUT", `/blocks/${made}`, {
    start_at: local(6, 9),
    end_at: local(6, 10),
  });
  assert.equal(byHand.status, 200, byHand.raw.body);
  const applied = await call(
    me.token,
    "POST",
    `/planner/plans/${plan.id}/apply`,
    { moves: [made, yours] },
  );
  assert.equal(applied.status, 200, applied.raw.body);
  assert.equal(applied.body.moves_skipped, 1);
  assert.deepEqual(
    (applied.body.moved as Json[]).map((b) => b.id),
    [yours],
  );
  assert.equal((await blockTimes(made)).start_at, local(6, 9));
  assert.ok(
    Date.parse((await blockTimes(yours)).end_at) <= Date.parse(local(3, 17)),
  );
  // Moved by hand, so it's yours now: a new plan offers it unticked.
  assert.equal((await blockTimes(made)).source, "manual");
  const next = await preview(me.token, [report.id]);
  const offer = (next.moves as Json[]).find((m) => m.block_id === made)!;
  assert.equal(offer.selected, false);
  assert.equal(offer.source, "manual");

  // Applying twice is refused.
  const twice = await call(me.token, "POST", `/planner/plans/${plan.id}/apply`);
  assert.equal(twice.status, 409);
});

test("apply: an empty tick list moves nothing, a gone session is skipped", async () => {
  const me = await newUser();
  const t = await newTask(me.token, {
    title: "Proposal",
    due_at: local(3, 17),
    estimate_minutes: 60,
  });
  const made = await session(me.id, t.id, local(4, 10), 60, "planner");
  const plan = await preview(me.token, [t.id]);
  // Moves only, none ticked: nothing to do.
  const none = await call(me.token, "POST", `/planner/plans/${plan.id}/apply`, {
    moves: [],
  });
  assert.equal(none.status, 409, none.raw.body);
  // The session is deleted before the plan is applied.
  await call(me.token, "DELETE", `/blocks/${made}`);
  const gone = await call(me.token, "POST", `/planner/plans/${plan.id}/apply`);
  assert.equal(gone.status, 200, gone.raw.body);
  assert.equal(gone.body.moved.length, 0);
  assert.equal(gone.body.moves_skipped, 1);
});

test("apply guards: 401, 404 for someone else's plan, 422 for a bad body or a move not offered, 400 for broken JSON", async () => {
  const me = await newUser();
  const other = await newUser();
  const t = await newTask(me.token, {
    title: "Guarded",
    due_at: local(3, 17),
    estimate_minutes: 60,
  });
  await session(me.id, t.id, local(4, 10), 60, "planner");
  const plan = await preview(me.token, [t.id]);
  const url = `/planner/plans/${plan.id}/apply`;
  assert.equal((await call(null, "POST", url)).status, 401);
  assert.equal((await call(other.token, "POST", url)).status, 404);
  assert.equal(
    (await call(me.token, "POST", url, { moves: "all" })).status,
    422,
  );
  assert.equal(
    (await call(me.token, "POST", url, { extra: true })).status,
    422,
  );
  assert.equal(
    (await call(me.token, "POST", url, { moves: ["not-a-uuid"] })).status,
    422,
  );
  assert.equal((await malformed(me.token, url)).status, 400);
  const unknown = await call(me.token, "POST", url, { moves: [randomUUID()] });
  assert.equal(unknown.status, 422);
  assert.match(
    unknown.body.error ?? unknown.raw.body,
    /moves this plan offers/,
  );
  // Still applies after the refusals (nothing was saved).
  assert.equal((await call(me.token, "POST", url)).status, 200);
});

test("apply is rate limited like everything else", async () => {
  const me = await newUser();
  const from = "10.72.0.1";
  const url = `/planner/plans/${randomUUID()}/apply`;
  const first = await call(me.token, "POST", url, undefined, from);
  assert.equal(first.status, 404);
  const limit = Number(first.raw.headers["ratelimit-limit"]);
  assert.ok(limit > 0);
  let last = first;
  for (let i = 0; i < limit && last.status !== 429; i++)
    last = await call(me.token, "POST", url, undefined, from);
  assert.equal(last.status, 429);
});

test("a plan says 'at risk' in the same words, with the minutes", async () => {
  const me = await newUser();
  const t = await newTask(me.token, {
    title: "Budget review",
    due_at: local(2, 12),
    estimate_minutes: 300,
  });
  const plan = await preview(me.token, [t.id], 1);
  const risk = (plan.at_risk as Json[]).find((a) => a.item_id === t.id)!;
  assert.ok(risk, plan.summary);
  assert.equal(risk.remaining_minutes, 300);
  assert.equal(risk.free_minutes, 180);
  assert.equal(risk.reason, "Needs 5 h more, with 3 h free before it's due.");
  assert.equal(risk.deadline_at, local(2, 12));
  const row = (plan.tasks as Json[]).find((x) => x.item_id === t.id)!;
  assert.equal(row.at_risk, true);
  assert.equal(row.fit.status, "at_risk");
});

test("planning again doesn't add late time twice for a task at risk", async () => {
  const me = await newUser();
  const t = await newTask(me.token, {
    title: "Budget review",
    due_at: local(2, 12),
    estimate_minutes: 480,
  });
  // Three hours before the deadline: the rest goes after it, and it's at risk.
  const first = await preview(me.token, [t.id], 2);
  const minutesOf = (plan: Json) =>
    (plan.blocks as Json[])
      .filter((b) => b.item_id === t.id)
      .reduce(
        (n, b) => n + (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000,
        0,
      );
  assert.ok(minutesOf(first) >= 480, first.summary);
  assert.ok((first.at_risk as Json[]).some((a) => a.item_id === t.id));
  const applied = await call(
    me.token,
    "POST",
    `/planner/plans/${first.id}/apply`,
  );
  assert.equal(applied.status, 200, applied.raw.body);

  // Its sessions after the deadline can't move before it, and they already
  // hold the time: a new plan adds none, and still says it's at risk.
  const again = await preview(me.token, [t.id], 2);
  assert.equal(minutesOf(again), 0, again.summary);
  assert.equal(
    again.summary,
    "No more time fits before the deadlines. 1 task may run late.",
  );
  assert.equal((again.moves as Json[]).length, 0);
  const risk = (again.at_risk as Json[]).find((a) => a.item_id === t.id)!;
  assert.ok(risk, again.summary);
  assert.equal(
    risk.remaining_minutes,
    480 - again.tasks[0].fit.planned_minutes,
  );
  assert.ok(risk.free_minutes < 60, risk.reason);
  assert.equal(again.tasks[0].fit.status, "at_risk");
  // Its Sessions card counts the late time as late, never as planned (and
  // with tomorrow still free there, it says "Session after the deadline").
  const sessions = await call(me.token, "GET", `/items/${t.id}/sessions`);
  assert.equal(sessions.body.fit.late_minutes, again.tasks[0].fit.late_minutes);
  assert.equal(sessions.body.fit.status, "late_session");
});

test("a repeating task: next week's session isn't this week's, and isn't offered to move", async () => {
  const me = await newUser();
  const t = await newTask(me.token, {
    title: "Weekly report",
    due_at: local(3, 17),
    rrule: "FREQ=WEEKLY",
    timezone: TZ,
    estimate_minutes: 60,
  });
  await session(me.id, t.id, local(5, 10));
  const plan = await preview(me.token, [t.id]);
  assert.equal((plan.moves as Json[]).length, 0);
  const mine = (plan.blocks as Json[]).filter((b) => b.item_id === t.id);
  assert.ok(mine.length > 0, plan.summary);
  for (const b of mine)
    assert.ok(Date.parse(b.end_at) <= Date.parse(local(3, 17)));
  const sessions = await call(me.token, "GET", `/items/${t.id}/sessions`);
  assert.equal(sessions.status, 200);
  assert.equal(sessions.body.fit.status, "unplanned");
});

// ---- a task's status on its Sessions card -------------------------------------

test("a task's sessions carry its status; a late session doesn't count", async () => {
  const me = await newUser();
  const t = await newTask(me.token, {
    title: "Quarterly report",
    due_at: local(3, 17),
    estimate_minutes: 120,
  });
  await session(me.id, t.id, local(2, 10), 60);
  const late = await session(me.id, t.id, local(4, 10), 60);
  const r = await call(me.token, "GET", `/items/${t.id}/sessions`);
  assert.equal(r.status, 200, r.raw.body);
  assert.equal(r.body.fit.status, "late_session");
  assert.equal(r.body.fit.label, "Session after the deadline");
  assert.equal(r.body.fit.planned_minutes, 60);
  assert.equal(r.body.fit.late_minutes, 60);
  assert.equal(r.body.fit.needed_minutes, 120);
  assert.equal(r.body.fit.deadline_at, local(3, 17));
  // Moved before the deadline, it fits.
  const moved = await call(me.token, "POST", `/blocks/${late}/reschedule`, {
    before_deadline: true,
  });
  assert.equal(moved.status, 200, moved.raw.body);
  const after = await call(me.token, "GET", `/items/${t.id}/sessions`);
  assert.equal(after.body.fit.status, "on_track");
  // A finished task has no status.
  await pool.query("UPDATE items SET status = 'done' WHERE id = $1", [t.id]);
  const finished = await call(me.token, "GET", `/items/${t.id}/sessions`);
  assert.equal(finished.body.fit, null);
  assert.equal(
    (await call(null, "GET", `/items/${t.id}/sessions`)).status,
    401,
  );
});

// ---- moving a session by hand --------------------------------------------------

test("'Move to next free time' can insist on time before the deadline", async () => {
  const me = await newUser();
  const other = await newUser();
  const t = await newTask(me.token, {
    title: "Slides",
    due_at: local(3, 17),
    estimate_minutes: 60,
  });
  const late = await session(me.id, t.id, local(4, 10), 60);
  const moved = await call(me.token, "POST", `/blocks/${late}/reschedule`, {
    before_deadline: true,
  });
  assert.equal(moved.status, 200, moved.raw.body);
  assert.equal(moved.body.after_deadline, false);
  assert.ok(Date.parse(moved.body.end_at) <= Date.parse(local(3, 17)));
  // The plain move also prefers a time before the deadline.
  const again = await call(me.token, "POST", `/blocks/${late}/reschedule`);
  assert.equal(again.status, 200, again.raw.body);
  assert.equal(again.body.after_deadline, false);

  // Too long to fit in any working day before it: refused only when asked.
  const big = await newTask(me.token, {
    title: "Stocktake",
    due_at: local(2, 17),
  });
  const long = await session(me.id, big.id, local(4, 9), 600);
  const none = await call(me.token, "POST", `/blocks/${long}/reschedule`, {
    before_deadline: true,
  });
  assert.equal(none.status, 409);
  assert.match(none.body.error ?? none.raw.body, /before the deadline/);
  // Its deadline has passed: there's no "before" to find.
  const past = await newTask(me.token, {
    title: "Late already",
    due_at: local(-1, 17),
  });
  const catchUp = await session(me.id, past.id, local(4, 12), 30);
  const passed = await call(me.token, "POST", `/blocks/${catchUp}/reschedule`, {
    before_deadline: true,
  });
  assert.equal(passed.status, 409);
  assert.equal(
    (
      await call(me.token, "POST", `/blocks/${late}/reschedule`, {
        before_deadline: "yes",
      })
    ).status,
    422,
  );
  assert.equal(
    (await malformed(me.token, `/blocks/${late}/reschedule`)).status,
    400,
  );
  assert.equal(
    (await call(null, "POST", `/blocks/${late}/reschedule`)).status,
    401,
  );
  assert.equal(
    (await call(other.token, "POST", `/blocks/${late}/reschedule`)).status,
    404,
  );
});

// ---- warnings: at risk, due soon, roll forward ---------------------------------

test("a session after the deadline doesn't silence the at-risk or due-soon notices", async () => {
  const me = await newUser();
  // Due at noon on day 2; its only session is the day after.
  const big = await newTask(me.token, {
    title: "Board pack",
    due_at: local(2, 12),
    estimate_minutes: 240,
  });
  await session(me.id, big.id, local(3, 9), 240);
  // Due at 4 pm on day 2, with its session after that.
  const late = await newTask(me.token, {
    title: "Expenses",
    due_at: local(2, 16),
    estimate_minutes: 30,
  });
  await session(me.id, late.id, local(3, 10), 30);
  // Half planned before the deadline.
  const half = await newTask(me.token, {
    title: "Minutes",
    due_at: local(2, 16),
    estimate_minutes: 120,
  });
  await session(me.id, half.id, local(2, 11), 60);
  // Planned before the deadline: nothing to say.
  const fine = await newTask(me.token, {
    title: "Covered",
    due_at: local(2, 16),
    estimate_minutes: 30,
  });
  await session(me.id, fine.id, local(2, 13), 30);

  const now = new Date(local(2, 10));
  const risks = await atRiskFor(pool, me.id, now);
  assert.deepEqual(
    risks.map((r) => r.item_id),
    [big.id],
  );
  assert.equal(risks[0].remaining_minutes, 240);
  assert.equal(risks[0].free_minutes, 120);

  await scanPlanningNotices(now, [me.id]);
  const notices = (await call(me.token, "GET", "/notifications"))
    .body as Json[];
  const of = (kind: string, id: string) =>
    notices.find((n) => n.kind === kind && n.item_id === id);
  assert.ok(of("at_risk", big.id));
  assert.match(
    of("at_risk", big.id)!.body,
    /^Needs 4 h more, with 2 h free before it's due\./,
  );
  assert.match(
    of("deadline", late.id)!.body,
    /^"Expenses" is due .+, but its session ends after the deadline\. Plan it\?$/,
  );
  assert.match(
    of("deadline", half.id)!.body,
    /^"Minutes" is due .+, and 1 h of it isn't planned before then\. Plan it\?$/,
  );
  assert.equal(of("deadline", fine.id), undefined);
  assert.equal(of("deadline", big.id), undefined);
});

test("roll forward: a late session doesn't keep work back, catch-up time does", async () => {
  const me = await newUser();
  // A later session after its deadline: still rolls forward.
  const lateOne = await newTask(me.token, {
    title: "Late one",
    due_at: local(5, 17),
    estimate_minutes: 60,
  });
  await session(me.id, lateOne.id, local(2, 9));
  await session(me.id, lateOne.id, local(6, 9));
  // A later session before its deadline: planned, so it doesn't.
  const planned = await newTask(me.token, {
    title: "Planned one",
    due_at: local(5, 17),
    estimate_minutes: 60,
  });
  await session(me.id, planned.id, local(2, 11));
  await session(me.id, planned.id, local(4, 9));
  // Its deadline has passed: the later session is catch-up.
  const overdue = await newTask(me.token, {
    title: "Overdue one",
    due_at: local(2, 17),
    estimate_minutes: 60,
  });
  await session(me.id, overdue.id, local(2, 13));
  await session(me.id, overdue.id, local(4, 11));

  const now = new Date(local(3, 10));
  const unfinished = await unfinishedBlocks(
    pool,
    me.id,
    new Date(local(3, 0)),
    now,
  );
  assert.deepEqual(
    [...new Set(unfinished.map((b) => b.item_id))],
    [lateOne.id],
  );

  await scanPlanningNotices(now, [me.id]);
  const notices = (await call(me.token, "GET", "/notifications"))
    .body as Json[];
  const roll = notices.filter((n) => n.kind === "rollforward");
  assert.equal(roll.length, 1);
  assert.match(roll[0].body, /"Late one"/);
  assert.doesNotMatch(roll[0].body, /Planned one|Overdue one/);
});

test("the planner's task list counts only time before the deadline", async () => {
  const me = await newUser();
  const t = await newTask(me.token, {
    title: "Counted",
    due_at: local(3, 17),
    estimate_minutes: 120,
  });
  await session(me.id, t.id, local(2, 9), 60);
  const late = await session(me.id, t.id, local(4, 9), 60);
  const started = await session(me.id, t.id, local(3, 16, 30), 60);
  const now = new Date(local(1, 12));
  const [row] = await candidateTasks(pool, me.id, { only: [t.id], now });
  assert.equal(row.scheduled_minutes, 60);
  assert.equal(row.late_minutes, 120);
  // Both late sessions can move: neither has started.
  assert.deepEqual(
    row.late_sessions?.map((s) => s.id),
    [started, late],
  );
  // Once one has started, it stays where it is.
  const during = await candidateTasks(pool, me.id, {
    only: [t.id],
    now: new Date(local(3, 16, 45)),
  });
  assert.deepEqual(
    during[0].late_sessions?.map((s) => s.id),
    [late],
  );
});
