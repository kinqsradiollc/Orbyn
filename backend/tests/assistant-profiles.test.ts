import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { defaultNightShift, assistantProfileState } from "@orbyn/core";
import { helpers, trapNetwork } from "./mcp-helpers.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { readAssistantProfiles, assistantProfileWindow } =
  await import("../src/modules/assistant-workspace/profiles.js");
const { buildApp } = await import("../src/app.js");
const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();
const users: string[] = [];
before(() => migrate());
after(async () => {
  assert.deepEqual(network.calls, []);
  network.restore();
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.end();
});
async function person() {
  const user = await h.register("profile-test");
  users.push(user.id);
  return user;
}
async function job(owner: string, lane: "background" | "overnight") {
  const origin = lane === "overnight" ? "night" : "task";
  const chat = (
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title,origin) VALUES(gen_random_uuid(),$1,'Private profile',$2) RETURNING id",
      [owner, origin],
    )
  ).rows[0].id;
  return (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,state,sources_checked,run_state) VALUES($1,$2,'queued',true,$3) RETURNING id",
      [owner, chat, { version: 1, request: { automation: { kind: origin } } }],
    )
  ).rows[0].id as string;
}
test("idle profiles remain idle; refresh never becomes activity", async () => {
  const user = await person();
  const first = await readAssistantProfiles(pool, user.id);
  assert.deepEqual(
    first.profiles.map((p) => p.state),
    ["idle", "idle"],
  );
  assert.ok(first.profiles.every((p) => p.last_activity_at === null));
  const response = await h.call(user.token, "GET", "/me/assistant/profiles");
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.deepEqual(response.json().profiles, first.profiles);
});
test("working requires an unexpired lease; recovery is queued and lanes stay separate", async () => {
  const user = await person();
  const background = await job(user.id, "background");
  const overnight = await job(user.id, "overnight");
  let page = await readAssistantProfiles(pool, user.id);
  assert.deepEqual(
    page.profiles.map((p) => p.state),
    ["queued", "queued"],
  );
  assert.ok(page.profiles.every((p) => p.last_activity_at === null));
  await pool.query(
    "UPDATE ai_jobs SET state='running',lease_until=now()+interval '60 seconds' WHERE id=$1",
    [background],
  );
  page = await readAssistantProfiles(pool, user.id);
  assert.deepEqual(
    page.profiles.map((p) => p.state),
    ["working", "queued"],
  );
  const last = page.profiles[0].last_activity_at;
  await pool.query(
    "UPDATE ai_jobs SET lease_until=now()-interval '1 second',last_polled_at=now(),heartbeat_at=now() WHERE id=$1",
    [background],
  );
  page = await readAssistantProfiles(pool, user.id);
  assert.equal(page.profiles[0].state, "queued");
  assert.equal(page.profiles[0].counts.recovering, 1);
  assert.equal(page.profiles[0].last_activity_at, last);
  await pool.query("UPDATE ai_jobs SET state='waiting' WHERE id=$1", [
    background,
  ]);
  await pool.query(
    "UPDATE ai_jobs SET state='running',lease_until=now()+interval '60 seconds' WHERE id=$1",
    [overnight],
  );
  assert.deepEqual(
    (await readAssistantProfiles(pool, user.id)).profiles.map((p) => p.state),
    ["waiting", "working"],
  );
  await pool.query("UPDATE ai_jobs SET state='done' WHERE id=ANY($1::uuid[])", [
    [background, overnight],
  ]);
  assert.deepEqual(
    (await readAssistantProfiles(pool, user.id)).profiles.map((p) => p.state),
    ["idle", "idle"],
  );
});
test("restricted and foreign jobs do not alter profiles or expose activity", async () => {
  const user = await person();
  const other = await person();
  const hidden = await job(user.id, "background");
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [hidden, randomUUID()],
  );
  await pool.query(
    "UPDATE ai_jobs SET state='running',lease_until=now()+interval '60 seconds' WHERE id=$1",
    [hidden],
  );
  await job(other.id, "overnight");
  const page = await readAssistantProfiles(pool, user.id);
  assert.ok(
    page.profiles.every(
      (p) => p.state === "idle" && p.last_activity_at === null,
    ),
  );
});
test("night windows are scheduled permissions, not executing work", () => {
  const settings = {
    ...defaultNightShift(),
    enabled: true,
    start: "22:00",
    end: "08:00",
    timezone: "Australia/Melbourne",
  };
  const before = assistantProfileWindow(
    new Date("2026-10-03T11:00:00Z"),
    settings,
  );
  assert.equal(before.in_window, false);
  assert.equal(before.next_start_at, "2026-10-03T12:00:00.000Z");
  const during = assistantProfileWindow(
    new Date("2026-10-03T16:00:00Z"),
    settings,
  );
  assert.equal(during.in_window, true);
  assert.equal(during.next_start_at, "2026-10-04T11:00:00.000Z");
  assert.equal(
    assistantProfileWindow(new Date(), { ...settings, enabled: false })
      .next_start_at,
    null,
  );
  const counts = { working: 0, queued: 0, recovering: 0, waiting: 0 };
  assert.equal(assistantProfileState(counts, true), "scheduled");
  assert.equal(assistantProfileState(counts, false), "idle");
  assert.equal(
    assistantProfileState({ ...counts, working: 1 }, true),
    "working",
  );
});

test("scheduled profiles and per-night estimates come from the owner's settings", async () => {
  const user = await person();
  const other = await person();
  const settings = {
    ...defaultNightShift(),
    enabled: true,
    start: "22:00",
    end: "08:00",
    timezone: "Australia/Melbourne",
  };
  await pool.query(
    "INSERT INTO agent_settings(user_id,night_shift) VALUES($1,$2)",
    [user.id, settings],
  );
  await pool.query(
    "INSERT INTO assistant_nights(user_id,local_day,budget_used,status) VALUES($1,'2026-10-02',123,'done'),($2,'2026-10-02',999,'done')",
    [user.id, other.id],
  );
  let page = await readAssistantProfiles(
    pool,
    user.id,
    new Date("2026-10-03T11:00:00Z"),
  );
  assert.deepEqual(
    page.profiles.map((p) => p.state),
    ["idle", "scheduled"],
  );
  assert.equal(page.profiles[1].budget?.estimated_tokens, 123);
  assert.equal(page.profiles[1].budget?.local_day, "2026-10-02");
  assert.equal(page.profiles[0].budget, null);
  page = await readAssistantProfiles(
    pool,
    user.id,
    new Date("2026-10-03T16:00:00Z"),
  );
  assert.equal(
    page.profiles[1].state,
    "idle",
    "an open night window without jobs is not work",
  );
  assert.equal(
    page.profiles[1].budget?.estimated_tokens,
    0,
    "current window must not inherit the previous night's estimate",
  );
  await pool.query(
    "UPDATE agent_settings SET night_shift=$2 WHERE user_id=$1",
    [user.id, { ...settings, enabled: false }],
  );
  page = await readAssistantProfiles(
    pool,
    user.id,
    new Date("2026-10-03T11:00:00Z"),
  );
  assert.equal(page.profiles[1].state, "idle");
  assert.equal(page.profiles[1].window?.next_start_at, null);
});
test("profile route shields authentication, disabled users, invalid queries and rate limits", async () => {
  const path = "/me/assistant/profiles";
  assert.equal((await h.call(null, "GET", path)).statusCode, 401);
  const user = await person();
  const key = (
    await h.call(user.token, "POST", "/me/api-keys", { name: "Profile test" })
  ).json().key;
  assert.equal((await h.call(key, "GET", path)).statusCode, 403);
  assert.equal(
    (await h.call(user.token, "GET", path + "?owner_id=other")).statusCode,
    400,
  );
  let limited = false;
  for (let i = 0; i < 125; i++) {
    const response = await h.call(user.token, "GET", path);
    if (response.statusCode === 429) {
      limited = true;
      break;
    }
    assert.equal(response.statusCode, 200, response.body);
  }
  assert.equal(limited, true);
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [user.id]);
  const disabled = await app.inject({
    method: "GET",
    url: path,
    remoteAddress: "10.97.1.2",
    headers: { authorization: `Bearer ${user.token}` },
  });
  assert.equal(disabled.statusCode, 403);
});
