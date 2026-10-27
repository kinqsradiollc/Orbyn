import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { Principal } from "../src/capabilities/policy.js";
import type { Capability } from "../src/capabilities/registry.js";

// Distinct unreachable pools; every connection below is replaced by a fixture.
process.env.DATABASE_URL =
  "postgres://fixture:fixture@127.0.0.1:1/booking_primary_test";
process.env.DATABASE_READ_URL =
  "postgres://fixture:fixture@127.0.0.1:2/booking_replica_test";
process.env.SECRETS_KEY = Buffer.alloc(32, 9).toString("base64");
const { pool, readPool } = await import("../src/db/pool.js");
const { Registry } = await import("../src/capabilities/registry.js");
const { execute } = await import("../src/capabilities/execute.js");
const { getBookings } = await import("../src/capabilities/booking.js");

const principal: Principal = {
  user: { id: "fixture-user", name: "Fixture", role: "member" },
  via: "agent_key",
  grant_id: "fixture-grant",
  client: { id: null, name: "Fixture" },
  access: "read",
  team_ids: null,
  personal: true,
  toolsets: ["booking"],
  flags: {
    notify_teammates: false,
    hide_outside_content: false,
    readonly: false,
  },
  trust: { level: "full", spaces: {}, acts_alone: [] },
  teams: [],
};

test("get_bookings selects the primary and retains the read-only transaction boundary", async (t) => {
  assert.notEqual(pool, readPool);
  assert.equal(getBookings.readConsistency, "primary");
  const statements: string[] = [];
  const client = (which: string) => ({
    query: async (sql: string) => {
      statements.push(`${which}: ${sql}`);
      if (sql === "SELECT fixture_pool") return { rows: [{ selected: which }] };
      if (sql.startsWith("SELECT * FROM planner_prefs")) return { rows: [] };
      if (
        ["BEGIN READ ONLY", "COMMIT", "ROLLBACK"].includes(sql) ||
        sql.startsWith("SET LOCAL statement_timeout")
      )
        return { rows: [] };
      throw new Error(`Unexpected fixture query: ${sql}`);
    },
    release() {},
  });
  t.mock.method(pool, "connect", async () => client("primary"));
  t.mock.method(readPool, "connect", async () => client("replica"));
  for (const db of [pool, readPool])
    t.mock.method(db, "query", async () => {
      throw new Error("Capability queries must use the transaction client");
    });
  const booking: Capability = {
    ...getBookings,
    input: z.object({}),
    output: z.object({ selected: z.string() }),
    async run(ctx) {
      const selected = (await ctx.db.query("SELECT fixture_pool")).rows[0];
      return { structured: selected, markdown: "Fixture" };
    },
  };
  const ordinary = {
    ...booking,
    name: "fixture_replica",
    readConsistency: undefined,
  };
  const registry = new Registry([booking, ordinary]);
  for (const [name, which] of [
    [booking.name, "primary"],
    [ordinary.name, "replica"],
  ]) {
    statements.length = 0;
    const result = await execute(registry, principal, name, {});
    assert.ok(!result.result.isError, JSON.stringify(result.result));
    assert.deepEqual(result.result.structuredContent, { selected: which });
    assert.equal(statements[0], `${which}: BEGIN READ ONLY`);
    assert.equal(statements.at(-1), `${which}: COMMIT`);
    assert.ok(statements.every((sql) => sql.startsWith(`${which}: `)));
  }
});
