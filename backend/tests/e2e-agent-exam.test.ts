import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { trapNetwork, type Person } from "./mcp-helpers.js";
import { type AgentClient, idOf, scenario } from "./e2e-agent-helpers.js";

/**
 * H9 scenario (d): quiz and exam prep. The person's About me page says
 * when they study and for how long; the agent writes practice-first cards
 * into a deck, names the exam and books its revision in one update_study
 * (plan: true), inside those study times and at that length. Then the quiz
 * loop, one card at a time: get_study queue (answer hidden) → the person
 * answers → get_study card (the answer, to judge) → update_study rating.
 * A card they keep getting wrong moves to the front and is named in wrong.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
const { h, connect } = scenario(app);
const network = await trapNetwork();

const TZ = "Europe/Berlin";
let sam: Person;
let agent: AgentClient;
let deck = "";

const dayAhead = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
/** An instant's wall-clock time in Berlin, "HH:MM". */
const berlin = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });

before(async () => {
  await migrate();
  sam = await h.register("e2e-exam-sam", "Sam");
  await h.call(sam.token, "PUT", "/planner/prefs", {
    timezone: TZ,
    work_days: [0, 1, 2, 3, 4, 5, 6],
    work_start: "09:00",
    work_end: "17:00",
  });
  agent = await connect(sam, { toolsets: ["study"], name: "Study agent" });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, [], "studying never reached the network");
  network.restore();
  await app.close();
  await pool.end();
});

test("exam prep: cards into a deck, the exam named and revision booked in the study times", async () => {
  // The person's page for agents: evenings, 25 minutes at a time.
  await agent.ok("create_doc", {
    title: "About me",
    kind: "profile",
    markdown:
      "## How I like cards\n\n- Card style: question and answer\n\n## Study times\n\n- Session length: 25 minutes\n- Study times: 19:00–21:00",
  });
  const ctx = await agent.ok("get_context");
  assert.equal(ctx.learning.session_minutes, 25);

  const cards = await agent.ok("update_study", {
    cards: {
      new_deck: "Genetics deck",
      items: [
        { q: "What does DNA stand for?", a: "Deoxyribonucleic acid" },
        { q: "How many chromosomes do humans have?", a: "46" },
        { q: "What pairs with adenine?", a: "Thymine" },
        { cloze: "Genes are made of {{DNA}}" },
      ],
    },
  });
  deck = idOf(cards.done.find((d: any) => d.id.startsWith("doc:")).id);

  const booked = await agent.ok("update_study", {
    exam: {
      title: "Genetics final",
      date: dayAhead(10),
      pages: [`doc:${deck}`],
      target: "80%",
      plan: true,
    },
  });
  const revise = booked.done.find((d: any) => /Revise for/.test(d.title));
  assert.ok(revise, JSON.stringify(booked));
  const sessions = (
    await pool.query<{ start_at: Date; end_at: Date }>(
      "SELECT start_at, end_at FROM time_blocks WHERE item_id = $1 ORDER BY start_at",
      [idOf(revise.id)],
    )
  ).rows;
  assert.ok(sessions.length >= 5, `${sessions.length} sessions`);
  for (const s of sessions) {
    const start = berlin(s.start_at.toISOString());
    const end = berlin(s.end_at.toISOString());
    assert.ok(
      start >= "19:00" && end <= "21:00",
      `${start}–${end} is in the study times`,
    );
  }
  // Their session length, except the longer last days.
  const minutes = sessions.map(
    (s) => (s.end_at.getTime() - s.start_at.getTime()) / 60_000,
  );
  assert.equal(minutes[0], 25);
  const study = await agent.ok("get_study");
  const exam = study.exams.find((e: any) => e.title === "Genetics final");
  assert.ok(exam);
  assert.deepEqual(exam.pages, [`doc:${deck}`]);
});

test("quiz loop: one card at a time, answer hidden, revealed after trying, rated; misses move to the front", async () => {
  const seen = new Set<string>();
  let missed = "";
  // Go through the deck once: the person gets DNA wrong, the rest right.
  for (let turn = 0; turn < 4; turn++) {
    const q = await agent.ok("get_study", {
      queue: true,
      deck: `doc:${deck}`,
      limit: 1,
    });
    assert.equal(q.queue.length, 1, `turn ${turn}`);
    const card = q.queue[0];
    assert.equal(card.answer, null, "the answer stays hidden");
    assert.ok(!seen.has(card.card), "each card once");
    seen.add(card.card);
    // The person answered in the chat; the agent looks at the answer to judge.
    const shown = await agent.ok("get_study", { card: card.card });
    assert.ok(shown.queue[0].answer, "revealed once asked for");
    const wrong = /DNA stand/.test(card.question);
    if (wrong) missed = card.card;
    await agent.ok("update_study", {
      reviews: [{ card: card.card, rating: wrong ? "again" : "good" }],
    });
  }
  assert.ok(missed, "the DNA card came up");
  // Twice more wrong: it keeps getting missed.
  for (let i = 0; i < 2; i++)
    await agent.ok("update_study", {
      reviews: [{ card: missed, rating: "again" }],
    });
  const study = await agent.ok("get_study");
  assert.equal(study.wrong[0].card, missed, "named in what they keep missing");
  assert.equal(study.wrong[0].misses, 3);
  // Practice first: it leads the queue, ahead of cards merely due.
  const next = await agent.ok("get_study", {
    queue: true,
    deck: `doc:${deck}`,
    ahead: true,
  });
  assert.equal(next.queue[0].card, missed);
  assert.ok(next.queue.every((c: any) => c.answer === null));
});
