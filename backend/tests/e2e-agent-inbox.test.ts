import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { trapNetwork, type Person } from "./mcp-helpers.js";
import { type AgentClient, idOf, scenario } from "./e2e-agent-helpers.js";

/**
 * H9 scenario (e): the inbox loop, with an app that can't show forms (so
 * asking goes by push). Three real events land in get_inbox: a guest asks
 * for time on a booking page, a teammate names the person in a comment,
 * and the planner finds a deadline at risk. The agent acts on each: it
 * replies in the page, asks the person whether to move the deadline
 * (ask_person, yes/no: a push with Approve), and approves the booking,
 * which asks first because the guest is new (the Review inbox's push).
 * The person answers both from their phone; the answers arrive in
 * get_inbox; the agent follows through and marks everything done.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { scanPlanningNotices } = await import("../src/worker/planning.js");
const { reviewCategory } = await import("../src/worker/channels/push.js");

const app = await buildApp();
const { h, connect } = scenario(app);
const network = await trapNetwork();

let olga: Person;
let mo: Person;
let crew = "";
let agent: AgentClient;
let slug = "";
let page = "";
let enormous = "";

const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  await migrate();
  // Bookings confirm (and are asked about) without a mail server here.
  await pool
    .query("DELETE FROM system_settings WHERE key = 'smtp'")
    .catch(() => {});
  invalidateSettings();
  olga = await h.register("e2e-inbox-olga", "Olga");
  mo = await h.register("e2e-inbox-mo", "Mo");
  crew = await h.team(olga, "Inbox crew", [[mo, "member"]]);
  await h.call(olga.token, "PUT", "/planner/prefs", {
    timezone: "UTC",
    work_days: [0, 1, 2, 3, 4, 5, 6],
    work_start: "09:00",
    work_end: "17:00",
  });
  await pool.query(
    "INSERT INTO devices (user_id, token) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [olga.id, `ExponentPushToken[inbox-${olga.id.slice(0, 8)}]`],
  );
  agent = await connect(olga, {
    team_ids: [crew],
    toolsets: ["workspace", "planner"],
    bookings: true,
    name: "Inbox agent",
  });
  // Her booking page, which holds a request until she decides.
  slug = `e2e-${randomUUID().slice(0, 8)}`;
  const made = await h.call(olga.token, "POST", "/booking-pages", {
    slug,
    title: "Office hours",
    durations: [30],
    min_notice_minutes: 0,
    window_days: 14,
    requires_approval: true,
  });
  assert.equal(made.statusCode, 201, made.body);
  // A team page Mo will comment on.
  const doc = await h.call(olga.token, "POST", "/docs", {
    title: "Launch notes",
    team_id: crew,
    content: [{ id: "bline", type: "paragraph", text: "Launch on Friday." }],
  });
  assert.equal(doc.statusCode, 201, doc.body);
  page = doc.json().id;
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(
    network.calls,
    [],
    "the inbox loop never reached the network",
  );
  network.restore();
  await app.close();
  await pool.end();
});

test("inbox loop: events land, the agent acts and asks, the answers come back, all marked done", async () => {
  // 1. Three things happen while the agent is away.
  const slots = await h.call(
    null,
    "GET",
    `/book/${slug}?duration=30&timezone=UTC&date=${day(2)}&days=1`,
  );
  assert.equal(slots.statusCode, 200, slots.body);
  const start = slots.json().slots[0].start_at as string;
  const asked = await h.call(null, "POST", `/book/${slug}`, {
    start_at: start,
    duration: 30,
    name: "Sam Guest",
    email: "sam.guest@example.com",
    timezone: "UTC",
  });
  assert.equal(asked.statusCode, 201, asked.body);
  assert.equal(asked.json().status, "awaiting_approval");
  const booking = asked.json().id as string;

  const said = await h.call(mo.token, "POST", `/docs/${page}/comments`, {
    body: "Can we move the launch to Monday?",
    mentions: [olga.id],
  });
  assert.equal(said.statusCode, 201, said.body);

  const task = await h.call(olga.token, "POST", "/items", {
    title: "Enormous report",
    estimate_minutes: 10080,
    due_at: `${day(1)}T12:00:00.000Z`,
  });
  assert.equal(task.statusCode, 201, task.body);
  enormous = task.json().id;
  await scanPlanningNotices(new Date(), [olga.id]);

  // 2. The agent looks: each item says what, with refs and tools to act.
  const inbox = await agent.ok("get_inbox");
  const kinds = inbox.items.map((i: any) => i.kind);
  for (const k of ["booking", "mention", "deadline"])
    assert.ok(kinds.includes(k), `${k} in ${kinds.join(", ")}`);
  const item = (k: string) => inbox.items.find((i: any) => i.kind === k);
  assert.ok(item("booking").next.includes("booking_action"));
  assert.ok(item("mention").refs.some((r: any) => r.id === `doc:${page}`));
  // Where to find the comment to reply to, and how.
  assert.deepEqual(item("mention").next.slice(0, 3), [
    "fetch",
    "get_history",
    "comment_on_doc",
  ]);
  assert.match(
    item("mention").what,
    /<untrusted-content source="teammate:/,
    "a teammate's words arrive fenced",
  );
  assert.ok(
    item("deadline").refs.some((r: any) => r.id === `task:${enormous}`),
  );
  assert.doesNotMatch(
    JSON.stringify(item("booking")),
    /sam\.guest@example\.com/,
    "a guest's address never shows",
  );

  // 3a. The mention: reply in the page.
  const history = await agent.ok("get_history", { of: `doc:${page}` });
  const comment = JSON.stringify(history).match(
    /"id":"([0-9a-f-]{36})"[^}]*Can we move the launch/,
  )?.[1];
  assert.ok(comment, JSON.stringify(history).slice(0, 800));
  await agent.ok("comment_on_doc", {
    doc: `doc:${page}`,
    action: "reply",
    reply_to: comment,
    body: "Olga's agent: I've asked Olga and will update the page.",
  });

  // 3b. The deadline: ask the person (no form here: a card and a push).
  const question = await agent.ok("ask_person", {
    question:
      "Enormous report won't fit before tomorrow noon. Move its deadline to next week?",
  });
  assert.equal(question.status, "open");
  const qid = idOf(question.question_id);
  const push = (
    await pool.query<{ kind: string; ref: string }>(
      "SELECT kind, ref FROM notifications WHERE kind = 'question' AND channel = 'push' AND ref LIKE $1",
      [`question:${qid}%`],
    )
  ).rows[0];
  assert.ok(push, "a push asks her");
  assert.equal(reviewCategory(push), true, "yes/no carries Approve/Decline");

  // 3c. The booking: approving a guest she hasn't met asks first.
  const approve = await agent.ok("booking_action", {
    action: "approve",
    booking,
  });
  assert.equal(approve.status, "pending_review");
  const proposal = idOf(approve.pending.proposal_id);
  const state = async () =>
    (await pool.query("SELECT status FROM bookings WHERE id = $1", [booking]))
      .rows[0].status;
  assert.equal(await state(), "awaiting_approval", "not until she says");

  // 4. She answers both from her phone.
  const yes = await h.call(olga.token, "POST", `/me/questions/${qid}/answer`, {
    answer: "approve",
    via: "push",
  });
  assert.equal(yes.statusCode, 200, yes.body);
  assert.equal(yes.json().answer, "Yes");
  const tapped = await h.call(
    olga.token,
    "POST",
    `/proposals/${proposal}/respond`,
    { decision: "approve" },
  );
  assert.equal(tapped.statusCode, 200, tapped.body);
  assert.equal(await state(), "confirmed");

  // 5. The answers arrive in the inbox; the agent follows through.
  const later = await agent.ok("get_inbox");
  const answer = later.items.find(
    (i: any) =>
      i.kind === "answer" &&
      i.refs.some((r: any) => r.id === `question:${qid}`),
  );
  assert.ok(answer, JSON.stringify(later.items.map((i: any) => i.kind)));
  assert.match(answer.what, /Yes/);
  const decided = later.items.find(
    (i: any) =>
      i.kind === "review" &&
      i.refs.some((r: any) => r.id === `proposal:${proposal}`),
  );
  assert.ok(decided, "the review decision reaches the agent");
  const status = await agent.ok("get_inbox", {
    question: `question:${qid}`,
  });
  assert.equal(status.question.answered_via, "push");
  const version = (
    await pool.query("SELECT version FROM items WHERE id = $1", [enormous])
  ).rows[0].version;
  await agent.ok("update_tasks", {
    changes: [
      {
        id: `task:${enormous}`,
        version,
        due_at: `${day(8)}T12:00:00.000Z`,
      },
    ],
  });

  // 6. Everything handled is marked done; nothing is left open.
  const open = (await agent.ok("get_inbox")).items.map((i: any) => i.id);
  const acked = await agent.ok("ack_inbox", {
    ids: open,
    action: "done",
    note: "Replied, moved the deadline, booking confirmed",
  });
  assert.equal(acked.acked.length, open.length);
  const empty = await agent.ok("get_inbox");
  assert.equal(empty.items.length, 0);
  assert.equal(empty.unread, 0);
});
