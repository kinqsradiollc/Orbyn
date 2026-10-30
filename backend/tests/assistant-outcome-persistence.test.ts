import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runtimeOutcome } from "../src/modules/ai/agent/outcome.js";
import { helpers, trapNetwork } from "./mcp-helpers.js";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { readAiChat } = await import("../src/modules/ai/chats.js");
const { registerOriginConversation, retainConversationTurn } =
  await import("../src/modules/assistant-workspace/conversation-storage.js");
const { conversationFeed } =
  await import("../src/modules/assistant-workspace/conversation-feed.js");
const { readAssistantProfiles } =
  await import("../src/modules/assistant-workspace/profiles.js");
const { buildApiService } = await import("../src/app.js");
const app = await buildApiService();
const h = helpers(app);
const network = await trapNetwork();
const users: string[] = [];
before(() => migrate());
after(async () => {
  network.restore();
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.end();
  assert.deepEqual(network.calls, []);
});
test("server receipts survive reload, preserve legacy storage, and respect ownership and revoked sources", async () => {
  const user = await h.register("outcome-owner");
  const other = await h.register("outcome-foreign");
  users.push(user.id, other.id);
  const chat = randomUUID(),
    job = randomUUID(),
    turn = randomUUID();
  const turns = [
    {
      role: "assistant" as const,
      text: "A draft is ready.",
      turn_id: turn,
      outcome: "info" as const,
    },
  ];
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin,turns) VALUES($1,$2,'Outcome privacy','task',$3)",
    [chat, user.id, JSON.stringify(turns)],
  );
  const receipt = runtimeOutcome({
    jobId: job,
    chatId: chat,
    turnId: turn,
    timedOut: true,
  });
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,chat_id,state,sources_checked,run_state,result,turn_id) VALUES($1,$2,$3,'queued',true,$4,$5,$6)",
    [
      job,
      user.id,
      chat,
      { version: 1, request: { automation: { kind: "task" } } },
      { turn_id: turn, assistant_run: { execution_outcome: receipt } },
      turn,
    ],
  );
  await pool.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [job]);
  const loaded = await readAiChat(pool, user.id, chat);
  assert.deepEqual(loaded.turns[0].execution_outcome, receipt);
  const profile = (await readAssistantProfiles(pool, user.id)).profiles[0];
  assert.deepEqual(profile.outputs[0].execution_outcome, receipt);
  assert.deepEqual(
    (await pool.query("SELECT turns FROM ai_chats WHERE id=$1", [chat])).rows[0]
      .turns,
    turns,
    "derived receipts must not alter strict legacy turn storage",
  );
  const legacyWire = await app.inject({
    method: "GET",
    url: "/me/assistant/profiles",
    headers: { authorization: `Bearer ${user.token}` },
  });
  assert.equal(legacyWire.statusCode, 200);
  assert.equal(
    legacyWire.json().profiles[0].outputs[0].execution_outcome,
    undefined,
    "old strict clients retain their previous wire shape",
  );
  const negotiated = await app.inject({
    method: "GET",
    url: "/me/assistant/profiles",
    headers: { authorization: `Bearer ${user.token}`, "x-orbyn-outcomes": "1" },
  });
  assert.deepEqual(
    negotiated.json().profiles[0].outputs[0].execution_outcome,
    receipt,
  );
  const destination = await transaction(async (db) => {
    const stream = await registerOriginConversation(db, user.id, chat);
    await retainConversationTurn(db, user.id, chat, turns[0]);
    return stream;
  });
  assert.ok(destination);
  const feed = await conversationFeed(pool, user.id, destination.id, {});
  const entry = feed.entries.find((entry) => entry.kind === "turn");
  assert.ok(entry?.kind === "turn");
  assert.deepEqual(
    entry.turn.execution_outcome,
    receipt,
    "retained conversation uses the same authorized receipt projection",
  );
  await assert.rejects(readAiChat(pool, other.id, chat));
  assert.deepEqual(
    (await readAssistantProfiles(pool, other.id)).profiles[0].outputs,
    [],
  );
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [job, randomUUID()],
  );
  const hidden = await readAssistantProfiles(pool, user.id);
  assert.deepEqual(hidden.profiles[0].outputs, []);
  // Legacy chat-level visibility may hide the whole chat; it must never expose the receipt.
  try {
    const revoked = await readAiChat(pool, user.id, chat);
    assert.ok(
      revoked.turns.every((saved) => saved.execution_outcome === undefined),
    );
  } catch (error) {
    assert.match(String(error), /Chat not found/);
  }
  await pool.query("DELETE FROM assistant_job_sources WHERE job_id=$1", [job]);
  const proposal = randomUUID();
  await pool.query(
    "INSERT INTO proposals(id,user_id,actions,expires_at) VALUES($1,$2,'[]',now()+interval '1 hour')",
    [proposal, user.id],
  );
  const pendingReceipt = runtimeOutcome({
    jobId: job,
    chatId: chat,
    turnId: turn,
    proposalOutcome: "pending",
    proposalId: proposal,
  });
  await pool.query("UPDATE ai_jobs SET result=$2 WHERE id=$1", [
    job,
    {
      turn_id: turn,
      assistant_run: {
        proposal_id: proposal,
        execution_outcome: pendingReceipt,
      },
    },
  ]);
  assert.equal(
    (await readAiChat(pool, user.id, chat)).turns[0].execution_outcome?.outcome,
    "waiting",
  );
  await pool.query(
    "UPDATE proposals SET expires_at=now()-interval '1 second' WHERE id=$1",
    [proposal],
  );
  const expiredReceipt = (await readAiChat(pool, user.id, chat)).turns[0]
    .execution_outcome;
  assert.equal(expiredReceipt?.outcome, "unverified");
  assert.equal(expiredReceipt?.reason, "waiting_expired");
  assert.equal(
    (await readAssistantProfiles(pool, user.id)).profiles[0].outputs[0]
      .execution_outcome?.reason,
    "waiting_expired",
  );
  const forged = { ...receipt, job_id: randomUUID() };
  await pool.query("UPDATE ai_jobs SET result=$2 WHERE id=$1", [
    job,
    { turn_id: turn, assistant_run: { execution_outcome: forged } },
  ]);
  assert.equal(
    (await readAiChat(pool, user.id, chat)).turns[0].execution_outcome,
    undefined,
    "a receipt must match its server-owned job identity",
  );
});
