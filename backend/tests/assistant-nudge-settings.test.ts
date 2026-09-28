import { test, before, after } from "node:test";
import "./setup.js";
import { helpers } from "./mcp-helpers.js";
import assert from "node:assert/strict";
import {
  DEFAULT_REMINDER_NUDGES,
  reminderNudgeSettingsInput,
  reminderNudgesQuiet,
  canSendReminderNudge,
  savedChatTurn,
} from "@orbyn/core";
const prefs = { ...DEFAULT_REMINDER_NUDGES };
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");
const app = await buildApp();
const h = helpers(app);
const users: string[] = [];
before(async () => {
  await migrate();
});
after(async () => {
  await app.close();
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await pool.end();
});
test("reminder quiet windows include the start and exclude the end across midnight", () => {
  assert.equal(
    reminderNudgesQuiet(new Date("2050-01-01T22:00:00Z"), "UTC", prefs),
    true,
  );
  assert.equal(
    reminderNudgesQuiet(new Date("2050-01-02T07:59:00Z"), "UTC", prefs),
    true,
  );
  assert.equal(
    reminderNudgesQuiet(new Date("2050-01-02T08:00:00Z"), "UTC", prefs),
    false,
  );
  assert.equal(
    reminderNudgesQuiet(new Date("2050-01-01T12:00:00Z"), "UTC", {
      ...prefs,
      quiet_start: "11:00",
      quiet_end: "13:00",
    }),
    true,
  );
  assert.equal(
    reminderNudgesQuiet(new Date("2050-01-01T12:00:00Z"), "UTC", {
      ...prefs,
      quiet_start: "12:00",
      quiet_end: "12:00",
    }),
    false,
  );
});
test("both occurrences of a DST repeated hour respect the same quiet window", () => {
  const settings = { ...prefs, quiet_start: "01:00", quiet_end: "03:00" };
  for (const at of ["2026-04-04T15:30:00Z", "2026-04-04T16:30:00Z"])
    assert.equal(
      reminderNudgesQuiet(new Date(at), "Australia/Melbourne", settings),
      true,
    );
});
test("three per day, stopped keys, channel switches and 24-hour dedupe gate reminders", () => {
  const now = new Date("2050-01-01T12:00:00Z");
  const history = { sent_today: 2, last_sent_at: null, stopped: false };
  assert.equal(canSendReminderNudge(now, "UTC", prefs, history), true);
  assert.equal(
    canSendReminderNudge(now, "UTC", prefs, { ...history, sent_today: 3 }),
    false,
  );
  assert.equal(
    canSendReminderNudge(now, "UTC", prefs, { ...history, stopped: true }),
    false,
  );
  assert.equal(
    canSendReminderNudge(now, "UTC", { ...prefs, enabled: false }, history),
    false,
  );
  assert.equal(
    canSendReminderNudge(
      now,
      "UTC",
      { ...prefs, chat: false, push: false, email: false },
      history,
    ),
    false,
  );
  assert.equal(
    canSendReminderNudge(now, "UTC", prefs, {
      ...history,
      last_sent_at: new Date(now.getTime() - 86399999),
    }),
    false,
  );
  assert.equal(
    canSendReminderNudge(now, "UTC", prefs, {
      ...history,
      last_sent_at: new Date(now.getTime() - 86400000),
    }),
    true,
  );
});
test("reminder preferences reject unknown fields and invalid clocks; saved chat cards preserve action metadata", () => {
  assert.equal(
    reminderNudgeSettingsInput.safeParse({ ...prefs, quiet_start: "25:00" })
      .success,
    false,
  );
  assert.equal(
    reminderNudgeSettingsInput.safeParse({ ...prefs, team_id: "other" })
      .success,
    false,
  );
  const card = {
    id: "00000000-0000-4000-8000-000000000001",
    key: "overdue:task",
    entity_kind: "task" as const,
    entity_id: "00000000-0000-4000-8000-000000000002",
    actions: ["done", "move", "skip", "book"],
  };
  assert.deepEqual(
    savedChatTurn.parse({
      role: "assistant",
      text: "Your task is overdue.",
      nudge: card,
    }).nudge,
    card,
  );
});

test("reminder settings are person-only, persist per owner and reject malformed and excessive writes", async () => {
  const me = await h.register("nudge-settings");
  const other = await h.register("nudge-settings-other");
  users.push(me.id, other.id);
  assert.equal(
    (await h.call(null, "GET", "/me/assistant/reminder-nudges")).statusCode,
    401,
  );
  assert.deepEqual(
    (await h.call(me.token, "GET", "/me/assistant/reminder-nudges")).json(),
    prefs,
  );
  const changed = { ...prefs, chat: false, email: false, quiet_start: "23:30" };
  const saved = await h.call(
    me.token,
    "PUT",
    "/me/assistant/reminder-nudges",
    changed,
  );
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(
    (await h.call(me.token, "GET", "/me/assistant/reminder-nudges")).json(),
    changed,
  );
  assert.deepEqual(
    (await h.call(other.token, "GET", "/me/assistant/reminder-nudges")).json(),
    prefs,
  );
  assert.equal(
    (
      await h.call(me.token, "PUT", "/me/assistant/reminder-nudges", {
        ...prefs,
        quiet_end: "24:01",
      })
    ).statusCode,
    422,
  );
  const key = (
    await h.call(me.token, "POST", "/me/api-keys", { name: "Nudge test" })
  ).json().key;
  assert.equal(
    (await h.call(key, "PUT", "/me/assistant/reminder-nudges", prefs))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: "/me/assistant/reminder-nudges",
        headers: {
          authorization: `Bearer ${me.token}`,
          "content-type": "application/json",
        },
        payload: "{",
      })
    ).statusCode,
    400,
  );
  const statuses: number[] = [];
  for (let n = 0; n < 31; n++)
    statuses.push(
      (
        await app.inject({
          method: "PUT",
          url: "/me/assistant/reminder-nudges",
          headers: { authorization: `Bearer ${me.token}` },
          payload: prefs,
          remoteAddress: "10.98.4.1",
        })
      ).statusCode,
    );
  assert.ok(statuses.includes(429));
});

test("stopping a source is person-only, idempotent and keeps one stop across historical cards", async () => {
  const me = await h.register("nudge-stop");
  const other = await h.register("nudge-stop-other");
  users.push(me.id, other.id);
  const { randomUUID } = await import("node:crypto");
  const first = randomUUID(),
    latest = randomUUID(),
    entity = randomUUID();
  await pool.query(
    `INSERT INTO assistant_nudges(id, user_id, nudge_key, entity_kind, entity_id, local_day, sent_at)
    VALUES($1, $3, $4, 'task', $5, '2050-01-01', '2050-01-01T12:00:00Z'),
          ($2, $3, $4, 'task', $5, '2050-01-02', '2050-01-02T12:00:00Z')`,
    [first, latest, me.id, `task:${entity}`, entity],
  );
  const url = `/me/assistant/reminder-nudges/${first}/stop`;
  assert.equal((await h.call(null, "POST", url)).statusCode, 401);
  assert.equal((await h.call(other.token, "POST", url)).statusCode, 404);
  const key = (
    await h.call(me.token, "POST", "/me/api-keys", { name: "Nudge stop" })
  ).json().key;
  assert.equal((await h.call(key, "POST", url)).statusCode, 403);
  assert.equal(
    (
      await h.call(
        me.token,
        "POST",
        "/me/assistant/reminder-nudges/not-an-id/stop",
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        headers: {
          authorization: `Bearer ${me.token}`,
          "content-type": "application/json",
        },
        payload: "{",
      })
    ).statusCode,
    400,
  );
  for (const id of [first, latest, first]) {
    const result = await h.call(
      me.token,
      "POST",
      `/me/assistant/reminder-nudges/${id}/stop`,
    );
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(result.json(), { stopped: true });
  }
  const stopped = (
    await pool.query(
      "SELECT id FROM assistant_nudges WHERE user_id = $1 AND stopped",
      [me.id],
    )
  ).rows;
  assert.deepEqual(stopped, [{ id: latest }]);
  const statuses: number[] = [];
  for (let n = 0; n < 31; n++)
    statuses.push(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { authorization: `Bearer ${me.token}` },
          remoteAddress: "10.98.4.2",
        })
      ).statusCode,
    );
  assert.ok(statuses.includes(429));
});
