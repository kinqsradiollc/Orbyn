import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Personal API keys act as their owner for items, pages and the calendar,
 * and never for the account itself: a leaked key can't mint more access,
 * change how the owner signs in, send their data somewhere new, spend the
 * assistant, or carry an admin's powers. Admins can see and revoke keys, and
 * every key made, deleted or revoked is in the audit log.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");

const app = await buildApp();

let caller = 0;
const address = () => `10.61.${Math.floor(++caller / 250)}.${caller % 250}`;
type Json = Record<string, any>;
async function call(
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) {
  const r = await app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as Json }),
  });
  let body: any = null;
  try {
    body = r.body ? JSON.parse(r.body) : null;
  } catch {
    body = r.body;
  }
  return { status: r.statusCode, body, raw: r };
}

async function newUser(role: "admin" | "member" = "member") {
  const r = await call(null, "POST", "/auth/register", {
    email: `keys-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name: "Key holder",
  });
  assert.equal(r.status, 201, r.raw.body);
  const id = r.body.user.id as string;
  if (role === "admin")
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [id]);
  return { token: r.body.token as string, id, email: r.body.user.email };
}

async function newKey(token: string, name = "Script") {
  const r = await call(token, "POST", "/me/api-keys", { name });
  assert.equal(r.status, 201, r.raw.body);
  return r.body as { id: string; key: string; prefix: string; name: string };
}

const auditFor = async (keyId: string) =>
  (
    await pool.query<{ action: string; actor_id: string; details: Json }>(
      "SELECT action, actor_id, details FROM audit_log WHERE target_type = 'api_key' AND target_id = $1 ORDER BY id",
      [keyId],
    )
  ).rows;

let me: Awaited<ReturnType<typeof newUser>>;
let key: string;

before(async () => {
  await migrate();
  me = await newUser();
  key = (await newKey(me.token)).key;
});

after(async () => {
  await app.close();
  await pool.end();
});

test("a key is refused on every account route, with a reason", async () => {
  const any = randomUUID();
  const blocked: [
    "GET" | "POST" | "PUT" | "DELETE",
    string,
    Record<string, unknown>?,
  ][] = [
    ["POST", "/me/api-keys", { name: "Another" }],
    ["GET", "/me/webhooks"],
    [
      "POST",
      "/me/webhooks",
      { url: "https://93.184.216.34/hook", events: ["item.created"] },
    ],
    ["PUT", `/me/webhooks/${any}`, { active: false }],
    ["DELETE", `/me/webhooks/${any}`],
    ["POST", `/me/webhooks/${any}/test`],
    ["GET", "/me/chat"],
    [
      "PUT",
      "/me/chat",
      { kind: "slack", url: "https://hooks.slack.com/services/x" },
    ],
    ["DELETE", "/me/chat"],
    ["POST", "/me/chat/test"],
    ["GET", "/me/sessions"],
    ["DELETE", `/me/sessions/${any}`],
    ["POST", "/me/sessions/revoke-others"],
    ["GET", "/me/2fa"],
    ["POST", "/me/2fa/setup"],
    ["POST", "/me/2fa/enable", { code: "123456" }],
    ["POST", "/me/2fa/disable", { code: "123456" }],
    ["GET", "/me/passkeys"],
    ["POST", "/me/passkeys/options"],
    ["POST", "/me/passkeys", {}],
    ["DELETE", `/me/passkeys/${any}`],
    ["GET", "/me/export"],
    ["DELETE", "/me", { password: "a-long-test-password" }],
    ["PUT", "/me", { email_reminders: false }],
    ["PUT", "/me/profile", { bio: "Taken over" }],
    ["PUT", "/me/privacy", { analytics_opt_out: true }],
    ["POST", "/me/timezone", { timezone: "Pacific/Kiritimati" }],
    ["POST", "/me/consent", { terms_version: "any" }],
    ["POST", "/me/inbox/rotate"],
    ["DELETE", "/me/inbox"],
    ["POST", "/me/calendar-feed", {}],
    ["PUT", "/me/calendar-feed", { include_blocks: true }],
    ["DELETE", "/me/calendar-feed"],
    ["POST", "/devices", { token: "ExponentPushToken[key-test]" }],
    ["DELETE", "/devices", { token: "ExponentPushToken[key-test]" }],
    ["POST", `/ai/proposals/${any}/apply`],
    ["POST", "/ai/chat", { message: "hi", timezone: "UTC", history: [] }],
    ["POST", "/ai/chat/start", { message: "hi", timezone: "UTC" }],
    ["GET", `/ai/chat/${any}`],
    ["POST", "/ai/project", { brief: "A launch" }],
    ["POST", "/ai/agenda/today", {}],
    ["POST", "/ai/study/grade", {}],
    ["POST", `/ai/study/pages/${any}/cards`, {}],
    ["POST", `/ai/study/cards/${any}/explain`, {}],
    ["POST", `/docs/${any}/assist`, {}],
    ["POST", `/docs/${any}/ask`, { question: "What?" }],
  ];
  for (const [method, url, payload] of blocked) {
    const r = await call(key, method, url, payload);
    assert.equal(r.status, 403, `${method} ${url}: ${r.raw.body}`);
    assert.match(r.body.message, /API keys can't/, `${method} ${url}`);
  }
  // Nothing happened: the account is still there, with one key and no 2FA,
  // its settings as they were, and no phone of the key's getting reminders.
  const account = await call(me.token, "GET", "/me");
  assert.equal(account.status, 200);
  assert.equal(account.body.bio, "");
  assert.equal((await call(me.token, "GET", "/me/api-keys")).body.length, 1);
  assert.equal((await call(me.token, "GET", "/me/2fa")).body.enabled, false);
  assert.equal(
    (await call(me.token, "GET", "/me/privacy")).body.analytics_opt_out,
    false,
  );
  const devices = await pool.query(
    "SELECT 1 FROM devices WHERE token = 'ExponentPushToken[key-test]'",
  );
  assert.equal(devices.rowCount, 0);
  // The owner's own session can do all of it.
  assert.equal((await call(me.token, "GET", "/me/webhooks")).status, 200);
  assert.equal((await call(me.token, "GET", "/me/sessions")).status, 200);
  assert.equal((await call(me.token, "GET", "/me/export")).status, 200);
});

test("a key keeps items, pages and the calendar, and can read its account", async () => {
  const created = await call(key, "POST", "/items", {
    title: "From a script",
    kind: "task",
  });
  assert.equal(created.status, 201, created.raw.body);
  assert.equal((await call(key, "GET", "/items")).status, 200);
  const page = await call(key, "POST", "/docs", { title: "Script notes" });
  assert.equal(page.status, 201, page.raw.body);
  assert.equal((await call(key, "GET", `/docs/${page.body.id}`)).status, 200);
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
  assert.equal(
    (
      await call(
        key,
        "GET",
        `/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
    ).status,
    200,
  );
  assert.equal((await call(key, "GET", "/me")).status, 200);
  assert.equal((await call(key, "GET", "/me/api-keys")).status, 200);
  assert.equal((await call(key, "GET", "/me/calendar-feed")).status, 200);
  assert.equal((await call(key, "GET", "/me/profile")).status, 200);
  assert.equal((await call(key, "GET", "/me/privacy")).status, 200);
});

test("a key can remove itself, but not its owner's other keys", async () => {
  const owner = await newUser();
  const first = await newKey(owner.token, "Zapier");
  const second = await newKey(owner.token, "Home script");
  const other = await newUser();
  const theirs = await newKey(other.token, "Theirs");
  for (const id of [second.id, theirs.id, randomUUID()]) {
    const r = await call(first.key, "DELETE", `/me/api-keys/${id}`);
    assert.equal(r.status, 403, r.raw.body);
    assert.match(r.body.message, /can remove only itself/);
  }
  assert.equal((await call(second.key, "GET", "/items")).status, 200);
  assert.equal((await call(theirs.key, "GET", "/items")).status, 200);
  assert.equal((await auditFor(second.id)).length, 1, "only its creation");
  assert.equal(
    (await call(first.key, "DELETE", `/me/api-keys/${first.id}`)).status,
    204,
  );
  assert.equal((await call(first.key, "GET", "/items")).status, 401);
  // Signed in, the owner removes any of theirs.
  assert.equal(
    (await call(owner.token, "DELETE", `/me/api-keys/${second.id}`)).status,
    204,
  );
  assert.equal((await call(second.key, "GET", "/items")).status, 401);
});

test("keys: 401 for a bad or deleted key, 422 for a bad name, 429 past the limit", async () => {
  const bad = await call("ok_not-a-real-key", "GET", "/items");
  assert.equal(bad.status, 401);
  assert.match(bad.body.message, /API key isn't valid/);
  assert.equal((await call(null, "POST", "/me/api-keys", {})).status, 401);
  assert.equal(
    (await call(me.token, "POST", "/me/api-keys", { name: "" })).status,
    422,
  );
  // A refused route still counts against the key's limit there.
  const owner = await newUser();
  const limited = await newKey(owner.token);
  let last = { status: 0 } as Awaited<ReturnType<typeof call>>;
  for (let i = 0; i < 11; i++)
    last = await call(limited.key, "POST", "/me/api-keys", { name: `K${i}` });
  assert.equal(last.status, 429);
  assert.equal(
    (await call(owner.token, "GET", "/me/api-keys")).body.length,
    1,
    "no key was made",
  );
});

test("making and deleting a key is in the audit log, with whose key it was", async () => {
  const owner = await newUser();
  const made = await newKey(owner.token, "Zapier");
  assert.deepEqual(
    (await auditFor(made.id)).map((a) => [
      a.action,
      a.actor_id,
      a.details.user_id,
      a.details.name,
      a.details.prefix,
    ]),
    [["api_key.created", owner.id, owner.id, "Zapier", made.prefix]],
  );
  assert.equal(
    JSON.stringify(await auditFor(made.id)).includes(made.key),
    false,
    "the key itself is never logged",
  );
  // A key may retire itself; the log says it was a key that did it.
  const gone = await call(made.key, "DELETE", `/me/api-keys/${made.id}`);
  assert.equal(gone.status, 204);
  assert.equal((await call(made.key, "GET", "/items")).status, 401);
  const trail = await auditFor(made.id);
  assert.equal(trail[1].action, "api_key.deleted");
  assert.equal(trail[1].details.via, "api_key");
  assert.equal(
    (await call(owner.token, "DELETE", `/me/api-keys/${made.id}`)).status,
    404,
  );
  const other = await newKey(owner.token, "Make");
  await call(owner.token, "DELETE", `/me/api-keys/${other.id}`);
  assert.equal((await auditFor(other.id))[1].details.via, "session");
});

test("admins see a person's keys and can revoke one; the history says so", async () => {
  const admin = await newUser("admin");
  const owner = await newUser();
  const first = await newKey(owner.token, "Zapier");
  const second = await newKey(owner.token, "Home script");
  await call(first.key, "GET", "/items");

  const detail = await call(admin.token, "GET", `/admin/users/${owner.id}`);
  assert.equal(detail.status, 200, detail.raw.body);
  assert.equal(detail.body.api_keys, 2);
  assert.deepEqual(
    detail.body.keys.map((k: Json) => k.name),
    ["Home script", "Zapier"],
  );
  const zapier = detail.body.keys.find((k: Json) => k.id === first.id);
  assert.equal(zapier.prefix, first.prefix);
  assert.notEqual(zapier.last_used_at, null);
  assert.equal(detail.raw.body.includes(first.key), false);
  assert.equal(detail.raw.body.includes("key_hash"), false);

  const path = `/admin/users/${owner.id}/api-keys/${first.id}`;
  // Only admins, only signed in to the app, and only that person's key.
  assert.equal((await call(null, "DELETE", path)).status, 401);
  assert.equal((await call(owner.token, "DELETE", path)).status, 403);
  const adminKey = await newKey(admin.token, "Admin script");
  const viaKey = await call(adminKey.key, "DELETE", path);
  assert.equal(viaKey.status, 403);
  assert.match(viaKey.body.message, /admin console/);
  assert.equal(
    (
      await call(
        admin.token,
        "DELETE",
        `/admin/users/${admin.id}/api-keys/${first.id}`,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        admin.token,
        "DELETE",
        `/admin/users/${owner.id}/api-keys/not-a-key`,
      )
    ).status,
    404,
  );

  const revoked = await call(admin.token, "DELETE", path);
  assert.equal(revoked.status, 204);
  assert.equal((await call(first.key, "GET", "/items")).status, 401);
  assert.equal((await call(second.key, "GET", "/items")).status, 200);
  assert.equal((await call(admin.token, "DELETE", path)).status, 404);
  const trail = await auditFor(first.id);
  assert.equal(trail.at(-1)!.action, "api_key.revoked");
  assert.equal(trail.at(-1)!.actor_id, admin.id);
  assert.equal(trail.at(-1)!.details.user_id, owner.id);

  const after = await call(admin.token, "GET", `/admin/users/${owner.id}`);
  assert.deepEqual(
    after.body.keys.map((k: Json) => k.id),
    [second.id],
  );
  const actions = after.body.audit.map((a: Json) => a.action);
  assert.ok(actions.includes("api_key.revoked"), actions.join());
  assert.ok(actions.includes("api_key.created"), actions.join());
});

test("an admin's key is an ordinary member for teams it isn't on", async () => {
  const admin = await newUser("admin");
  const adminKey = await newKey(admin.token, "Admin script");
  const owner = await newUser();
  const team = await call(owner.token, "POST", "/teams", { name: "Studio" });
  assert.equal(team.status, 201, team.raw.body);
  const path = `/teams/${team.body.id}`;
  // Signed in to the app, an admin may manage any team…
  assert.equal((await call(admin.token, "GET", path)).status, 200);
  // …but not through a key: the team isn't theirs to see.
  assert.equal((await call(adminKey.key, "GET", path)).status, 404);
  const rename = await call(adminKey.key, "PUT", path, { name: "Taken over" });
  assert.equal(rename.status, 404);
  assert.match(rename.body.message, /Team not found/);
  assert.equal((await call(adminKey.key, "DELETE", path)).status, 404);
  assert.equal(
    (
      await call(adminKey.key, "POST", `${path}/members`, {
        email: admin.email,
        role: "owner",
      })
    ).status,
    404,
  );
  const still = await call(owner.token, "GET", path);
  assert.equal(still.body.name, "Studio");
  assert.equal(still.body.members.length, 1);
});

test("during maintenance an admin's session may change things, its key may not", async () => {
  const admin = await newUser("admin");
  const adminKey = await newKey(admin.token, "Admin script");
  const on = await call(admin.token, "PUT", "/admin/maintenance", {
    enabled: true,
    message: "",
    until: null,
  });
  assert.equal(on.status, 200, on.raw.body);
  try {
    const item = { title: "During maintenance", kind: "task" };
    const byKey = await call(adminKey.key, "POST", "/items", item);
    assert.equal(byKey.status, 503);
    assert.equal(byKey.body.maintenance, true);
    assert.equal((await call(adminKey.key, "GET", "/items")).status, 200);
    assert.equal((await call(admin.token, "POST", "/items", item)).status, 201);
  } finally {
    await call(admin.token, "PUT", "/admin/maintenance", { enabled: false });
    // Whatever that answered, maintenance must not outlive this test.
    await pool.query("DELETE FROM system_settings WHERE key = 'maintenance'");
    invalidateSettings();
  }
});
