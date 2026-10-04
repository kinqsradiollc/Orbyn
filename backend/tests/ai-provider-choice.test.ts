import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { readAiProviderChoice, saveAiProviderChoice } =
  await import("../src/modules/auth/ai-provider-choice.js");
const users: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.end();
});
async function person() {
  const userId = randomUUID(),
    sessionId = randomUUID();
  users.push(userId);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Fixture',true)",
    [userId, `${userId}@fixture.invalid`],
  );
  await pool.query(
    "INSERT INTO sessions(id,user_id,token_hash) VALUES($1,$2,$3)",
    [sessionId, userId, randomUUID()],
  );
  return { userId, sessionId };
}
const status = (code: number) => (e: any) => e.statusCode === code;
test("provider choice defaults to Orbyn, uses CAS and never enables fallback through MCP or a stale save", async () => {
  const a = await person(),
    b = await person();
  assert.deepEqual(await readAiProviderChoice(pool, a.userId), {
    primary: "default",
    connection_id: null,
    executor_id: null,
    fallback_to_default: false,
    version: 0,
  });
  const saved = await saveAiProviderChoice(a, {
    primary: "default",
    fallback_to_default: false,
    expected_version: 0,
  });
  assert.equal(saved.version, 1);
  await assert.rejects(
    saveAiProviderChoice(a, {
      primary: "default",
      fallback_to_default: false,
      expected_version: 0,
    }),
    status(409),
  );
  assert.equal((await readAiProviderChoice(pool, b.userId)).version, 0);
  await assert.rejects(
    saveAiProviderChoice(a, {
      primary: "chatgpt",
      connection_id: randomUUID(),
      executor_id: randomUUID(),
      fallback_to_default: true,
      expected_version: 1,
    }),
    status(404),
  );
  await pool.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
    [a.sessionId],
  );
  await assert.rejects(
    saveAiProviderChoice(a, {
      primary: "default",
      fallback_to_default: false,
      expected_version: 1,
    }),
    status(401),
  );
});
