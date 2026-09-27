import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import {
  helpers,
  trapNetwork,
  bearer,
  META_KEYS,
  MODERN,
  type Person,
} from "./mcp-helpers.js";

/**
 * H4: study from anything, practice first. The agent writes the cards and
 * judges answers; Orbyn stores, orders and schedules. Cards of each kind
 * (question/answer, cloze, picture) linked to the notes line they came
 * from, into a page's Cards section or a new deck, and undone; the quiz
 * order (needs work, most missed, due, new; decks interleaved) with no
 * answers until one is asked for; exams named, changed and planned in one
 * call (asking first under "ask" trust); explain-it-back returning only
 * notes this connection can read; misses tracked from reviews.
 */

process.env.FILES_SECRET ??= "test-files-secret-0123456789abcdef";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { drainStudyQueue, interleave } =
  await import("../src/modules/study/service.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { AGENT_TOOLSETS, cardsInBlocks, cardSource, dayTime } =
  await import("@orbyn/core");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

let olga: Person;
let mo: Person;
let crew = "";
const keys: Record<string, string> = {};
const ALL = [...AGENT_TOOLSETS];

type Result = {
  content: { type: string; text: string }[];
  structuredContent?: any;
  isError?: boolean;
  _meta?: Record<string, any>;
};

async function tool(
  key: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Result> {
  limiter.reset();
  strikes.reset();
  const r = await h.tool(key, name, args);
  assert.ok(r, `${name}: no result`);
  return r as Result;
}
const code = (r: Result) => r._meta?.["orbyn/error"]?.code as string;
const ok = (r: Result, what = "call") => {
  assert.ok(!r.isError, `${what}: ${r.content?.[0]?.text}`);
  return r.structuredContent;
};
const idOf = (typed: string) => typed.replace(/^\w+:/, "").slice(0, 36);

/** A 2026-07-28 tools/call with the client's capabilities (and a retry). */
async function modern(
  key: string,
  name: string,
  args: Record<string, unknown>,
  caps: Record<string, unknown>,
  retry?: { state: string; responses: Record<string, unknown> },
) {
  limiter.reset();
  strikes.reset();
  const r = await h.post(
    {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        ...(retry
          ? { requestState: retry.state, inputResponses: retry.responses }
          : {}),
        _meta: {
          [META_KEYS.version]: MODERN,
          [META_KEYS.client]: { name: "test", version: "1" },
          [META_KEYS.caps]: caps,
        },
      },
    },
    {
      ...bearer(key),
      "mcp-protocol-version": MODERN,
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const FORM = { elicitation: { form: {} } };

const page = async (
  who: Person,
  title: string,
  content: unknown[],
  team?: string,
) =>
  (
    await h.call(who.token, "POST", "/docs", {
      title,
      content,
      ...(team ? { team_id: team } : {}),
    })
  ).json() as { id: string; version: number };

const cardsOf = async (doc: string) =>
  (
    await pool.query(
      `SELECT id, card_key, question, answer, source_doc_id, source_block_id,
              picture_file, misses, needs_work_at
         FROM study_cards WHERE doc_id = $1 AND user_id = $2
        ORDER BY created_at`,
      [doc, olga.id],
    )
  ).rows;

/** Make a deck's cards reviewed once and due, `hoursAgo` apart in order. */
const dueNow = async (doc: string, start: number) => {
  const cards = await cardsOf(doc);
  for (const [i, c] of cards.entries())
    await pool.query(
      `UPDATE study_cards SET reps = 1, stability = 1, difficulty = 5,
              last_review_at = now() - interval '2 days',
              due_at = now() - make_interval(hours => $2)
        WHERE id = $1`,
      [c.id, start - i],
    );
  return cards;
};

const dayAhead = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  await migrate();
  olga = await h.register("st-olga", "Olga");
  mo = await h.register("st-mo", "Mo");
  crew = await h.team(olga, "Crew", [[mo, "member"]]);
  const make = async (name: string, body: Record<string, unknown>) => {
    keys[name] = (await h.agentKey(olga, { toolsets: ALL, ...body })).key;
  };
  await make("full", { access: "write", team_ids: [crew] });
  await make("mine", { access: "write" });
  await make("ask", { access: "write", trust: "ask" });
  await make("read", { access: "read" });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, [], "study never reaches the network");
  network.restore();
  await app.close();
  await pool.end();
});

test("pages: a card line's source link and the picture above it", () => {
  const src = "orbyn://doc/0b6f2d3e-3a52-4d1e-9b39-9a3f5d8f4c11#n1";
  const cards = cardsInBlocks([
    { id: "p1", type: "image", file: "f-1", text: "" },
    {
      id: "c1",
      type: "bullet",
      text: `What is shown? :: A cell [src: Cells › Cells divide](${src})`,
    },
    { id: "c2", type: "paragraph", text: "The {{nucleus}} holds DNA" },
    {
      id: "c3",
      type: "paragraph",
      text: "Why? :: Because [src: a web page](https://example.org) [src: p. 4]",
    },
  ]);
  assert.deepEqual(
    cards.map((c) => [c.key, c.question, c.answer, c.picture]),
    [
      ["c1", "What is shown?", "A cell", "f-1"],
      ["c2#c1", "The […] holds DNA", "nucleus", null],
      ["c3", "Why?", "Because", null],
    ],
  );
  assert.deepEqual(cards[0].source, {
    doc_id: "0b6f2d3e-3a52-4d1e-9b39-9a3f5d8f4c11",
    block_id: "n1",
  });
  assert.equal(cards[1].source, null);
  assert.equal(cards[2].source, null, "only a link to an Orbyn page");
  assert.equal(cardSource("No source here").source, null);
  // Decks take turns; each keeps its own order.
  assert.deepEqual(
    interleave([
      { doc_id: "a", n: 1 },
      { doc_id: "a", n: 2 },
      { doc_id: "a", n: 3 },
      { doc_id: "b", n: 4 },
    ]).map((c) => c.n),
    [1, 4, 2, 3],
  );
});

test("cards of each kind, linked to their notes lines, and undone", async () => {
  const notes = await page(olga, "Cells", [
    { id: "n1", type: "paragraph", text: "Mitochondria make ATP." },
    {
      id: "n2",
      type: "paragraph",
      text: "The Krebs cycle runs in the matrix.",
    },
  ]);
  const picture = (
    await pool.query(
      `INSERT INTO page_files (user_id, doc_id, name, mime, kind, bytes, status)
       VALUES ($1, $2, 'cell.png', 'image/png', 'image', 10, 'ready')
       RETURNING id`,
      [olga.id, notes.id],
    )
  ).rows[0].id as string;
  const made = ok(
    await tool(keys.full, "update_study", {
      cards: {
        page: `doc:${notes.id}`,
        items: [
          {
            q: "What makes ATP?",
            a: "The mitochondria",
            from: `doc:${notes.id}#n1`,
          },
          {
            cloze: "The {{Krebs}} cycle runs in the matrix.",
            from: `doc:${notes.id}#n2`,
          },
          {
            q: "What is shown?",
            a: "A mitochondrion",
            picture: `orbyn://file/${picture}`,
            from: `doc:${notes.id}#n1`,
          },
        ],
      },
    }),
    "cards",
  );
  assert.equal(made.status, "done");
  assert.match(made.done[0].change, /3 cards added/);
  await drainStudyQueue();
  const content = (
    await pool.query("SELECT content FROM docs WHERE id = $1", [notes.id])
  ).rows[0].content;
  const heading = content.findIndex(
    (b: any) => b.type === "heading" && b.text === "Cards",
  );
  assert.ok(heading > 1, "under a new Cards heading, after the notes");
  assert.ok(
    content.some((b: any) => b.type === "image" && b.file === picture),
    "the picture line above its card",
  );
  const rows = await cardsOf(notes.id);
  assert.deepEqual(
    rows.map((r) => [r.question, r.answer]),
    [
      ["What makes ATP?", "The mitochondria"],
      ["The […] cycle runs in the matrix.", "Krebs"],
      ["What is shown?", "A mitochondrion"],
    ],
  );
  assert.ok(rows.every((r) => r.source_doc_id === notes.id));
  assert.deepEqual(
    rows.map((r) => r.source_block_id),
    ["n1", "n2", "n1"],
  );
  assert.equal(rows[2].picture_file, picture);
  // The quiz shows where each card came from, and its picture; the line's
  // words (which give the answer away) only with the answer.
  const q = ok(
    await tool(keys.full, "get_study", {
      queue: true,
      deck: `doc:${notes.id}`,
    }),
  );
  const first = q.queue.find((c: any) => c.question === "What makes ATP?");
  assert.equal(first.answer, null);
  assert.equal(first.from, `Cells (doc:${notes.id}#n1)`);
  const pic = q.queue.find((c: any) => c.question === "What is shown?");
  assert.equal(pic.picture, `orbyn://file/${picture}`);
  const shown = ok(await tool(keys.full, "get_study", { card: first.card }));
  assert.equal(shown.queue[0].answer, "The mitochondria");
  assert.equal(
    shown.queue[0].from,
    `Cells › Mitochondria make ATP. (doc:${notes.id}#n1)`,
  );
  // Adding again goes under the same heading.
  ok(
    await tool(keys.full, "update_study", {
      cards: {
        page: `doc:${notes.id}`,
        items: [{ q: "ATP is?", a: "Energy" }],
      },
    }),
  );
  const again = (
    await pool.query("SELECT content FROM docs WHERE id = $1", [notes.id])
  ).rows[0].content;
  assert.equal(
    again.filter((b: any) => b.type === "heading" && b.text === "Cards").length,
    1,
  );
  assert.equal(again.at(-1).text, "ATP is? :: Energy");
  // Undo takes the last cards away, page and Study.
  const changes = ok(await tool(keys.full, "list_agent_changes", { limit: 1 }));
  ok(await tool(keys.full, "undo", { change: changes.changes[0].id }));
  await drainStudyQueue();
  assert.equal((await cardsOf(notes.id)).length, 3);
  // A new deck.
  const deck = ok(
    await tool(keys.full, "update_study", {
      cards: {
        new_deck: "Biology deck",
        items: [{ q: "Powerhouse?", a: "Mitochondria" }],
      },
    }),
  );
  assert.match(deck.done[0].change, /New deck, 1 card added/);
  const deckId = idOf(deck.done[0].id);
  await drainStudyQueue();
  assert.equal((await cardsOf(deckId)).length, 1);
  const undoDeck = ok(
    await tool(keys.full, "list_agent_changes", { limit: 1 }),
  );
  ok(await tool(keys.full, "undo", { change: undoDeck.changes[0].id }));
  await drainStudyQueue();
  assert.ok(
    (await pool.query("SELECT deleted_at FROM docs WHERE id = $1", [deckId]))
      .rows[0].deleted_at,
    "the new deck went to Trash",
  );
  // Refusals: a line that isn't there, a picture it can't read, no q/a.
  const hidden = await page(mo, "Mo's page", [
    { id: "m1", type: "paragraph", text: "Private" },
  ]);
  const moPic = (
    await pool.query(
      `INSERT INTO page_files (user_id, doc_id, name, mime, kind, bytes, status)
       VALUES ($1, $2, 'x.png', 'image/png', 'image', 10, 'ready') RETURNING id`,
      [mo.id, hidden.id],
    )
  ).rows[0].id;
  for (const item of [
    { q: "Q", a: "A", from: `doc:${notes.id}#nope` },
    { q: "Q", a: "A", from: `doc:${hidden.id}#m1` },
    { q: "Q", a: "A", picture: `orbyn://file/${moPic}` },
    { q: "Only a question" },
    { cloze: "No hidden words" },
  ])
    assert.equal(
      code(
        await tool(keys.full, "update_study", {
          cards: { page: `doc:${notes.id}`, items: [item] },
        }),
      ),
      "INVALID",
      JSON.stringify(item),
    );
  // A read-only connection can't add cards.
  assert.equal(
    code(
      await tool(keys.read, "update_study", {
        cards: { page: `doc:${notes.id}`, items: [{ q: "Q", a: "A" }] },
      }),
    ),
    "FORBIDDEN",
  );
});

test("quiz: needs work, then most missed, then due, decks interleaved; no answers until asked", async () => {
  const a = await page(olga, "Deck A", [
    { id: "a1", type: "bullet", text: "Alpha one? :: ans-a1" },
    { id: "a2", type: "bullet", text: "Alpha two? :: ans-a2" },
    { id: "a3", type: "bullet", text: "Alpha three? :: ans-a3" },
  ]);
  const b = await page(olga, "Deck B", [
    { id: "b1", type: "bullet", text: "Beta one? :: ans-b1" },
    { id: "b2", type: "bullet", text: "Beta two? :: ans-b2" },
    { id: "b3", type: "bullet", text: "Beta three? :: ans-b3" },
  ]);
  await drainStudyQueue();
  // Clear the other tests' cards out of the way of this order.
  await pool.query(
    "UPDATE study_cards SET reps = 1, due_at = now() + interval '30 days' WHERE user_id = $1",
    [olga.id],
  );
  const [a1, a2, a3] = await dueNow(a.id, 10);
  const [b1, b2, b3] = await dueNow(b.id, 5);
  await pool.query("UPDATE study_cards SET misses = 3 WHERE id = $1", [a3.id]);
  await pool.query("UPDATE study_cards SET misses = 1 WHERE id = $1", [b2.id]);
  // Explain-it-back fell short on b1: marked, it comes first.
  const marked = ok(
    await tool(keys.full, "update_study", {
      needs_work: [{ card: b1.id, note: "Mixed up the steps" }],
    }),
  );
  assert.match(marked.done[0].change, /Needs work/);
  const q = ok(await tool(keys.full, "get_study", { queue: true, limit: 10 }));
  assert.deepEqual(
    q.queue.map((c: any) => c.card),
    [b1.id, a3.id, b2.id, a1.id, b3.id, a2.id],
  );
  assert.equal(q.left_today, 6);
  assert.ok(q.queue.every((c: any) => c.answer === null));
  const leaked = JSON.stringify(q);
  const text = (await tool(keys.full, "get_study", { queue: true })).content[0]
    .text;
  for (const ans of ["ans-a1", "ans-a2", "ans-a3", "ans-b1", "ans-b2"]) {
    assert.ok(!leaked.includes(ans), `${ans} in the answer`);
    assert.ok(!text.includes(ans), `${ans} in the text`);
  }
  assert.match(text, /answers hidden/);
  // One at a time.
  const one = ok(await tool(keys.full, "get_study", { queue: true, limit: 1 }));
  assert.equal(one.queue.length, 1);
  assert.equal(one.queue[0].card, b1.id);
  // The answer, once asked for.
  const reveal = ok(await tool(keys.full, "get_study", { card: b1.id }));
  assert.equal(reveal.queue[0].answer, "ans-b1");
  // Ratings: a miss counts; recalling well clears "needs work".
  ok(
    await tool(keys.full, "update_study", {
      reviews: [
        { card: a3.id, rating: "again" },
        { card: b1.id, rating: "good" },
      ],
    }),
  );
  const [after3] = (await cardsOf(a.id)).filter((c) => c.id === a3.id);
  assert.equal(after3.misses, 4);
  const [afterB1] = (await cardsOf(b.id)).filter((c) => c.id === b1.id);
  assert.equal(afterB1.needs_work_at, null);
  const s = ok(await tool(keys.full, "get_study"));
  assert.equal(s.wrong[0].card, a3.id);
  assert.equal(s.wrong[0].misses, 4);
  // Scoped to one deck; the app's overview counts misses too.
  const onlyB = ok(
    await tool(keys.full, "get_study", { queue: true, deck: `doc:${b.id}` }),
  );
  assert.ok(onlyB.queue.every((c: any) => c.doc === `doc:${b.id}`));
  const overview = (await h.call(olga.token, "GET", "/study")).json();
  assert.equal(overview.weak[0].id, a3.id);
  assert.equal(overview.weak[0].misses, 4);
  // An unknown card, and the app's routes' shield.
  assert.equal(
    code(
      await tool(keys.full, "get_study", {
        card: "00000000-0000-4000-8000-000000000000",
      }),
    ),
    "NOT_FOUND",
  );
  assert.equal((await h.call(null, "GET", "/study/queue")).statusCode, 401);
  assert.equal(
    (await h.call(olga.token, "GET", "/study/queue?limit=0")).statusCode,
    422,
  );
});

test("exams: named, changed and planned in one call; undo puts them back", async () => {
  const deck = await page(olga, "Genetics", [
    { id: "g1", type: "bullet", text: "DNA? :: Deoxyribonucleic acid" },
  ]);
  const date = dayAhead(12);
  const named = ok(
    await tool(keys.full, "update_study", {
      exam: {
        title: "Genetics final",
        date,
        pages: [`doc:${deck.id}`],
        target: "80%",
      },
    }),
  );
  const key = named.done[0].id.replace(/^exam:/, "");
  assert.match(key, /^own:[0-9a-f-]{36}$/);
  let s = ok(await tool(keys.full, "get_study"));
  let exam = s.exams.find((e: any) => e.key === key);
  assert.equal(exam.title, "Genetics final");
  assert.equal(exam.target, "80%");
  assert.deepEqual(exam.pages, [`doc:${deck.id}`]);
  assert.equal(
    exam.starts.at,
    dayTime(date, 0, "UTC").toISOString(),
    "an all-day exam starts at midnight",
  );
  // Changed.
  ok(
    await tool(keys.full, "update_study", {
      exam: { key, target: "90%", title: "Genetics final exam" },
    }),
  );
  s = ok(await tool(keys.full, "get_study"));
  exam = s.exams.find((e: any) => e.key === key);
  assert.equal(exam.target, "90%");
  assert.equal(exam.title, "Genetics final exam");
  // Plan my revision: one call books the sessions.
  const preview = ok(
    await tool(keys.full, "plan_revision", { exam: key, minutes: 30 }),
  );
  const planned = ok(
    await tool(keys.full, "update_study", {
      exam: { key, plan: true, minutes: 30 },
    }),
  );
  const task = planned.done.find((d: any) => /Revise for/.test(d.title));
  assert.ok(preview.sessions.length > 0, "free working time before it");
  {
    assert.ok(task, JSON.stringify(planned.done));
    const blocks = (
      await pool.query(
        "SELECT count(*)::int AS n FROM time_blocks WHERE item_id = $1",
        [idOf(task.id)],
      )
    ).rows[0].n;
    assert.equal(blocks, preview.sessions.length);
    // Undo: the task and its sessions go.
    const changes = ok(
      await tool(keys.full, "list_agent_changes", { limit: 1 }),
    );
    ok(await tool(keys.full, "undo", { change: changes.changes[0].id }));
    assert.equal(
      (await pool.query("SELECT 1 FROM items WHERE id = $1", [idOf(task.id)]))
        .rowCount,
      0,
    );
  }
  // Refusals: a calendar exam's time, a new one without a date, the past.
  assert.equal(
    code(await tool(keys.full, "update_study", { exam: { title: "No date" } })),
    "INVALID",
  );
  assert.equal(
    code(
      await tool(keys.full, "update_study", {
        exam: { title: "Old", date: "2020-01-01" },
      }),
    ),
    "INVALID",
  );
  assert.equal(
    code(
      await tool(keys.full, "update_study", {
        exam: { key: "own:00000000-0000-4000-8000-000000000000", target: "x" },
      }),
    ),
    "NOT_FOUND",
  );
  // A fresh exam, undone: gone from Study.
  const temp = ok(
    await tool(keys.full, "update_study", {
      exam: { title: "Quiz week", date: dayAhead(20) },
    }),
  );
  const tempKey = temp.done[0].id.replace(/^exam:/, "");
  const last = ok(await tool(keys.full, "list_agent_changes", { limit: 1 }));
  ok(await tool(keys.full, "undo", { change: last.changes[0].id }));
  s = ok(await tool(keys.full, "get_study"));
  assert.ok(!s.exams.some((e: any) => e.key === tempKey));
});

test("asking first: an 'ask' connection asks in the chat, or can't book without it", async () => {
  const args = {
    exam: { title: "Chemistry midterm", date: dayAhead(9), plan: true },
  };
  // No form in this app: refused, nothing saved.
  const refused = await tool(keys.ask, "update_study", args);
  assert.equal(code(refused), "FORBIDDEN");
  assert.match(refused.content[0].text, /yes first/);
  const none = async () =>
    (
      await pool.query(
        "SELECT 1 FROM study_exams WHERE user_id = $1 AND title = 'Chemistry midterm'",
        [olga.id],
      )
    ).rowCount;
  assert.equal(await none(), 0);
  // With a form: asked, nothing changes until yes.
  const first = await modern(keys.ask, "update_study", args, FORM);
  assert.equal(first.result.resultType, "input_required");
  assert.match(
    first.result.inputRequests.confirm.params.message,
    /before every change/,
  );
  assert.equal(await none(), 0);
  const yes = await modern(keys.ask, "update_study", args, FORM, {
    state: first.result.requestState,
    responses: { confirm: { action: "accept", content: { confirm: true } } },
  });
  assert.equal(yes.result.structuredContent.status, "done");
  assert.equal(await none(), 1);
  // Reading never asks.
  const read = await modern(keys.ask, "get_study", { queue: true }, FORM);
  assert.ok(read.result.structuredContent);
});

test("explain-it-back: their own notes and card answers, only what this connection can read", async () => {
  const notes = await page(olga, "Energy notes", [
    { id: "e1", type: "paragraph", text: "ATP synthase spins to make ATP." },
    {
      id: "e2",
      type: "paragraph",
      text: "Glycolysis happens in the cytoplasm.",
    },
    {
      id: "e3",
      type: "bullet",
      text: "What spins to make ATP? :: ATP synthase",
    },
  ]);
  // A team page about the same thing: the "mine" connection can't reach it.
  await page(
    olga,
    "Crew energy",
    [{ id: "t1", type: "paragraph", text: "ATP team secret line." }],
    crew,
  );
  await drainStudyQueue();
  const found = ok(
    await tool(keys.mine, "get_study", { explain: { topic: "ATP" } }),
  );
  const lines = found.notes.map((n: any) => n.text);
  assert.ok(lines.includes("ATP synthase spins to make ATP."), lines.join("|"));
  assert.ok(!lines.some((l: string) => /team secret/.test(l)));
  assert.ok(!lines.some((l: string) => /Glycolysis/.test(l)));
  assert.ok(!lines.some((l: string) => /::/.test(l)), "cards come as cards");
  const card = found.queue.find(
    (c: any) => c.question === "What spins to make ATP?",
  );
  assert.equal(card.answer, "ATP synthase");
  // The connection that reaches the team sees its line too.
  const wide = ok(
    await tool(keys.full, "get_study", { explain: { topic: "ATP" } }),
  );
  assert.ok(wide.notes.some((n: any) => /team secret/.test(n.text)));
  // By cards: the lines they came from.
  const made = ok(
    await tool(keys.mine, "update_study", {
      cards: {
        page: `doc:${notes.id}`,
        items: [
          {
            q: "Where does glycolysis happen?",
            a: "The cytoplasm",
            from: `doc:${notes.id}#e2`,
          },
        ],
      },
    }),
  );
  assert.equal(made.status, "done");
  await drainStudyQueue();
  const glyco = (await cardsOf(notes.id)).find((c) =>
    /glycolysis/.test(c.question),
  );
  const byCard = ok(
    await tool(keys.mine, "get_study", { explain: { cards: [glyco.id] } }),
  );
  assert.deepEqual(
    byCard.notes.map((n: any) => n.line),
    [`doc:${notes.id}#e2`],
  );
  assert.equal(byCard.queue[0].answer, "The cytoplasm");
  assert.match(
    (await tool(keys.mine, "get_study", { explain: { cards: [glyco.id] } }))
      .content[0].text,
    /Judge the explanation/,
  );
  // The outcome is the agent's to record: needs work.
  ok(
    await tool(keys.mine, "update_study", { needs_work: [{ card: glyco.id }] }),
  );
  const [marked] = (await cardsOf(notes.id)).filter((c) => c.id === glyco.id);
  assert.ok(marked.needs_work_at);
  // Nothing to look in: refused.
  assert.equal(
    code(await tool(keys.mine, "get_study", { explain: {} })),
    "INVALID",
  );
});
