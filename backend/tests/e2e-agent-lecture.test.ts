import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { trapNetwork, type Person } from "./mcp-helpers.js";
import {
  type AgentClient,
  codeOf,
  idOf,
  scenario,
} from "./e2e-agent-helpers.js";

/**
 * H9 scenario (a): a lecture becomes notes, cards, tasks and a first
 * review. An app signed in with Orbyn (OAuth) reads who it works for, sends
 * a long transcript in parts, then does the whole job in one apply_plan:
 * the transcript page, a notes page whose lines say where they came from,
 * cards linked to those lines, dated tasks, a related link and a review
 * session. The page reads back as written, the cards are in the quiz queue
 * at once, and one undo takes every bit of it back. Nothing reaches the
 * network and no AI of Orbyn's runs.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
const { h, connect } = scenario(app);
const network = await trapNetwork();

let lena: Person;
let agent: AgentClient;

/** Tomorrow at `hour`:00 UTC, and half an hour after. */
const tomorrowAt = (hour: number) => {
  const d = new Date(Date.now() + 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return {
    start_at: d.toISOString(),
    end_at: new Date(d.getTime() + 30 * 60_000).toISOString(),
  };
};
const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString();

/** A transcript part: minutes of lecture, one timestamped line each. */
const transcriptPart = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => {
    const m = from + i;
    return `[${String(m).padStart(2, "0")}:00] So at minute ${m} we keep talking about cells, membranes and how mitochondria make ATP for the cell, with examples from the slides and a question from the room about respiration.`;
  }).join("\n\n");

before(async () => {
  await migrate();
  lena = await h.register("e2e-lecture-lena", "Lena");
  // Her profile and the instructions she left for agents (H8).
  assert.equal(
    (await h.call(lena.token, "POST", "/me/agent-profile")).statusCode,
    201,
  );
  assert.equal(
    (
      await h.call(lena.token, "PUT", "/me/agent-instructions", {
        text: "Keep a [src: …] on every notes line.",
      })
    ).statusCode,
    200,
  );
  agent = await connect(lena, {
    kind: "oauth",
    toolsets: ["workspace", "study"],
    name: "Lecture agent",
  });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, [], "the lecture never reached the network");
  network.restore();
  await app.close();
  await pool.end();
});

test("lecture → notes, cards, tasks and a first review, read back, quizzed, and undone as one job", async () => {
  // 1. Who and where: a signed-in app, at full power, with her profile and
  // instructions to follow.
  const ctx = await agent.ok("get_context");
  assert.equal(ctx.connection.kind, "oauth");
  assert.match(JSON.stringify(ctx.connection), /full/);
  assert.ok(ctx.profile?.id?.startsWith("doc:"), "her About me page");
  assert.deepEqual(
    ctx.instructions.map((i: any) => [i.space, i.text]),
    [["personal", "Keep a [src: …] on every notes line."]],
  );

  // 2. The transcript, in parts (about 40 KB: longer than one call wants).
  const parts = [transcriptPart(0, 70), transcriptPart(70, 140)];
  assert.ok(parts.join("").length > 25_000);
  const started = await agent.ok("append_doc", {
    title: "Lecture 5 transcript",
    markdown: `# Lecture 5: Cells\n\n${parts[0]}`,
  });
  const draft = started.done[0].id as string;
  assert.match(draft, /^draft:/);
  await agent.ok("append_doc", { draft, markdown: parts[1] });
  // Nothing is a page until the plan finishes it.
  const pages = async (title: string) =>
    (
      await pool.query<{ id: string; deleted_at: Date | null }>(
        "SELECT id, deleted_at FROM docs WHERE user_id = $1 AND title = $2",
        [lena.id, title],
      )
    ).rows;
  assert.equal((await pages("Lecture 5 transcript")).length, 0);

  // 3. The whole job in one call.
  const notes = [
    "## Energy ^energy",
    "",
    "Mitochondria make ATP [src: Lecture 5 transcript, 12:00] ^atp",
    "",
    "The membrane lets some things through [src: Lecture 5 slides, slide 7] ^membrane",
  ].join("\n");
  const job = await agent.ok("apply_plan", {
    summary: "Lecture 5 into notes, cards, tasks and a first review",
    steps: [
      { id: "transcript", tool: "append_doc", args: { draft, finish: true } },
      {
        id: "notes",
        tool: "create_doc",
        args: { title: "Lecture 5 notes", markdown: notes },
      },
      {
        id: "cards",
        tool: "update_study",
        args: {
          cards: {
            page: "$notes.id",
            items: [
              {
                q: "What makes ATP?",
                a: "Mitochondria",
                from: "$notes.lines.atp",
              },
              {
                cloze: "The {{membrane}} lets some things through",
                from: "$notes.lines.membrane",
              },
            ],
          },
        },
      },
      {
        id: "tasks",
        tool: "create_tasks",
        args: {
          tasks: [
            {
              title: "Read chapter 5",
              due_at: inDays(3),
              estimate_minutes: 45,
              notes: "From {$notes.uri}",
            },
            {
              title: "Review: Lecture 5",
              due_at: inDays(2),
              estimate_minutes: 30,
            },
          ],
        },
      },
      {
        id: "related",
        tool: "link",
        args: {
          action: "link",
          kind: "related",
          from: "$notes.id",
          to: "$transcript.id",
        },
      },
      {
        id: "review",
        tool: "schedule_sessions",
        args: { sessions: [{ task: "$tasks.ids[1]", ...tomorrowAt(10) }] },
      },
    ],
  });
  assert.equal(job.status, "done");
  assert.deepEqual(
    job.steps.map((s: any) => s.id),
    ["transcript", "notes", "cards", "tasks", "related", "review"],
  );
  for (const s of job.steps) assert.ok(s.done.length, `${s.id} made something`);
  const notesId = idOf(job.steps[1].done[0].id);
  const transcriptId = idOf(job.steps[0].done[0].id);
  const taskIds = job.steps[3].done.map((d: any) => idOf(d.id));
  // Every write answers with where to open it, on the web and the phone.
  assert.match(job.steps[1].done[0].url, /\/app\/doc\//);
  assert.match(job.steps[1].done[0].app_url, /^orbyn:\/\//);

  // 4. The page reads back as it was written: the source lines exactly,
  // each line with its anchor, the cards under Cards linked to their line.
  const read = await agent.ok("fetch", { id: `doc:${notesId}` });
  assert.equal(read.title, "Lecture 5 notes");
  assert.match(
    read.text,
    /Mitochondria make ATP \[src: Lecture 5 transcript, 12:00\] \^atp/,
  );
  assert.match(
    read.text,
    /The membrane lets some things through \[src: Lecture 5 slides, slide 7\] \^membrane/,
  );
  assert.match(read.text, /What makes ATP\? :: Mitochondria/);
  assert.match(read.text, new RegExp(`orbyn://doc/${notesId}#atp`));
  // Written back unchanged, nothing changes (the dialect round-trips).
  const again = await agent.ok("fetch", { id: `doc:${notesId}` });
  assert.equal(again.text, read.text);
  const links = await agent.ok("get_links", { of: `doc:${notesId}` });
  assert.ok(
    JSON.stringify(links).includes(transcriptId),
    "the transcript is related",
  );
  // A long page reads in parts: follow next_block to the end.
  let transcript = "";
  let next: string | undefined;
  do {
    const part = await agent.ok("fetch", {
      id: `doc:${transcriptId}`,
      ...(next ? { next_block: next } : {}),
    });
    transcript += part.text;
    next = part.metadata?.next_block ?? undefined;
  } while (next);
  assert.ok(
    transcript.indexOf("[69:00]") < transcript.indexOf("[70:00]") &&
      transcript.includes("[139:00]"),
    "every part, in order",
  );

  // 5. The cards are in the quiz queue at once, answers hidden.
  const queue = await agent.ok("get_study", {
    queue: true,
    deck: `doc:${notesId}`,
  });
  assert.equal(queue.queue.length, 2);
  assert.ok(queue.queue.every((c: any) => c.answer === null));
  assert.doesNotMatch(JSON.stringify(queue), /Mitochondria"/);

  // The dated tasks and the review session are on her calendar.
  const sessions = (
    await pool.query(
      "SELECT item_id FROM time_blocks WHERE item_id = ANY ($1::uuid[])",
      [taskIds],
    )
  ).rows;
  assert.equal(sessions.length, 1);
  const listed = await agent.ok("list_agent_changes", { limit: 20 });
  assert.ok(
    listed.changes.some((c: any) => c.job === job.job),
    "the job is listed",
  );

  // 6. One undo takes the whole job back.
  const undone = await agent.ok("undo", { job: job.job });
  assert.ok(undone.undone.length >= 5, JSON.stringify(undone));
  for (const title of ["Lecture 5 notes", "Lecture 5 transcript"])
    assert.ok(
      (await pages(title)).every((p) => p.deleted_at),
      `${title} is in the Trash`,
    );
  assert.equal(
    (
      await pool.query("SELECT 1 FROM items WHERE id = ANY ($1::uuid[])", [
        taskIds,
      ])
    ).rowCount,
    0,
    "the tasks are gone",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM time_blocks WHERE item_id = ANY ($1::uuid[])",
        [taskIds],
      )
    ).rowCount,
    0,
    "the session is gone",
  );
  const after = await agent.ok("get_study", { queue: true, ahead: true });
  assert.ok(
    !after.queue.some((c: any) => c.doc === `doc:${notesId}`),
    "the cards left the queue",
  );
  assert.equal(
    codeOf(await agent.call("fetch", { id: `doc:${notesId}` })),
    "NOT_FOUND",
  );
  // Undone once: again is refused, nothing changes.
  assert.ok(
    ["STALE", "NOT_FOUND", "INVALID"].includes(
      codeOf(await agent.call("undo", { job: job.job }))!,
    ),
  );
});
