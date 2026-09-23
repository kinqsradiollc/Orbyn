import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/db/pool.js";
import { createService } from "../src/services/http.js";
import { aiRoutes } from "../src/modules/ai/routes.js";
import { digest } from "../src/lib/auth.js";
import { runTool, type AgentContext } from "../src/modules/ai/agent/tools.js";

const draft = {
  title: "Launch",
  tasks: [
    {
      id: "design",
      title: "Design",
      estimate_minutes: 30,
      due_in_days: 1,
      depends_on: [],
    },
  ],
};
test("conversational project tool validates the graph and does not write data", async () => {
  const ctx: AgentContext = {
    user: { id: randomUUID(), role: "member" },
    timezone: "UTC",
    intentText: "Break this project into tasks: launch the site",
    actions: [],
    clarification: null,
  };
  const result = await runTool(
    { id: "test", name: "propose_project", arguments: JSON.stringify(draft) },
    ctx,
  );
  assert.equal(result.isError, false, result.content);
  assert.equal(ctx.projectDraft?.tasks.length, 1);
  assert.deepEqual(ctx.actions, []);
  const mixed = await runTool(
    {
      id: "next",
      name: "propose_create",
      arguments: JSON.stringify({ items: [{ title: "Extra" }] }),
    },
    ctx,
  );
  assert.equal(mixed.isError, true);
  const readOnly = {
    ...ctx,
    projectDraft: undefined,
    intentText: "What does it mean to break this project into tasks?",
  };
  assert.equal(
    (
      await runTool(
        {
          id: "read",
          name: "propose_project",
          arguments: JSON.stringify(draft),
        },
        readOnly,
      )
    ).isError,
    true,
  );
});

test("project API enforces authentication, forbidden accounts, malformed input, rate limits and scoped idempotent approval", async () => {
  const userId = randomUUID(),
    proposalId = randomUUID();
  const user = {
    id: userId,
    name: "Test",
    role: "member",
    disabled: false,
    email_verified: true,
  };
  const tx: string[] = [];
  let applied = true;
  let expires = new Date(Date.now() + 60000);
  let owner = userId;
  mock.method(pool, "query", async (sql: string, args: unknown[] = []) => {
    if (sql.includes("JOIN sessions"))
      return {
        rows: [{ ...user, disabled: args[0] === digest("disabled") }],
        rowCount: 1,
      };
    return { rows: [], rowCount: 0 };
  });
  mock.method(pool, "connect", async () => ({
    query: async (sql: string, args: unknown[] = []) => {
      tx.push(sql);
      if (sql.includes("FROM proposals")) {
        assert.equal(args[1], userId);
        return {
          rows:
            owner === userId
              ? [{ id: proposalId, applied, expires_at: expires, actions: [] }]
              : [],
          rowCount: owner === userId ? 1 : 0,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  }));
  const app = await createService("ai", [aiRoutes]);
  const call = (
    path: string,
    payload: unknown,
    token?: string,
    remoteAddress = "10.9.0.1",
  ) =>
    app.inject({
      method: "POST",
      url: path,
      payload: payload as Record<string, unknown>,
      remoteAddress,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  try {
    assert.equal(
      (await call("/ai/project", { prompt: "Launch" })).statusCode,
      401,
    );
    assert.equal(
      (await call("/ai/project", { prompt: "Launch" }, "disabled")).statusCode,
      403,
    );
    assert.equal(
      (await call("/ai/project", { prompt: "" }, "member")).statusCode,
      422,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/ai/project",
          payload: "{",
          headers: { "content-type": "application/json" },
        })
      ).statusCode,
      400,
    );
    let last = 0;
    for (let i = 0; i < 11; i++)
      last = (await call("/ai/project", { prompt: "" }, "member", "10.9.0.9"))
        .statusCode;
    assert.equal(last, 429);
    const url = `/ai/proposals/${proposalId}/apply`;
    assert.equal((await call(url, {}, "member")).statusCode, 200);
    assert.ok(tx.includes("COMMIT"));
    assert.equal(
      tx.some((s) => s.startsWith("INSERT")),
      false,
    );
    owner = randomUUID();
    tx.length = 0;
    assert.equal((await call(url, {}, "member")).statusCode, 404);
    assert.ok(tx.includes("ROLLBACK"));
    owner = userId;
    applied = false;
    expires = new Date(0);
    tx.length = 0;
    assert.equal((await call(url, {}, "member")).statusCode, 409);
    assert.ok(tx.includes("ROLLBACK"));
  } finally {
    await app.close();
    mock.restoreAll();
  }
});
