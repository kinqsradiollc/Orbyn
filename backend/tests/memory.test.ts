import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";

process.env.FILES_SECRET ??= "test-files-secret-0123456789abcdef";

const { buildApp } = await import("../src/app.js");
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { drainMemoryQueue } = await import("../src/worker/memory.js");
const { finishChatTurn } = await import("../src/modules/ai/chats.js");
const {
  enqueueMemory,
  listMemory,
  readMemory,
  recallMemory,
  rememberMemory,
  forgetMemory,
} = await import("../src/modules/memory/service.js");
const { closeLive } = await import("../src/modules/docs/live.js");
const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

type ToolResult = {
  content: { type: string; text: string }[];
  structuredContent?: any;
  isError?: boolean;
  _meta?: Record<string, any>;
};

let owner: Person;
let other: Person;

before(async () => {
  await migrate();
  owner = await h.register("memory-owner", "Memory owner");
  other = await h.register("memory-other", "Another person");
});

after(async () => {
  await closeLive();
  assert.deepEqual(
    network.calls,
    [],
    "memory processing never reaches a real provider",
  );
  network.restore();
  await app.close();
  await pool.end();
});

async function memorySourceChat() {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin,turns) VALUES($1,$2,'Memory source','person','[]')",
    [id, owner.id],
  );
  return id;
}

test("Memory stays private, searchable only in its own library, and forget removes its source queue", async () => {
  const sourceChat = await memorySourceChat();
  const topic = "Planning preferences";
  const learned = await transaction(async (db) => {
    const result = await rememberMemory(
      db,
      owner.id,
      topic,
      ["Prefers short plans with the MTRX marker"],
      [
        {
          type: "chat",
          id: sourceChat,
          label: "A planning conversation",
          quote: null,
        },
      ],
    );
    await enqueueMemory(db, {
      userId: owner.id,
      chatId: sourceChat,
      turns: [{ role: "user", content: "I prefer short plans." }],
      sourceProjectId: null,
    });
    return result.entry;
  });
  const agentNote = await h.call(owner.token, "POST", "/docs", {
    title: "Agent note title AGNTQ",
    kind: "agent",
    content: [
      { type: "paragraph", text: "A note produced for an outside agent." },
    ],
  });
  assert.equal(agentNote.statusCode, 201, agentNote.body);
  const agentDocId = agentNote.json().id as string;

  const visibleDocs = (await h.call(owner.token, "GET", "/docs")).json() as {
    id: string;
  }[];
  assert.ok(!visibleDocs.some((doc) => doc.id === learned.id));
  assert.ok(!visibleDocs.some((doc) => doc.id === agentDocId));
  const memoryLibrary = (
    await h.call(owner.token, "GET", "/docs?kind=memory")
  ).json() as {
    id: string;
  }[];
  assert.ok(memoryLibrary.some((doc) => doc.id === learned.id));
  const agentLibrary = (
    await h.call(owner.token, "GET", "/docs?kind=agent")
  ).json() as {
    id: string;
  }[];
  assert.ok(agentLibrary.some((doc) => doc.id === agentDocId));

  const memorySearch = await h.call(
    owner.token,
    "GET",
    "/search?q=MTRX&type=doc",
  );
  const agentSearch = await h.call(
    owner.token,
    "GET",
    "/search?q=AGNTQ&type=doc",
  );
  assert.deepEqual(memorySearch.json(), []);
  assert.deepEqual(agentSearch.json(), []);
  await h.call(owner.token, "POST", "/recents", {
    kind: "doc",
    id: learned.id,
  });
  const recentDocs = (
    await h.call(owner.token, "GET", "/find?type=doc")
  ).json() as {
    id: string;
  }[];
  assert.ok(!recentDocs.some((doc) => doc.id === learned.id));

  const opened = await h.call(owner.token, "GET", `/docs/${learned.id}`);
  assert.equal(opened.statusCode, 200);
  assert.match(
    JSON.stringify(opened.json().content),
    /\[src: A planning conversation\]/,
  );
  const sources = await readMemory(pool, owner.id, topic);
  assert.deepEqual(
    sources?.sources.map((source) => source.label),
    ["A planning conversation"],
  );
  assert.match(
    await recallMemory(pool, owner.id, "MTRX"),
    /Prefers short plans/,
  );
  assert.ok(!(await readMemory(pool, other.id, topic)));

  const outsider = await h.agentKey(other, {
    access: "write",
    trust: "full",
    toolsets: ["core"],
  });
  const hiddenFetch = (await h.tool(outsider.key, "fetch", {
    id: `doc:${learned.id}`,
  })) as ToolResult;
  assert.equal(hiddenFetch._meta?.["orbyn/error"]?.code, "NOT_FOUND");

  const forgottenByOther = await h.call(
    other.token,
    "DELETE",
    `/me/memory/${learned.id}`,
  );
  assert.equal(forgottenByOther.statusCode, 404);
  const legacyKey = (
    await h.call(owner.token, "POST", "/me/api-keys", {
      name: "Memory API key",
    })
  ).json().key;
  const forbiddenForget = await h.call(
    legacyKey,
    "DELETE",
    `/me/memory/${learned.id}`,
  );
  assert.equal(forbiddenForget.statusCode, 403);
  const forgotten = await h.call(
    owner.token,
    "DELETE",
    `/me/memory/${learned.id}`,
  );
  assert.equal(forgotten.statusCode, 200, forgotten.body);
  assert.ok(!(await readMemory(pool, owner.id, topic)));
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM memory_queue WHERE user_id = $1 AND chat_id = $2",
        [owner.id, sourceChat],
      )
    ).rowCount,
    0,
  );
});

test("MCP manages shared Memory and fetches Agent notes as ordinary pages", async () => {
  const source = await h.call(owner.token, "POST", "/docs", {
    title: "MCP source page",
    kind: "doc",
    content: [
      { type: "paragraph", text: "A source page for the outside agent." },
    ],
  });
  assert.equal(source.statusCode, 201, source.body);
  const sourceId = source.json().id as string;
  const agentNote = await h.call(owner.token, "POST", "/docs", {
    title: "Agent note from MCP",
    kind: "agent",
    content: [
      { type: "paragraph", text: "An outside agent can fetch this note." },
    ],
  });
  assert.equal(agentNote.statusCode, 201, agentNote.body);
  const agentDocId = agentNote.json().id as string;
  const grant = await h.agentKey(owner, {
    access: "write",
    trust: "full",
    toolsets: ["core"],
  });
  await pool.query(
    "UPDATE agent_grants SET acts_alone = ARRAY['profile'] WHERE id = $1",
    [grant.id],
  );
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await h.legacy(grant.key, "tools/call", {
      name,
      arguments: args,
    });
    const result = response.body?.result as ToolResult | undefined;
    assert.ok(result, `${name}: ${JSON.stringify(response.body)}`);
    return result;
  };
  const ok = (result: ToolResult) => {
    assert.ok(!result.isError, result.content?.[0]?.text);
    return result.structuredContent;
  };

  const saved = ok(
    await call("manage_memory", {
      action: "remember",
      topic: "MCP goals",
      facts: ["Wants an incremental delivery plan"],
      sources: [{ type: "doc", id: sourceId, label: "MCP source page" }],
    }),
  );
  assert.equal(saved.status, "done");
  const list = ok(await call("manage_memory", { action: "list" }));
  assert.ok(
    list.memories.some(
      (entry: { topic: string }) => entry.topic === "MCP goals",
    ),
  );
  const read = ok(
    await call("manage_memory", { action: "read", topic: "MCP goals" }),
  );
  assert.equal(read.memory.facts[0].text, "Wants an incremental delivery plan");
  assert.equal(read.memory.sources[0].label, "MCP source page");

  const fetched = ok(await call("fetch", { id: `doc:${agentDocId}` }));
  assert.equal(fetched.metadata.type, "doc");
  assert.equal(fetched.metadata.kind, "agent");
  const memorySearch = ok(
    await call("search", { query: "incremental delivery plan" }),
  );
  assert.doesNotMatch(
    JSON.stringify(memorySearch),
    /MCP goals|incremental delivery plan/,
  );
  const hiddenFetch = await call("fetch", { id: `doc:${read.memory.id}` });
  assert.equal(hiddenFetch._meta?.["orbyn/error"]?.code, "NOT_FOUND");

  const forgotten = ok(
    await call("manage_memory", { action: "forget", topic: "MCP goals" }),
  );
  assert.equal(forgotten.status, "done");
  assert.ok(!(await readMemory(pool, owner.id, "MCP goals")));
});

test("the worker learns off-request with a fake provider and skips a kept-out project", async () => {
  // Earlier assistant integration tests may have left unrelated learning
  // jobs in this shared disposable database. Keep this worker exercise local.
  await pool.query("DELETE FROM memory_queue");
  const projectResponse = await h.call(owner.token, "POST", "/projects", {
    name: "Memory kept-out project",
  });
  assert.equal(projectResponse.statusCode, 201, projectResponse.body);
  const projectId = projectResponse.json().id as string;
  const keptOut = await h.call(
    owner.token,
    "PUT",
    `/projects/${projectId}/assistant`,
    {
      off: true,
    },
  );
  assert.equal(keptOut.statusCode, 200, keptOut.body);
  const hiddenMemory = await transaction((db) =>
    rememberMemory(
      db,
      owner.id,
      "Project-only context",
      ["PROJECTKEY stays out"],
      [
        {
          type: "project",
          id: projectId,
          label: "Memory kept-out project",
          quote: null,
        },
      ],
    ),
  );
  assert.equal(
    await readMemory(pool, owner.id, "Project-only context", [projectId]),
    null,
  );
  assert.ok(
    !(await listMemory(pool, owner.id, { keptOutProjects: [projectId] })).some(
      (entry) => entry.id === hiddenMemory.entry.id,
    ),
  );
  assert.doesNotMatch(
    await recallMemory(pool, owner.id, "PROJECTKEY", 4000, [projectId]),
    /PROJECTKEY/,
  );
  const chatId = await memorySourceChat();
  await enqueueMemory(pool, {
    userId: owner.id,
    chatId,
    turns: [
      { role: "user", content: "I like concise progress reports." },
      { role: "assistant", content: "I will keep that in mind." },
    ],
    sourceProjectId: null,
  });
  let sent = "";
  const worked = await drainMemoryQueue({
    ai: {} as never,
    completeTurn: async (_ai, messages) => {
      sent = messages.map((message) => message.content).join("\n");
      return JSON.stringify({
        topics: [
          {
            topic: "Progress reports",
            facts: ["Likes concise progress reports"],
          },
        ],
      });
    },
  });
  assert.equal(worked, 1);
  assert.match(sent, /I like concise progress reports/);
  const learned = await readMemory(pool, owner.id, "Progress reports");
  assert.equal(learned?.facts[0].text, "Likes concise progress reports");
  assert.ok(
    learned?.sources.some(
      (source) => source.type === "chat" && source.id === chatId,
    ),
  );

  const blockedChat = await memorySourceChat();
  await enqueueMemory(pool, {
    userId: owner.id,
    chatId: blockedChat,
    turns: [{ role: "user", content: "Kept out project details" }],
    sourceProjectId: projectId,
  });
  const skipped = await drainMemoryQueue({
    ai: {} as never,
    completeTurn: async () => {
      throw new Error("kept-out project text reached the provider");
    },
  });
  assert.equal(skipped, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM memory_queue WHERE id IS NOT NULL AND chat_id = $1",
        [blockedChat],
      )
    ).rowCount,
    0,
  );
  assert.ok(!(await readMemory(pool, owner.id, "Kept out project details")));
});

test("recall matches any word of a long request, and a note whose topic it names", async () => {
  const chatId = await memorySourceChat();
  await transaction((db) =>
    rememberMemory(
      db,
      owner.id,
      "Revision habits",
      ["Revises best in short evening sessions"],
      [{ type: "chat", id: chatId, label: "A study chat", quote: null }],
    ),
  );
  const long = await recallMemory(
    pool,
    owner.id,
    "Could you please plan out my whole week so that I get some revision done before Friday",
  );
  assert.match(long, /short evening sessions/);
  const named = await recallMemory(
    pool,
    owner.id,
    "what do you know about my revision habits?",
  );
  assert.match(named, /## Revision habits/);
  assert.equal(await recallMemory(pool, owner.id, "zebra quantum"), "");
});

test("a turn that keeps failing to learn is dropped after five tries", async () => {
  const chat = randomUUID();
  await enqueueMemory(pool, {
    userId: other.id,
    chatId: chat,
    sourceProjectId: null,
    turns: [{ role: "user", content: "I like tea" }],
  });
  const fake = { provider: "fake" } as never;
  for (let i = 0; i < 6; i++) {
    await pool.query(
      "UPDATE memory_queue SET claimed_at = NULL WHERE chat_id = $1",
      [chat],
    );
    await drainMemoryQueue({
      ai: fake,
      completeTurn: async () => "not json",
    });
  }
  const left = await pool.query(
    "SELECT 1 FROM memory_queue WHERE chat_id = $1",
    [chat],
  );
  assert.equal(left.rowCount, 0);
});

test("automated completions save their answer without teaching personal Memory", async () => {
  for (const origin of ["person", "idea", "goal", "routine", "task", "night"]) {
    const chatId = randomUUID();
    const turnId = randomUUID();
    await pool.query(
      `INSERT INTO ai_chats(id,user_id,title,origin,turns)
       VALUES($1,$2,'Provenance check',$3,$4::jsonb)`,
      [
        chatId,
        owner.id,
        origin,
        JSON.stringify([
          { role: "user", text: "Review my work", turn_id: turnId },
        ]),
      ],
    );
    const result = {
      summary: "Observed: a task failed. Interpretation: try a shorter task.",
      trace: [],
    };
    await finishChatTurn(owner.id, chatId, turnId, result);
    await finishChatTurn(owner.id, chatId, turnId, result);
    const saved = (
      await pool.query("SELECT turns FROM ai_chats WHERE id=$1", [chatId])
    ).rows[0];
    assert.equal(
      saved.turns.length,
      2,
      `${origin}: retry cannot duplicate the answer`,
    );
    assert.equal(saved.turns[1].text, result.summary);
    const queued = await pool.query(
      "SELECT 1 FROM memory_queue WHERE chat_id=$1",
      [chatId],
    );
    assert.equal(
      queued.rowCount,
      origin === "person" ? 1 : 0,
      `${origin}: only personal chats can teach Memory`,
    );
    await pool.query("DELETE FROM memory_queue WHERE chat_id=$1", [chatId]);
    await enqueueMemory(pool, {
      userId: other.id,
      chatId,
      turns: [],
      sourceProjectId: null,
    });
    assert.equal(
      (
        await pool.query("SELECT 1 FROM memory_queue WHERE chat_id=$1", [
          chatId,
        ])
      ).rowCount,
      0,
      "a different person's chat cannot be queued",
    );
  }
});

test("legacy automated memory backlog is discarded before reaching a provider", async () => {
  const chatId = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin,turns) VALUES($1,$2,'Overnight reflection','night','[]')",
    [chatId, owner.id],
  );
  await pool.query(
    `INSERT INTO memory_queue(chat_id,user_id,turns) VALUES($1,$2,$3::jsonb)`,
    [
      chatId,
      owner.id,
      JSON.stringify([
        { role: "user", content: "Generated reflection instructions" },
      ]),
    ],
  );
  let calls = 0;
  await drainMemoryQueue({
    ai: {} as never,
    completeTurn: async () => {
      calls++;
      throw new Error(
        "Automated reflection reached personal memory extraction",
      );
    },
  });
  assert.equal(calls, 0);
  assert.equal(
    (await pool.query("SELECT 1 FROM memory_queue WHERE chat_id=$1", [chatId]))
      .rowCount,
    0,
  );
});

test("a source deleted during extraction cannot create a personal memory", async () => {
  const chatId = await memorySourceChat();
  await enqueueMemory(pool, {
    userId: owner.id,
    chatId,
    sourceProjectId: null,
    turns: [
      { role: "user", content: "An explicit preference in a deleted chat" },
    ],
  });
  await drainMemoryQueue({
    ai: {} as never,
    completeTurn: async () => {
      await pool.query("DELETE FROM ai_chats WHERE id=$1", [chatId]);
      return JSON.stringify({
        topics: [
          { topic: "Deleted source preference", facts: ["Must not be stored"] },
        ],
      });
    },
  });
  assert.equal(
    await readMemory(pool, owner.id, "Deleted source preference"),
    null,
  );
  assert.equal(
    (await pool.query("SELECT 1 FROM memory_queue WHERE chat_id=$1", [chatId]))
      .rowCount,
    0,
  );
});
