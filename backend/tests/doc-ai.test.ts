import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });

/** What the stand-in provider says next, and what it was asked. */
let reply = "";
let beforeProviderReply: (() => Promise<void>) | undefined;
const asked: { system: string; user: string }[] = [];

const provider = createServer(async (req, res) => {
  const body = JSON.parse((await read(req)) || "{}");
  const messages = (body.messages ?? []) as { role: string; content: string }[];
  asked.push({
    system: messages.find((m) => m.role === "system")?.content ?? "",
    user: messages.find((m) => m.role === "user")?.content ?? "",
  });
  await beforeProviderReply?.();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: reply } }],
    }),
  );
});

const app = await buildApp();
let token = "";
let strangerToken = "";
let docId = "";

const call = (
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  as = () => token,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${as()}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async () =>
  (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `docai-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name: "Writer",
      },
    })
  ).json().token as string;

before(async () => {
  await migrate();
  token = await register();
  strangerToken = await register();
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  const port = (provider.address() as { port: number }).port;
  const standIn = (
    await pool.query<{ id: string }>(
      "INSERT INTO ai_providers(kind, name, base_url) VALUES ('openai-compatible', 'Doc AI stand-in', $1) RETURNING id",
      [`http://127.0.0.1:${port}/v1`],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1, model='doc-ai-test' WHERE id",
    [standIn],
  );
  docId = (
    await call("POST", "/docs", {
      title: "Pricing memo",
      content: [
        {
          type: "paragraph",
          text: "We will raise prices by ten per cent in October.",
          id: "p1",
        },
        { type: "paragraph", text: "Legal has not reviewed it.", id: "p2" },
      ],
    })
  ).json().id;
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
  provider.close();
});

test("the assistant offers words as a proposal, never as an edit", async () => {
  reply = "prices rise 10% in October";
  const made = await call("POST", `/docs/${docId}/assist`, {
    block_id: "p1",
    range_start: 0,
    range_end: "We will raise prices by ten per cent in October.".length,
    action: "shorten",
  });
  assert.equal(made.statusCode, 201);
  const s = made.json();
  assert.equal(s.status, "open");
  assert.equal(s.kind, "replace");
  assert.equal(s.text, "prices rise 10% in October");
  assert.match(s.note, /Assistant · Shorten/);

  // The page itself has not moved.
  const doc = (await call("GET", `/docs/${docId}`)).json();
  assert.equal(
    doc.content[0].text,
    "We will raise prices by ten per cent in October.",
  );

  // And it goes through the ordinary Take.
  const taken = await call("POST", `/docs/${docId}/suggestions/${s.id}`, {
    take: true,
  });
  assert.equal(taken.statusCode, 200);
  assert.equal(taken.json().doc.content[0].text, "prices rise 10% in October");
});

test("only the passage and its neighbours are sent, never the workspace", async () => {
  asked.length = 0;
  reply = "Legal have not reviewed it.";
  await call("POST", `/docs/${docId}/assist`, {
    block_id: "p2",
    range_start: 0,
    range_end: "Legal has not reviewed it.".length,
    action: "fix",
  });
  const sent = asked.at(-1)!;
  assert.match(sent.user, /Legal has not reviewed it\./);
  assert.match(sent.user, /Pricing memo/, "the page's own title is context");
  assert.match(sent.system, /NOTHING else/, "it is told to give words only");
});

test("an unchanged answer is not written down as a proposal", async () => {
  reply = "Legal has not reviewed it.";
  const same = await call("POST", `/docs/${docId}/assist`, {
    block_id: "p2",
    range_start: 0,
    range_end: "Legal has not reviewed it.".length,
    action: "improve",
  });
  assert.equal(same.statusCode, 409);
});

test("a line that is not on the page, and words that are not there", async () => {
  const nowhere = await call("POST", `/docs/${docId}/assist`, {
    block_id: "nope",
    range_start: 0,
    range_end: 4,
    action: "improve",
  });
  assert.equal(nowhere.statusCode, 404);
  const empty = await call("POST", `/docs/${docId}/assist`, {
    block_id: "p2",
    range_start: 0,
    range_end: 0,
    action: "improve",
  });
  assert.equal(empty.statusCode, 422);
});

test("someone else's page cannot be worked on, or asked about", async () => {
  const assist = await call(
    "POST",
    `/docs/${docId}/assist`,
    { block_id: "p2", range_start: 0, range_end: 5, action: "improve" },
    () => strangerToken,
  );
  assert.equal(assist.statusCode, 404);
  const ask = await call(
    "POST",
    `/docs/${docId}/ask`,
    { question: "What does it say?" },
    () => strangerToken,
  );
  assert.equal(ask.statusCode, 404);
});

test("a question is answered with the lines it rests on", async () => {
  reply = JSON.stringify({
    answer: "Prices rise in October; legal has not reviewed it.",
    sources: [0, 1],
  });
  const answered = await call("POST", `/docs/${docId}/ask`, {
    question: "What is the pricing decision?",
  });
  assert.equal(answered.statusCode, 200);
  const a = answered.json();
  assert.match(a.answer, /October/);
  assert.deepEqual(
    a.sources.map((s: { block_id: string }) => s.block_id),
    ["p1", "p2"],
  );
});

test("a provider that will not give JSON still says something", async () => {
  reply = "It says prices go up.";
  const a = (
    await call("POST", `/docs/${docId}/ask`, { question: "And?" })
  ).json();
  assert.equal(a.answer, "It says prices go up.");
  assert.deepEqual(a.sources, []);
});

test("Docs model calls persist an owned operation without creating a chat", async () => {
  reply = '{"answer":"No change.","sources":[]}';
  const owner = (
    await pool.query("SELECT user_id FROM docs WHERE id=$1", [docId])
  ).rows[0].user_id;
  const response = await call("POST", `/docs/${docId}/ask`, {
    question: "What changed?",
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().provider, {
    source: "default",
    model: "doc-ai-test",
    fallback: false,
  });
  const job = (
    await pool.query(
      "SELECT * FROM ai_jobs WHERE user_id=$1 AND run_state->>'feature'='doc_ask' ORDER BY created_at DESC LIMIT 1",
      [owner],
    )
  ).rows[0];
  assert.equal(job.state, "done");
  assert.equal(job.chat_id, null);
  assert.equal(job.provider_choice_snapshot.primary, "default");
  assert.match(job.run_state.operation_id, /^[0-9a-f-]{36}$/);
  assert.equal(job.sources_checked, true);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_job_sources WHERE job_id=$1 AND source_kind='doc' AND source_id=$2",
        [job.id, docId],
      )
    ).rowCount,
    1,
  );
});

test("revoked personal choice never silently sends Docs to the managed provider", async () => {
  const owner = (
    await pool.query("SELECT user_id FROM docs WHERE id=$1", [docId])
  ).rows[0].user_id;
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider,fallback_to_default) VALUES($1,'chatgpt',false)",
    [owner],
  );
  const before = asked.length;
  try {
    const response = await call("POST", `/docs/${docId}/ask`, {
      question: "Private request",
    });
    assert.equal(response.statusCode, 502);
    assert.equal(asked.length, before);
    const job = (
      await pool.query(
        "SELECT state,provider_choice_snapshot FROM ai_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [owner],
      )
    ).rows[0];
    assert.equal(job.state, "failed");
    assert.equal(job.provider_choice_snapshot.primary, "chatgpt");
  } finally {
    await pool.query("DELETE FROM user_ai_provider_choice WHERE user_id=$1", [
      owner,
    ]);
  }
});

test("Docs discards a model response when its source revision changes in flight", async () => {
  reply = '{"answer":"Stale material must not be returned.","sources":[]}';
  const fresh = (
    await call("POST", "/docs", {
      title: "Concurrent source",
      content: [{ id: "p", type: "paragraph", text: "Initial text" }],
    })
  ).json().id;
  beforeProviderReply = async () => {
    await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [fresh]);
  };
  try {
    const response = await call("POST", `/docs/${fresh}/ask`, {
      question: "Explain",
    });
    assert.equal(response.statusCode, 409);
    assert.ok(!response.body.includes("Stale material"));
  } finally {
    beforeProviderReply = undefined;
  }
});

test("explicit fallback permits a revoked personal connection to use managed Docs", async () => {
  const owner = (
    await pool.query("SELECT user_id FROM docs WHERE id=$1", [docId])
  ).rows[0].user_id;
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider,fallback_to_default) VALUES($1,'chatgpt',true)",
    [owner],
  );
  reply = '{"answer":"Fallback result.","sources":[]}';
  const before = asked.length;
  try {
    const response = await call("POST", `/docs/${docId}/ask`, {
      question: "Allowed fallback",
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(asked.length, before + 1);
    assert.deepEqual(response.json().provider, {
      source: "default",
      model: "doc-ai-test",
      fallback: true,
    });
    const operation = (
      await pool.query(
        "SELECT o.state FROM chatgpt_inference_operations o JOIN ai_jobs j ON j.id=o.job_id WHERE j.user_id=$1 ORDER BY j.created_at DESC LIMIT 1",
        [owner],
      )
    ).rows[0];
    assert.equal(operation.state, "fallback_started");
  } finally {
    await pool.query("DELETE FROM user_ai_provider_choice WHERE user_id=$1", [
      owner,
    ]);
  }
});

test("a provider-choice change during Docs inference fences the returned result", async () => {
  const owner = (
    await pool.query("SELECT user_id FROM docs WHERE id=$1", [docId])
  ).rows[0].user_id;
  reply = '{"answer":"Old provider result.","sources":[]}';
  beforeProviderReply = async () => {
    await pool.query(
      "INSERT INTO user_ai_provider_choice(user_id,primary_provider,fallback_to_default) VALUES($1,'chatgpt',false)",
      [owner],
    );
  };
  try {
    const response = await call("POST", `/docs/${docId}/ask`, {
      question: "Changed choice",
    });
    assert.equal(response.statusCode, 409);
    assert.ok(!response.body.includes("Old provider result"));
  } finally {
    beforeProviderReply = undefined;
    await pool.query("DELETE FROM user_ai_provider_choice WHERE user_id=$1", [
      owner,
    ]);
  }
});
