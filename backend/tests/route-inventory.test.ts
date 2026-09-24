import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * The route inventory ratchet: every route the app registers is classified.
 * Routes are collected with an onRoute hook over buildApp(), then probed
 * without credentials: a 401 means signed-in. Every signed-in route must be
 * covered by a capability, excluded with a reason, or pending, and PENDING
 * may only shrink (MAX_PENDING below). Routes that answer without signing
 * in must be listed as PUBLIC, so a new public route is looked at first.
 * Service-internal routes are recognised by prefix.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { COVERED, EXCLUDED, EXCLUSION_REASONS, PENDING, PUBLIC } =
  await import("../src/capabilities/exclusions.js");
const { registry } = await import("../src/capabilities/index.js");

/**
 * The most routes that may wait for a capability. Lower it when a phase
 * covers routes; never raise it (a new signed-in route is covered or
 * excluded with a reason instead).
 */
const MAX_PENDING = 151;

/** Routes between services, never for people or agents. */
const INTERNAL = /^\/internal\//;

const routes: { method: string; url: string }[] = [];
const collect: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook("onRoute", (r) => {
    for (const method of [r.method].flat())
      if (method !== "HEAD" && method !== "OPTIONS")
        routes.push({ method, url: r.url });
  });
};
// Registered on the root (like fastify-plugin), so it sees every route.
(collect as unknown as Record<symbol, boolean>)[Symbol.for("skip-override")] =
  true;

const app = await buildApp([collect]);
const classes = new Map<string, "public" | "signed-in" | "internal">();
/** The address each route was probed at. */
const probes = new Map<string, string>();
/** A fresh address for each probe, so per-address limits never answer. */
let n = 0;
const nextAddress = () => `10.77.${Math.floor(n / 250) % 250}.${n++ % 250}`;

before(async () => {
  await app.ready();
  for (const r of routes) {
    const key = `${r.method} ${r.url}`;
    if (INTERNAL.test(r.url)) {
      classes.set(key, "internal");
      continue;
    }
    const url = r.url
      .replace(/:[A-Za-z_]+/g, "00000000-0000-0000-0000-000000000000")
      .replace(/\*/g, "x");
    probes.set(key, url);
    const res = await app.inject({
      method: r.method as "GET",
      url,
      remoteAddress: nextAddress(),
      ...(["POST", "PUT", "PATCH", "DELETE"].includes(r.method)
        ? { payload: {} }
        : {}),
    });
    classes.set(key, res.statusCode === 401 ? "signed-in" : "public");
  }
});
after(async () => {
  await app.close();
  await pool.end();
});

test("every signed-in route is covered, excluded with a reason, or pending", () => {
  const unplaced: string[] = [];
  for (const [key, cls] of classes) {
    if (cls !== "signed-in") continue;
    const places = [
      key in COVERED,
      key in EXCLUDED,
      PENDING.includes(key),
    ].filter(Boolean);
    if (places.length !== 1)
      unplaced.push(
        `${key} (${places.length ? "in more than one list" : "not listed"})`,
      );
  }
  assert.deepEqual(
    unplaced,
    [],
    "Place each route in backend/src/capabilities/exclusions.ts: COVERED by a capability, EXCLUDED with a reason, or (only if it waits for a later phase) PENDING.",
  );
});

test("the lists name only routes that exist and capabilities that exist", () => {
  const signedIn = new Set(
    [...classes].filter(([, c]) => c === "signed-in").map(([k]) => k),
  );
  const stale = [
    ...Object.keys(COVERED),
    ...Object.keys(EXCLUDED),
    ...PENDING,
  ].filter((k) => !signedIn.has(k));
  assert.deepEqual(
    stale,
    [],
    "These are listed but aren't signed-in routes (any more).",
  );
  for (const [route, caps] of Object.entries(COVERED))
    for (const cap of caps)
      assert.ok(registry.get(cap), `${route}: no capability ${cap}`);
  for (const [route, reason] of Object.entries(EXCLUDED))
    assert.ok(
      reason in EXCLUSION_REASONS,
      `${route}: unknown reason ${reason}`,
    );
});

test("PENDING only shrinks", () => {
  assert.ok(
    PENDING.length <= MAX_PENDING,
    `PENDING has ${PENDING.length} routes, more than ${MAX_PENDING}. Cover or exclude the new route instead.`,
  );
  assert.equal(
    new Set(PENDING).size,
    PENDING.length,
    "PENDING has a route twice.",
  );
});

test("routes that answer without signing in are the listed public ones", () => {
  const open = [...classes]
    .filter(([, c]) => c === "public")
    .map(([k]) => k)
    .sort();
  assert.deepEqual(
    open,
    [...PUBLIC].sort(),
    "A route answers without signing in: list it in PUBLIC after checking it should.",
  );
});

test("agents are refused on the routes the safety list names", () => {
  for (const key of [
    "POST /me/api-keys",
    "GET /me/webhooks",
    "POST /me/sessions/revoke-others",
    "POST /me/2fa/enable",
    "DELETE /me",
    "POST /ai/proposals/:id/apply",
    "POST /me/agent-keys",
    "POST /me/calendar-subscriptions",
    "GET /admin/users",
  ])
    assert.ok(key in EXCLUDED, key);
});

test("audience isolation: every signed-in route refuses agent credentials", async () => {
  // A credential is refused by its prefix before anything is looked up, so a
  // fresh one per call exercises the same path as a real key (and keeps each
  // call under its own rate limit).
  const fresh = (prefix: string) =>
    `${prefix}${randomBytes(32).toString("base64url")}`;
  const accepted: string[] = [];
  for (const [key, cls] of classes) {
    if (cls !== "signed-in") continue;
    const [method, route] = key.split(" ");
    for (const prefix of ["oak_", "oat_", "ort_"]) {
      const res = await app.inject({
        method: method as "GET",
        url: probes.get(key)!,
        remoteAddress: nextAddress(),
        headers: { authorization: `Bearer ${fresh(prefix)}` },
        ...(["POST", "PUT", "PATCH", "DELETE"].includes(method)
          ? { payload: {} }
          : {}),
      });
      if (res.statusCode !== 401)
        accepted.push(`${prefix} ${method} ${route}: ${res.statusCode}`);
    }
  }
  assert.deepEqual(accepted, [], "Agent credentials reached these routes.");
  // And the MCP address is the one place that takes them.
  const mcp = await app.inject({
    method: "POST",
    url: "/mcp",
    remoteAddress: nextAddress(),
    headers: {
      authorization: `Bearer ${fresh("oak_")}`,
      "content-type": "application/json",
    },
    payload: { jsonrpc: "2.0", id: 1, method: "ping" },
  });
  assert.equal(mcp.statusCode, 401);
  assert.match(String(mcp.headers["www-authenticate"]), /invalid_token/);
});
