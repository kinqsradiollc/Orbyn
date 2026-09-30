import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
import { helpers, trapNetwork } from "./mcp-helpers.js";
import { OrbynClient, performReminderAction } from "@orbyn/api-client";
import type { ReminderNudgeCard } from "@orbyn/core";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp(),
  h = helpers(app),
  network = await trapNetwork();
const users: string[] = [];
before(async () => {
  await migrate();
});
after(async () => {
  assert.deepEqual(network.calls, []);
  network.restore();
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.end();
});
async function fixture() {
  const me = await h.register("action-receipts");
  users.push(me.id);
  const made = await h.call(me.token, "POST", "/items", {
    title: "Receipt task",
    kind: "task",
    status: "todo",
    priority: "medium",
    estimate_minutes: 30,
  });
  assert.equal(made.statusCode, 201, made.body);
  const item = made.json();
  const card: ReminderNudgeCard = {
    id: randomUUID(),
    key: `task:${item.id}`,
    entity_kind: "task",
    entity_id: item.id,
    actions: ["done", "move", "skip", "book"],
  };
  await pool.query(
    "INSERT INTO assistant_nudges(id,user_id,nudge_key,entity_kind,entity_id,local_day) VALUES($1,$2,$3,'task',$4,'2050-01-01')",
    [card.id, me.id, card.key, item.id],
  );
  const makeClient = () =>
    new OrbynClient({
      baseUrl: "http://orbyn.test",
      getToken: () => me.token,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const response = await app.inject({
          method: init?.method ?? "GET",
          url: url.pathname + url.search,
          headers: Object.fromEntries(new Headers(init?.headers)),
          ...(init?.body ? { payload: String(init.body) } : {}),
        });
        return new Response(response.body || null, {
          status: response.statusCode,
          headers: response.headers as Record<string, string>,
        });
      },
    });
  return { me, item, card, client: makeClient(), makeClient };
}
const path = "/me/assistant/reminder-actions";
test("a retry and another client recover one durable action and Undo receipt", async () => {
  const { me, item, card, client, makeClient } = await fixture();
  const first = await performReminderAction(client, card, "done");
  const second = await performReminderAction(makeClient(), card, "done");
  assert.equal(first.id, second.id);
  assert.equal((await client.getItem(item.id)).version, 2);
  const restored = await makeClient().reminderActionReceipt(card.id);
  assert.equal(restored?.id, first.id);
  assert.equal(restored?.undone, false);
  await makeClient().undoReminderAction(restored!.id);
  await first.undo(); // Repeating Undo is harmless.
  assert.equal((await client.getItem(item.id)).status, "todo");
  assert.equal((await client.getItem(item.id)).version, 3);
  const next = await performReminderAction(makeClient(), card, "move", {
    day: "2050-01-03",
  });
  assert.notEqual(next.id, first.id);
  assert.equal((await client.reminderActionReceipt(card.id))?.generation, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM assistant_action_receipts WHERE user_id=$1",
        [me.id],
      )
    ).rows[0].n,
    2,
  );
});
test("simultaneous identical booking requests commit exactly one session", async () => {
  const { me, item, card, client } = await fixture();
  const body = {
    card,
    action: "book",
    generation: 0,
    options: { day: "2050-01-03", minutes: 30 },
  };
  const responses = await Promise.all(
    Array.from({ length: 4 }, () => h.call(me.token, "POST", path, body)),
  );
  for (const response of responses)
    assert.equal(response.statusCode, 200, response.body);
  assert.equal(new Set(responses.map((row) => row.json().id)).size, 1);
  assert.equal((await client.itemSessions(item.id)).sessions.length, 1);
  await client.undoReminderAction(responses[0].json().id);
  assert.equal((await client.itemSessions(item.id)).sessions.length, 0);
});
test("different stale choices and generations cannot consume the next receipt", async () => {
  const { me, card, client, item } = await fixture();
  const body = { card, action: "done", generation: 0, options: {} };
  const first = await h.call(me.token, "POST", path, body);
  assert.equal(first.statusCode, 200, first.body);
  const stale = await h.call(me.token, "POST", path, {
    ...body,
    action: "move",
    options: { day: "2050-01-03" },
  });
  assert.equal(stale.statusCode, 409, stale.body);
  await client.undoReminderAction(first.json().id);
  const next = await h.call(me.token, "POST", path, {
    ...body,
    action: "move",
    generation: 1,
    options: { day: "2050-01-03" },
  });
  assert.equal(next.statusCode, 200, next.body);
  assert.equal((await h.call(me.token, "POST", path, body)).statusCode, 409);
  assert.equal((await client.getItem(item.id)).status, "todo");
});
test("receipt insertion failure rolls back the work mutation", async () => {
  const { me, card, client, item } = await fixture();
  await pool.query(
    `CREATE FUNCTION test_reject_action_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END $$`,
  );
  await pool.query(
    "CREATE TRIGGER test_reject_action_receipt BEFORE INSERT ON assistant_action_receipts FOR EACH ROW EXECUTE FUNCTION test_reject_action_receipt()",
  );
  try {
    const response = await h.call(me.token, "POST", path, {
      card,
      action: "done",
      generation: 0,
      options: {},
    });
    assert.equal(response.statusCode, 500, response.body);
    assert.equal((await client.getItem(item.id)).status, "todo");
    assert.equal((await client.getItem(item.id)).version, 1);
  } finally {
    await pool.query(
      "DROP TRIGGER test_reject_action_receipt ON assistant_action_receipts",
    );
    await pool.query("DROP FUNCTION test_reject_action_receipt()");
  }
  assert.equal(await client.reminderActionReceipt(card.id), null);
});
test("restored Undo refuses a later writer without changing the receipt or work", async () => {
  const { card, client, item, makeClient } = await fixture();
  const action = await performReminderAction(client, card, "done");
  const { itemBody } = await import("@orbyn/core");
  const current = await client.getItem(item.id);
  await client.updateItem(item.id, {
    ...itemBody(current),
    title: "Later writer",
  });
  await assert.rejects(makeClient().undoReminderAction(action.id!), {
    statusCode: 409,
  });
  assert.equal((await client.getItem(item.id)).title, "Later writer");
  assert.equal((await client.reminderActionReceipt(card.id))?.undone, false);
});
test("Skip persists its own receipt and Undo rejects a changed saved card", async () => {
  const { me, card, client } = await fixture();
  const chatId = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin,turns) VALUES($1,$2,'Reminders','reminders',$3::jsonb)",
    [
      chatId,
      me.id,
      JSON.stringify([
        {
          role: "assistant",
          turn_id: card.id,
          text: "Reminder",
          outcome: "info",
          nudge: card,
        },
      ]),
    ],
  );
  const receipt = await performReminderAction(client, card, "skip", {
    chatId,
    turnId: card.id,
  });
  assert.equal((await client.aiChat(chatId)).turns[0].outcome, "discarded");
  await pool.query(
    "UPDATE ai_chats SET turns=jsonb_set(turns,'{0,text}','\"Changed reminder\"') WHERE id=$1",
    [chatId],
  );
  await assert.rejects(client.undoReminderAction(receipt.id!), {
    statusCode: 409,
  });
  assert.equal((await client.aiChat(chatId)).turns[0].outcome, "discarded");
});
test("receipt endpoints enforce ownership, first-party access, source visibility and input shields", async () => {
  const { me, card, client, item } = await fixture();
  const other = await h.register("receipt-other");
  users.push(other.id);
  const receipt = await performReminderAction(client, card, "done");
  assert.equal(
    (await h.call(null, "POST", path, { card, action: "done", generation: 0 }))
      .statusCode,
    401,
  );
  assert.equal(
    (await h.call(other.token, "POST", `${path}/${receipt.id}/undo`, {}))
      .statusCode,
    404,
  );
  assert.equal(
    (await h.call(other.token, "GET", `${path}/nudges/${card.id}`)).json(),
    null,
  );
  assert.equal(
    (
      await h.call(me.token, "POST", path, {
        card,
        action: "delete",
        generation: 0,
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await h.call(me.token, "POST", path, {
        card,
        action: "book",
        generation: 0,
        options: { minutes: 0 },
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await h.call(me.token, "POST", path, {
        card: { ...card, id: randomUUID() },
        action: "done",
        generation: 0,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await h.call(me.token, "POST", path, {
        card: { ...card, entity_id: randomUUID() },
        action: "done",
        generation: 0,
      })
    ).statusCode,
    404,
  );
  await pool.query("DELETE FROM items WHERE id=$1", [item.id]);
  assert.equal(
    (await h.call(me.token, "POST", `${path}/${receipt.id}/undo`, {}))
      .statusCode,
    404,
  );
  assert.equal(
    (await h.call(me.token, "GET", `${path}/nudges/${card.id}`)).statusCode,
    404,
  );
});

test("receipt routes reject API keys, malformed JSON and burst writes", async () => {
  const { me, card } = await fixture();
  const key = (
    await h.call(me.token, "POST", "/me/api-keys", { name: "Receipt shield" })
  ).json().key;
  for (const [method, url, payload] of [
    ["POST", path, { card, action: "done", generation: 0 }],
    ["GET", `${path}/nudges/${card.id}`, undefined],
    ["POST", `${path}/${randomUUID()}/undo`, {}],
  ] as const) {
    assert.equal((await h.call(key, method, url, payload)).statusCode, 403);
  }
  const malformed = await app.inject({
    method: "POST",
    url: path,
    headers: {
      authorization: `Bearer ${me.token}`,
      "content-type": "application/json",
    },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  const statuses: number[] = [];
  for (let n = 0; n < 31; n++)
    statuses.push(
      (
        await app.inject({
          method: "POST",
          url: `${path}/${randomUUID()}/undo`,
          headers: { authorization: `Bearer ${me.token}` },
          payload: {},
          remoteAddress: "10.98.0.19",
        })
      ).statusCode,
    );
  assert.ok(statuses.includes(429));
});
