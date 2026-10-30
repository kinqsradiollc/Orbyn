import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { helpers, trapNetwork } from "./mcp-helpers.js";

// Two distinct pools against the same guarded test database exercise routing,
// without needing or connecting to a real replica. A single client per pool
// makes connection reuse and transaction-local setting cleanup observable.
process.env.DATABASE_READ_URL = process.env.TEST_DATABASE_URL;
process.env.DB_POOL_MAX = "1";
process.env.ASSISTANT_CONVERSATION_ENABLED = "true";
const { pool, readPool, readTransaction, closeDatabase } =
  await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApiService } = await import("../src/app.js");
const { listAiChats, projectChatRoutes } =
  await import("../src/modules/ai/chats.js");
const { createService } = await import("../src/services/http.js");
const { listNotifications } =
  await import("../src/modules/notifications/service.js");
const { readAssistantProfiles } =
  await import("../src/modules/assistant-workspace/profiles.js");
const app = await buildApiService();
// Mount the deployed AI-service list owner without starting its model runner.
const chatApp = await createService("ai", [projectChatRoutes]);
const h = helpers(app);
const network = await trapNetwork();
const owners: string[] = [];
before(() => migrate());
after(async () => {
  await chatApp.close();
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await closeDatabase();
  network.restore();
  assert.deepEqual(network.calls, []);
});
const stateSql = `SELECT pg_backend_pid() AS pid,current_setting('jit') AS jit,
  current_setting('jit_above_cost') AS above_cost,
  current_setting('transaction_read_only') AS readonly,
  current_setting('transaction_isolation') AS isolation`;

test("JIT opt-out is local, preserves results and resets on commit and every failure", async () => {
  assert.notEqual(pool, readPool);
  const original = (await pool.query(stateSql)).rows[0];
  try {
    await pool.query("SET jit=on");
    await pool.query("SET jit_above_cost=0");
    const available = (
      await pool.query("SELECT pg_jit_available() AS available")
    ).rows[0].available;
    const execute = (jit?: false) =>
      readTransaction(
        async (db) => {
          const state = (await db.query(stateSql)).rows[0];
          assert.equal(state.pid, original.pid);
          assert.equal(state.readonly, "on");
          assert.equal(state.jit, jit === false ? "off" : "on");
          const result = (
            await db.query(
              "SELECT sum(n)::int AS total FROM generate_series(1,100) n",
            )
          ).rows;
          const plan = (
            await db.query(
              "EXPLAIN (ANALYZE,FORMAT JSON) SELECT sum(n)::int FROM generate_series(1,100) n",
            )
          ).rows[0]["QUERY PLAN"][0];
          if (jit === false) assert.equal(plan.JIT, undefined);
          else if (available) assert.ok(plan.JIT.Functions > 0);
          return result;
        },
        { primary: true, jit },
      );
    assert.deepEqual(await execute(false), await execute());
    const reset = async () => {
      const row = (await pool.query(stateSql)).rows[0];
      assert.equal(row.pid, original.pid);
      assert.equal(row.jit, "on");
      assert.equal(row.readonly, "off");
    };
    await reset();
    const sentinel = new Error("callback failure");
    await assert.rejects(
      readTransaction(
        async () => {
          throw sentinel;
        },
        { primary: true, jit: false },
      ),
      (error) => error === sentinel,
    );
    await reset();
    await assert.rejects(
      readTransaction((db) => db.query("SELECT 1/0"), {
        primary: true,
        jit: false,
      }),
      { code: "22012" },
    );
    await reset();
    await assert.rejects(
      readTransaction((db) => db.query("DELETE FROM users WHERE false"), {
        primary: true,
        jit: false,
      }),
      { code: "25006" },
    );
    await reset();
  } finally {
    await pool.query("SELECT set_config('jit',$1,false)", [original.jit]);
    await pool.query("SELECT set_config('jit_above_cost',$1,false)", [
      original.above_cost,
    ]);
  }
});

test("observed HTTP reads disable JIT and preserve replica selection and private summaries", async () => {
  const user = await h.register("read-compilation");
  const other = await h.register("read-compilation-other");
  owners.push(user.id, other.id);
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name) VALUES($1,'Visible project') RETURNING id",
      [user.id],
    )
  ).rows[0].id;
  const ownTask = (
    await pool.query(
      "INSERT INTO items(user_id,title) VALUES($1,'Own source') RETURNING id",
      [user.id],
    )
  ).rows[0].id;
  const privateTask = (
    await pool.query(
      "INSERT INTO items(user_id,title) VALUES($1,'Private source') RETURNING id",
      [other.id],
    )
  ).rows[0].id;
  const chat = randomUUID(),
    hidden = randomUUID(),
    mixed = randomUUID(),
    stream = randomUUID();
  for (const [id, title, projectId] of [
    [chat, "Visible work", project],
    [hidden, "Hidden work", null],
    [mixed, "Private mixed title", null],
  ]) {
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title,project_id,turns) VALUES($1,$2,$3,$4,$5)",
      [
        id,
        user.id,
        title,
        projectId,
        JSON.stringify([
          { role: "user", text: "One" },
          { role: "assistant", text: "Two" },
        ]),
      ],
    );
  }
  for (const id of [hidden, mixed])
    await pool.query(
      "INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id) VALUES($1,$2,'task',$3)",
      [id, randomUUID(), privateTask],
    );
  await pool.query(
    "INSERT INTO assistant_conversation_streams(id,owner_id,chat_id,personal,last_sequence) VALUES($1,$2,$3,true,2)",
    [stream, user.id, mixed],
  );
  for (const [index, source] of [ownTask, privateTask].entries()) {
    const entry = randomUUID();
    await pool.query(
      "INSERT INTO assistant_conversation_entries(id,destination_id,sequence,kind,turn_id,role,payload,sources_checked) VALUES($1,$2,$3,'turn',$4,'user',$5,true)",
      [
        entry,
        stream,
        index + 1,
        randomUUID(),
        { text: index ? "Hidden retained text" : "Visible retained text" },
      ],
    );
    await pool.query(
      "INSERT INTO assistant_conversation_entry_sources(entry_id,source_kind,source_id) VALUES($1,'task',$2)",
      [entry, source],
    );
  }
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,state,sources_checked,run_state) VALUES($1,$2,'queued',true,$3) RETURNING id",
      [
        user.id,
        chat,
        { version: 1, request: { automation: { kind: "task" } } },
      ],
    )
  ).rows[0].id;
  await pool.query("UPDATE ai_jobs SET state='waiting' WHERE id=$1", [job]);
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'task',$2)",
    [job, ownTask],
  );
  for (const [id, title] of [
    [chat, "Visible notice"],
    [hidden, "Hidden notice"],
  ]) {
    const sourceJob =
      id === chat
        ? job
        : (
            await pool.query(
              "INSERT INTO ai_jobs(user_id,chat_id,state,sources_checked) VALUES($1,$2,'done',true) RETURNING id",
              [user.id, id],
            )
          ).rows[0].id;
    await pool.query(
      "INSERT INTO notifications(user_id,item_version,channel,title,body,state,kind,ref) VALUES($1,0,'inapp',$2,'Synthetic only','sent','assistant',$3)",
      [user.id, title, `chat:${id}:${sourceJob}`],
    );
  }
  const primaryBefore = (await pool.query(stateSql)).rows[0];
  const replicaBefore = (await readPool.query(stateSql)).rows[0];
  await pool.query("SET jit=on");
  await readPool.query("SET jit=on");
  const primaryPid = primaryBefore.pid;
  const replicaPid = replicaBefore.pid;
  assert.notEqual(primaryPid, replicaPid);
  const expectedChats = await listAiChats(pool, user.id, {
    search: "",
    limit: 50,
  });
  assert.deepEqual(expectedChats.map((row) => row.title).sort(), [
    "Conversation",
    "Visible work",
  ]);
  assert.equal(expectedChats.find((row) => row.id === mixed)?.turn_count, 1);
  const expectedProject = await listAiChats(pool, user.id, {
    search: "",
    project_id: project,
    limit: 50,
  });
  const expectedNotices = await listNotifications(pool, user.id);
  assert.deepEqual(
    expectedNotices.map((row) => row.title),
    ["Visible notice"],
  );
  const expectedProfiles = (
    await readAssistantProfiles(pool, user.id, undefined, true, true)
  ).profiles;

  const observations: {
    pid: number;
    jit: string;
    readonly: string;
    isolation: string;
  }[] = [];
  const prototype = pg.Client.prototype as any,
    original = prototype.query;
  prototype.query = function (...args: any[]) {
    const text = typeof args[0] === "string" ? args[0] : args[0]?.text;
    const result = original.apply(this, args);
    if (
      typeof text !== "string" ||
      ![
        "AS turn_count",
        "FROM notifications n LEFT JOIN items",
        "FROM users u LEFT JOIN agent_settings",
      ].some((part) => text.includes(part))
    )
      return result;
    return result.then(async (value: any) => {
      observations.push((await original.call(this, stateSql)).rows[0]);
      return value;
    });
  };
  try {
    for (const primary of [false, true])
      for (const [url, expected] of [
        ["/ai/chats", expectedChats],
        [`/ai/projects/${project}/chats`, expectedProject],
        ["/notifications", expectedNotices],
        ["/me/assistant/profiles", expectedProfiles],
      ] as const) {
        observations.length = 0;
        const response = await (url.startsWith("/ai/") ? chatApp : app).inject({
          method: "GET",
          url,
          headers: {
            authorization: `Bearer ${user.token}`,
            "x-orbyn-outcomes": "1",
            "x-orbyn-review-origins": "1",
            ...(primary ? { "x-orbyn-consistency": "primary" } : {}),
          },
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.deepEqual(
          url === "/me/assistant/profiles"
            ? response.json().profiles
            : response.json(),
          JSON.parse(JSON.stringify(expected)),
        );
        assert.ok(observations.length > 0, url);
        for (const state of observations) {
          assert.equal(state.jit, "off", url);
          assert.equal(state.readonly, "on", url);
          assert.equal(
            state.pid,
            primary || url === "/me/assistant/profiles"
              ? primaryPid
              : replicaPid,
            url,
          );
          assert.equal(
            state.isolation,
            url === "/me/assistant/profiles"
              ? "repeatable read"
              : "read committed",
            url,
          );
        }
        assert.equal((await pool.query("SHOW jit")).rows[0].jit, "on");
        assert.equal((await readPool.query("SHOW jit")).rows[0].jit, "on");
      }
    const denied = await app.inject({ method: "GET", url: "/notifications" });
    assert.equal(denied.statusCode, 401);
    const foreignProject = (
      await pool.query(
        "INSERT INTO projects(user_id,name) VALUES($1,'Private project') RETURNING id",
        [other.id],
      )
    ).rows[0].id;
    const unavailable = await chatApp.inject({
      method: "GET",
      url: `/ai/projects/${foreignProject}/chats`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    assert.equal(unavailable.statusCode, 404);
    const afterFailure = (await readPool.query(stateSql)).rows[0];
    assert.equal(afterFailure.jit, "on");
    assert.equal(afterFailure.readonly, "off");
  } finally {
    prototype.query = original;
    await pool.query("SELECT set_config('jit',$1,false)", [primaryBefore.jit]);
    await readPool.query("SELECT set_config('jit',$1,false)", [
      replicaBefore.jit,
    ]);
  }
});
