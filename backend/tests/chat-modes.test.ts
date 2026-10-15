import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
const users: string[] = [];
before(() => migrate());
after(async () => {
  try {
    if (users.length)
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  } finally {
    await app.close();
    await pool.end();
  }
});
async function account() {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `modes-${randomUUID()}@example.test`,
      password: "synthetic-chat-modes-password",
      name: "Chat modes",
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const v = r.json();
  users.push(v.user.id);
  return { id: v.user.id as string, token: v.token as string };
}
test("Chat/Work histories retain project conversations, rename/pin metadata and account visibility", async () => {
  const user = await account(),
    other = await account();
  const headers = { authorization: `Bearer ${user.token}` };
  const projectResponse = await app.inject({
    method: "POST",
    url: "/projects",
    headers,
    payload: { name: "Work history fixture" },
  });
  assert.equal(projectResponse.statusCode, 201, projectResponse.body);
  const project = projectResponse.json();
  const chat = randomUUID(),
    work = randomUUID(),
    foreign = randomUUID();
  for (const [id, owner, projectId] of [
    [chat, user.id, null],
    [work, user.id, project.id],
    [foreign, other.id, null],
  ])
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,project_id,title,turns) VALUES($1,$2,$3,'History fixture','[]'::jsonb)",
      [id, owner, projectId],
    );
  const list = async (url: string) => {
    const r = await app.inject({ method: "GET", url, headers });
    assert.equal(r.statusCode, 200, r.body);
    return r.json() as { id: string; title: string; pinned: boolean }[];
  };
  assert.deepEqual(
    (await list("/ai/chats?kind=chat")).map((c) => c.id),
    [chat],
  );
  assert.deepEqual(
    (await list("/ai/chats?kind=work")).map((c) => c.id),
    [work],
  );
  assert.deepEqual(
    (await list(`/ai/projects/${project.id}/chats`)).map((c) => c.id),
    [work],
  );
  const renamed = await app.inject({
    method: "PATCH",
    url: `/ai/chats/${work}`,
    headers,
    payload: { title: "Pinned project work", pinned: true },
  });
  assert.equal(renamed.statusCode, 200, renamed.body);
  const history = (await list("/ai/chats?kind=work"))[0];
  assert.equal(history.title, "Pinned project work");
  assert.equal(history.pinned, true);
  const opened = await app.inject({
    method: "GET",
    url: `/ai/chats/${work}`,
    headers,
  });
  assert.equal(opened.statusCode, 200, opened.body);
  const denied = await app.inject({
    method: "GET",
    url: `/ai/chats/${work}`,
    headers: { authorization: `Bearer ${other.token}` },
  });
  assert.equal(denied.statusCode, 404, denied.body);
  assert.ok(!(await list("/ai/chats?kind=all")).some((c) => c.id === foreign));
});
