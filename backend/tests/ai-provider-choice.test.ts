import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  readAiProviderChoice,
  saveAiProviderChoice,
  readJobAiProviderChoice,
  assertJobAiProviderChoice,
} = await import("../src/modules/auth/ai-provider-choice.js");
const users: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.end();
});

test("enqueue captures an immutable provider choice and restart cannot adopt changed settings", async () => {
  const a = await person(),
    b = await person();
  const original = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,state,provider_choice_snapshot) VALUES($1,'queued',$2) RETURNING id,provider_choice_snapshot",
      [a.userId, { primary: "default", version: 999 }],
    )
  ).rows[0];
  assert.equal(
    original.provider_choice_snapshot.version,
    0,
    "an enqueue caller cannot supply another policy snapshot",
  );
  assert.equal(
    (await readJobAiProviderChoice(a.userId, original.id)).version,
    0,
  );
  await assert.rejects(
    readJobAiProviderChoice(b.userId, original.id),
    status(404),
  );
  await saveAiProviderChoice(a, {
    primary: "default",
    fallback_to_default: false,
    expected_version: 0,
  });
  await assert.rejects(
    readJobAiProviderChoice(a.userId, original.id),
    status(409),
  );
  const { resolveUserAi } =
    await import("../src/modules/ai/providers/user-choice.js");
  await assert.rejects(
    resolveUserAi(a.userId, original.id, async () => {}),
    status(409),
  );
  const fresh = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,state) VALUES($1,'queued') RETURNING id",
      [a.userId],
    )
  ).rows[0];
  assert.equal((await readJobAiProviderChoice(a.userId, fresh.id)).version, 1);
  await assert.rejects(
    pool.query("UPDATE ai_jobs SET provider_choice_snapshot=$2 WHERE id=$1", [
      fresh.id,
      original.provider_choice_snapshot,
    ]),
    (e: any) => e.code === "23514",
  );
  const legacyDb = {
    query: async () => ({ rows: [{ provider_choice_snapshot: null }] }),
  };
  await assert.rejects(
    assertJobAiProviderChoice(legacyDb as any, a.userId, original.id),
    status(409),
  );
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
