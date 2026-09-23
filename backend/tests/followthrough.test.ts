import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  pageFreshness,
  realityCheck,
  whatIfVerdict,
  type PlanReality,
} from "@orbyn/core";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
type Json = Record<string, any>;
const call = (
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

async function newUser(name: string) {
  const r = await call(null, "POST", "/auth/register", {
    email: `ft-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name,
  });
  return { token: r.json().token as string, id: r.json().user.id as string };
}

let lead: { token: string; id: string };
let dev: { token: string; id: string };
let stranger: { token: string; id: string };
let team = "";

before(async () => {
  await migrate();
  lead = await newUser("Lead");
  dev = await newUser("Dev");
  stranger = await newUser("Stranger");
  team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Follow crew', $1) RETURNING id",
      [lead.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member')",
    [team, lead.id, dev.id],
  );
});
after(async () => {
  await app.close();
  await pool.end();
});

// ---- plan reality check -----------------------------------------------------

test("reality: planned time against what got done, by weekday", async () => {
  const task = (
    await call(dev.token, "POST", "/items", { title: "Report", kind: "task" })
  ).json();
  const other = (
    await call(dev.token, "POST", "/items", { title: "Slides", kind: "task" })
  ).json();
  // Two weeks back: 2 h planned on the report (finished that day) and 2 h on
  // the slides (never touched).
  const day = new Date(Date.now() - 14 * 86_400_000);
  day.setUTCHours(9, 0, 0, 0);
  const at = (h: number) => new Date(day.getTime() + h * 3_600_000);
  await pool.query(
    `INSERT INTO time_blocks (item_id, user_id, start_at, end_at) VALUES
       ($1, $3, $4, $5), ($2, $3, $5, $6)`,
    [task.id, other.id, dev.id, at(0), at(2), at(4)],
  );
  await pool.query(
    "INSERT INTO item_updates (item_id, user_id, status, created_at) VALUES ($1, $2, 'done', $3)",
    [task.id, dev.id, at(3)],
  );
  const r = await call(dev.token, "GET", "/planner/reality");
  assert.equal(r.statusCode, 200, r.body);
  const reality: PlanReality = r.json();
  assert.equal(reality.enough, true);
  assert.equal(reality.rate, 0.5);
  const w = reality.by_weekday.find((x) => x.weekday === day.getUTCDay())!;
  assert.equal(w.planned_minutes, 240);
  assert.equal(w.kept_minutes, 120);
  assert.equal((await call(null, "GET", "/planner/reality")).statusCode, 401);
});

test("reality check names the day a plan stretches most", () => {
  const reality: PlanReality = {
    window_days: 28,
    enough: true,
    rate: 0.5,
    by_weekday: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      days: 2,
      planned_minutes: 480,
      kept_minutes: 240,
      rate: 0.5,
    })),
  };
  // Tuesday 22 September 2026: 6 hours planned, where 2 usually get done.
  const block = (h: number) => ({
    item_id: "x",
    title: "x",
    start_at: `2026-09-22T0${h}:00:00Z`,
    end_at: `2026-09-22T0${h + 2}:00:00Z`,
    frame_id: null,
    frame_name: null,
    part: 1,
    parts: 1,
    score: 0,
  });
  const check = realityCheck(
    { blocks: [block(1), block(3), block(5)] },
    reality,
    "UTC",
  );
  assert.equal(check.days[0].planned_minutes, 360);
  assert.equal(check.days[0].likely_minutes, 180);
  assert.equal(check.days[0].stretch, true);
  assert.match(check.message!, /On Tuesdays you usually get through about 2 h/);
  // Not enough history: nothing to say.
  assert.equal(
    realityCheck(
      { blocks: [] },
      { ...reality, enough: false, rate: null },
      "UTC",
    ).message,
    null,
  );
});

// ---- what if ----------------------------------------------------------------

test("what if: a new task, worked out without saving anything", async () => {
  const plansBefore = (
    await pool.query(
      "SELECT count(*)::int AS n FROM plans WHERE user_id = $1",
      [dev.id],
    )
  ).rows[0].n;
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const r = await call(dev.token, "POST", "/planner/what-if", {
    days: 3,
    add_tasks: [{ title: "Huge audit", estimate_minutes: 10080, due_at: due }],
  });
  assert.equal(r.statusCode, 200, r.body);
  const w = r.json();
  assert.ok(w.newly_late.includes("Huge audit"));
  assert.match(w.verdict, /Huge audit/);
  const plansAfter = (
    await pool.query(
      "SELECT count(*)::int AS n FROM plans WHERE user_id = $1",
      [dev.id],
    )
  ).rows[0].n;
  assert.equal(plansAfter, plansBefore);
  assert.equal(
    (await call(dev.token, "POST", "/planner/what-if", { days: 3 })).statusCode,
    422,
  );
  const fits = whatIfVerdict(
    { planned_minutes: 60, capacity_minutes: 600, at_risk: [], unplaced: [] },
    { planned_minutes: 120, capacity_minutes: 600, at_risk: [], unplaced: [] },
  );
  assert.equal(fits.verdict, "It fits. You'd still have 8 h free.");
});

// ---- negotiated plans ---------------------------------------------------------

test("a task handed over is an ask: suggest a date, the asker agrees", async () => {
  const due = "2026-10-02T07:00:00.000Z";
  const task = (
    await call(lead.token, "POST", "/items", {
      title: "Write the release notes",
      kind: "task",
      team_id: team,
      assignee_id: dev.id,
      due_at: due,
    })
  ).json();
  const mine = (await call(dev.token, "GET", "/asks")).json();
  const ask = mine.to_me.find((a: Json) => a.item_id === task.id);
  assert.ok(ask, JSON.stringify(mine));
  assert.equal(ask.asked_by_name, "Lead");
  assert.equal(ask.due_at, due);
  // Someone else can't answer it.
  assert.equal(
    (
      await call(stranger.token, "POST", `/asks/${ask.id}/reply`, {
        action: "accept",
      })
    ).statusCode,
    404,
  );
  const later = "2026-10-06T07:00:00.000Z";
  const countered = await call(dev.token, "POST", `/asks/${ask.id}/reply`, {
    action: "counter",
    due_at: later,
    message: "Tuesday works better",
  });
  assert.equal(countered.statusCode, 200, countered.body);
  assert.equal(countered.json().status, "countered");
  // Now it waits on the lead.
  const leadAsks = (await call(lead.token, "GET", "/asks")).json();
  assert.ok(leadAsks.to_me.some((a: Json) => a.id === ask.id));
  const agreed = await call(lead.token, "POST", `/asks/${ask.id}/settle`, {
    action: "agree",
  });
  assert.equal(agreed.statusCode, 200, agreed.body);
  assert.equal(agreed.json().status, "accepted");
  const item = (await call(lead.token, "GET", `/items/${task.id}`)).json();
  assert.equal(item.due_at, later);
  // Settled asks can't be answered again.
  assert.equal(
    (
      await call(dev.token, "POST", `/asks/${ask.id}/reply`, {
        action: "accept",
      })
    ).statusCode,
    409,
  );
});

test("saying no needs a reason, and hands the task back", async () => {
  const task = (
    await call(lead.token, "POST", "/items", {
      title: "Fix the printer",
      kind: "task",
      team_id: team,
      assignee_id: dev.id,
    })
  ).json();
  const ask = (await call(dev.token, "GET", `/items/${task.id}/ask`)).json();
  assert.equal(ask.status, "open");
  assert.equal(
    (
      await call(dev.token, "POST", `/asks/${ask.id}/reply`, {
        action: "decline",
        message: "",
      })
    ).statusCode,
    422,
  );
  const no = await call(dev.token, "POST", `/asks/${ask.id}/reply`, {
    action: "decline",
    message: "Not my area",
  });
  assert.equal(no.json().status, "declined");
  const item = (await call(lead.token, "GET", `/items/${task.id}`)).json();
  assert.equal(item.assignee_id, null);
  // Assigning yourself asks no one.
  const self = (
    await call(lead.token, "POST", "/items", {
      title: "Mine",
      kind: "task",
      team_id: team,
      assignee_id: lead.id,
    })
  ).json();
  assert.equal(
    (await call(lead.token, "GET", `/items/${self.id}/ask`)).json(),
    null,
  );
});

// ---- team attention budget ------------------------------------------------------

test("a team's meeting budget, and who a new meeting would push over", async () => {
  assert.equal(
    (
      await call(dev.token, "PUT", `/teams/${team}/attention`, {
        meeting_budget_minutes: 120,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(lead.token, "PUT", `/teams/${team}/attention`, {
        meeting_budget_minutes: 120,
      })
    ).statusCode,
    200,
  );
  // A 90-minute team meeting this week.
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  monday.setUTCHours(10, 0, 0, 0);
  const start = new Date(monday.getTime() + 86_400_000);
  await call(lead.token, "POST", "/items", {
    title: "Planning",
    kind: "event",
    team_id: team,
    due_at: start.toISOString(),
    end_at: new Date(start.getTime() + 90 * 60_000).toISOString(),
  });
  const now = (await call(dev.token, "GET", `/teams/${team}/attention`)).json();
  assert.equal(now.budget_minutes, 120);
  const devRow = now.members.find((m: Json) => m.user_id === dev.id);
  assert.equal(devRow.meeting_minutes, 90);
  assert.equal(devRow.over, false);
  // Another hour would take everyone over.
  const next = new Date(start.getTime() + 3 * 3_600_000);
  const check = (
    await call(lead.token, "POST", `/teams/${team}/attention/check`, {
      start_at: next.toISOString(),
      end_at: new Date(next.getTime() + 60 * 60_000).toISOString(),
    })
  ).json();
  assert.deepEqual(check.over.map((o: Json) => o.name).sort(), ["Dev", "Lead"]);
  assert.equal(
    (await call(stranger.token, "GET", `/teams/${team}/attention`)).statusCode,
    404,
  );
});

// ---- memory decay ---------------------------------------------------------------

test("pages nobody has touched in months fade, until confirmed or flagged", async () => {
  const doc = (
    await call(lead.token, "POST", "/docs", {
      title: "On-call guide",
      kind: "doc",
      team_id: team,
    })
  ).json();
  await pool.query(
    "UPDATE docs SET updated_at = now() - interval '200 days' WHERE id = $1",
    [doc.id],
  );
  const fading = (
    await call(dev.token, "GET", `/docs/fading?team_id=${team}`)
  ).json();
  const row = fading.find((d: Json) => d.id === doc.id);
  assert.equal(row.freshness.state, "stale");
  assert.equal(row.owner_name, "Lead");
  // Still true: it leaves the list, its version untouched.
  const ok = await call(dev.token, "POST", `/docs/${doc.id}/review`, {
    verdict: "still_true",
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.ok(
    !(await call(dev.token, "GET", "/docs/fading"))
      .json()
      .some((d: Json) => d.id === doc.id),
  );
  // Needs updating: its author gets a task.
  await pool.query(
    "UPDATE docs SET updated_at = now() - interval '120 days', reviewed_at = NULL WHERE id = $1",
    [doc.id],
  );
  const flag = await call(dev.token, "POST", `/docs/${doc.id}/review`, {
    verdict: "needs_update",
    note: "The rota changed",
  });
  const t = flag.json().task;
  assert.equal(t.title, "Update “On-call guide”");
  assert.equal(t.assignee_id, lead.id);
  assert.match(t.notes, /The rota changed/);
  assert.equal(
    (
      await call(stranger.token, "POST", `/docs/${doc.id}/review`, {
        verdict: "still_true",
      })
    ).statusCode,
    404,
  );
  assert.equal(pageFreshness(new Date().toISOString(), null).state, "fresh");
});

// ---- proof of progress ------------------------------------------------------------

test("proof on a task, and what got done this week with it", async () => {
  const task = (
    await call(dev.token, "POST", "/items", {
      title: "Ship the fix",
      kind: "task",
    })
  ).json();
  assert.equal(
    (await call(dev.token, "POST", `/items/${task.id}/proofs`, {})).statusCode,
    422,
  );
  assert.equal(
    (
      await call(dev.token, "POST", `/items/${task.id}/proofs`, {
        url: "javascript:alert(1)",
      })
    ).statusCode,
    422,
  );
  const proof = await call(dev.token, "POST", `/items/${task.id}/proofs`, {
    url: "https://example.com/pr/42",
    note: "PR #42",
  });
  assert.equal(proof.statusCode, 201, proof.body);
  assert.equal(
    (await call(stranger.token, "GET", `/items/${task.id}/proofs`)).statusCode,
    404,
  );
  await call(dev.token, "POST", `/items/${task.id}/updates`, {
    status: "done",
  });
  const from = new Date(Date.now() - 86_400_000).toISOString();
  const to = new Date(Date.now() + 86_400_000).toISOString();
  const report = (
    await call(
      dev.token,
      "GET",
      `/progress?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    )
  ).json();
  const done = report.people[0].done.find((d: Json) => d.item_id === task.id);
  assert.deepEqual(done.proofs, [
    { url: "https://example.com/pr/42", note: "PR #42" },
  ]);
  assert.match(
    report.markdown,
    /- Ship the fix — \[PR #42\]\(https:\/\/example\.com\/pr\/42\)/,
  );
});

// ---- re-entry brief ----------------------------------------------------------------

test("coming back after days away: a brief of what happened", async () => {
  const beat = () =>
    call(dev.token, "POST", "/presence/heartbeat", {
      device_id: "dev-laptop-1",
      platform: "web",
    });
  await beat();
  assert.equal((await call(dev.token, "GET", "/me/reentry")).json(), null);
  // Away for three days.
  await pool.query(
    "UPDATE reentry SET last_active_at = now() - interval '3 days' WHERE user_id = $1",
    [dev.id],
  );
  await beat();
  const brief = (await call(dev.token, "GET", "/me/reentry")).json();
  assert.equal(brief.days_away, 3);
  // The asks made meanwhile, and the tasks handed over, are in it.
  assert.ok(brief.assigned.length >= 1, JSON.stringify(brief));
  assert.ok(Array.isArray(brief.due));
  assert.equal(
    (await call(dev.token, "POST", "/me/reentry/dismiss")).statusCode,
    200,
  );
  assert.equal((await call(dev.token, "GET", "/me/reentry")).json(), null);
  assert.equal((await call(null, "GET", "/me/reentry")).statusCode, 401);
});
