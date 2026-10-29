import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";

process.env.DATABASE_URL =
  "postgres://fixture:fixture@127.0.0.1:1/idempotency_test";
process.env.DATABASE_READ_URL = "";
const { pool } = await import("../src/db/pool.js");
const { idempotency, rememberIdempotencyScope } =
  await import("../src/lib/idempotency.js");
const { KEY_BLOCKED_MESSAGE } = await import("../src/lib/auth.js");

type Receipt = {
  method: string;
  path: string;
  request_hash: string | null;
  original_scope?: unknown;
  status: number | null;
  body: string | null;
  fresh: boolean;
};
function fixture(t: TestContext) {
  const userId = randomUUID(),
    id = randomUUID(),
    teamId = randomUUID(),
    projectId = randomUUID();
  const receipts = new Map<string, Receipt>();
  let systemRole: "member" | "admin" = "member";
  let live = true,
    disabled = false,
    verified = true,
    membership: string | null = "member";
  let current = { user_id: userId, team_id: null as string | null };
  let linkExists = true;
  let writes = 0,
    authChecks = 0,
    receiptQueries = 0;
  t.mock.method(pool, "connect", async () => {
    throw new Error("No real database connections");
  });
  t.mock.method(pool, "query", async (sql: string, values: unknown[] = []) => {
    if (sql.includes("JOIN sessions") || sql.includes("JOIN api_keys")) {
      authChecks++;
      return {
        rows: live
          ? [
              {
                id: userId,
                role: systemRole,
                email_verified: verified,
                disabled,
              },
            ]
          : [],
      };
    }
    if (sql.startsWith("UPDATE sessions") || sql.startsWith("UPDATE api_keys"))
      return { rows: [] };
    if (sql.includes("idempotency_keys")) {
      receiptQueries++;
      const key = `${values[0]}:${values[1]}`;
      if (sql.includes("INSERT INTO")) {
        if (receipts.has(key)) return { rowCount: 0, rows: [] };
        receipts.set(key, {
          method: values[2] as string,
          path: values[3] as string,
          request_hash: values[4] as string,
          original_scope: values[5] ? JSON.parse(values[5] as string) : null,
          status: null,
          body: null,
          fresh: true,
        });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("SELECT method"))
        return { rows: receipts.has(key) ? [{ ...receipts.get(key)! }] : [] };
      const row = receipts.get(key);
      if (sql.startsWith("DELETE")) {
        const removed = row?.status === null;
        if (removed) receipts.delete(key);
        return { rows: [], rowCount: removed ? 1 : 0 };
      }
      if (sql.includes("SET original_scope") && row?.status === null) {
        row.original_scope = JSON.parse(values[2] as string);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE") && row?.status === null) {
        row.status = values[2] as number;
        row.body = values[3] as string | null;
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (sql === "SELECT project_id FROM project_links WHERE id=$1")
      return { rows: linkExists ? [{ project_id: projectId }] : [] };
    if (sql.includes("WHERE d.id = ANY")) return { rows: [] };
    if (sql.startsWith("SELECT user_id")) return { rows: [{ ...current }] };
    if (sql === "SELECT name FROM teams WHERE id=$1")
      return { rows: [{ name: "Fixture team" }] };
    if (sql.startsWith("SELECT role FROM team_members"))
      return { rows: membership ? [{ role: membership }] : [] };
    throw new Error(`Unexpected database query: ${sql}`);
  });
  const app = Fastify();
  idempotency(app);
  for (const path of ["/items", "/docs", "/projects", "/planner/habits"])
    app.post(path, async (_, reply) => {
      writes++;
      reply.code(201);
      return { id, ...current, title: "Private fixture" };
    });
  app.post("/capture", async (_, reply) => {
    writes++;
    reply.code(201);
    return { to: "page", doc: { id, title: "Old page words" } };
  });
  app.put("/bookings/:id/note", async (request) => {
    await rememberIdempotencyScope(request, pool as never, {
      user_id: userId,
      team_id: teamId,
      permission: "items:read",
    });
    writes++;
    return { id, page_id: projectId, invite_id: null };
  });
  app.post("/projects/:id/links", async (_, reply) => {
    writes++;
    reply.code(201);
    return {
      id,
      project_id: projectId,
      url: "https://example.test/fixture",
      title: "Fixture link",
    };
  });
  app.put("/docs/:id/content", async (request) => {
    // The production route records this under its mutation transaction lock.
    await rememberIdempotencyScope(request, pool as never, { ...current });
    writes++;
    return { id, version: 2, document: { format: 2, nodes: [] } };
  });
  for (const path of [
    "/me/api-keys",
    "/me/2fa/setup",
    "/me/2fa/enable",
    "/me/webhooks",
    "/me/clip-keys",
    "/me/calendar-feed",
    "/me/agent-keys",
    "/auth/register",
    "/unknown",
    "/teams/:id/members",
  ])
    app.post(path, async () => {
      writes++;
      return { secret: "synthetic-credential-must-never-be-issued" };
    });
  app.delete("/items/:id", async (_, reply) => {
    writes++;
    return reply.code(204).send();
  });
  const send = (
    url = "/items",
    body: unknown = { title: "Private fixture" },
    key = "fixture-key",
    token: string | null = "fixture-session",
    method: "POST" | "PUT" | "DELETE" = "POST",
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url,
      payload: body as object,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "idempotency-key": key,
        ...headers,
      },
    });
  return {
    app,
    send,
    receipts,
    id,
    teamId,
    projectId,
    userId,
    deleteLink() {
      linkExists = false;
    },
    get writes() {
      return writes;
    },
    get authChecks() {
      return authChecks;
    },
    get receiptQueries() {
      return receiptQueries;
    },
    admin() {
      systemRole = "admin";
    },
    revoke() {
      live = false;
    },
    disable() {
      disabled = true;
    },
    unverify() {
      verified = false;
    },
    move(team: string | null) {
      current.team_id = team;
    },
    membership(role: string | null) {
      membership = role;
    },
  };
}

test("live authorized item/habit/doc/project receipts return the exact result once", async (t) => {
  const f = fixture(t);
  try {
    for (const url of ["/items", "/docs", "/projects", "/planner/habits"]) {
      const first = await f.send(url, {}, `key-${url.replaceAll("/", "_")}`);
      const again = await f.send(url, {}, `key-${url.replaceAll("/", "_")}`);
      assert.equal(first.statusCode, 201, first.body);
      assert.equal(again.statusCode, 201, again.body);
      assert.equal(again.body, first.body);
      assert.equal(again.headers["idempotent-replay"], "true");
    }
    assert.equal(f.writes, 4);
    assert.equal(f.authChecks, 8);
  } finally {
    await f.app.close();
  }
});

for (const change of ["revoke", "disable", "unverify"] as const)
  test(`${change} refuses a cached success before receipt access`, async (t) => {
    const f = fixture(t);
    try {
      assert.equal((await f.send()).statusCode, 201);
      const queries = f.receiptQueries;
      f[change]();
      const replay = await f.send();
      assert.equal(
        replay.statusCode,
        change === "revoke" ? 401 : 403,
        replay.body,
      );
      assert.equal(replay.headers["idempotent-replay"], undefined);
      assert.equal(f.receiptQueries, queries);
      assert.equal(f.writes, 1);
    } finally {
      await f.app.close();
    }
  });

test("item and structured-doc replay rechecks current scope after moves and team removal", async (t) => {
  const f = fixture(t);
  try {
    assert.equal((await f.send()).statusCode, 201);
    f.move(f.teamId);
    f.membership(null);
    assert.equal((await f.send()).statusCode, 404);
    f.membership("viewer");
    assert.equal((await f.send()).statusCode, 403);
    f.membership("member");
    assert.equal((await f.send()).statusCode, 201);
    const url = `/docs/${f.id}/content`;
    const body = { version: 1, document: { format: 2, nodes: [] } };
    assert.equal(
      (await f.send(url, body, "doc-fixture-key", "fixture-session", "PUT"))
        .statusCode,
      200,
    );
    assert.equal(
      (await f.send(url, body, "doc-fixture-key", "fixture-session", "PUT"))
        .statusCode,
      200,
    );
    f.membership(null);
    assert.equal(
      (await f.send(url, body, "doc-fixture-key", "fixture-session", "PUT"))
        .statusCode,
      404,
    );
    assert.equal(f.writes, 2);
  } finally {
    await f.app.close();
  }
});

test("legacy, in-flight, expired and unsafe receipts hold without another mutation", async (t) => {
  const f = fixture(t);
  try {
    assert.equal((await f.send()).statusCode, 201);
    const receipt = [...f.receipts.values()][0];
    for (const patch of [
      { request_hash: null },
      { status: null },
      { body: null },
      { status: 500 },
      { fresh: false },
    ]) {
      const original = { ...receipt };
      Object.assign(receipt, patch);
      const replay = await f.send();
      assert.equal(replay.statusCode, 409, replay.body);
      assert.equal(f.writes, 1);
      Object.assign(receipt, original);
    }
  } finally {
    await f.app.close();
  }
});

test("body, query and document capability changes cannot borrow a prior receipt", async (t) => {
  const f = fixture(t);
  try {
    assert.equal((await f.send()).statusCode, 201);
    for (const response of [
      await f.send("/items", { title: "Different" }),
      await f.send("/items?scope=this"),
      await f.send(
        "/items",
        { title: "Private fixture" },
        "fixture-key",
        "fixture-session",
        "POST",
        { "x-orbyn-doc-formats": "1,2" },
      ),
    ]) {
      assert.equal(response.statusCode, 422, response.body);
    }
    assert.equal(f.writes, 1);
  } finally {
    await f.app.close();
  }
});

test("unsupported keyed credential and identity requests issue and store no secret", async (t) => {
  const f = fixture(t);
  try {
    for (const route of [
      "/me/api-keys",
      "/me/2fa/setup",
      "/me/2fa/enable",
      "/me/webhooks",
      "/me/clip-keys",
      "/me/calendar-feed",
      "/me/agent-keys",
      "/auth/register",
      "/unknown",
    ]) {
      assert.equal((await f.send(route)).statusCode, 409);
      assert.equal((await f.send(route)).statusCode, 409);
      assert.equal(
        (await f.send(route, {}, "fixture-key", "invalid-session")).statusCode,
        409,
      );
    }
    assert.equal(
      (await f.send("/auth/register", {}, "fixture-key", null)).statusCode,
      401,
    );
    assert.equal(f.receipts.size, 0);
    assert.equal(f.writes, 0);
  } finally {
    await f.app.close();
  }
});

test("keyed requests still enforce personal-key route restrictions first", async (t) => {
  const f = fixture(t);
  try {
    for (const route of ["/me/api-keys", `/teams/${f.teamId}/members`]) {
      const response = await f.send(
        route,
        {},
        "fixture-key",
        "ok_fixture-only",
      );
      assert.equal(response.statusCode, 403, response.body);
      assert.equal(response.json().message, KEY_BLOCKED_MESSAGE);
    }
    assert.equal(f.receipts.size, 0);
    assert.equal(f.writes, 0);
  } finally {
    await f.app.close();
  }
});

test("exact bodyless DELETE receipts drain offline work without rerunning a deleted object", async (t) => {
  const f = fixture(t);
  try {
    const send = () =>
      f.send(
        `/items/${f.id}?version=1`,
        undefined,
        "delete-fixture-key",
        "fixture-session",
        "DELETE",
      );
    const first = await send();
    assert.equal(first.statusCode, 204, first.body);
    f.move(f.teamId);
    f.membership(null);
    const replay = await send();
    assert.equal(replay.statusCode, 204, replay.body);
    assert.equal(replay.body, "");
    assert.equal(replay.headers["idempotent-replay"], "true");
    assert.equal(f.writes, 1);
    f.revoke();
    assert.equal((await send()).statusCode, 401);
    assert.equal(f.writes, 1);
  } finally {
    await f.app.close();
  }
});

test("cached labels of links that have become private cannot replay", async (t) => {
  const f = fixture(t);
  try {
    assert.equal((await f.send()).statusCode, 201);
    const receipt = [...f.receipts.values()][0];
    const body = JSON.parse(receipt.body!);
    body.title = `[Former private title](orbyn://doc/${randomUUID()})`;
    receipt.body = JSON.stringify(body);
    const response = await f.send();
    assert.equal(response.statusCode, 409, response.body);
    assert.ok(!response.body.includes("Former private title"));
    assert.equal(f.writes, 1);
  } finally {
    await f.app.close();
  }
});

test("project-link receipts replay exactly once and require the current project and link", async (t) => {
  const f = fixture(t);
  try {
    const send = () =>
      f.send(`/projects/${f.projectId}/links`, {
        url: "https://example.test/fixture",
        title: "Fixture link",
      });
    const first = await send();
    assert.equal(first.statusCode, 201, first.body);
    const replay = await send();
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(replay.body, first.body);
    assert.equal(replay.headers["idempotent-replay"], "true");
    f.move(f.teamId);
    f.membership("viewer");
    assert.equal((await send()).statusCode, 403);
    f.membership(null);
    assert.equal((await send()).statusCode, 404);
    f.membership("member");
    assert.equal((await send()).statusCode, 201);
    f.deleteLink();
    assert.equal((await send()).statusCode, 409);
    assert.equal(f.writes, 1);
  } finally {
    await f.app.close();
  }
});

test("receipt refusals expose stable outcomes without marking arbitrary conflicts safe", async (t) => {
  const f = fixture(t);
  try {
    assert.equal(
      (await f.send("/unknown")).headers["idempotency-outcome"],
      "unsupported",
    );
    assert.equal(
      (await f.send("/items", {}, "bad")).headers["idempotency-outcome"],
      "mismatch",
    );
    const first = await f.send();
    assert.equal(first.headers["idempotency-outcome"], undefined);
    assert.equal(
      (await f.send("/items", { title: "changed" })).headers[
        "idempotency-outcome"
      ],
      "mismatch",
    );
    const receipt = [...f.receipts.values()][0];
    receipt.status = null;
    assert.equal((await f.send()).headers["idempotency-outcome"], "in-flight");
    receipt.status = 409;
    assert.equal((await f.send()).headers["idempotency-outcome"], "unsafe");
    receipt.status = 201;
    f.move(f.teamId);
    f.membership(null);
    assert.equal((await f.send()).headers["idempotency-outcome"], "unsafe");
  } finally {
    await f.app.close();
  }
});

test("narrow doc replay requires the transaction's original scope as well as current scope", async (t) => {
  const f = fixture(t);
  try {
    const originalTeam = randomUUID();
    f.move(originalTeam);
    const send = () =>
      f.send(
        `/docs/${f.id}/content`,
        { version: 1, document: { format: 2, nodes: [] } },
        "origin-doc-key",
        "fixture-session",
        "PUT",
      );
    assert.equal((await send()).statusCode, 200);
    const receipt = [...f.receipts.values()][0];
    assert.equal(
      (receipt.original_scope as { team_id: string }).team_id,
      originalTeam,
    );
    receipt.original_scope = null;
    assert.equal((await send()).statusCode, 409);
    assert.equal(f.writes, 1);
  } finally {
    await f.app.close();
  }
});

test("capture-to-doc narrow receipts conservatively hold without transactional original scope", async (t) => {
  const f = fixture(t);
  try {
    const body = { text: "Fixture", to: { kind: "page", doc_id: f.id } };
    assert.equal((await f.send("/capture", body)).statusCode, 201);
    const replay = await f.send("/capture", body);
    assert.equal(replay.statusCode, 409, replay.body);
    assert.equal(replay.headers["idempotency-outcome"], "unsafe");
    assert.equal(f.writes, 1);
  } finally {
    await f.app.close();
  }
});

test("booking original-scope checks cannot use the system-admin membership override", async (t) => {
  const f = fixture(t);
  try {
    f.admin();
    const send = () =>
      f.send(
        `/bookings/${f.id}/note`,
        { note: "Fixture" },
        "booking-admin-key",
        "fixture-session",
        "PUT",
      );
    assert.equal((await send()).statusCode, 200);
    f.membership(null);
    const replay = await send();
    assert.equal(replay.statusCode, 404, replay.body);
    assert.equal(replay.headers["idempotency-outcome"], "unsafe");
    assert.equal(f.writes, 1);
  } finally {
    await f.app.close();
  }
});
