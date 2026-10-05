import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");
const app = await buildApp();
const owners: string[] = [];
let calls = 0;
let token: string, owner: string, providerId: string;
let original: { provider_id: string | null; model: string };
let responseHook: (() => Promise<void>) | undefined;
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    void (async () => {
      calls++;
      const system = JSON.parse(raw).messages[0].content;
      await responseHook?.();
      const value = system.includes("break projects")
        ? {
            title: "Local launch",
            summary: "Fixture project",
            tasks: [
              {
                id: "first",
                title: "First step",
                estimate_minutes: 30,
                due_in_days: 1,
                depends_on: [],
              },
            ],
          }
        : system.includes("find deadlines")
          ? {
              tasks: [
                {
                  title: "Submit fixture",
                  due: "2026-11-01",
                  source: "Submit fixture on 2026-11-01.",
                },
              ],
            }
          : { summary: "- Local fixture summary" };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(value) },
            },
          ],
        }),
      );
    })().catch(() => {
      res.writeHead(500);
      res.end("{}");
    });
  });
});
before(async () => {
  await migrate();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  original = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai-compatible','Feature stand-in',$1) RETURNING id",
      [`http://127.0.0.1:${(server.address() as { port: number }).port}/v1`],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='feature-fixture' WHERE id",
    [providerId],
  );
  const registered = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `feature-${randomUUID()}@example.test`,
      password: "a-long-test-password",
      name: "Feature fixture",
    },
  });
  assert.equal(registered.statusCode, 201, registered.body);
  token = registered.json().token;
  owner = registered.json().user.id;
  owners.push(owner);
});
after(async () => {
  await pool.query("UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id", [
    original.provider_id,
    original.model,
  ]);
  await pool.query("DELETE FROM ai_providers WHERE id=$1", [providerId]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
  server.close();
});
let address = 1;
const call = (url: string, payload: object, authenticated = true) =>
  app.inject({
    method: "POST",
    url,
    payload,
    remoteAddress: `10.201.0.${address++}`,
    headers: authenticated ? { authorization: `Bearer ${token}` } : {},
  });
const page = async () =>
  (
    await pool.query(
      "INSERT INTO docs(user_id,title,content) VALUES($1,'Capture fixture',$2::jsonb) RETURNING id,version",
      [
        owner,
        JSON.stringify([
          { id: "text", type: "paragraph", text: "Local source facts." },
        ]),
      ],
    )
  ).rows[0];
test("capture preserves security and proposal-only response contracts", async () => {
  assert.equal(
    (await call("/ai/assist", { action: "summarise", text: "Fixture" }, false))
      .statusCode,
    401,
  );
  assert.equal(
    (await call("/ai/assist", { action: "unknown", text: "Fixture" }))
      .statusCode,
    422,
  );
  assert.equal(
    (await call("/ai/assist", { action: "summarise", doc_id: randomUUID() }))
      .statusCode,
    404,
  );
  const result = await call("/ai/assist", {
    action: "summarise",
    text: "Local source facts.",
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().summary, "- Local fixture summary");
  assert.deepEqual(result.json().provider, {
    source: "default",
    model: "feature-fixture",
    fallback: false,
  });
  const job = (
    await pool.query(
      "SELECT chat_id,state,run_state FROM ai_jobs WHERE user_id=$1 AND run_state->>'feature'='capture_summary' ORDER BY created_at DESC LIMIT 1",
      [owner],
    )
  ).rows[0];
  assert.equal(job.chat_id, null);
  assert.equal(job.state, "done");
  assert.deepEqual(job.run_state.sources, []);
});
test("project drafting records selected provider and leaves creation for approval", async () => {
  const before = (
    await pool.query(
      "SELECT count(*)::int AS count FROM projects WHERE user_id=$1",
      [owner],
    )
  ).rows[0].count;
  const response = await call("/ai/project", {
    prompt: "Launch the fixture",
    timezone: "UTC",
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.ok(response.json().id);
  assert.equal(response.json().provider.model, "feature-fixture");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM projects WHERE user_id=$1",
        [owner],
      )
    ).rows[0].count,
    before,
  );
});
test("personal choice without fallback never sends project or capture data to managed AI", async () => {
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider,fallback_to_default) VALUES($1,'chatgpt',false)",
    [owner],
  );
  const before = calls;
  try {
    assert.equal(
      (
        await call("/ai/project", {
          prompt: "Private project",
          timezone: "UTC",
        })
      ).statusCode,
      502,
    );
    assert.equal(
      (
        await call("/ai/assist", {
          action: "summarise",
          text: "Private fixture",
        })
      ).statusCode,
      502,
    );
    assert.equal(calls, before);
  } finally {
    await pool.query("DELETE FROM user_ai_provider_choice WHERE user_id=$1", [
      owner,
    ]);
  }
});
test("capture discards output when the selected page changes during inference", async () => {
  const doc = await page();
  responseHook = async () => {
    await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [doc.id]);
  };
  try {
    assert.equal(
      (await call("/ai/assist", { action: "summarise", doc_id: doc.id }))
        .statusCode,
      409,
    );
  } finally {
    responseHook = undefined;
  }
});

test("team project drafts honor assistant policy before sending any prompt", async () => {
  const team = (
    await pool.query(
      "INSERT INTO teams(name,assistant_allowed) VALUES('Feature team',false) RETURNING id",
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
    [team, owner],
  );
  const before = calls;
  try {
    const response = await call("/ai/project", {
      prompt: "Team fixture",
      timezone: "UTC",
      team_id: team,
    });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(calls, before);
  } finally {
    await pool.query("DELETE FROM teams WHERE id=$1", [team]);
  }
});

test("team write permission changes fence a project result before proposal creation", async () => {
  const team = (
    await pool.query(
      "INSERT INTO teams(name,assistant_allowed) VALUES('Changing feature team',true) RETURNING id",
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'member')",
    [team, owner],
  );
  responseHook = async () => {
    await pool.query(
      "UPDATE team_members SET role='viewer' WHERE team_id=$1 AND user_id=$2",
      [team, owner],
    );
  };
  try {
    const response = await call("/ai/project", {
      prompt: "Team fixture",
      timezone: "UTC",
      team_id: team,
    });
    assert.equal(response.statusCode, 409, response.body);
  } finally {
    responseHook = undefined;
    await pool.query("DELETE FROM teams WHERE id=$1", [team]);
  }
});

test("capture refuses a page whose project is kept out of AI", async () => {
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name,assistant_off) VALUES($1,'Excluded capture',true) RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const doc = await page();
  await pool.query("UPDATE docs SET project_id=$1 WHERE id=$2", [
    project,
    doc.id,
  ]);
  const before = calls;
  const response = await call("/ai/assist", {
    action: "summarise",
    doc_id: doc.id,
  });
  assert.equal(response.statusCode, 422, response.body);
  assert.equal(calls, before);
});

test("personal API keys cannot borrow ChatGPT for project or capture features", async () => {
  const { digest } = await import("../src/lib/auth.js");
  const key = "ok_" + randomUUID();
  await pool.query(
    "INSERT INTO api_keys(user_id,name,prefix,key_hash) VALUES($1,'Feature key',$2,$3)",
    [owner, key.slice(0, 12), digest(key)],
  );
  const managed = await app.inject({
    method: "POST",
    url: "/ai/assist",
    payload: { action: "summarise", text: "Managed key fixture" },
    remoteAddress: `10.201.0.${address++}`,
    headers: { authorization: `Bearer ${key}` },
  });
  assert.equal(managed.statusCode, 403, managed.body);
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider,fallback_to_default) VALUES($1,'chatgpt',true)",
    [owner],
  );
  const before = calls;
  try {
    for (const [url, payload] of [
      ["/ai/project", { prompt: "Key fixture", timezone: "UTC" }],
      ["/ai/assist", { action: "summarise", text: "Key fixture" }],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url,
        payload,
        remoteAddress: `10.201.0.${address++}`,
        headers: { authorization: `Bearer ${key}` },
      });
      assert.equal(response.statusCode, 403, response.body);
    }
    assert.equal(calls, before);
  } finally {
    await pool.query("DELETE FROM user_ai_provider_choice WHERE user_id=$1", [
      owner,
    ]);
    await pool.query("DELETE FROM api_keys WHERE key_hash=$1", [digest(key)]);
  }
});
