import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import nodemailer from "nodemailer";

// Capture every email the app tries to send.
const sent: { to: string; subject: string; text: string }[] = [];
mock.method(nodemailer, "createTransport", () => ({
  sendMail: async (m: { to: string; subject: string; text: string }) => {
    sent.push({ to: m.to, subject: m.subject, text: m.text });
    return { messageId: "test" };
  },
  close: () => {},
  verify: async () => true,
}));

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { scanDigests } = await import("../src/worker/digest.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");

const app = await buildApp();
let token = "";
let userId = "";
let email = "";
const auth = () => ({ authorization: `Bearer ${token}` });
const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: auth(),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

async function setMail(on: boolean) {
  if (on)
    await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ('smtp', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify({ host: "smtp.test", port: 587, from: "orbyn@test" })],
    );
  else await pool.query("DELETE FROM system_settings WHERE key='smtp'");
  invalidateSettings();
}

before(async () => {
  await migrate();
  email = `digest-${randomUUID()}@example.com`;
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "a-long-test-password", name: "Dana" },
  });
  token = reg.json().token;
  userId = reg.json().user.id;
  // A task due today, so the morning agenda has something to say.
  await call("POST", "/items", {
    title: "File the report",
    kind: "task",
    due_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  });
});
after(async () => {
  await pool.query("DELETE FROM system_settings WHERE key='smtp'");
  await app.close();
  await pool.end();
});

test("a test digest previews the day and needs a mail server", async () => {
  await setMail(false);
  assert.equal(
    (await call("POST", "/planner/digest/test", {})).statusCode,
    503,
  );

  await setMail(true);
  const hiddenProject = await call("POST", "/projects", {
    name: "Hidden brief project",
  });
  assert.equal(hiddenProject.statusCode, 201, hiddenProject.body);
  const hiddenTask = await call("POST", "/items", {
    title: "SECRET_HIDDEN_BRIEF_TASK",
    kind: "task",
    due_at: new Date(Date.now() + 2 * 3_600_000).toISOString(),
  });
  assert.equal(hiddenTask.statusCode, 201, hiddenTask.body);
  await call("PUT", `/items/${hiddenTask.json().id}/project`, {
    project_id: hiddenProject.json().id,
  });
  await pool.query("UPDATE projects SET assistant_off = true WHERE id = $1", [
    hiddenProject.json().id,
  ]);
  const hiddenGoal = await call("POST", "/me/goals", {
    title: "SECRET_HIDDEN_BRIEF_GOAL",
    project_id: hiddenProject.json().id,
  });
  assert.equal(hiddenGoal.statusCode, 201, hiddenGoal.body);
  const person = (
    await pool.query<{ name: string; role: "member" }>(
      "SELECT name, role FROM users WHERE id = $1",
      [userId],
    )
  ).rows[0];
  const assistant = await assistantPrincipal({ ...person, id: userId });
  await pool.query(
    `INSERT INTO agent_questions (grant_id, user_id, question, choices, expires_at)
     VALUES ($1, $2, 'Is SECRET_HIDDEN_BRIEF_TASK still on track?',
       ARRAY['Yes', 'No'], now() + interval '1 day')`,
    [assistant.grant_id, userId],
  );

  sent.length = 0;
  const r = await call("POST", "/planner/digest/test", { kind: "morning" });
  assert.equal(r.statusCode, 204, r.body);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, email);
  assert.match(sent[0].subject, /preview/i);
  assert.match(sent[0].text, /Good morning, Dana/);
  assert.match(sent[0].text, /File the report/);
  assert.match(sent[0].text, /Brief summary: .*1 task due/);
  const brief = await pool.query<{ doc_id: string; local_day: string }>(
    "SELECT doc_id, local_day::text FROM assistant_briefs WHERE user_id = $1",
    [userId],
  );
  assert.equal(brief.rowCount, 1, "one brief is saved for the local day");
  assert.match(sent[0].text, new RegExp(`/app/doc/${brief.rows[0].doc_id}`));
  const saved = await call("GET", `/docs/${brief.rows[0].doc_id}`);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().kind, "agent");
  assert.equal(saved.json().team_id, null, "the brief stays in Personal");
  assert.match(JSON.stringify(saved.json().content), /Goal progress/);
  assert.match(JSON.stringify(saved.json().content), /Ideas ready to review/);
  assert.match(JSON.stringify(saved.json().content), /Questions and approvals/);
  assert.doesNotMatch(
    JSON.stringify(saved.json().content),
    /SECRET_HIDDEN_BRIEF_(TASK|GOAL)|still on track/i,
  );

  sent.length = 0;
  const repeats = await Promise.all([
    call("POST", "/planner/digest/test", { kind: "morning" }),
    call("POST", "/planner/digest/test", { kind: "morning" }),
  ]);
  assert.ok(repeats.every((response) => response.statusCode === 204));
  const sameDay = await pool.query<{ doc_id: string }>(
    "SELECT doc_id FROM assistant_briefs WHERE user_id = $1",
    [userId],
  );
  assert.equal(sameDay.rowCount, 1, "parallel runs share the same daily brief");
  assert.equal(sameDay.rows[0].doc_id, brief.rows[0].doc_id);
});

test("the scan sends a due morning digest exactly once a day", async () => {
  await setMail(true);
  // Turn the morning digest on, set to a time already past today.
  await call("PUT", "/planner/prefs", {
    timezone: "UTC",
    digest: { morning: true, morning_time: "00:00" },
  });
  sent.length = 0;

  await scanDigests(new Date());
  const first = sent.filter((m) => m.to === email);
  assert.equal(first.length, 1, "one digest sent");
  assert.match(first[0].subject, /day ahead/i);

  // Running again the same day sends nothing more.
  await scanDigests(new Date());
  assert.equal(sent.filter((m) => m.to === email).length, 1, "not resent");

  const claimed = await pool.query(
    "SELECT 1 FROM digest_sends WHERE user_id=$1 AND kind='morning'",
    [userId],
  );
  assert.equal(claimed.rowCount, 1);
});

test("a digest that isn't due yet, or is off, is not sent", async () => {
  await setMail(true);
  // Evening off; morning due-time in the far future.
  await call("PUT", "/planner/prefs", {
    timezone: "UTC",
    digest: {
      morning: true,
      morning_time: "23:59",
      evening: false,
    },
  });
  await pool.query("DELETE FROM digest_sends WHERE user_id=$1", [userId]);
  sent.length = 0;
  // 12:00 UTC is before 23:59, so nothing goes out.
  await scanDigests(new Date("2026-02-02T12:00:00Z"));
  assert.equal(sent.filter((m) => m.to === email).length, 0);
});

test("no digests are sent without a mail server", async () => {
  await setMail(false);
  await pool.query("DELETE FROM digest_sends WHERE user_id=$1", [userId]);
  sent.length = 0;
  await scanDigests(new Date());
  assert.equal(sent.length, 0);
  await setMail(true);
});
