import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Every AI feature sees the real calendar: the assistant (both the fixed
 * graph used for Matilda and the tool loop), today's agenda and its
 * assistant-written summary, and the morning agenda the worker writes. A
 * stand-in provider records exactly what each call is sent.
 */
type Sent = {
  body: {
    messages: { role: string; content: string }[];
    tools?: unknown[];
  };
};
let replies: string[] = [];
let sent: Sent[] = [];

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
const provider = createServer(async (req, res) => {
  sent.push({ body: JSON.parse((await read(req)) || "{}") });
  const content = replies.shift() ?? "Done.";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content } }],
    }),
  );
});
await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
const providerUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;

process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { scanMorningAgendas } = await import("../src/worker/agenda.js");
const { addDays, dayTime, localDateKey } = await import("@orbyn/core");
const app = await buildApp();

const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.14.${Math.floor(++caller / 250)}.${caller % 250}`;
const today = () => localDateKey(new Date(), TZ);
const at = (offset: number, hour: number, minute = 0) =>
  dayTime(addDays(today(), offset), hour * 60 + minute, TZ).toISOString();

let matilda = "";
let plain = "";

async function call(
  token: string,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
) {
  const r = await app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: r.statusCode, body: r.body ? r.json() : null, raw: r };
}

/**
 * Someone with a class timetable and an exam calendar subscribed, a daily
 * standup that started last week (so today's is a repeat, not its first
 * date), and an hour set aside for a task.
 */
async function student() {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: address(),
    payload: {
      email: `aical-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Student",
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const token = r.json().token as string;
  const id = r.json().user.id as string;
  await call(token, "PUT", "/planner/prefs", {
    timezone: TZ,
    work_days: [0, 1, 2, 3, 4, 5, 6],
    work_start: "08:00",
    work_end: "20:00",
  });
  const sub = async (name: string, kind: string, allDayBusy = false) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO calendar_subscriptions (user_id, url, name, kind, busy, all_day_busy, last_fetched_at)
         VALUES ($1, $2, $3, $4, true, $5, now()) RETURNING id`,
        [
          id,
          `https://93.184.216.34/${randomUUID()}.ics`,
          name,
          kind,
          allDayBusy,
        ],
      )
    ).rows[0].id;
  const uni = await sub("Uni timetable", "classes");
  const exams = await sub("Exams", "exams", true);
  await pool.query(
    `INSERT INTO external_events (subscription_id, uid, title, starts_at, ends_at, location, timezone)
     VALUES ($1, 'lecture', 'Algorithms lecture', $2, $3, 'Theatre 1', $4)`,
    [uni, at(0, 14), at(0, 16), TZ],
  );
  await pool.query(
    `INSERT INTO external_events (subscription_id, uid, title, starts_at, ends_at, all_day, timezone)
     VALUES ($1, 'exam', 'Final exam', $2, $3, true, $4)`,
    [exams, at(3, 0), at(4, 0), TZ],
  );
  const standup = await call(token, "POST", "/items", {
    kind: "event",
    title: "Team standup",
    due_at: at(-7, 9),
    end_at: at(-7, 9, 15),
    rrule: "FREQ=DAILY",
    timezone: TZ,
  });
  assert.equal(standup.status, 201, standup.raw.body);
  const task = await call(token, "POST", "/items", {
    kind: "task",
    title: "Write the essay",
  });
  const block = await call(token, "POST", "/blocks", {
    item_id: task.body.id,
    start_at: at(0, 11),
    end_at: at(0, 12),
  });
  assert.equal(block.status, 201, block.raw.body);
  return { token, id };
}

const useProvider = (id: string | null) =>
  pool.query(
    "UPDATE ai_settings SET provider_id=$1, model='stand-in' WHERE id",
    [id],
  );
const reset = (...next: string[]) => {
  replies = next;
  sent = [];
};
/** The last user message a call was sent. */
const lastUser = (s: Sent) =>
  s.body.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
const texts = (doc: { content: { text?: string }[] }) =>
  doc.content.map((b) => b.text ?? "");

before(async () => {
  await migrate();
  matilda = (
    await pool.query<{ id: string }>(
      "INSERT INTO ai_providers(kind, name, base_url) VALUES ('matilda', 'Calendar stand-in (graph)', $1) RETURNING id",
      [providerUrl],
    )
  ).rows[0].id;
  plain = (
    await pool.query<{ id: string }>(
      "INSERT INTO ai_providers(kind, name, base_url) VALUES ('openai-compatible', 'Calendar stand-in (tools)', $1) RETURNING id",
      [providerUrl],
    )
  ).rows[0].id;
});
after(async () => {
  await useProvider(null);
  await app.close();
  await pool.end();
  provider.close();
});

test("the assistant (Matilda's graph) answers from the real calendar", async () => {
  await useProvider(matilda);
  const me = await student();
  reset(
    "You have your standup at 9, time for the essay at 11 and the Algorithms lecture at 2.",
  );
  const r = await call(me.token, "POST", "/ai/chat", {
    message: "What's on today?",
    timezone: TZ,
  });
  assert.equal(r.status, 200, r.raw.body);
  const data = lastUser(sent[0]);
  // The subscribed class, today's repeat of the standup, and the time set aside.
  assert.match(data, /Algorithms lecture/);
  assert.match(data, /Uni timetable \(classes\)/);
  assert.match(data, /"read_only":true/);
  assert.match(data, /Team standup/);
  assert.match(data, /Write the essay/);
  assert.match(data, /free_today/);
  // And the model is told what the calendar is.
  assert.match(sent[0].body.messages[0].content, /subscribe to/);
});

test("a request that names a class finds it further ahead", async () => {
  await useProvider(matilda);
  const me = await student();
  await pool.query(
    `INSERT INTO external_events (subscription_id, uid, title, starts_at, ends_at, timezone)
     SELECT id, 'lab', 'Compilers lab', $2, $3, $4 FROM calendar_subscriptions
      WHERE user_id = $1 AND name = 'Uni timetable'`,
    [me.id, at(20, 10), at(20, 12), TZ],
  );
  reset("Your next Compilers lab is in 20 days.");
  const r = await call(me.token, "POST", "/ai/chat", {
    message: "When is my compilers lab?",
    timezone: TZ,
  });
  assert.equal(r.status, 200, r.raw.body);
  assert.match(
    lastUser(sent[0]),
    /"matching_calendar":\[\{[^\]]*Compilers lab/,
  );
});

test("with a per-message limit, the data is cut to fit and the request is whole", async () => {
  await useProvider(matilda);
  const me = await student();
  // A calendar far fuller than fits in 16,000 characters.
  await pool.query(
    `INSERT INTO external_events (subscription_id, uid, title, starts_at, ends_at, location, timezone)
     SELECT s.id, 'busy-' || n,
            'A very long subscribed event title number ' || n || ' that takes up a great deal of room',
            $2::timestamptz + (n * interval '5 minutes'), $2::timestamptz + (n * interval '5 minutes') + interval '1 hour',
            'Building ' || n || ', Room with a long name', $3
       FROM calendar_subscriptions s, generate_series(1, 90) n
      WHERE s.user_id = $1 AND s.name = 'Uni timetable'`,
    [me.id, at(0, 12), TZ],
  );
  reset("Here's your day.");
  const message = "What do I have on today?";
  const r = await call(me.token, "POST", "/ai/chat", {
    message,
    timezone: TZ,
  });
  assert.equal(r.status, 200, r.raw.body);
  const content = lastUser(sent[0]);
  assert.ok(content.length <= 16_000, `${content.length} characters`);
  assert.ok(!content.endsWith("…"), "nothing clipped off the end");
  assert.ok(content.includes(`My request: ${message}`));
  // The calendar was shortened to fit, keeping the start of the day.
  const shown = content.match(/A very long subscribed event/g)?.length ?? 0;
  assert.ok(shown < 40, `${shown} of 90 shown`);
  assert.match(content, /Team standup/);
});

test("the tool-using assistant gets the calendar in its overview too", async () => {
  await useProvider(plain);
  const me = await student();
  reset("Your day: standup, essay time, then the lecture.");
  const r = await call(me.token, "POST", "/ai/chat", {
    message: "What's on today?",
    timezone: TZ,
  });
  assert.equal(r.status, 200, r.raw.body);
  const system = sent[0].body.messages[0].content;
  assert.match(system, /Algorithms lecture/);
  assert.match(system, /Team standup/);
  assert.match(system, /get_calendar/);
});

test("today's agenda is written from the calendar, without waiting on the AI", async () => {
  await useProvider(plain);
  const me = await student();
  reset();
  const r = await call(me.token, "GET", "/agenda/today");
  assert.equal(r.status, 200, r.raw.body);
  const lines = texts(r.body);
  assert.ok(lines.includes("Schedule"));
  assert.ok(lines.includes("Afternoon"), "grouped by part of the day");
  const lecture = lines.find((l) => /Algorithms lecture/.test(l));
  assert.ok(lecture, lines.join(" | "));
  assert.match(lecture!, /^14:00–16:00 · Algorithms lecture — Theatre 1$/);
  assert.ok(
    !lines.some((l) => /Uni timetable/.test(l)),
    "calendar names stay out of the page",
  );
  assert.ok(
    lines.some((l) => /Team standup/.test(l)),
    "today's repeat",
  );
  assert.ok(lines.includes("Focus time"));
  assert.ok(lines.some((l) => /Write the essay/.test(l)));
  assert.ok(lines.some((l) => /Final exam/.test(l)));
  assert.ok(lines.includes("Top priorities"));
  assert.ok(lines.includes("Notes"));
  assert.ok(lines.includes("End of day"));
  assert.equal(sent.length, 0, "opening the agenda asks no provider");
  // Asking again the same day keeps the same page.
  const again = await call(me.token, "GET", "/agenda/today");
  assert.equal(again.body.id, r.body.id);
});

test("rewriting the agenda opens with the assistant's summary of the day", async () => {
  await useProvider(plain);
  const me = await student();
  const first = (await call(me.token, "GET", "/agenda/today")).body;
  const summary =
    "Your standup is at 9, then an hour on the essay at 11 and the Algorithms lecture at 2. Your final exam is on the way.";
  reset(summary);
  const r = await call(me.token, "POST", "/ai/agenda/today");
  assert.equal(r.status, 200, r.raw.body);
  assert.equal(r.body.id, first.id, "the same page, rewritten");
  assert.equal(r.body.brief, true);
  assert.equal(texts(r.body)[0], summary);
  assert.ok(r.body.version > first.version);
  // The provider was given the day as facts, subscribed calendars included.
  const facts = lastUser(sent[0]);
  assert.match(facts, /Algorithms lecture/);
  assert.doesNotMatch(facts, /Uni timetable/, "calendar names stay out");
  assert.match(facts, /Final exam/);
  assert.match(sent[0].body.messages[0].content, /never invent/i);
});

test("without a provider, rewriting still works, without a summary", async () => {
  await useProvider(null);
  const me = await student();
  reset();
  const r = await call(me.token, "POST", "/ai/agenda/today");
  assert.equal(r.status, 200, r.raw.body);
  assert.equal(r.body.brief, false);
  assert.match(texts(r.body)[0], /^Today: /);
  assert.equal(sent.length, 0);
});

test("the morning agenda is written by the worker, with the summary", async () => {
  await useProvider(plain);
  const me = await student();
  const morning = new Date(at(0, 7));
  reset(
    "A full day: standup, essay time and your lecture, with the exam ahead.",
  );
  const written = await scanMorningAgendas(morning, { only: [me.id] });
  assert.equal(written, 1);
  const doc = (await call(me.token, "GET", "/agenda/today")).body;
  assert.equal(
    texts(doc)[0],
    "A full day: standup, essay time and your lecture, with the exam ahead.",
  );
  // Once written, the next pass leaves it alone.
  reset();
  assert.equal(await scanMorningAgendas(morning, { only: [me.id] }), 0);
  assert.equal(sent.length, 0);
  // Outside the morning, nothing is written.
  const other = await student();
  assert.equal(
    await scanMorningAgendas(new Date(at(0, 15)), { only: [other.id] }),
    0,
  );
});
