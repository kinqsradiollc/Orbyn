import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { helpers, trapNetwork } from "./mcp-helpers.js";

process.env.ASSISTANT_CONVERSATION_ENABLED = "true";
const { env } = await import("../src/config/env.js");
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApiService } = await import("../src/app.js");
const { retainConversationTurn } =
  await import("../src/modules/assistant-workspace/conversation-storage.js");
const { bindConversationWork, publishConversationIntent } =
  await import("../src/modules/assistant-workspace/conversation-delivery.js");
const { answerConversationQuestion } =
  await import("../src/modules/assistant-workspace/conversation-answers.js");
const app = await buildApiService();
const h = helpers(app);
const network = await trapNetwork();
const owners: string[] = [];
before(() => migrate());
after(async () => {
  assert.deepEqual(network.calls, []);
  network.restore();
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function person() {
  const user = await h.register("conversation-route");
  owners.push(user.id);
  return user;
}

async function waitingFixture(
  kind: "person" | "approval" = "person",
  overnight = false,
) {
  const owner = await person();
  await pool.query(
    "INSERT INTO agent_settings(user_id,reminder_nudges) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET reminder_nudges=$2",
    [owner.id, { quiet_start: "00:00", quiet_end: "00:00" }],
  );
  const destination = (
    await h.call(owner.token, "POST", "/me/assistant/conversation")
  ).json();
  const jobs = [];
  const night = overnight ? randomUUID() : undefined;
  if (night) {
    await pool.query(
      "INSERT INTO assistant_nights(id,user_id,local_day) VALUES($1,$2,current_date)",
      [night, owner.id],
    );
    await transaction((db) =>
      bindConversationWork(db, {
        ownerId: owner.id,
        work: { kind: "night", id: night },
        lane: "overnight",
        timezone: "UTC",
        sourcesChecked: true,
        notBefore: new Date(Date.now() - 60000),
      }),
    );
  }
  for (let n = 0; n < 2; n++) {
    const id = randomUUID(),
      chatId = randomUUID(),
      waitingId = randomUUID();
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Work','task')",
      [chatId, owner.id],
    );
    await pool.query(
      "INSERT INTO ai_jobs(id,user_id,chat_id,state,run_origin,sources_checked,run_state) VALUES($1,$2,$3,'queued','task',true,$4)",
      [id, owner.id, chatId, { request: { automation: { kind: "task" } } }],
    );
    await transaction((db) =>
      bindConversationWork(db, {
        ownerId: owner.id,
        work: { kind: "job", id },
        lane: overnight ? "overnight" : "background",
        timezone: "UTC",
        nightId: night,
      }),
    );
    const state = {
      version: 1,
      request: {
        message: "Choose work",
        automation: { kind: "task" },
        chat_id: chatId,
        turn_id: randomUUID(),
        timezone: "UTC",
        history: [],
      },
      state: {
        plan: [],
        selected_steps: [],
        reports: [],
        waiting: {
          kind,
          id: waitingId,
          question: `Question ${n}`,
          choices: ["First", "Second"],
        },
      },
    };
    await pool.query(
      "UPDATE ai_jobs SET state='waiting',run_state=$2 WHERE id=$1",
      [id, state],
    );
    const intent = (
      await pool.query(
        "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_id=$1",
        [id],
      )
    ).rows[0].id;
    assert.equal(
      await transaction((db) => publishConversationIntent(db, intent)),
      true,
    );
    const entryId = (
      await pool.query(
        "SELECT id FROM assistant_conversation_entries WHERE intent_id=$1",
        [intent],
      )
    ).rows[0].id;
    jobs.push({ id, chatId, waitingId, entryId, state });
  }
  return {
    owner,
    destination,
    jobs,
    url: (entryId: string) =>
      `/me/assistant/conversations/${destination.id}/entries/${entryId}/answer`,
  };
}

test("question answers resume exactly one existing job and concurrent retries retain one answer", async () => {
  const f = await waitingFixture();
  const [first, second] = f.jobs;
  const input = { answer: "First", turn_id: randomUUID() };
  const responses = await Promise.all([
    h.call(f.owner.token, "POST", f.url(first.entryId), input),
    h.call(f.owner.token, "POST", f.url(first.entryId), input),
  ]);
  for (const response of responses)
    assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(responses[0].json(), responses[1].json());
  assert.equal(
    (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [first.id]))
      .rows[0].state,
    "queued",
  );
  assert.equal(
    (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [second.id]))
      .rows[0].state,
    "waiting",
  );
  assert.equal(
    (
      await pool.query("SELECT 1 FROM ai_jobs WHERE chat_id=$1", [
        f.destination.chat_id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_conversation_answers WHERE destination_id=$1",
        [f.destination.id],
      )
    ).rowCount,
    1,
  );
  const retained = (
    await pool.query(
      "SELECT payload,reply_to_entry_id FROM assistant_conversation_entries WHERE destination_id=$1 AND turn_id=$2",
      [f.destination.id, input.turn_id],
    )
  ).rows;
  assert.equal(retained.length, 1);
  assert.equal(retained[0].payload.text, input.answer);
  assert.equal(retained[0].reply_to_entry_id, first.entryId);
  const execution = (
    await pool.query(
      "SELECT c.turns,j.run_state FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id WHERE j.id=$1",
      [first.id],
    )
  ).rows[0];
  assert.equal(execution.turns.length, 1);
  assert.equal(execution.run_state.request.history.length, 1);
  assert.equal(
    (
      await h.call(f.owner.token, "POST", f.url(first.entryId), {
        ...input,
        answer: "Second",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await h.call(f.owner.token, "POST", f.url(second.entryId), input))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await h.call(f.owner.token, "POST", f.url(first.entryId), {
        ...input,
        turn_id: randomUUID(),
      })
    ).statusCode,
    409,
  );
});

test("Overnight questions retain individual reply targets instead of becoming count-only summaries", async () => {
  const f = await waitingFixture("person", true);
  const feed = (
    await h.call(
      f.owner.token,
      "GET",
      `/me/assistant/conversations/${f.destination.id}`,
    )
  ).json();
  assert.equal(feed.entries.length, 2);
  assert.ok(
    feed.entries.every(
      (entry: any) => entry.lane === "overnight" && entry.actionable,
    ),
  );
  for (const job of f.jobs) {
    const answer = await h.call(f.owner.token, "POST", f.url(job.entryId), {
      answer: "First",
      turn_id: randomUUID(),
    });
    assert.equal(answer.statusCode, 200, answer.body);
    assert.equal(
      (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [job.id]))
        .rows[0].state,
      "queued",
    );
  }
});

test("conversation history separates execution views while legacy listings and direct reads stay available", async () => {
  const f = await waitingFixture();
  const { buildAiService } = await import("../src/app.js");
  const historyApp = await buildAiService(),
    history = helpers(historyApp);
  const previous = env.ASSISTANT_CONVERSATION_ENABLED;
  try {
    const list = async (query: string) => {
      const response = await history.call(
        f.owner.token,
        "GET",
        `/ai/chats?kind=chat${query}`,
      );
      assert.equal(response.statusCode, 200, response.body);
      return response.json() as { id: string }[];
    };
    const legacy = await list("");
    assert.ok(legacy.some((chat) => chat.id === f.jobs[0].chatId));
    const conversations = await list("&conversation_only=true");
    assert.ok(conversations.some((chat) => chat.id === f.destination.chat_id));
    assert.ok(
      f.jobs.every(
        (job) => !conversations.some((chat) => chat.id === job.chatId),
      ),
    );
    assert.equal(
      (
        await history.call(
          f.owner.token,
          "GET",
          `/ai/chats/${f.jobs[0].chatId}`,
        )
      ).statusCode,
      200,
    );
    env.ASSISTANT_CONVERSATION_ENABLED = "false";
    assert.ok(
      (await list("&conversation_only=true")).some(
        (chat) => chat.id === f.jobs[0].chatId,
      ),
    );
  } finally {
    env.ASSISTANT_CONVERSATION_ENABLED = previous;
    await historyApp.close();
  }
});

test("lane pauses block only new admissions and preserve foreground, waiting answers and history", async () => {
  const f = await waitingFixture();
  const controls = "/me/assistant/work-controls";
  assert.deepEqual((await h.call(f.owner.token, "GET", controls)).json(), {
    background_paused: false,
    overnight_paused: false,
  });
  const paused = await h.call(f.owner.token, "PATCH", controls, {
    background_paused: true,
  });
  assert.equal(paused.statusCode, 200, paused.body);
  assert.deepEqual(paused.json(), {
    background_paused: true,
    overnight_paused: false,
  });
  const admission = async (lane: "background" | "overnight" | "interactive") =>
    pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,state,run_state) VALUES($1,$2,'queued',$3) RETURNING id",
      [
        f.owner.id,
        f.jobs[0].chatId,
        lane === "interactive"
          ? {}
          : {
              request: {
                automation: { kind: lane === "overnight" ? "night" : "task" },
              },
            },
      ],
    );
  await assert.rejects(
    admission("background"),
    (error: any) => error.code === "55000",
  );
  const overnight = await admission("overnight");
  assert.equal(overnight.rowCount, 1);
  assert.equal((await admission("interactive")).rowCount, 1);
  await h.call(f.owner.token, "PATCH", controls, { overnight_paused: true });
  await assert.rejects(
    admission("overnight"),
    (error: any) => error.code === "55000",
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO assistant_nights(user_id,local_day) VALUES($1,current_date)",
      [f.owner.id],
    ),
    (error: any) => error.code === "55000",
  );
  const answer = await h.call(f.owner.token, "POST", f.url(f.jobs[0].entryId), {
    answer: "First",
    turn_id: randomUUID(),
  });
  assert.equal(answer.statusCode, 200, answer.body);
  assert.equal(
    (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [f.jobs[1].id]))
      .rows[0].state,
    "waiting",
  );
  assert.equal(
    (
      await h.call(
        f.owner.token,
        "GET",
        `/me/assistant/conversations/${f.destination.id}`,
      )
    ).json().entries.length,
    3,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM agent_grants WHERE user_id=$1 AND kind='assistant' AND suspended_at IS NOT NULL",
        [f.owner.id],
      )
    ).rowCount,
    0,
  );
  const resumed = await h.call(f.owner.token, "PATCH", controls, {
    background_paused: false,
  });
  assert.deepEqual(resumed.json(), {
    background_paused: false,
    overnight_paused: true,
  });
  assert.equal((await admission("background")).rowCount, 1);
  assert.equal(
    (await h.call(f.owner.token, "PATCH", controls, {})).statusCode,
    422,
  );
  const other = await person();
  assert.deepEqual((await h.call(other.token, "GET", controls)).json(), {
    background_paused: false,
    overnight_paused: false,
  });
});

test("paused automation cannot roll back a completed foreground answer or its Memory checkpoint", async () => {
  const f = await waitingFixture();
  await h.call(f.owner.token, "PATCH", "/me/assistant/work-controls", {
    background_paused: true,
    overnight_paused: true,
  });
  const { beginChatTurn, finishChatTurn } =
    await import("../src/modules/ai/chats.js");
  const user = (
    await pool.query("SELECT * FROM users WHERE id=$1", [f.owner.id])
  ).rows[0];
  const turn = randomUUID();
  await transaction(async (db) => {
    await beginChatTurn(
      user,
      {
        chatId: f.destination.chat_id,
        turnId: turn,
        message: "Continue our foreground conversation",
        scope: null,
        legacyHistory: [],
      },
      db,
    );
    await db.query(
      "INSERT INTO ai_jobs(user_id,chat_id,turn_id,state,run_origin,sources_checked) VALUES($1,$2,$3,'done','person',true)",
      [f.owner.id, f.destination.chat_id, turn],
    );
    await finishChatTurn(
      f.owner.id,
      f.destination.chat_id,
      turn,
      { summary: "A retained foreground answer", trace: [] },
      db,
    );
  });
  const page = (
    await h.call(
      f.owner.token,
      "GET",
      `/me/assistant/conversations/${f.destination.id}`,
    )
  ).json();
  assert.equal(
    page.entries.some(
      (entry: any) =>
        entry.kind === "turn" &&
        entry.turn.text === "A retained foreground answer",
    ),
    true,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM memory_queue WHERE user_id=$1 AND chat_id=$2",
        [f.owner.id, f.destination.chat_id],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM ai_jobs WHERE user_id=$1 AND run_state->>'version'='6'",
        [f.owner.id],
      )
    ).rowCount,
    1,
  );
});

test("approval, replaced questions and other owners cannot be resumed through a conversation answer", async () => {
  const f = await waitingFixture("approval");
  const input = { answer: "yes", turn_id: randomUUID() };
  assert.equal(
    (await h.call(f.owner.token, "POST", f.url(f.jobs[0].entryId), input))
      .statusCode,
    409,
  );
  const other = await person();
  assert.equal(
    (await h.call(other.token, "POST", f.url(f.jobs[0].entryId), input))
      .statusCode,
    404,
  );
  const job = f.jobs[1];
  job.state.state.waiting.id = randomUUID();
  job.state.state.waiting.kind = "person";
  await pool.query("UPDATE ai_jobs SET run_state=$2 WHERE id=$1", [
    job.id,
    job.state,
  ]);
  assert.equal(
    (await h.call(f.owner.token, "POST", f.url(job.entryId), input)).statusCode,
    409,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM ai_jobs WHERE user_id=$1 AND state='waiting'",
        [f.owner.id],
      )
    ).rowCount,
    2,
  );
});

test("a rolled-back conversation answer cannot queue work or retain a receipt", async () => {
  const f = await waitingFixture();
  const user = (
    await pool.query("SELECT * FROM users WHERE id=$1", [f.owner.id])
  ).rows[0];
  await assert.rejects(
    transaction(async (db) => {
      await answerConversationQuestion(
        db,
        user,
        f.destination.id,
        f.jobs[0].entryId,
        { answer: "First", turn_id: randomUUID() },
        app.log,
      );
      throw new Error("transaction interrupted");
    }),
    /transaction interrupted/,
  );
  assert.equal(
    (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [f.jobs[0].id]))
      .rows[0].state,
    "waiting",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_conversation_answers WHERE destination_id=$1",
        [f.destination.id],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_conversation_entries WHERE destination_id=$1 AND kind='turn'",
        [f.destination.id],
      )
    ).rowCount,
    0,
  );
});

test("revoking the bound grant rejects new answers and replay receipts without resuming other work", async () => {
  const f = await waitingFixture();
  const grant = (
    await pool.query<{ id: string }>(
      "INSERT INTO agent_grants(user_id,kind,client_id,access,personal,team_ids) VALUES($1,'oauth','https://fixture.invalid/agent','write',true,'{}') RETURNING id",
      [f.owner.id],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE assistant_delivery_bindings SET grant_id=$2 WHERE owner_id=$1",
    [f.owner.id, grant],
  );
  const input = { answer: "First", turn_id: randomUUID() };
  assert.equal(
    (await h.call(f.owner.token, "POST", f.url(f.jobs[0].entryId), input))
      .statusCode,
    200,
  );
  await pool.query("UPDATE agent_grants SET revoked_at=now() WHERE id=$1", [
    grant,
  ]);
  assert.equal(
    (await h.call(f.owner.token, "POST", f.url(f.jobs[0].entryId), input))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await h.call(f.owner.token, "POST", f.url(f.jobs[1].entryId), {
        ...input,
        turn_id: randomUUID(),
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [f.jobs[1].id]))
      .rows[0].state,
    "waiting",
  );
});

test("the existing work-view answer endpoint retains a sourced reply in the origin conversation", async () => {
  const f = await waitingFixture();
  const { buildAiService } = await import("../src/app.js");
  const ai = await buildAiService();
  const doc = randomUUID();
  await pool.query(
    "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Answer dependency')",
    [doc, f.owner.id],
  );
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [f.jobs[0].id, doc],
  );
  try {
    const response = await ai.inject({
      method: "POST",
      url: `/ai/chat/${f.jobs[0].id}/answer`,
      headers: { authorization: `Bearer ${f.owner.token}` },
      payload: { answer: "First", waiting_id: f.jobs[0].waitingId },
    });
    assert.equal(response.statusCode, 202, response.body);
    const page = (
      await h.call(
        f.owner.token,
        "GET",
        `/me/assistant/conversations/${f.destination.id}`,
      )
    ).json();
    const answers = page.entries.filter((entry: any) => entry.kind === "turn");
    assert.equal(answers.length, 1);
    assert.equal(answers[0].turn.text, "First");
    assert.equal(answers[0].reply_to_entry_id, f.jobs[0].entryId);
    assert.equal(
      (
        await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [
          f.jobs[1].id,
        ])
      ).rows[0].state,
      "waiting",
    );
    await pool.query("UPDATE docs SET deleted_at=now() WHERE id=$1", [doc]);
    const hidden = (
      await h.call(
        f.owner.token,
        "GET",
        `/me/assistant/conversations/${f.destination.id}`,
      )
    ).json();
    assert.equal(
      hidden.entries.some((entry: any) => entry.id === answers[0].id),
      false,
    );
    assert.equal(
      hidden.entries.some((entry: any) => entry.id === f.jobs[1].entryId),
      true,
    );
  } finally {
    await ai.close();
  }
});

test("work-view answers cannot revive a retired destination or redirect into its replacement", async () => {
  const f = await waitingFixture();
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [f.destination.chat_id]);
  const replacement = (
    await h.call(f.owner.token, "POST", "/me/assistant/conversation")
  ).json();
  const { buildAiService } = await import("../src/app.js");
  const ai = await buildAiService();
  try {
    const response = await ai.inject({
      method: "POST",
      url: `/ai/chat/${f.jobs[0].id}/answer`,
      headers: { authorization: `Bearer ${f.owner.token}` },
      payload: { answer: "First", waiting_id: f.jobs[0].waitingId },
    });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(
      (
        await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [
          f.jobs[0].id,
        ])
      ).rows[0].state,
      "waiting",
    );
    assert.equal(
      (
        await pool.query("SELECT turns FROM ai_chats WHERE id=$1", [
          f.jobs[0].chatId,
        ])
      ).rows[0].turns.length,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM assistant_conversation_entries WHERE destination_id=$1",
          [replacement.id],
        )
      ).rowCount,
      0,
    );
  } finally {
    await ai.close();
  }
});

test("home read is side-effect free; explicit open is stable and private", async () => {
  const owner = await person();
  const other = await person();
  const home = await h.call(owner.token, "GET", "/me/assistant/conversation");
  assert.equal(home.statusCode, 200);
  assert.deepEqual(home.json(), { enabled: true, destination: null });
  const opened = await h.call(
    owner.token,
    "POST",
    "/me/assistant/conversation",
  );
  assert.equal(opened.statusCode, 200, opened.body);
  assert.match(opened.headers["cache-control"] as string, /no-store/);
  const d = opened.json();
  assert.equal(
    (await h.call(owner.token, "POST", "/me/assistant/conversation")).json().id,
    d.id,
  );
  assert.equal(
    (await h.call(other.token, "GET", `/me/assistant/conversations/${d.id}`))
      .statusCode,
    404,
  );
  await transaction((db) =>
    retainConversationTurn(db, owner.id, d.chat_id, {
      turn_id: randomUUID(),
      role: "user",
      text: "A retained message",
    }),
  );
  const page = await h.call(
    owner.token,
    "GET",
    `/me/assistant/conversations/${d.id}?limit=1`,
  );
  assert.equal(page.statusCode, 200, page.body);
  assert.equal(page.json().entries.length, 1);
  assert.equal(page.json().destination.read_sequence, "0");
  const read = await h.call(
    owner.token,
    "POST",
    `/me/assistant/conversations/${d.id}/read`,
    { through: "1" },
  );
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.json().read_sequence, "1");
  assert.equal(
    (
      await h.call(
        owner.token,
        "GET",
        `/me/assistant/conversations/${d.id}?after=9`,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await h.call(
        owner.token,
        "GET",
        `/me/assistant/conversations/${d.id}?limit=101`,
      )
    ).statusCode,
    422,
  );
});

test("previous saved history is explicit, paginated and excluded from the timeline and provider context", async () => {
  const owner = await person(),
    chat = randomUUID(),
    tracked = randomUUID();
  const turns = Array.from({ length: 60 }, (_, index) => ({
    role: "user",
    text: `Historical ${index}`,
    turn_id: randomUUID(),
  }));
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,turns) VALUES($1,$2,'Existing origin',$3)",
    [
      chat,
      owner.id,
      JSON.stringify([
        ...turns,
        { role: "user", text: "Retained current turn", turn_id: tracked },
      ]),
    ],
  );
  const { registerOriginConversation } =
    await import("../src/modules/assistant-workspace/conversation-storage.js");
  const destination = await transaction(async (db) => {
    const d = await registerOriginConversation(db, owner.id, chat);
    await retainConversationTurn(db, owner.id, chat, {
      role: "user",
      text: "Retained current turn",
      turn_id: tracked,
    });
    return d;
  });
  const first = await h.call(
    owner.token,
    "GET",
    `/me/assistant/conversations/${destination.id}/history?limit=25`,
  );
  assert.equal(first.statusCode, 200, first.body);
  const a = first.json();
  assert.equal(a.before, 35);
  assert.equal(a.turns[0].text, "Historical 35");
  assert.equal(a.turns.length, 25);
  const b = (
    await h.call(
      owner.token,
      "GET",
      `/me/assistant/conversations/${destination.id}/history?limit=25&before=${a.before}&version=${a.version}`,
    )
  ).json();
  const c = (
    await h.call(
      owner.token,
      "GET",
      `/me/assistant/conversations/${destination.id}/history?limit=25&before=${b.before}&version=${b.version}`,
    )
  ).json();
  assert.equal(c.before, null);
  assert.deepEqual(
    [...c.turns, ...b.turns, ...a.turns].map((turn: any) => turn.text),
    turns.map((turn) => turn.text),
  );
  const { readAiChat } = await import("../src/modules/ai/chats.js");
  const saved = await readAiChat(pool, owner.id, chat);
  assert.equal(saved.has_legacy_history, true);
  assert.equal(saved.legacy_history_destination_id, destination.id);
  const rollout = env.ASSISTANT_CONVERSATION_ENABLED;
  env.ASSISTANT_CONVERSATION_ENABLED = "false";
  try {
    assert.equal(
      (
        await h.call(
          owner.token,
          "GET",
          `/me/assistant/conversations/${destination.id}/history`,
        )
      ).statusCode,
      200,
    );
  } finally {
    env.ASSISTANT_CONVERSATION_ENABLED = rollout;
  }
  assert.deepEqual(
    saved.turns.map((turn) => turn.text),
    ["Retained current turn"],
  );
  const { prepareConversationContext } =
    await import("../src/modules/assistant-workspace/conversation-context.js");
  const context = await transaction((db) =>
    prepareConversationContext(db, owner.id, chat, randomUUID()),
  );
  assert.equal(JSON.stringify(context).includes("Historical"), false);
  const page = (
    await h.call(
      owner.token,
      "GET",
      `/me/assistant/conversations/${destination.id}`,
    )
  ).json();
  assert.equal(page.entries.length, 1);
  assert.equal(page.destination.read_sequence, "0");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_delivery_intents WHERE binding_id IN(SELECT id FROM assistant_delivery_bindings WHERE destination_id=$1)",
        [destination.id],
      )
    ).rowCount,
    0,
  );
  await pool.query("UPDATE ai_chats SET turns=turns || $2::jsonb WHERE id=$1", [
    chat,
    JSON.stringify([{ role: "user", text: "Changed historical window" }]),
  ]);
  assert.equal(
    (
      await h.call(
        owner.token,
        "GET",
        `/me/assistant/conversations/${destination.id}/history?before=35&version=${a.version}`,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await h.call(
        owner.token,
        "GET",
        `/me/assistant/conversations/${destination.id}/history?before=35`,
      )
    ).statusCode,
    422,
  );
  const other = await person();
  assert.equal(
    (
      await h.call(
        other.token,
        "GET",
        `/me/assistant/conversations/${destination.id}/history`,
      )
    ).statusCode,
    404,
  );
});

test("revoked legacy dependencies deny saved history while independent retained turns remain usable", async () => {
  const owner = await person(),
    chat = randomUUID(),
    doc = randomUUID(),
    old = randomUUID();
  await pool.query(
    "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Legacy private source')",
    [doc, owner.id],
  );
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,turns) VALUES($1,$2,'Source-derived old title',$3)",
    [
      chat,
      owner.id,
      JSON.stringify([
        { role: "assistant", text: "Legacy private quotation", turn_id: old },
      ]),
    ],
  );
  await pool.query(
    "INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id) VALUES($1,$2,'doc',$3)",
    [chat, old, doc],
  );
  const { registerOriginConversation } =
    await import("../src/modules/assistant-workspace/conversation-storage.js");
  const d = await transaction(async (db) => {
    const d = await registerOriginConversation(db, owner.id, chat);
    await retainConversationTurn(db, owner.id, chat, {
      role: "user",
      text: "Independent retained turn",
      turn_id: randomUUID(),
    });
    return d;
  });
  const path = `/me/assistant/conversations/${d.id}/history`;
  assert.equal((await h.call(owner.token, "GET", path)).statusCode, 200);
  await pool.query("UPDATE docs SET deleted_at=now() WHERE id=$1", [doc]);
  assert.equal((await h.call(owner.token, "GET", path)).statusCode, 404);
  assert.equal(
    (
      await h.call(owner.token, "GET", `/me/assistant/conversations/${d.id}`)
    ).json().entries.length,
    1,
  );
});

test("rollout off preserves legacy capability and refuses new destinations", async () => {
  const owner = await person();
  env.ASSISTANT_CONVERSATION_ENABLED = "false";
  try {
    const home = await h.call(owner.token, "GET", "/me/assistant/conversation");
    assert.deepEqual(home.json(), { enabled: false, destination: null });
    assert.equal(
      (await h.call(owner.token, "POST", "/me/assistant/conversation"))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM assistant_conversation_streams WHERE owner_id=$1",
          [owner.id],
        )
      ).rowCount,
      0,
    );
  } finally {
    env.ASSISTANT_CONVERSATION_ENABLED = "true";
  }
});

test("API keys cannot open, read or acknowledge personal conversation history", async () => {
  const owner = await person();
  const d = (
    await h.call(owner.token, "POST", "/me/assistant/conversation")
  ).json();
  const made = await h.call(owner.token, "POST", "/me/api-keys", {
    name: "Conversation test",
  });
  assert.equal(made.statusCode, 201, made.body);
  const token = made.json().key;
  assert.equal(typeof token, "string");
  for (const [method, url, payload] of [
    ["GET", "/me/assistant/conversation", undefined],
    ["GET", "/me/assistant/work-controls", undefined],
    ["PATCH", "/me/assistant/work-controls", { background_paused: true }],
    ["POST", "/me/assistant/conversation", undefined],
    ["GET", `/me/assistant/conversations/${d.id}`, undefined],
    ["GET", `/me/assistant/conversations/${d.id}/history`, undefined],
    ["POST", `/me/assistant/conversations/${d.id}/read`, { through: "1" }],
    [
      "POST",
      `/me/assistant/conversations/${d.id}/entries/${randomUUID()}/answer`,
      { answer: "First", turn_id: randomUUID() },
    ],
  ] as const)
    assert.equal((await h.call(token, method, url, payload)).statusCode, 403);
  const exported = await h.call(token, "GET", "/me/export");
  assert.equal(exported.statusCode, 403, exported.body);
  assert.equal(
    exported.json().assistant_conversations,
    undefined,
    "Legacy key exports must not gain private conversation access",
  );
  const personal = await h.call(owner.token, "GET", "/me/export");
  assert.equal(personal.statusCode, 200, personal.body);
  assert.equal(personal.json().assistant_conversations.length, 1);
});

test("muting conversation alerts does not pause or revoke execution", async () => {
  const owner = await person();
  await h.call(owner.token, "POST", "/me/assistant/conversation");
  const response = await h.call(
    owner.token,
    "PATCH",
    "/me/assistant/conversation/preferences",
    { muted: true },
  );
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().muted, true);
  assert.equal(
    (
      await pool.query(
        "SELECT suspended_at FROM agent_grants WHERE user_id=$1 AND kind='assistant'",
        [owner.id],
      )
    ).rows[0].suspended_at,
    null,
  );
  const read = await h.call(
    owner.token,
    "GET",
    "/me/assistant/conversation/preferences",
  );
  assert.equal(read.json().muted, true);
  assert.ok(read.json().quiet_start);
  assert.ok(read.json().timezone);
});

test("notification entry lookup is private, current-authorized and cannot recreate a deleted destination", async () => {
  const owner = await person(),
    other = await person();
  const d = (
    await h.call(owner.token, "POST", "/me/assistant/conversation")
  ).json();
  await transaction((db) =>
    retainConversationTurn(db, owner.id, d.chat_id, {
      turn_id: randomUUID(),
      role: "user",
      text: "Retained target",
    }),
  );
  const feed = (
    await h.call(owner.token, "GET", `/me/assistant/conversations/${d.id}`)
  ).json();
  const e = feed.entries[0];
  const url = `/me/assistant/conversations/${d.id}/entries/${e.id}`;
  const location = await h.call(owner.token, "GET", url);
  assert.equal(location.statusCode, 200, location.body);
  assert.equal(location.json().sequence, e.sequence);
  assert.equal(location.json().entry_id, e.id);
  assert.match(location.headers["cache-control"] as string, /no-store/);
  assert.equal((await h.call(other.token, "GET", url)).statusCode, 404);
  const doc = randomUUID();
  await pool.query(
    "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Disposable source')",
    [doc, owner.id],
  );
  await pool.query(
    "INSERT INTO assistant_conversation_entry_sources(entry_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [e.id, doc],
  );
  assert.equal((await h.call(owner.token, "GET", url)).statusCode, 200);
  await pool.query("DELETE FROM docs WHERE id=$1", [doc]);
  assert.equal((await h.call(owner.token, "GET", url)).statusCode, 404);
  // A source-revoked/untrusted row must not disclose even its navigation identity.
  await pool.query(
    "UPDATE assistant_conversation_entries SET sources_checked=false WHERE id=$1",
    [e.id],
  );
  assert.equal((await h.call(owner.token, "GET", url)).statusCode, 404);
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [d.chat_id]);
  assert.equal((await h.call(owner.token, "GET", url)).statusCode, 404);
  assert.equal(
    (await h.call(owner.token, "GET", "/me/assistant/conversation")).json()
      .destination,
    null,
  );
});

test("registered conversations withhold unknown legacy poll results and recheck known source dependencies", async () => {
  const { buildAiService } = await import("../src/app.js");
  const ai = await buildAiService();
  const owner = await person();
  const d = (
    await h.call(owner.token, "POST", "/me/assistant/conversation")
  ).json();
  const chat = d.chat_id,
    unknown = randomUUID(),
    known = randomUUID(),
    doc = randomUUID();
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,chat_id,state,run_origin,sources_checked,result) VALUES($1,$2,$3,'done','person',false,$4)",
    [unknown, owner.id, chat, { answer: "Unknown legacy content" }],
  );
  const poll = (id: string) =>
    ai.inject({
      method: "GET",
      url: `/ai/chat/${id}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
  try {
    assert.equal((await poll(unknown)).statusCode, 404);
    await pool.query(
      "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Known source')",
      [doc, owner.id],
    );
    await pool.query(
      "INSERT INTO ai_jobs(id,user_id,chat_id,state,run_origin,sources_checked,result) VALUES($1,$2,$3,'done','person',true,$4)",
      [known, owner.id, chat, { answer: "Known, authorized result" }],
    );
    await pool.query(
      "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
      [known, doc],
    );
    const visible = await poll(known);
    assert.equal(visible.statusCode, 200, visible.body);
    assert.equal(visible.json().answer, "Known, authorized result");
    await pool.query("DELETE FROM docs WHERE id=$1", [doc]);
    assert.equal((await poll(known)).statusCode, 404);
  } finally {
    await ai.close();
  }
});
