import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const adminEmail = `root-${randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = adminEmail;
process.env.SMTP_HOST = "";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { enqueue } = await import("../src/worker/scheduler.js");
const { OrbynClient } = await import("@orbyn/api-client");

const app = await buildApp();
type Account = { token: string; id: string; email: string };
const accounts: Account[] = [];
const auth = (a: Account) => ({ authorization: `Bearer ${a.token}` });

async function register(
  label: string,
  email = `${label}-${randomUUID()}@example.com`,
) {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "a-long-test-password", name: label },
  });
  assert.equal(r.statusCode, 201, r.body);
  const body = r.json();
  const account = {
    token: body.token,
    id: body.user.id,
    email,
    role: body.user.role,
  };
  accounts.push(account);
  return account;
}

const call = (
  a: Account,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: auth(a),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const task = (title: string, team_id: string | null = null) => ({
  title,
  team_id,
  due_at: new Date(Date.now() + 60_000).toISOString(),
});

let admin: Account & { role: string };
let owner: Account & { role: string };
let member: Account & { role: string };
let viewer: Account & { role: string };
let outsider: Account & { role: string };
let teamId = "";

before(async () => {
  await migrate();
  // The admin registers first so the "first account is admin" rule cannot promote the others.
  admin = await register("admin", adminEmail);
  owner = await register("owner");
  member = await register("member");
  viewer = await register("viewer");
  outsider = await register("outsider");
});

after(async () => {
  await pool.query("DELETE FROM teams WHERE created_by=ANY($1::uuid[])", [
    accounts.map((a) => a.id),
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    accounts.map((a) => a.id),
  ]);
  await app.close();
  await pool.end();
});

test("ADMIN_EMAILS grants admin; everyone else is a member", async () => {
  assert.equal(admin.role, "admin");
  for (const a of [owner, member, viewer, outsider])
    assert.equal(a.role, "member");
  assert.equal((await call(owner, "GET", "/me")).json().role, "member");
});

test("members cannot reach any admin route", async () => {
  for (const url of [
    "/admin/overview",
    "/admin/users",
    "/admin/teams",
    "/admin/audit",
    "/admin/database/tables",
    "/admin/database/tables/users",
    "/admin/database/tables/users/rows",
  ])
    assert.equal((await call(member, "GET", url)).statusCode, 403, url);
  assert.equal(
    (
      await call(member, "PUT", `/admin/users/${outsider.id}`, {
        role: "admin",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call(member, "DELETE", `/admin/users/${outsider.id}`)).statusCode,
    403,
  );
});

test("database explorer exposes structure but masks private values", async () => {
  const anonymous = await app.inject({
    method: "GET",
    url: "/admin/database/tables",
  });
  assert.equal(anonymous.statusCode, 401);
  const tables = await call(admin, "GET", "/admin/database/tables");
  assert.equal(tables.statusCode, 200, tables.body);
  assert.ok(tables.json().some((t: { name: string }) => t.name === "users"));

  const detail = await call(admin, "GET", "/admin/database/tables/users");
  assert.equal(detail.statusCode, 200, detail.body);
  assert.ok(
    detail
      .json()
      .columns.some((c: { name: string }) => c.name === "password_hash"),
  );
  assert.ok(detail.json().indexes.length > 0);

  const rows = await call(admin, "GET", "/admin/database/tables/users/rows");
  assert.equal(rows.statusCode, 200, rows.body);
  assert.ok(rows.json().rows.length > 0);
  for (const row of rows.json().rows) assert.equal(row.password_hash, "••••");
  assert.equal(rows.json().limit, 25);
  const items = await call(admin, "GET", "/admin/database/tables/items/rows");
  assert.equal(items.statusCode, 200, items.body);
  for (const row of items.json().rows) assert.equal(row.title, "••••");
  assert.equal(
    (await call(admin, "GET", "/admin/database/tables/not_a_table")).statusCode,
    404,
  );
  assert.equal(
    (await call(admin, "GET", "/admin/database/tables/users/rows?offset=-1"))
      .statusCode,
    422,
  );
});

test("team roles control membership and team items", async () => {
  const created = await call(owner, "POST", "/teams", { name: "Launch crew" });
  assert.equal(created.statusCode, 201);
  teamId = created.json().id;
  assert.equal(created.json().role, "owner");

  for (const [who, role] of [
    [member, "member"],
    [viewer, "viewer"],
  ] as const)
    assert.equal(
      (
        await call(owner, "POST", `/teams/${teamId}/members`, {
          email: who.email,
          role,
        })
      ).statusCode,
      201,
    );
  assert.equal(
    (
      await call(owner, "POST", `/teams/${teamId}/members`, {
        email: member.email,
      })
    ).statusCode,
    409,
  );

  // Outsiders cannot see the team or its items at all.
  assert.equal(
    (await call(outsider, "GET", `/teams/${teamId}`)).statusCode,
    404,
  );

  // Members write, viewers read.
  const item = await call(
    member,
    "POST",
    "/items",
    task("Ship launch", teamId),
  );
  assert.equal(item.statusCode, 201);
  const shared = item.json();
  assert.equal(
    (await call(viewer, "POST", "/items", task("Nope", teamId))).statusCode,
    403,
  );
  const viewerList = (await call(viewer, "GET", "/items")).json();
  assert.ok(
    viewerList.some(
      (i: { id: string; team_name: string }) =>
        i.id === shared.id && i.team_name === "Launch crew",
    ),
  );
  assert.equal(
    (
      await call(viewer, "PUT", `/items/${shared.id}`, {
        ...task("Edited by viewer", teamId),
        version: shared.version,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        outsider,
        "DELETE",
        `/items/${shared.id}?version=${shared.version}`,
      )
    ).statusCode,
    404,
  );
  assert.ok(
    !(await call(outsider, "GET", "/items"))
      .json()
      .some((i: { id: string }) => i.id === shared.id),
  );
  assert.equal(
    (await call(outsider, "GET", `/items?team_id=${teamId}`)).statusCode,
    404,
  );

  // Viewers and members cannot manage members; team admins cannot grant admin.
  assert.equal(
    (
      await call(viewer, "POST", `/teams/${teamId}/members`, {
        email: outsider.email,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(owner, "PUT", `/teams/${teamId}/members/${member.id}`, {
        role: "admin",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(member, "PUT", `/teams/${teamId}/members/${viewer.id}`, {
        role: "admin",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(member, "PUT", `/teams/${teamId}/members/${viewer.id}`, {
        role: "member",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(member, "PUT", `/teams/${teamId}/members/${owner.id}`, {
        role: "viewer",
      })
    ).statusCode,
    403,
  );

  // The only owner cannot leave or be demoted.
  assert.equal(
    (await call(owner, "DELETE", `/teams/${teamId}/members/${owner.id}`))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await call(owner, "PUT", `/teams/${teamId}/members/${owner.id}`, {
        role: "member",
      })
    ).statusCode,
    409,
  );

  // Every member gets an in-app reminder for a due team item.
  await enqueue();
  const recipients = (
    await pool.query(
      "SELECT user_id FROM notifications WHERE item_id=$1 AND channel='inapp'",
      [shared.id],
    )
  ).rows.map((r) => r.user_id);
  assert.deepEqual(
    new Set(recipients),
    new Set([owner.id, member.id, viewer.id]),
  );

  // Removing someone revokes access immediately.
  const previousNotice = (await call(viewer, "GET", "/notifications"))
    .json()
    .find((n: { title: string }) => n.title === "Coming up: Ship launch");
  assert.ok(previousNotice, "team reminder should be visible before removal");
  assert.equal(
    (await call(owner, "DELETE", `/teams/${teamId}/members/${viewer.id}`))
      .statusCode,
    204,
  );
  assert.equal((await call(viewer, "GET", `/teams/${teamId}`)).statusCode, 404);
  assert.ok(
    !(await call(viewer, "GET", "/items"))
      .json()
      .some((i: { id: string }) => i.id === shared.id),
  );
  assert.ok(
    !(await call(viewer, "GET", "/notifications"))
      .json()
      .some((n: { id: string }) => n.id === previousNotice.id),
    "old reminders must not disclose items after membership is revoked",
  );
  assert.equal(
    (await call(viewer, "POST", `/notifications/${previousNotice.id}/read`))
      .statusCode,
    404,
  );
});

test("admins manage teams but cannot read team or personal items", async () => {
  const personal = (
    await call(owner, "POST", "/items", task("Private"))
  ).json();
  const detail = await call(admin, "GET", `/teams/${teamId}`);
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().role, null);
  assert.ok(detail.json().members.length >= 2);
  assert.equal(
    (await call(admin, "GET", `/items?team_id=${teamId}`)).statusCode,
    404,
  );
  assert.ok(
    !(await call(admin, "GET", "/items"))
      .json()
      .some((i: { id: string }) => i.id === personal.id),
  );
  assert.equal(
    (await call(admin, "PUT", `/teams/${teamId}`, { name: "Launch crew 2" }))
      .statusCode,
    200,
  );
  const teams = (await call(admin, "GET", "/admin/teams")).json();
  assert.ok(
    teams.some(
      (t: { id: string; name: string }) =>
        t.id === teamId && t.name === "Launch crew 2",
    ),
  );
});

test("admins change roles, disable accounts, and keep one admin", async () => {
  const promoted = await call(admin, "PUT", `/admin/users/${outsider.id}`, {
    role: "admin",
  });
  assert.equal(promoted.statusCode, 200);
  assert.equal(promoted.json().role, "admin");
  assert.equal(
    (await call(outsider, "GET", "/admin/overview")).statusCode,
    200,
  );
  assert.equal(
    (
      await call(admin, "PUT", `/admin/users/${outsider.id}`, {
        role: "member",
      })
    ).statusCode,
    200,
  );

  // Disabling revokes sessions and blocks login.
  assert.equal(
    (await call(admin, "PUT", `/admin/users/${viewer.id}`, { disabled: true }))
      .statusCode,
    200,
  );
  assert.equal((await call(viewer, "GET", "/me")).statusCode, 401);
  const login = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: viewer.email, password: "a-long-test-password" },
  });
  assert.equal(login.statusCode, 403);

  // The last active admin cannot be demoted, disabled, or delete themselves.
  const others = (
    await pool.query(
      "SELECT id FROM users WHERE role='admin' AND NOT disabled AND id<>$1",
      [admin.id],
    )
  ).rows;
  if (others.length === 0) {
    assert.equal(
      (await call(admin, "PUT", `/admin/users/${admin.id}`, { role: "member" }))
        .statusCode,
      409,
    );
    assert.equal(
      (await call(admin, "PUT", `/admin/users/${admin.id}`, { disabled: true }))
        .statusCode,
      409,
    );
  }
  assert.equal(
    (await call(admin, "DELETE", `/admin/users/${admin.id}`)).statusCode,
    409,
  );

  const users = (
    await call(
      admin,
      "GET",
      `/admin/users?search=${encodeURIComponent(viewer.email)}`,
    )
  ).json();
  assert.equal(users.total, 1);
  assert.equal(users.rows[0].disabled, true);

  const log = (await call(admin, "GET", "/admin/audit?limit=200")).json();
  const actions = log.rows.map((e: { action: string }) => e.action);
  for (const action of [
    "user.role_changed",
    "user.disabled",
    "team.created",
    "team.member_added",
  ])
    assert.ok(actions.includes(action), action);
});

test("deleting a sole team owner hands the team to the next member", async () => {
  assert.equal(
    (await call(admin, "DELETE", `/admin/users/${owner.id}`)).statusCode,
    204,
  );
  const heir = (
    await pool.query(
      "SELECT user_id, role FROM team_members WHERE team_id=$1",
      [teamId],
    )
  ).rows;
  assert.deepEqual(heir, [{ user_id: member.id, role: "owner" }]);
  const items = (
    await pool.query("SELECT user_id FROM items WHERE team_id=$1", [teamId])
  ).rows;
  assert.ok(items.length > 0 && items.every((i) => i.user_id === member.id));

  // The deleted owner's earlier actions stay attributed to their email, not "System".
  const log = (await call(admin, "GET", "/admin/audit?limit=500")).json();
  const created = log.rows.find(
    (e: { action: string; target_id: string }) =>
      e.action === "team.created" && e.target_id === teamId,
  );
  assert.equal(created?.actor_id, null);
  assert.equal(created?.actor_email, owner.email);
});

test("the shared client sends bodyless requests the API accepts", async () => {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as { port: number };
  const signedIn = await register("client");
  const client = new OrbynClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    getToken: () => signedIn.token,
  });
  const team = await client.createTeam({ name: "Client team" });
  await client.deleteTeam(team.id);
  await client.logout();
  assert.equal((await call(signedIn, "GET", "/me")).statusCode, 401);
});
