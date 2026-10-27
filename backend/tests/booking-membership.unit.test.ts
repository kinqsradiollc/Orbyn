import { test } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../src/db/pool.js";
import type { UserRow } from "../src/lib/auth.js";
import type { PageRow } from "../src/modules/booking/availability.js";

// These tests supply every query. No database connection may be opened.
process.env.DATABASE_URL =
  "postgres://fixture:fixture@127.0.0.1:1/booking_membership_test";
process.env.DATABASE_READ_URL = "";
const { canEdit, canHost } = await import("../src/modules/booking/manage.js");
const { retainTeamHosts } = await import("../src/modules/booking/pages.js");
const { pool } = await import("../src/db/pool.js");

const user = { id: "former-host" } as UserRow;
const page = {
  id: "page",
  owner_id: "owner",
  team_id: "team",
  hosts: [{ user_id: user.id, name: "Former host", required: true }],
} as PageRow;
function dbWith(rows: unknown[], inspect?: (sql: string) => void): Queryable {
  return {
    query: async (sql: string) => {
      inspect?.(sql);
      return { rows, rowCount: rows.length };
    },
  } as unknown as Queryable;
}

test("team booking authority rejects removed hosts and owners even with a stale page snapshot", async (t) => {
  t.mock.method(pool, "connect", () => {
    throw new Error("No real database");
  });
  const missing = dbWith([]);
  assert.equal(await canHost(missing, page, user), false);
  assert.equal(
    await canEdit(missing, { ...page, owner_id: user.id }, user),
    false,
  );
  assert.equal(
    await canHost(missing, { ...page, owner_id: user.id }, user),
    false,
  );
  // Rejoining as a member does not restore an assignment removed in between.
  assert.equal(
    await canHost(dbWith([{ role: "member", host: false }]), page, user),
    false,
  );
  assert.equal(
    await canHost(dbWith([{ role: "member", host: true }]), page, user),
    true,
  );
  for (const role of ["owner", "admin"]) {
    const manager = dbWith([{ role, host: false }]);
    assert.equal(await canEdit(manager, page, user), true);
    assert.equal(await canHost(manager, page, user), true);
  }
  assert.equal(
    await canEdit(dbWith([{ role: "member", host: true }]), page, user),
    false,
  );
});

test("personal booking pages preserve owner and cohost authority without team queries", async () => {
  const noQueries = dbWith([], () => {
    throw new Error("Personal authority needs no team query");
  });
  const personal = { ...page, team_id: null };
  assert.equal(await canHost(noQueries, personal, user), true);
  assert.equal(await canEdit(noQueries, personal, user), false);
  assert.equal(
    await canEdit(noQueries, { ...personal, owner_id: user.id }, user),
    true,
  );
});

test("host refresh discards a stale assignment and read-only checks do not request locks", async () => {
  const snapshot = structuredClone(page);
  await retainTeamHosts(
    dbWith([], (sql) => assert.ok(!sql.includes("FOR SHARE"))),
    snapshot,
  );
  assert.deepEqual(snapshot.hosts, []);
  let locks = 0;
  await retainTeamHosts(
    dbWith([{ user_id: user.id }], (sql) => {
      assert.ok(sql.includes("FOR SHARE"));
      locks++;
    }),
    structuredClone(page),
    true,
  );
  assert.equal(locks, 1);
  await canHost(
    dbWith([{ role: "member", host: true }], (sql) =>
      assert.ok(!sql.includes("FOR SHARE")),
    ),
    page,
    user,
  );
  await canHost(
    dbWith([{ role: "member", host: true }], (sql) =>
      assert.ok(sql.includes("FOR SHARE")),
    ),
    page,
    user,
    true,
  );
});
