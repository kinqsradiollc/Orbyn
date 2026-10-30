import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fixtureId,
  seedOptions,
  seedTarget,
  assertSeedDatabase,
  assertAccountOwnership,
  DEMO_ACCOUNTS,
} from "./seed-ui-demo-support.mjs";
test("dry run and explicit input options are bounded", () => {
  assert.equal(seedOptions([], "/repo").apply, false);
  assert.equal(
    seedOptions(
      ["--apply", "--db-host=127.0.0.1", "--env-file", "local.env"],
      "/repo",
    ).envFile,
    "/repo/local.env",
  );
  assert.throws(() => seedOptions(["--repair"], "/repo"));
  assert.throws(() =>
    seedOptions(["--db-port=5433", "--db-port=5432"], "/repo"),
  );
});
test("target requires loopback and development name, independent of apply", () => {
  const options = seedOptions([], "/repo");
  assert.throws(() =>
    seedTarget("postgres://u:p@postgres/orbyn_workspace_local", options),
  );
  assert.equal(
    seedTarget("postgres://u:p@postgres/orbyn_workspace_local", {
      ...options,
      host: "127.0.0.1",
      port: "5433",
    }).display,
    "127.0.0.1:5433/orbyn_workspace_local",
  );
  for (const url of [
    "postgres://u:p@127.0.0.1/production",
    "postgres://u:p@127.0.0.1/orbyn?options=-corbyn.ui_fixture=development-demo",
    "https://127.0.0.1/orbyn",
  ])
    assert.throws(() => seedTarget(url, options));
});
test("only a matching persisted development marker qualifies", () => {
  assertSeedDatabase(
    { database: "orbyn_test", marker: "development-demo", environment: "test" },
    "orbyn_test",
  );
  for (const row of [
    { database: "orbyn_test", marker: null },
    {
      database: "orbyn_test",
      marker: "development-demo",
      environment: "production",
    },
    { database: "wrong", marker: "development-demo" },
  ])
    assert.throws(() => assertSeedDatabase(row, "orbyn_test"));
});
test("deterministic IDs never authorize email collisions or role promotion", () => {
  assert.equal(fixtureId("a"), fixtureId("a"));
  assert.notEqual(fixtureId("a"), fixtureId("b"));
  const a = DEMO_ACCOUNTS[0];
  assertAccountOwnership(DEMO_ACCOUNTS, []);
  assertAccountOwnership([a], [a]);
  assert.throws(() =>
    assertAccountOwnership([a], [{ ...a, id: fixtureId("foreign") }]),
  );
  assert.throws(() =>
    assertAccountOwnership([a], [{ ...a, email: "foreign@example.com" }]),
  );
  assert.throws(() => assertAccountOwnership([a], [{ ...a, role: "member" }]));
});
