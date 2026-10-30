import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as uptime from "../src/modules/status/uptime.js";

function fixture() {
  let now = Date.parse("2026-10-31T00:00:00Z");
  const RealDate = Date;
  class Clock extends RealDate {
    constructor(value?: string | number) {
      super(value ?? now);
    }
    static now() {
      return now;
    }
  }
  let release!: () => void;
  const gate = new Promise<void>((yes) => {
    release = yes;
  });
  const calls: string[] = [];
  let fail = false;
  const failure = new Error("history unavailable");
  const db = {
    async query(sql: string) {
      const kind = sql.includes("AS quarter")
        ? "windows"
        : sql.includes("AS uptime")
          ? "daily"
          : sql.includes("AS resolved_at")
            ? "incidents"
            : sql === "clock"
              ? "clock"
              : "recent";
      calls.push(kind);
      await gate;
      if (fail && kind === "daily") throw failure;
      return {
        rows:
          kind === "windows"
            ? [{ service: "api", day: "1", week: "0.9", quarter: "0.8" }]
            : kind === "daily"
              ? [{ service: "api", day: "2026-10-30", uptime: "0.75" }]
              : kind === "recent"
                ? [
                    {
                      service: "api",
                      ok: true,
                      latency_ms: 12,
                      checked_at: new RealDate("2026-10-30T23:59:00Z"),
                    },
                  ]
                : [],
      };
    },
  };
  const dependencies: Record<string, unknown> = {
    "../../db/pool.js": { readPool: db },
    "../../lib/clock.js": {
      serverClock: async () => {
        await db.query("clock");
        return null;
      },
    },
    "../../lib/settings.js": {
      settings: async () => ({ maintenance: { enabled: false } }),
    },
    "./components.js": { components: () => [{ id: "api", name: "Planner" }] },
    "./uptime.js": {
      ...uptime,
      lastDays: (days: number) => uptime.lastDays(days, new RealDate(now)),
    },
  };
  const module = { exports: {} as any };
  runInNewContext(
    transformSync(
      readFileSync(
        new URL("../src/modules/status/report.ts", import.meta.url),
        "utf8",
      ),
      { loader: "ts", format: "cjs" },
    ).code,
    {
      module,
      exports: module.exports,
      Date: Clock,
      require: (id: string) => {
        assert.ok(id in dependencies, `Unexpected status dependency: ${id}`);
        return dependencies[id];
      },
    },
  );
  return {
    api: module.exports,
    calls,
    release,
    failure,
    fail(value: boolean) {
      fail = value;
    },
    advance(ms: number) {
      now += ms;
    },
  };
}
const tick = () => new Promise<void>((yes) => setImmediate(yes));

test("public cold status callers share one full report, with warm cache and expiry preserved", async () => {
  const f = fixture();
  const pending = [
    f.api.statusReport(),
    f.api.statusReport(),
    f.api.statusReport(),
  ];
  await tick();
  assert.deepEqual([...f.calls].sort(), [
    "daily",
    "incidents",
    "recent",
    "windows",
  ]);
  f.release();
  const reports = await Promise.all(pending);
  assert.deepEqual(reports[0], reports[1]);
  assert.deepEqual(reports[0], reports[2]);
  assert.equal(
    f.calls.length,
    5,
    "one clock read follows one set of four history reads",
  );
  assert.equal(reports[0].components[0].history.length, 90);
  assert.equal(reports[0].components[0].history[89].date, "2026-10-31");
  assert.equal(reports[0].components[0].history[88].uptime, 0.75);
  assert.equal(reports[0].components[0].uptime.quarter, 0.8);
  assert.deepEqual(await f.api.statusReport(), reports[0]);
  assert.equal(f.calls.length, 5);
  f.advance(15_001);
  const next = await f.api.statusReport();
  assert.equal(f.calls.length, 10);
  assert.notEqual(next.updated_at, reports[0].updated_at);
});

test("shared report failure rejects every waiter and a subsequent request retries cleanly", async () => {
  const f = fixture();
  f.fail(true);
  const pending = [
    f.api.statusReport(),
    f.api.statusReport(),
    f.api.statusReport(),
  ];
  f.release();
  const failed = await Promise.allSettled(pending);
  assert.ok(
    failed.every(
      (result) => result.status === "rejected" && result.reason === f.failure,
    ),
  );
  assert.equal(f.calls.length, 4);
  f.fail(false);
  const recovered = await Promise.all([
    f.api.statusReport(),
    f.api.statusReport(),
  ]);
  assert.deepEqual(recovered[0], recovered[1]);
  assert.equal(
    f.calls.length,
    9,
    "failure is not cached and the retry still coalesces",
  );
  await f.api.statusReport();
  assert.equal(f.calls.length, 9);
});
