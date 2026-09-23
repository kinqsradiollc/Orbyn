import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Study: cards written in pages as "Question :: Answer", reviewed with
 * spaced repetition per person, exams from the calendar with pages attached,
 * revision planned into free time and applied only when approved, and the
 * assistant's card suggestions, grading and explanations — from the page
 * alone, through a stand-in provider.
 */
let replies: string[] = [];
let sent: { messages: { role: string; content: string }[] }[] = [];
const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
const provider = createServer(async (req, res) => {
  sent.push(JSON.parse((await read(req)) || "{}"));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { content: replies.shift() ?? "{}" },
        },
      ],
    }),
  );
});
await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
const providerUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;

process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { addDays, dayTime, localDateKey, withCards } =
  await import("@orbyn/core");
const app = await buildApp();
const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.16.${Math.floor(++caller / 250)}.${caller % 250}`;
const at = (offset: number, hour: number) =>
  dayTime(
    addDays(localDateKey(new Date(), TZ), offset),
    hour * 60,
    TZ,
  ).toISOString();

type Json = Record<string, any>;
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
  return {
    status: r.statusCode,
    body: r.body ? (r.json() as any) : null,
    raw: r,
  };
}
async function student(name = "Student") {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: address(),
    payload: {
      email: `study-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const token = r.json().token as string;
  await call(token, "PUT", "/planner/prefs", {
    timezone: TZ,
    work_days: [0, 1, 2, 3, 4, 5, 6],
    work_start: "09:00",
    work_end: "17:00",
  });
  return { token, id: r.json().user.id as string };
}
const lines = (...texts: string[]) =>
  texts.map((text) => ({ type: "paragraph", text }));
async function page(
  token: string,
  title: string,
  content: Json[],
  extra: Json = {},
) {
  const r = await call(token, "POST", "/docs", { title, content, ...extra });
  assert.equal(r.status, 201, r.raw.body);
  return r.body as Json;
}

before(async () => {
  await migrate();
});
after(async () => {
  await pool.query("UPDATE ai_settings SET provider_id = NULL WHERE id");
  await app.close();
  await pool.end();
  provider.close();
});

test("cards come from Question :: Answer lines, and only from them", async () => {
  const me = await student();
  const notes = await page(me.token, "Distributed Systems", [
    ...lines(
      "Lecture 3 notes",
      "What does CAP stand for? :: Consistency, availability, partition tolerance",
      "Who is elected in Raft? :: A leader, by majority vote",
      "A line with a colon: not a card",
    ),
  ]);
  const s = (await call(me.token, "GET", "/study")).body;
  const deck = s.decks.find((d: Json) => d.doc_id === notes.id);
  assert.equal(deck.cards, 2);
  assert.equal(deck.new, 2);
  assert.equal(s.new_cards, 2);
  const queue = (await call(me.token, "GET", `/study/queue?doc_id=${notes.id}`))
    .body;
  assert.deepEqual(
    queue.map((c: Json) => c.question),
    ["What does CAP stand for?", "Who is elected in Raft?"],
  );
  assert.equal(queue[0].next.good, "4 days");
});

test("reviews schedule each card, and forgetting brings it back soon", async () => {
  const me = await student();
  const notes = await page(
    me.token,
    "Algorithms",
    lines("Big-O of binary search? :: O(log n)"),
  );
  const [card] = (
    await call(me.token, "GET", `/study/queue?doc_id=${notes.id}`)
  ).body;
  const good = (
    await call(me.token, "POST", `/study/cards/${card.id}/review`, {
      rating: "good",
    })
  ).body;
  const days = (Date.parse(good.due_at) - Date.now()) / 86_400_000;
  assert.ok(days > 3.5 && days < 4.5, `due in ${days} days`);
  assert.equal(good.reps, 1);
  const again = (
    await call(me.token, "POST", `/study/cards/${card.id}/review`, {
      rating: "again",
    })
  ).body;
  const minutes = (Date.parse(again.due_at) - Date.now()) / 60_000;
  assert.ok(minutes > 8 && minutes < 12, `due in ${minutes} minutes`);
  assert.equal(again.lapses, 1);
  const s = (await call(me.token, "GET", "/study")).body;
  assert.equal(s.reviewed_today, 2);
  assert.equal(s.streak, 1);
  assert.equal(s.weak[0].question, "Big-O of binary search?");
  // Someone else can't review your card.
  const other = await student();
  assert.equal(
    (
      await call(other.token, "POST", `/study/cards/${card.id}/review`, {
        rating: "good",
      })
    ).status,
    404,
  );
});

test("editing the page edits the card; deleting the line drops it", async () => {
  const me = await student();
  const notes = await page(me.token, "Networks", [
    { type: "bullet", id: "b-tcp", text: "TCP is? :: Reliable" },
    ...lines("UDP is? :: Unreliable"),
  ]);
  const [tcp] = (await call(me.token, "GET", `/study/queue?doc_id=${notes.id}`))
    .body;
  await call(me.token, "POST", `/study/cards/${tcp.id}/review`, {
    rating: "easy",
  });
  const saved = await call(me.token, "PUT", `/docs/${notes.id}`, {
    version: notes.version,
    content: [
      { type: "bullet", id: "b-tcp", text: "TCP is? :: Reliable and ordered" },
    ],
  });
  assert.equal(saved.status, 200, saved.raw.body);
  const cards = (
    await call(me.token, "GET", `/study/queue?doc_id=${notes.id}&ahead=true`)
  ).body;
  assert.equal(cards.length, 1, "UDP's line is gone, so is its card");
  assert.equal(cards[0].id, tcp.id, "the named line kept its card");
  assert.equal(cards[0].answer, "Reliable and ordered");
  assert.equal(cards[0].reps, 1, "and its review history");
});

test("twenty new cards a day at most, however long the page", async () => {
  const me = await student();
  await page(
    me.token,
    "Vocabulary",
    lines(...Array.from({ length: 30 }, (_, n) => `Word ${n} :: Meaning ${n}`)),
  );
  const s = (await call(me.token, "GET", "/study")).body;
  assert.equal(s.new_cards, 20);
  assert.equal((await call(me.token, "GET", "/study/queue")).body.length, 20);
});

test("a team page's cards are studied by each member, not by outsiders", async () => {
  const owner = await student("Owner");
  const mate = await student("Mate");
  const outsider = await student("Outsider");
  const team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Study group', $1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')",
    [team, owner.id, mate.id],
  );
  const shared = await page(
    owner.token,
    "Group notes",
    lines("Paxos? :: Consensus"),
    {
      team_id: team,
    },
  );
  const has = async (token: string) =>
    (await call(token, "GET", "/study")).body.decks.some(
      (d: Json) => d.doc_id === shared.id,
    );
  assert.equal(await has(owner.token), true);
  assert.equal(await has(mate.token), true);
  assert.equal(await has(outsider.token), false);
  const [mine] = (
    await call(owner.token, "GET", `/study/queue?doc_id=${shared.id}`)
  ).body;
  await call(owner.token, "POST", `/study/cards/${mine.id}/review`, {
    rating: "good",
  });
  const [theirs] = (
    await call(mate.token, "GET", `/study/queue?doc_id=${shared.id}`)
  ).body;
  assert.equal(theirs.reps, 0, "each member on their own schedule");
});

test("an exam on the calendar gets pages attached, and revision planned around classes", async () => {
  const me = await student();
  const notes = await page(
    me.token,
    "Algorithms",
    lines("Dijkstra? :: Shortest paths"),
  );
  // An exams calendar with an exam in 5 days, and a class each morning.
  const sub = (
    await pool.query<{ id: string }>(
      `INSERT INTO calendar_subscriptions (user_id, url, name, kind, busy, last_fetched_at)
       VALUES ($1, $2, 'Exams', 'exams', true, now()) RETURNING id`,
      [me.id, `https://93.184.216.34/${randomUUID()}.ics`],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO external_events (subscription_id, uid, title, starts_at, ends_at, timezone)
     VALUES ($1, 'exam', 'Algorithms final exam', $2, $3, $4)`,
    [sub, at(5, 9), at(5, 12), TZ],
  );
  const classes = (
    await pool.query<{ id: string }>(
      `INSERT INTO calendar_subscriptions (user_id, url, name, kind, busy, last_fetched_at)
       VALUES ($1, $2, 'Uni', 'classes', true, now()) RETURNING id`,
      [me.id, `https://93.184.216.34/${randomUUID()}.ics`],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO external_events (subscription_id, uid, title, starts_at, ends_at, rrule, timezone)
     VALUES ($1, 'class', 'Lecture', $2, $3, 'FREQ=DAILY', $4)`,
    [classes, at(-1, 9), at(-1, 11), TZ],
  );
  const s = (await call(me.token, "GET", "/study")).body;
  const exam = s.exams.find((e: Json) => e.title === "Algorithms final exam");
  assert.ok(exam, JSON.stringify(s.exams));
  assert.equal(exam.readiness, null);
  const attached = (
    await call(me.token, "PUT", "/study/exams", {
      key: exam.key,
      title: exam.title,
      starts_at: exam.starts_at,
      doc_ids: [notes.id],
    })
  ).body.exams.find((e: Json) => e.key === exam.key);
  assert.deepEqual(attached.doc_ids, [notes.id]);
  assert.equal(attached.readiness, 0);

  const plan = (
    await call(me.token, "POST", "/study/revision/plan", {
      key: exam.key,
      minutes: 30,
      timezone: TZ,
    })
  ).body;
  assert.ok(plan.sessions.length >= 4, JSON.stringify(plan));
  for (const s of plan.sessions) {
    assert.ok(s.end_at <= exam.starts_at, "before the exam");
    const start = new Date(s.start_at).toLocaleTimeString("en-GB", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
    });
    assert.ok(start >= "11:00", `after the 9–11 class, not ${start}`);
  }
  const last = plan.sessions.at(-1);
  assert.equal(
    (Date.parse(last.end_at) - Date.parse(last.start_at)) / 60_000,
    45,
    "longer in the last three days",
  );
  // Nothing is saved until applied.
  const before = await pool.query(
    "SELECT 1 FROM time_blocks WHERE user_id = $1",
    [me.id],
  );
  assert.equal(before.rowCount, 0);
  const applied = await call(me.token, "POST", "/study/revision/apply", {
    key: exam.key,
    sessions: plan.sessions,
  });
  assert.equal(applied.status, 201, applied.raw.body);
  const task = (
    await pool.query<{ title: string; due_at: Date }>(
      "SELECT title, due_at FROM items WHERE id = $1",
      [applied.body.item_id],
    )
  ).rows[0];
  assert.equal(task.title, "Revise for Algorithms final exam");
  assert.equal(
    task.due_at.toISOString(),
    new Date(exam.starts_at).toISOString(),
  );
  assert.equal(applied.body.block_ids.length, plan.sessions.length);
});

test("the agenda has a Study section for someone with cards", async () => {
  const me = await student();
  await page(me.token, "Chemistry", lines("pH of water? :: 7"));
  const agenda = (
    await call(
      me.token,
      "GET",
      `/agenda/today?timezone=${encodeURIComponent(TZ)}`,
    )
  ).body;
  const text = agenda.content.map((b: Json) => b.text ?? "");
  assert.ok(text.includes("Study"), text.join(" | "));
  assert.ok(text.some((t: string) => /1 new/.test(t)));
});

test("the assistant suggests cards from the page alone, and they're only added when approved", async () => {
  const me = await student();
  const standIn = (
    await pool.query<{ id: string }>(
      "INSERT INTO ai_providers(kind, name, base_url) VALUES ('openai-compatible', 'Study stand-in', $1) RETURNING id",
      [providerUrl],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id = $1, model = 'stand-in' WHERE id",
    [standIn],
  );
  const notes = await page(
    me.token,
    "Operating systems",
    lines(
      "A process is a program in execution.",
      "What is a thread? :: A unit of execution within a process",
    ),
  );
  sent = [];
  replies = [
    JSON.stringify({
      cards: [
        {
          question: "What is a process?",
          answer: "A program in execution",
          source: "A process is a program in execution.",
        },
        // Already on the page: left out.
        {
          question: "What is a thread?",
          answer: "A unit of execution",
          source: "",
        },
      ],
    }),
  ];
  const suggested = await call(
    me.token,
    "POST",
    `/ai/study/pages/${notes.id}/cards`,
  );
  assert.equal(suggested.status, 200, suggested.raw.body);
  assert.deepEqual(
    suggested.body.cards.map((c: Json) => c.question),
    ["What is a process?"],
  );
  assert.match(
    sent[0].messages[1].content,
    /A process is a program in execution/,
  );
  assert.match(sent[0].messages[0].content, /Use only what the notes say/);
  // Suggesting added nothing.
  const count = async () =>
    (await call(me.token, "GET", "/study")).body.decks.find(
      (d: Json) => d.doc_id === notes.id,
    ).cards;
  assert.equal(await count(), 1);
  // Approving adds the ticked ones to the page (as the apps do).
  const full = (await call(me.token, "GET", `/docs/${notes.id}`)).body;
  const saved = await call(me.token, "PUT", `/docs/${notes.id}`, {
    version: full.version,
    content: withCards(full.content, [
      { question: "What is a process?", answer: "A program in execution" },
    ]),
  });
  assert.equal(saved.status, 200, saved.raw.body);
  assert.equal(await count(), 2);

  // Grading a typed answer, and explaining a card.
  const [card] = (
    await call(me.token, "GET", `/study/queue?doc_id=${notes.id}`)
  ).body;
  replies = [
    JSON.stringify({
      verdict: "partly",
      feedback: "Close — you missed 'within a process'.",
    }),
  ];
  const graded = await call(me.token, "POST", "/ai/study/grade", {
    card_id: card.id,
    answer: "a unit of execution",
  });
  assert.equal(graded.status, 200, graded.raw.body);
  assert.equal(graded.body.verdict, "partly");
  assert.equal(graded.body.suggested_rating, "hard");
  replies = [
    JSON.stringify({
      explanation: "Threads share their process's memory.",
      beyond_notes: true,
    }),
  ];
  const explained = await call(
    me.token,
    "POST",
    `/ai/study/cards/${card.id}/explain`,
  );
  assert.equal(explained.status, 200, explained.raw.body);
  assert.equal(explained.body.beyond_notes, true);

  // Without a provider the assistant parts say so; reviewing still works.
  await pool.query("UPDATE ai_settings SET provider_id = NULL WHERE id");
  assert.equal(
    (await call(me.token, "POST", `/ai/study/pages/${notes.id}/cards`)).status,
    503,
  );
  assert.equal(
    (
      await call(me.token, "POST", `/study/cards/${card.id}/review`, {
        rating: "good",
      })
    ).status,
    200,
  );
});
