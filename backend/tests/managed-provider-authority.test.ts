import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { encryptSecret } = await import("../src/lib/secrets.js");
const { resolveAi } = await import("../src/modules/ai/providers/resolve.js");
const { resolveUserAi } =
  await import("../src/modules/ai/providers/user-choice.js");
const { complete } = await import("../src/modules/ai/providers/adapters.js");
const { readJobManagedSnapshot } =
  await import("../src/modules/ai/providers/managed-authority.js");
const users: string[] = [];
const providers: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("UPDATE ai_settings SET provider_id=NULL,model='' WHERE id");
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.query("DELETE FROM ai_providers WHERE id=ANY($1::uuid[])", [
    providers,
  ]);
  await pool.end();
});
const stale = (error: any) => error.reason === "provider_changed";
async function fixture(configured = true) {
  const owner = randomUUID();
  users.push(owner);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Fixture',true)",
    [owner, `${owner}@fixture.invalid`],
  );
  const provider = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url,api_key_encrypted,options,enabled) VALUES('openai','Authority fixture','https://api.openai.com/v1',$1,'{}',true) RETURNING id",
      [await encryptSecret("fixture-not-real")],
    )
  ).rows[0];
  providers.push(provider.id);
  await pool.query("UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id", [
    configured ? provider.id : null,
    configured ? "gpt-6.1-sol" : "",
  ]);
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,state,managed_provider_snapshot) VALUES($1,'queued',$2) RETURNING id,managed_provider_snapshot",
      [owner, { version: 1, selection_revision: "999", provider: null }],
    )
  ).rows[0];
  return {
    owner,
    provider: provider.id as string,
    job: job.id as string,
    snapshot: job.managed_provider_snapshot,
  };
}
test("enqueue overwrites caller authority, keeps secrets out and makes capture immutable", async () => {
  const f = await fixture();
  assert.equal(f.snapshot.provider.id, f.provider);
  assert.equal(f.snapshot.provider.model, "gpt-6.1-sol");
  assert.notEqual(f.snapshot.selection_revision, "999");
  assert.equal(JSON.stringify(f.snapshot).includes("fixture-not-real"), false);
  assert.deepEqual(Object.keys(f.snapshot.provider).sort(), [
    "id",
    "model",
    "revision",
  ]);
  await assert.rejects(
    pool.query("UPDATE ai_jobs SET managed_provider_snapshot=$2 WHERE id=$1", [
      f.job,
      { ...f.snapshot, selection_revision: "999" },
    ]),
    (error: any) => error.code === "23514",
  );
  const ai = await resolveUserAi(f.owner, f.job, async () => {});
  assert.equal(ai?.model, "gpt-6.1-sol");
  await ai?.assertAuthority?.();
});
test("changed model rejects held and resumed jobs before any request", async (t) => {
  const f = await fixture();
  const ai = (await resolveUserAi(f.owner, f.job, async () => {}))!;
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    throw new Error("Must not dispatch");
  });
  await pool.query("UPDATE ai_settings SET model='other-model' WHERE id");
  await assert.rejects(ai.assertAuthority!(), stale);
  await assert.rejects(
    resolveUserAi(f.owner, f.job, async () => {}),
    stale,
  );
  await assert.rejects(
    complete(ai, [{ role: "user", content: "fixture" }]),
    stale,
  );
  assert.equal(requests, 0);
});
test("selection A to B to A cannot reactivate old captured authority", async () => {
  const f = await fixture();
  await pool.query("UPDATE ai_settings SET model='other-model' WHERE id");
  await pool.query("UPDATE ai_settings SET model='gpt-6.1-sol' WHERE id");
  await assert.rejects(
    resolveUserAi(f.owner, f.job, async () => {}),
    stale,
  );
});
for (const [name, update] of [
  ["disabled", "enabled=false"],
  ["key", "api_key_encrypted=NULL"],
  ["endpoint", "base_url='https://example.com/v1'"],
  ["options", "options='{" + '"apiVersion":"fixture"' + "}'::jsonb"],
  ["kind", "kind='openai-compatible'"],
] as const)
  test(`provider ${name} changes reject captured jobs`, async () => {
    const f = await fixture();
    const ai = (await resolveAi())!;
    await pool.query(`UPDATE ai_providers SET ${update} WHERE id=$1`, [
      f.provider,
    ]);
    await assert.rejects(ai.assertAuthority!(), stale);
    await assert.rejects(
      resolveUserAi(f.owner, f.job, async () => {}),
      stale,
    );
  });
test("provider selection switch and deletion reject queued authority", async () => {
  const f = await fixture();
  await pool.query("UPDATE ai_settings SET provider_id=NULL,model='' WHERE id");
  await assert.rejects(
    resolveUserAi(f.owner, f.job, async () => {}),
    stale,
  );
  await pool.query("DELETE FROM ai_providers WHERE id=$1", [f.provider]);
  await assert.rejects(
    resolveUserAi(f.owner, f.job, async () => {}),
    stale,
  );
});
test("unconfigured enqueue cannot adopt a subsequently configured provider", async () => {
  const f = await fixture(false);
  assert.equal(await resolveUserAi(f.owner, f.job, async () => {}), null);
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='gpt-6.1-sol' WHERE id",
    [f.provider],
  );
  await assert.rejects(
    resolveUserAi(f.owner, f.job, async () => {}),
    stale,
  );
});
test("unrelated labels and night budgets preserve managed generation authority", async () => {
  const f = await fixture();
  const ai = (await resolveUserAi(f.owner, f.job, async () => {}))!;
  await pool.query(
    "UPDATE ai_providers SET name='Renamed fixture' WHERE id=$1",
    [f.provider],
  );
  await pool.query(
    "UPDATE ai_settings SET night_token_budget=night_token_budget+1 WHERE id",
  );
  await ai.assertAuthority!();
  assert.equal(
    (await resolveUserAi(f.owner, f.job, async () => {}))?.model,
    ai.model,
  );
});
test("legacy or malformed snapshots cannot infer consent from current settings", async () => {
  for (const snapshot of [
    null,
    {},
    { version: 1, selection_revision: "1", provider: { api_key: "forbidden" } },
  ]) {
    const db = {
      query: async () => ({ rows: [{ managed_provider_snapshot: snapshot }] }),
    };
    await assert.rejects(
      readJobManagedSnapshot(db as any, randomUUID(), randomUUID()),
      (error: any) => error.reason === "managed_authority_unverified",
    );
  }
});

for (const kind of ["openai", "openai-compatible", "anthropic"] as const) {
  test(`${kind} completion rejects a provider revoked while awaiting its response`, async (t) => {
    const f = await fixture();
    await pool.query("UPDATE ai_providers SET kind=$2 WHERE id=$1", [
      f.provider,
      kind,
    ]);
    const ai = (await resolveAi())!;
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => {
      requests++;
      await pool.query("UPDATE ai_providers SET enabled=false WHERE id=$1", [
        f.provider,
      ]);
      return Response.json(
        kind === "anthropic"
          ? {
              type: "message",
              content: [{ type: "text", text: "Do not accept" }],
            }
          : kind === "openai"
            ? {
                status: "completed",
                output: [
                  {
                    type: "message",
                    content: [{ type: "output_text", text: "Do not accept" }],
                  },
                ],
              }
            : {
                choices: [
                  {
                    message: { content: "Do not accept" },
                    finish_reason: "stop",
                  },
                ],
              },
      );
    });
    await assert.rejects(
      complete(ai, [{ role: "user", content: "fixture" }]),
      stale,
    );
    assert.equal(
      requests,
      1,
      "revocation must not trigger a replacement request",
    );
  });
}

test("transcription checks managed authority before dispatch and after response", async (t) => {
  const { transcribe } =
    await import("../src/modules/ai/providers/adapters.js");
  const f = await fixture();
  const ai = (await resolveAi())!;
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    await pool.query("UPDATE ai_settings SET model='other-model' WHERE id");
    return Response.json({ text: "Do not accept" });
  });
  await assert.rejects(
    transcribe(ai, new Uint8Array([1, 2]), "audio/webm"),
    stale,
  );
  assert.equal(requests, 1);
  await assert.rejects(
    transcribe(ai, new Uint8Array([1, 2]), "audio/webm"),
    stale,
  );
  assert.equal(requests, 1);
});

test("explicit fallback resolution preserves captured managed model and refuses retargeting", async () => {
  const f = await fixture();
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider,fallback_to_default) VALUES($1,'chatgpt',true)",
    [f.owner],
  );
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,state) VALUES($1,'queued') RETURNING id",
      [f.owner],
    )
  ).rows[0];
  const notices: string[] = [];
  const ai = await resolveUserAi(f.owner, job.id, async (text) => {
    notices.push(text);
  });
  assert.equal(ai?.model, "gpt-6.1-sol");
  assert.equal(notices.length, 1);
  await pool.query("UPDATE ai_settings SET model='other-model' WHERE id");
  await assert.rejects(
    resolveUserAi(f.owner, job.id, async (text) => {
      notices.push(text);
    }),
    stale,
  );
  assert.equal(notices.length, 1);
});

test("hosted page origins capture managed authority and cannot retarget queued work", async () => {
  const { captureMaintainedPageModelOrigin, resolveMaintainedPageModel } =
    await import("../src/modules/docs/maintenance-model.js");
  const f = await fixture();
  const captured = await captureMaintainedPageModelOrigin(pool, f.owner);
  // PostgreSQL jsonb reorders keys; persisted authority must compare semantically.
  const origin = (await pool.query("SELECT $1::jsonb AS origin", [captured]))
    .rows[0].origin;
  assert.equal(origin.kind, "hosted");
  if (origin.kind !== "hosted") throw new Error("Expected hosted origin");
  assert.equal(
    origin.managed_provider_snapshot?.provider?.model,
    "gpt-6.1-sol",
  );
  assert.equal(
    (await resolveMaintainedPageModel(f.owner, origin)).ai.model,
    "gpt-6.1-sol",
  );
  await pool.query("UPDATE ai_settings SET model='other-model' WHERE id");
  await assert.rejects(
    resolveMaintainedPageModel(f.owner, origin),
    (error: any) => error.reason === "provider_choice_changed",
  );
});

test("legacy hosted page origins cannot invent the queued managed selection", async () => {
  const { resolveMaintainedPageModel } =
    await import("../src/modules/docs/maintenance-model.js");
  const f = await fixture();
  await assert.rejects(
    resolveMaintainedPageModel(f.owner, {
      kind: "hosted",
      provider_choice_version: 0,
    }),
    (error: any) => error.reason === "provider_choice_changed",
  );
});

test("hosted model key ignores label edits and preserves persisted snapshot identity", async () => {
  const { captureMaintainedPageModelOrigin, resolveMaintainedPageModel } =
    await import("../src/modules/docs/maintenance-model.js");
  const f = await fixture();
  const captured = await captureMaintainedPageModelOrigin(pool, f.owner);
  const origin = (await pool.query("SELECT $1::jsonb AS origin", [captured]))
    .rows[0].origin;
  const before = await resolveMaintainedPageModel(f.owner, origin);
  await pool.query(
    "UPDATE ai_providers SET name='Relabeled',updated_at=clock_timestamp() WHERE id=$1",
    [f.provider],
  );
  const after = await resolveMaintainedPageModel(f.owner, origin);
  assert.equal(after.key, before.key);
  await before.ai.assertAuthority?.();
});

for (const target of ["selection", "provider"] as const) {
  test(`enqueue locks ${target} so configuration edits cannot produce a mixed snapshot`, async () => {
    const f = await fixture();
    const enqueue = await pool.connect();
    const writer = await pool.connect();
    try {
      await enqueue.query("BEGIN");
      const job = (
        await enqueue.query(
          "INSERT INTO ai_jobs(user_id,state) VALUES($1,'queued') RETURNING id",
          [f.owner],
        )
      ).rows[0];
      await writer.query("BEGIN");
      await writer.query("SET LOCAL lock_timeout='100ms'");
      await assert.rejects(
        writer.query(
          target === "selection"
            ? "UPDATE ai_settings SET model='racing-model' WHERE id"
            : "UPDATE ai_providers SET enabled=false WHERE id=$1",
          target === "selection" ? [] : [f.provider],
        ),
        (error: any) => error.code === "55P03",
      );
      await writer.query("ROLLBACK");
      await enqueue.query("COMMIT");
      assert.equal(
        (await resolveUserAi(f.owner, job.id, async () => {}))?.model,
        "gpt-6.1-sol",
      );
    } finally {
      await enqueue.query("ROLLBACK");
      await writer.query("ROLLBACK");
      enqueue.release();
      writer.release();
    }
  });
}
