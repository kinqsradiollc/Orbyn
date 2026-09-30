import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { agentRoutineInput, nextOccurrence } from "@orbyn/core";
import type {
  ChatMessage,
  ResolvedAi,
} from "../src/modules/ai/providers/adapters.js";
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { scanAssistantGoals } = await import("../src/worker/assistant-goals.js");
const { scanAssistantIdeas } = await import("../src/worker/assistant-ideas.js");
const { scanAssistantRoutines } =
  await import("../src/worker/assistant-routines.js");
const { sweepOldChats } = await import("../src/worker/chat-sweep.js");
const { buildMorning, buildOvernightSection } =
  await import("../src/worker/digest.js");
const { retention, runSweep } = await import("../src/lib/sweep.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");

const app = await buildApp();
const users: string[] = [];
const fakeAi = {} as ResolvedAi;
const MINUTE = 60_000;
const DAY = 86_400_000;
let address = 0;

async function register(withAssistant = true) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: `10.93.${Math.floor(address / 250)}.${(address++ % 250) + 1}`,
    payload: {
      email: `assistant-workers-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Worker tester",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const id = response.json().user.id as string;
  users.push(id);
  if (withAssistant)
    await assistantPrincipal({ id, name: "Worker tester", role: "member" });
  return id;
}

type StartInput = Parameters<
  NonNullable<Parameters<typeof scanAssistantGoals>[1]>["startAutomation"] &
    object
>[0];

/** Queues a job row the way the engine does, without any model call. */
function fakeStart(calls: StartInput[]) {
  return async (input: StartInput) => {
    calls.push(input);
    return transaction(async (db) => {
      const id = (
        await db.query<{ id: string }>(
          "INSERT INTO ai_jobs (user_id) VALUES ($1) RETURNING id",
          [input.userId],
        )
      ).rows[0].id;
      await input.onQueued?.(db, id);
      return id;
    });
  };
}

async function chatCount(userId: string) {
  return (
    await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM ai_chats WHERE user_id = $1",
      [userId],
    )
  ).rows[0].n;
}

before(async () => {
  await migrate();
});

after(async () => {
  if (users.length)
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await app.close();
  await pool.end();
});

test("without an AI provider no scan claims work or opens a chat", async () => {
  const userId = await register();
  await pool.query(
    "INSERT INTO goals (user_id, title) VALUES ($1, 'No provider goal')",
    [userId],
  );
  await pool.query(
    `INSERT INTO agent_routines (user_id, instruction, rrule, next_run_at)
     VALUES ($1, 'Review', 'FREQ=DAILY', now() - interval '1 minute')`,
    [userId],
  );
  const calls: StartInput[] = [];
  const options = {
    only: [userId],
    ai: null,
    startAutomation: fakeStart(calls),
  };
  assert.equal(await scanAssistantGoals(new Date(), options), 0);
  assert.equal(await scanAssistantIdeas(new Date(), options), 0);
  assert.equal(await scanAssistantRoutines(new Date(), options), 0);
  assert.equal(await sweepOldChats({ ai: null, compact: async () => "{}" }), 0);
  assert.equal(calls.length, 0);
  assert.equal(await chatCount(userId), 0);
  for (const table of ["goals_checkins", "assistant_idea_days"])
    assert.equal(
      (await pool.query(`SELECT 1 FROM ${table} WHERE user_id = $1`, [userId]))
        .rowCount,
      0,
      `${table} stays unclaimed`,
    );
  assert.equal(
    (
      await pool.query(
        "SELECT claimed_at FROM agent_routines WHERE user_id = $1",
        [userId],
      )
    ).rows[0].claimed_at,
    null,
  );
});

test("a finished weekly check-in never runs again that week", async () => {
  const userId = await register();
  const goalId = (
    await pool.query<{ id: string }>(
      "INSERT INTO goals (user_id, title) VALUES ($1, 'Weekly goal') RETURNING id",
      [userId],
    )
  ).rows[0].id;
  const calls: StartInput[] = [];
  // Tuesday, so every rescan below stays in the same UTC week.
  const now = new Date("2026-09-29T09:00:00.000Z");
  const options = {
    only: [userId],
    ai: fakeAi,
    startAutomation: fakeStart(calls),
  };
  assert.equal(await scanAssistantGoals(now, options), 1);
  await pool.query(
    `UPDATE goals_checkins SET status = 'done', summary = 'Reviewed'
      WHERE goal_id = $1`,
    [goalId],
  );
  await pool.query(
    "UPDATE ai_jobs SET state = 'done' WHERE id = (SELECT job_id FROM goals_checkins WHERE goal_id = $1)",
    [goalId],
  );
  for (const later of [31 * MINUTE, DAY, 3 * DAY])
    assert.equal(
      await scanAssistantGoals(new Date(now.getTime() + later), options),
      0,
      `no new run ${later / MINUTE} minutes later`,
    );
  assert.equal(calls.length, 1);
});

test("a stuck or failed check-in retries with a backoff, at most three times a week", async () => {
  const userId = await register();
  const goalId = (
    await pool.query<{ id: string }>(
      "INSERT INTO goals (user_id, title) VALUES ($1, 'Retry goal') RETURNING id",
      [userId],
    )
  ).rows[0].id;
  const calls: StartInput[] = [];
  const options = {
    only: [userId],
    ai: fakeAi,
    startAutomation: fakeStart(calls),
  };
  const now = new Date("2026-09-29T09:00:00.000Z");
  assert.equal(await scanAssistantGoals(now, options), 1);
  // A healthy running job is left alone.
  await pool.query(
    `UPDATE ai_jobs SET heartbeat_at = $2
      WHERE id = (SELECT job_id FROM goals_checkins WHERE goal_id = $1)`,
    [goalId, now],
  );
  assert.equal(
    await scanAssistantGoals(new Date(now.getTime() + 5 * MINUTE), options),
    0,
  );
  // Its worker died: the heartbeat went stale.
  await pool.query(
    `UPDATE ai_jobs SET heartbeat_at = $2
      WHERE id = (SELECT job_id FROM goals_checkins WHERE goal_id = $1)`,
    [goalId, new Date(now.getTime() - 60 * MINUTE)],
  );
  assert.equal(
    await scanAssistantGoals(new Date(now.getTime() + 20 * MINUTE), options),
    1,
  );
  // A failed run waits six hours.
  await pool.query(
    "UPDATE goals_checkins SET status = 'failed', claimed_at = $2 WHERE goal_id = $1",
    [goalId, now],
  );
  assert.equal(
    await scanAssistantGoals(new Date(now.getTime() + 60 * MINUTE), options),
    0,
  );
  assert.equal(
    await scanAssistantGoals(
      new Date(now.getTime() + 7 * 60 * MINUTE),
      options,
    ),
    1,
  );
  // Three tries used: never a fourth this week.
  await pool.query(
    "UPDATE goals_checkins SET status = 'failed', claimed_at = $2 WHERE goal_id = $1",
    [goalId, now],
  );
  assert.equal(
    await scanAssistantGoals(new Date(now.getTime() + 2 * DAY), options),
    0,
  );
  assert.equal(calls.length, 3);
});

test("goal check-ins and routines skip a suspended assistant", async () => {
  const userId = await register();
  await pool.query(
    "INSERT INTO goals (user_id, title) VALUES ($1, 'Suspended goal')",
    [userId],
  );
  await pool.query(
    `INSERT INTO agent_routines (user_id, instruction, rrule, next_run_at)
     VALUES ($1, 'Review', 'FREQ=DAILY', now() - interval '1 minute')`,
    [userId],
  );
  await pool.query(
    "UPDATE agent_grants SET suspended_at = now() WHERE user_id = $1 AND kind = 'assistant'",
    [userId],
  );
  const calls: StartInput[] = [];
  const options = {
    only: [userId],
    ai: fakeAi,
    startAutomation: fakeStart(calls),
  };
  assert.equal(await scanAssistantGoals(new Date(), options), 0);
  assert.equal(await scanAssistantRoutines(new Date(), options), 0);
  assert.equal(await scanAssistantIdeas(new Date(), options), 0);
  assert.equal(calls.length, 0);
});

test("ideas reach every active person, skip full days and inactive people", async () => {
  const first = await register();
  const second = await register();
  const inactive = await register();
  await pool.query(
    "UPDATE sessions SET last_seen_at = now() - interval '20 days' WHERE user_id = $1",
    [inactive],
  );
  await pool.query(
    "UPDATE agent_grants SET last_used_at = now() - interval '20 days' WHERE user_id = $1",
    [inactive],
  );
  const calls: StartInput[] = [];
  // 01:00 UTC today, so seven hours later is still the same local day.
  const now = new Date(
    new Date().toISOString().slice(0, 10) + "T01:00:00.000Z",
  );
  const only = [first, second, inactive];
  const options = {
    only,
    ai: fakeAi,
    startAutomation: fakeStart(calls),
    limit: 1,
  };
  assert.equal(await scanAssistantIdeas(now, options), 3);
  assert.equal(await scanAssistantIdeas(now, options), 3);
  assert.equal(await scanAssistantIdeas(now, options), 0);
  assert.deepEqual(
    new Set(calls.map((call) => call.userId)),
    new Set([first, second]),
    "a full day is skipped so the next person is reached",
  );
  // A failed idea is retried after the backoff; finished slots never are.
  await pool.query(
    `UPDATE assistant_idea_days SET finished_at = now()
      WHERE user_id = $1 AND slot > 1`,
    [first],
  );
  await pool.query(
    `UPDATE ai_jobs SET state = 'failed'
      WHERE id = (SELECT job_id FROM assistant_idea_days WHERE user_id = $1 AND slot = 1)`,
    [first],
  );
  const firstOnly = { ...options, only: [first] };
  assert.equal(
    await scanAssistantIdeas(new Date(now.getTime() + 30 * MINUTE), firstOnly),
    0,
  );
  assert.equal(
    await scanAssistantIdeas(
      new Date(now.getTime() + 7 * 60 * MINUTE),
      firstOnly,
    ),
    1,
  );
});

test("a routine held by a dead or finished job runs again; a bad schedule pauses only itself", async () => {
  const userId = await register();
  const calls: StartInput[] = [];
  const now = new Date();
  const options = {
    only: [userId],
    ai: fakeAi,
    startAutomation: fakeStart(calls),
  };
  const job = async (state: string, heartbeat: Date) =>
    (
      await pool.query<{ id: string }>(
        "INSERT INTO ai_jobs (user_id, state, heartbeat_at) VALUES ($1, $2, $3) RETURNING id",
        [userId, state, heartbeat],
      )
    ).rows[0].id;
  const routine = async (jobId: string | null, timezone = "UTC") =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO agent_routines
           (user_id, instruction, rrule, timezone, next_run_at, current_job_id, claimed_at)
         VALUES ($1, 'Review', 'FREQ=DAILY', $2, $3, $4, $5) RETURNING id`,
        [
          userId,
          timezone,
          new Date(now.getTime() - MINUTE),
          jobId,
          jobId ? new Date(now.getTime() - 2 * DAY) : null,
        ],
      )
    ).rows[0].id;
  const stale = await routine(
    await job("running", new Date(now.getTime() - 60 * MINUTE)),
  );
  const finished = await routine(
    await job("done", new Date(now.getTime() - DAY)),
  );
  const busy = await routine(await job("running", now));
  const waiting = await routine(
    await job("waiting", new Date(now.getTime() - MINUTE)),
  );
  const broken = await routine(null, "Not/A_Zone");
  assert.equal(await scanAssistantRoutines(now, options), 2);
  const rows = new Map(
    (
      await pool.query<{
        id: string;
        paused: boolean;
        next_run_at: Date;
        last_result: { error?: string } | null;
      }>(
        "SELECT id, paused, next_run_at, last_result FROM agent_routines WHERE user_id = $1",
        [userId],
      )
    ).rows.map((row) => [row.id, row]),
  );
  assert.ok(rows.get(stale)!.next_run_at > now);
  assert.ok(rows.get(finished)!.next_run_at > now);
  assert.ok(
    rows.get(busy)!.next_run_at < now,
    "a live job still holds its routine",
  );
  assert.ok(rows.get(waiting)!.next_run_at < now);
  assert.equal(rows.get(broken)!.paused, true);
  assert.match(rows.get(broken)!.last_result?.error ?? "", /schedule/);
});

test("routine schedules refuse run counts and daily weekday lists", () => {
  const base = {
    instruction: "Review",
    timezone: "UTC",
    next_run_at: new Date().toISOString(),
  };
  assert.equal(
    agentRoutineInput.safeParse({ ...base, rrule: "FREQ=DAILY;COUNT=3" })
      .success,
    false,
  );
  assert.equal(
    agentRoutineInput.safeParse({ ...base, rrule: "FREQ=DAILY;UNTIL=20301231" })
      .success,
    true,
  );
  // Weekdays belong to weekly rules; a daily rule with BYDAY is refused
  // rather than silently running every day.
  assert.equal(
    agentRoutineInput.safeParse({ ...base, rrule: "FREQ=DAILY;BYDAY=MO,WE" })
      .success,
    false,
  );
  const start = new Date("2026-09-28T08:00:00.000Z");
  assert.equal(
    nextOccurrence(
      start,
      "FREQ=WEEKLY;BYDAY=MO,WE",
      "UTC",
      start,
    )?.toISOString(),
    "2026-09-30T08:00:00.000Z",
  );
});

test("the morning email keeps going without an assistant or when the brief fails", async () => {
  const withoutAssistant = await register(false);
  const plain = await buildMorning(
    withoutAssistant,
    "Worker tester",
    new Date(),
    "UTC",
  );
  assert.ok(!plain.lines.some((line) => /morning brief/.test(line)));
  assert.equal(
    (
      await pool.query("SELECT 1 FROM assistant_briefs WHERE user_id = $1", [
        withoutAssistant,
      ])
    ).rowCount,
    0,
    "no brief is written for someone without the assistant",
  );

  const withAssistant = await register();
  const failed = await buildMorning(
    withAssistant,
    "Worker tester",
    new Date(),
    "UTC",
    {
      writeBrief: async () => {
        throw new Error("simulated brief failure");
      },
    },
  );
  assert.equal(failed.subject, "Your day ahead");
  assert.ok(!failed.lines.some((line) => /morning brief/.test(line)));
  assert.ok(failed.lines.some((line) => /Open your day/.test(line)));
});

test("saved night results lead the morning email and private brief with review, Undo, questions and leftovers", async () => {
  const userId = await register();
  const stranger = await register();
  const now = new Date("2050-02-02T08:00:00Z");
  const nightId = (
    await pool.query(
      `INSERT INTO assistant_nights(user_id, local_day, status, runs, summary)
     VALUES($1, '2050-02-01', 'done', 3, $2::jsonb) RETURNING id`,
      [
        userId,
        JSON.stringify({
          not_done: [
            {
              title: "Revision plan",
              kind: "study",
              reason: "Not done tonight: the token budget was reached",
            },
          ],
        }),
      ],
    )
  ).rows[0].id;
  const proposal = randomUUID();
  await pool.query(
    "INSERT INTO proposals(id, user_id, actions) VALUES($1, $2, '[]'::jsonb)",
    [proposal, userId],
  );
  const task = randomUUID();
  const { appLink } = await import("../src/modules/booking/service.js");
  for (const run of [
    {
      state: "done",
      summary: "Prepared tomorrow's sessions",
      result: { assistant_run: { outcome: "applied", plan_job: "plan_test" } },
      apply: {
        structured: {
          steps: [
            {
              done: [
                {
                  title: "Revision session",
                  url: appLink(`/app/task/${task}`),
                },
              ],
            },
          ],
        },
      },
    },
    {
      state: "done",
      summary: "Prepared flashcards",
      result: {
        assistant_run: {
          outcome: "pending",
          proposal_id: `proposal:${proposal}`,
        },
      },
    },
    {
      state: "waiting",
      summary: "Which meeting?",
      checkpoint: {
        state: {
          waiting: {
            kind: "person",
            question: "Which meeting should I prepare?",
          },
        },
      },
    },
  ]) {
    const job = (
      await pool.query(
        "INSERT INTO ai_jobs(user_id, state, result, run_state, apply_result, sources_checked) VALUES($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, true) RETURNING id",
        [
          userId,
          run.state,
          JSON.stringify(run.result ?? null),
          JSON.stringify(run.checkpoint ?? null),
          JSON.stringify(run.apply ?? null),
        ],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO assistant_night_runs(night_id, job_id, kind, summary) VALUES($1, $2, 'plan', $3)",
      [nightId, job, run.summary],
    );
  }
  const section = await buildOvernightSection(userId, "2050-02-02");
  assert.ok(section);
  assert.match(
    section.firstLine,
    /2 runs finished, 1 to review, 1 question, 1 not done/,
  );
  const text = section.markdown.join("\n");
  assert.match(
    section.markdown[0],
    /\[Review Overnight\]\(.*\/app\/overnight\/[0-9a-f-]+\)/,
  );
  assert.match(text, new RegExp(`/app/review/${proposal}`));
  assert.match(text, new RegExp(`/app/task/${task}`));
  assert.match(text, /Changes and Undo/);
  assert.match(text, /Which meeting should I prepare/);
  assert.match(text, /Revision plan.*token budget/);
  assert.equal(await buildOvernightSection(stranger, "2050-02-02"), null);
  assert.equal(await buildOvernightSection(userId, "2050-02-04"), null);
  const digest = await buildMorning(userId, "Worker tester", now, "UTC");
  assert.equal(digest.lines[0], section.firstLine);
  assert.match(digest.lines[1], /Review Overnight: .*\/app\/overnight/);
  const brief = (
    await pool.query(
      "SELECT d.content FROM assistant_briefs b JOIN docs d ON d.id = b.doc_id WHERE b.user_id = $1 AND b.local_day = '2050-02-02'",
      [userId],
    )
  ).rows[0];
  assert.ok(brief);
  const blocks = brief.content as { text?: string }[];
  assert.equal(blocks[0].text, "Overnight");
  assert.match(JSON.stringify(blocks), /\/app\/overnight/);
  assert.match(JSON.stringify(blocks), /Prepared flashcards/);
  const hiddenProject = (
    await pool.query(
      "INSERT INTO projects(user_id, name, assistant_off) VALUES($1, 'Prepared flashcards', true) RETURNING id",
      [userId],
    )
  ).rows[0].id;
  assert.ok(hiddenProject);
  const filtered = await buildOvernightSection(userId, "2050-02-02");
  assert.ok(filtered);
  assert.doesNotMatch(filtered.markdown.join("\n"), /Prepared flashcards/);
  await pool.query("UPDATE projects SET assistant_off = false WHERE id = $1", [
    hiddenProject,
  ]);
  await pool.query("UPDATE proposals SET status = 'applied' WHERE id = $1", [
    proposal,
  ]);
  const decided = await buildOvernightSection(userId, "2050-02-02");
  assert.ok(decided);
  assert.match(decided.firstLine, /0 to review/);
  assert.doesNotMatch(
    decided.markdown.join("\n"),
    new RegExp(`/app/review/${proposal}`),
  );
});

test("the chat sweep drains in batches, respects visibility and kept-out sources", async () => {
  const userId = await register();
  const otherId = await register(false);
  const now = new Date();
  const old = new Date(now.getTime() - 10 * DAY);
  const hiddenProject = (
    await pool.query<{ id: string }>(
      "INSERT INTO projects (user_id, name, assistant_off) VALUES ($1, 'Kept out', true) RETURNING id",
      [userId],
    )
  ).rows[0].id;
  const someoneElses = (
    await pool.query<{ id: string }>(
      "INSERT INTO projects (user_id, name) VALUES ($1, 'Not mine') RETURNING id",
      [otherId],
    )
  ).rows[0].id;
  const turn = (text: string, extra: Record<string, unknown> = {}) => ({
    role: "user",
    text,
    ...extra,
  });
  const insert = async (
    title: string,
    turns: unknown[],
    projectId: string | null = null,
  ) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO ai_chats (id, user_id, project_id, title, turns, last_used_at)
         VALUES ($6, $1, $2, $3, $4::jsonb, $5) RETURNING id`,
        [userId, projectId, title, JSON.stringify(turns), old, randomUUID()],
      )
    ).rows[0].id;
  const plain = [];
  for (let n = 0; n < 5; n++)
    plain.push(await insert(`Batch ${n}`, [turn(`Plain question ${n}`)]));
  const mixed = await insert("Mixed sources", [
    turn("VISIBLE_QUESTION"),
    { role: "assistant", text: "VISIBLE_ANSWER" },
    turn("HIDDEN_QUESTION"),
    {
      role: "assistant",
      text: "HIDDEN_ANSWER",
      sources: [
        { kind: "project", project_id: hiddenProject, title: "Kept out" },
      ],
    },
  ]);
  const invisible = await insert(
    "Left project",
    [turn("Private")],
    someoneElses,
  );
  const cameBack = await insert("Came back", [turn("Still using this")]);
  const broken = await insert("Broken summary", [turn("Fails")]);

  const seen: string[] = [];
  const summary = JSON.stringify({
    asked: ["A question"],
    decided: [],
    changed: [],
  });
  const compact = async (_ai: ResolvedAi, messages: ChatMessage[]) => {
    const content = messages[1].content;
    seen.push(content);
    if (content.includes("Came back"))
      await pool.query(
        "UPDATE ai_chats SET last_used_at = now() WHERE id = $1",
        [cameBack],
      );
    if (content.includes("Broken summary")) return "not JSON";
    return summary;
  };
  const swept = await sweepOldChats({ ai: fakeAi, compact, now, limit: 2 });
  assert.equal(swept, 6, "five plain chats and the mixed one, across batches");
  const state = new Map(
    (
      await pool.query<{
        id: string;
        swept_at: Date | null;
        sweep_attempts: number;
        sweep_last_error: string | null;
      }>(
        "SELECT id, swept_at, sweep_attempts, sweep_last_error FROM ai_chats WHERE user_id = $1",
        [userId],
      )
    ).rows.map((row) => [row.id, row]),
  );
  for (const id of [...plain, mixed]) assert.ok(state.get(id)!.swept_at);
  assert.equal(state.get(invisible)!.swept_at, null);
  assert.equal(state.get(invisible)!.sweep_attempts, 0);
  assert.equal(state.get(cameBack)!.swept_at, null);
  assert.equal(
    state.get(cameBack)!.sweep_attempts,
    0,
    "coming back is not a failed try",
  );
  assert.equal(state.get(broken)!.swept_at, null);
  assert.equal(state.get(broken)!.sweep_attempts, 1, "tried once in this run");
  assert.ok(state.get(broken)!.sweep_last_error);
  const mixedCall = seen.find((content) => content.includes("Mixed sources"))!;
  assert.match(mixedCall, /VISIBLE_QUESTION/);
  assert.doesNotMatch(mixedCall, /HIDDEN_(QUESTION|ANSWER)/);
  assert.ok(!seen.some((content) => content.includes("Left project")));
  assert.equal(
    (
      await pool.query("SELECT 1 FROM memory_queue WHERE user_id = $1", [
        userId,
      ])
    ).rowCount,
    0,
    "swept turns are not queued for Memory again",
  );
});

test("the sweeper clears dead and abandoned assistant jobs and clamps retention", async () => {
  const userId = await register();
  const job = async (state: string, created: string, heartbeat: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO ai_jobs (user_id, state, created_at, heartbeat_at)
         VALUES ($1, $2, now() - $3::interval, now() - $4::interval) RETURNING id`,
        [userId, state, created, heartbeat],
      )
    ).rows[0].id;
  const deadRun = await job("running", "3 days", "2 days");
  const liveRun = await job("running", "3 days", "1 minute");
  const oldWait = await job("waiting", "20 days", "15 days");
  const recentWait = await job("waiting", "3 days", "2 days");
  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ('retention', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ status_checks: 1 })],
  );
  try {
    assert.equal(
      (await retention()).status_checks,
      7,
      "raised to the rule's minimum",
    );
    const grant = (
      await pool.query<{ id: string }>(
        "SELECT id FROM agent_grants WHERE user_id = $1 AND kind = 'assistant'",
        [userId],
      )
    ).rows[0].id;
    const activity = async (undoUntil: string) =>
      (
        await pool.query<{ id: string }>(
          `INSERT INTO agent_activity (at, user_id, grant_id, tool, outcome, undo_until)
           VALUES (now() - interval '200 days', $1, $2, 'test', 'ok', now() - $3::interval)
           RETURNING id`,
          [userId, grant, undoUntil],
        )
      ).rows[0].id;
    const recentUndo = await activity("30 days");
    const oldUndo = await activity("100 days");
    await runSweep();
    const left = new Set(
      (
        await pool.query<{ id: string }>(
          "SELECT id FROM ai_jobs WHERE id = ANY($1::uuid[])",
          [[deadRun, liveRun, oldWait, recentWait]],
        )
      ).rows.map((row) => row.id),
    );
    assert.deepEqual(left, new Set([liveRun, recentWait]));
    const kept = (
      await pool.query<{ id: string }>(
        "SELECT id::text FROM agent_activity WHERE id = ANY($1::bigint[])",
        [[recentUndo, oldUndo]],
      )
    ).rows.map((row) => row.id);
    assert.deepEqual(kept, [String(recentUndo)]);
  } finally {
    await pool.query("DELETE FROM system_settings WHERE key = 'retention'");
  }
});

test("night settings with Follow through disabled leave ordinary goals and routines scheduled", async () => {
  const userId = await register();
  const { defaultNightShift } = await import("@orbyn/core");
  const prefs = defaultNightShift();
  prefs.enabled = true;
  prefs.kinds.follow_through = false;
  await pool.query(
    "INSERT INTO agent_settings(user_id,night_shift) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET night_shift=EXCLUDED.night_shift",
    [userId, JSON.stringify(prefs)],
  );
  await pool.query(
    "INSERT INTO goals(user_id,title) VALUES($1,'Daytime goal')",
    [userId],
  );
  const now = new Date();
  await pool.query(
    "INSERT INTO agent_routines(user_id,instruction,rrule,next_run_at) VALUES($1,'Daytime routine','FREQ=DAILY',$2)",
    [userId, now],
  );
  const calls: StartInput[] = [];
  const options = {
    only: [userId],
    ai: {} as import("../src/modules/ai/providers/adapters.js").ResolvedAi,
    startAutomation: fakeStart(calls),
  };
  assert.equal(await scanAssistantGoals(now, options), 1);
  assert.equal(await scanAssistantRoutines(now, options), 1);
  assert.deepEqual(
    calls.map((input) => input.automation.kind),
    ["goal", "routine"],
  );
});
