import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const {
  buildApiService,
  buildAiService,
  buildStatusService,
  buildRealtimeService,
} = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { clearStatusCache } = await import("../src/modules/status/report.js");
const { lastDays, overallState, stateFromRecent } =
  await import("../src/modules/status/uptime.js");

let api: FastifyInstance;
let ai: FastifyInstance;
let status: FastifyInstance;
let realtime: FastifyInstance;

before(async () => {
  await migrate();
  [api, ai, status, realtime] = await Promise.all([
    buildApiService(),
    buildAiService(),
    buildStatusService(),
    buildRealtimeService(),
  ]);
  await pool.query("DELETE FROM status_checks");
});

after(async () => {
  await pool.query("DELETE FROM status_checks");
  await Promise.all([
    api.close(),
    ai.close(),
    status.close(),
    realtime.close(),
  ]);
  await pool.end();
});

test("each service exposes only the routes it owns", async () => {
  for (const [app, name] of [
    [api, "api"],
    [ai, "ai"],
    [status, "status"],
    [realtime, "realtime"],
  ] as const) {
    const health = await app.inject({ url: "/health" });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().service, name);
  }
  // Owned routes answer (401 = exists but needs sign-in); others are 404.
  assert.equal((await api.inject({ url: "/items" })).statusCode, 401);
  assert.equal((await ai.inject({ url: "/items" })).statusCode, 404);
  assert.equal((await status.inject({ url: "/items" })).statusCode, 404);
  const chat = {
    method: "POST" as const,
    url: "/ai/chat",
    payload: { message: "hi" },
  };
  assert.equal((await ai.inject(chat)).statusCode, 401);
  assert.equal((await api.inject(chat)).statusCode, 404);
  assert.equal((await status.inject({ url: "/status" })).statusCode, 200);
  assert.equal((await api.inject({ url: "/status" })).statusCode, 404);
  // Long-lived streams live on the realtime service, and nothing else does.
  assert.equal((await realtime.inject({ url: "/events" })).statusCode, 401);
  assert.equal((await api.inject({ url: "/events" })).statusCode, 404);
  assert.equal((await realtime.inject({ url: "/items" })).statusCode, 404);
});

test("the status report computes state, uptime, history, and incidents", async () => {
  const now = Date.now();
  const minute = 60_000;
  // Planner: two failures in a row, then recovered. AI: failing right now.
  const plannerChecks = [
    true,
    true,
    true,
    false,
    false,
    true,
    true,
    true,
    true,
    true,
  ];
  const aiChecks = [true, false, false];
  const rows = [
    ...plannerChecks.map((ok, i) => [
      "api",
      ok,
      12,
      new Date(now - (plannerChecks.length - i) * minute),
    ]),
    ...aiChecks.map((ok, i) => [
      "ai",
      ok,
      null,
      new Date(now - (aiChecks.length - i) * minute),
    ]),
  ];
  for (const row of rows)
    await pool.query(
      "INSERT INTO status_checks(service,ok,latency_ms,checked_at) VALUES($1,$2,$3,$4)",
      row,
    );
  clearStatusCache();

  const response = await status.inject({ url: "/status" });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["cache-control"] as string, /max-age=15/);
  const report = response.json();
  const planner = report.components.find((c: { id: string }) => c.id === "api");
  const assistant = report.components.find(
    (c: { id: string }) => c.id === "ai",
  );
  const reminders = report.components.find(
    (c: { id: string }) => c.id === "notifier",
  );

  assert.equal(planner.state, "operational");
  assert.equal(planner.uptime.day, 0.8);
  assert.equal(planner.latency_ms, 12);
  assert.equal(planner.history.length, 90);
  assert.ok(
    planner.history.some((d: { uptime: number | null }) => d.uptime !== null),
  );
  assert.equal(assistant.state, "outage");
  assert.equal(reminders.state, "unknown");
  assert.equal(report.state, "outage");

  const plannerIncident = report.incidents.find(
    (i: { component: string }) => i.component === "api",
  );
  const aiIncident = report.incidents.find(
    (i: { component: string }) => i.component === "ai",
  );
  assert.ok(plannerIncident?.resolved_at, "the planner incident recovered");
  assert.equal(aiIncident?.resolved_at, null, "the AI incident is ongoing");
  assert.equal(plannerIncident.name, "Planner");
});

test("state and date helpers", () => {
  assert.equal(stateFromRecent([]), "unknown");
  assert.equal(stateFromRecent([true, false]), "operational");
  assert.equal(stateFromRecent([false]), "degraded");
  assert.equal(stateFromRecent([false, true]), "degraded");
  assert.equal(stateFromRecent([false, false]), "outage");
  assert.equal(overallState(["operational", "unknown"]), "operational");
  assert.equal(overallState(["operational", "degraded"]), "degraded");
  assert.equal(overallState(["unknown"]), "unknown");
  assert.deepEqual(lastDays(3, new Date("2026-03-01T05:00:00Z")), [
    "2026-02-27",
    "2026-02-28",
    "2026-03-01",
  ]);
});

test("a dropped idle database connection is logged, not fatal", async () => {
  const { pool } = await import("../src/db/pool.js");
  assert.ok(pool.listenerCount("error") >= 1, "the pool has an error listener");
  // Emitting the event pg raises for a dropped idle client must not throw.
  const quiet = console.error;
  console.error = () => {};
  try {
    pool.emit("error", new Error("server closed the connection"));
  } finally {
    console.error = quiet;
  }
});
