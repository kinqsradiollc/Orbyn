import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, createHash } from "node:crypto";
import { defaultNightShift } from "@orbyn/core";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { scanAssistantGoals } = await import("../src/worker/assistant-goals.js");
const { scanAssistantIdeas } = await import("../src/worker/assistant-ideas.js");
const { scanAssistantRoutines } =
  await import("../src/worker/assistant-routines.js");
const { scanAssistantTasks } = await import("../src/worker/assistant-tasks.js");
const { scanNightShift } = await import("../src/worker/night-shift.js");
const owners: string[] = [];
let original: { provider_id: string | null; model: string };
const now = new Date("2050-01-02T23:00:00Z");
before(async () => {
  await migrate();
  original = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  await pool.query("UPDATE ai_settings SET provider_id=NULL,model='' WHERE id");
});
after(async () => {
  await pool.query("UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id", [
    original.provider_id,
    original.model,
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function fixture(kind: string) {
  const owner = randomUUID(),
    session = randomUUID(),
    connection = randomUUID(),
    executor = randomUUID();
  owners.push(owner);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Personal scanner fixture',true)",
    [owner, owner + "@fixture.invalid"],
  );
  await pool.query(
    "INSERT INTO sessions(id,user_id,token_hash,last_seen_at) VALUES($1,$2,$3,now()-interval '1 day')",
    [session, owner, randomUUID()],
  );
  await pool.query(
    "INSERT INTO chatgpt_identity_connections(id,user_id,issuer,subject,client_id) VALUES($1,$2,'https://auth.openai.com',$3,'oaiapp_fixture')",
    [connection, owner, randomUUID()],
  );
  const key = generateKeyPairSync("ed25519")
    .publicKey.export({ format: "der", type: "spki" })
    .toString("base64url");
  await pool.query(
    "INSERT INTO chatgpt_executor_enrollments(id,connection_id,host_id,session_id,public_key,public_key_fingerprint,epoch) VALUES($1,$2,$3,$4,$5,$6,1)",
    [
      executor,
      connection,
      randomUUID(),
      session,
      key,
      createHash("sha256")
        .update(Buffer.from(key, "base64url"))
        .digest("base64url"),
    ],
  );
  await pool.query(
    "INSERT INTO chatgpt_executor_leases(executor_id,enrollment_epoch,session_id,epoch,expires_at) VALUES($1,1,$2,1,now()+interval '5 minutes')",
    [executor, session],
  );
  await pool.query(
    "INSERT INTO chatgpt_executor_catalogs(executor_id,enrollment_epoch,lease_epoch,sequence,models,capabilities) VALUES($1,1,1,1,$2,$3)",
    [
      executor,
      JSON.stringify([{ slug: "fixture-model", display_name: "Fixture" }]),
      JSON.stringify(["plan_inference_v1", "plan_inference_limits_v1"]),
    ],
  );
  await pool.query(
    "INSERT INTO chatgpt_model_preferences(connection_id,model) VALUES($1,'fixture-model')",
    [connection],
  );
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider,connection_id,executor_id,fallback_to_default) VALUES($1,'chatgpt',$2,$3,false)",
    [owner, connection, executor],
  );
  const grant = await assistantPrincipal({
    id: owner,
    name: "Personal scanner fixture",
    role: "member",
  });
  await pool.query("UPDATE agent_grants SET last_used_at=$2 WHERE id=$1", [
    grant.grant_id,
    now,
  ]);
  if (kind === "goal")
    await pool.query(
      "INSERT INTO goals(user_id,title) VALUES($1,'Private goal')",
      [owner],
    );
  if (kind === "routine")
    await pool.query(
      "INSERT INTO agent_routines(user_id,instruction,rrule,next_run_at) VALUES($1,'Private routine','FREQ=DAILY',$2)",
      [owner, new Date(now.getTime() - 60000)],
    );
  if (kind === "task" || kind === "night")
    await pool.query(
      "INSERT INTO items(user_id,title,agent_grant_id,agent_state,agent_when) VALUES($1,'Private task',$2,'queued',$3)",
      [owner, grant.grant_id, kind === "night" ? "tonight" : "now"],
    );
  if (kind === "night")
    await pool.query(
      "INSERT INTO agent_settings(user_id,night_shift) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET night_shift=excluded.night_shift",
      [
        owner,
        JSON.stringify({
          ...defaultNightShift(),
          enabled: true,
          timezone: "UTC",
          start: "22:00",
          end: "08:00",
        }),
      ],
    );
  return owner;
}
for (const [kind, scan] of [
  ["goal", scanAssistantGoals],
  ["idea", scanAssistantIdeas],
  ["routine", scanAssistantRoutines],
  ["task", scanAssistantTasks],
  ["night", scanNightShift],
] as const) {
  test(`configured personal ${kind} can enqueue with no managed provider`, async () => {
    const owner = await fixture(kind);
    assert.equal(
      await scan(now, { only: [owner], ai: null }),
      0,
      "explicitly disabled scan must not claim work",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM ai_jobs WHERE user_id=$1",
          [owner],
        )
      ).rows[0].n,
      0,
    );
    const actual = await scan(now, { only: [owner] });
    if (!actual) {
      const control = await scan(now, { only: [owner], ai: {} as any });
      assert.ok(
        control > 0,
        "positive control must enqueue the same eligible work",
      );
    }
    const jobs = (
      await pool.query(
        "SELECT provider_choice_snapshot FROM ai_jobs WHERE user_id=$1",
        [owner],
      )
    ).rows;
    assert.ok(jobs.length > 0);
    assert.ok(
      jobs.every((j) => j.provider_choice_snapshot.primary === "chatgpt"),
    );
    assert.ok(
      actual > 0,
      `configured personal ${kind} blocked by unrelated managed availability`,
    );
  });
  test(`${kind} preserves unavailable default and disconnected personal choices`, async () => {
    const owner = await fixture(kind);
    await pool.query("DELETE FROM user_ai_provider_choice WHERE user_id=$1", [
      owner,
    ]);
    assert.equal(await scan(now, { only: [owner] }), 0);
    await pool.query(
      "INSERT INTO user_ai_provider_choice(user_id,primary_provider,fallback_to_default) VALUES($1,'chatgpt',false)",
      [owner],
    );
    assert.equal(await scan(now, { only: [owner] }), 0);
    await pool.query(
      "UPDATE user_ai_provider_choice SET fallback_to_default=true WHERE user_id=$1",
      [owner],
    );
    assert.equal(
      await scan(now, { only: [owner] }),
      0,
      "fallback also needs a configured managed provider",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM ai_jobs WHERE user_id=$1",
          [owner],
        )
      ).rows[0].n,
      0,
    );
  });

  test(`${kind} admits an offline personal connection without silently falling back`, async () => {
    const owner = await fixture(kind);
    await pool.query(
      "DELETE FROM chatgpt_executor_leases WHERE executor_id=(SELECT executor_id FROM user_ai_provider_choice WHERE user_id=$1)",
      [owner],
    );
    assert.ok((await scan(now, { only: [owner] })) > 0);
    const jobs = (
      await pool.query(
        "SELECT provider_choice_snapshot FROM ai_jobs WHERE user_id=$1",
        [owner],
      )
    ).rows;
    assert.ok(jobs.length > 0);
    for (const job of jobs) {
      assert.equal(job.provider_choice_snapshot.primary, "chatgpt");
      assert.equal(job.provider_choice_snapshot.fallback_to_default, false);
    }
  });

  test(`${kind} does not enqueue for a disabled owner`, async () => {
    const owner = await fixture(kind);
    await pool.query("UPDATE users SET disabled=true WHERE id=$1", [owner]);
    assert.equal(await scan(now, { only: [owner] }), 0);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM ai_jobs WHERE user_id=$1",
          [owner],
        )
      ).rows[0].n,
      0,
    );
  });
}

test("unavailable owner cannot consume a routine batch slot or advance its schedule", async () => {
  const unavailable = await fixture("routine");
  const personal = await fixture("routine");
  await pool.query("DELETE FROM user_ai_provider_choice WHERE user_id=$1", [
    unavailable,
  ]);
  await pool.query(
    "UPDATE agent_routines SET next_run_at=$2 WHERE user_id=$1",
    [unavailable, new Date(now.getTime() - 120000)],
  );
  const before = (
    await pool.query(
      "SELECT next_run_at FROM agent_routines WHERE user_id=$1",
      [unavailable],
    )
  ).rows[0];
  assert.equal(
    await scanAssistantRoutines(now, {
      only: [unavailable, personal],
      limit: 1,
    }),
    1,
  );
  const waiting = (
    await pool.query(
      "SELECT next_run_at,claimed_at,current_job_id FROM agent_routines WHERE user_id=$1",
      [unavailable],
    )
  ).rows[0];
  assert.deepEqual(waiting.next_run_at, before.next_run_at);
  assert.equal(waiting.claimed_at, null);
  assert.equal(waiting.current_job_id, null);
  const jobs = (
    await pool.query(
      "SELECT user_id FROM ai_jobs WHERE user_id=ANY($1::uuid[])",
      [[unavailable, personal]],
    )
  ).rows;
  assert.deepEqual(
    jobs.map((j) => j.user_id),
    [personal],
  );
});

test("managed admission respects enabled/model selection and explicit fallback", async () => {
  const { assistantProviderAdmissionSql } =
    await import("../src/modules/ai/providers/admission.js");
  const provider = randomUUID();
  const personal = await fixture("routine");
  const disconnected = await fixture("routine");
  const managed = await fixture("routine");
  await pool.query("DELETE FROM user_ai_provider_choice WHERE user_id=$1", [
    managed,
  ]);
  await pool.query(
    "UPDATE user_ai_provider_choice SET connection_id=NULL,executor_id=NULL WHERE user_id=$1",
    [disconnected],
  );
  await pool.query(
    "INSERT INTO ai_providers(id,kind,name,base_url,api_key_encrypted,enabled) VALUES($1,'openai','Inert admission fixture','https://fixture.invalid','deliberately-unreadable',true)",
    [provider],
  );
  const eligible = async (owner: string) =>
    (
      await pool.query(
        `SELECT ${assistantProviderAdmissionSql("u.id")} AS eligible FROM users u WHERE u.id=$1`,
        [owner],
      )
    ).rows[0].eligible;
  try {
    await pool.query(
      "UPDATE ai_settings SET provider_id=$1,model='fixture-model' WHERE id",
      [provider],
    );
    assert.equal(await eligible(personal), true);
    assert.equal(await eligible(managed), true);
    assert.equal(
      await eligible(disconnected),
      false,
      "no implicit billing fallback",
    );
    assert.equal(await scanAssistantRoutines(now, { only: [disconnected] }), 0);
    await pool.query(
      "UPDATE user_ai_provider_choice SET fallback_to_default=true WHERE user_id=$1",
      [disconnected],
    );
    assert.equal(await eligible(disconnected), true);
    // Enqueue records authority; it must not decrypt unrelated credentials or call a vendor.
    assert.equal(
      await scanAssistantRoutines(now, {
        only: [personal, disconnected, managed],
      }),
      3,
    );
    const jobs = (
      await pool.query(
        "SELECT user_id,provider_choice_snapshot FROM ai_jobs WHERE user_id=ANY($1::uuid[])",
        [[personal, disconnected, managed]],
      )
    ).rows;
    assert.equal(
      jobs.find((j) => j.user_id === personal).provider_choice_snapshot
        .fallback_to_default,
      false,
    );
    assert.equal(
      jobs.find((j) => j.user_id === disconnected).provider_choice_snapshot
        .fallback_to_default,
      true,
    );
    assert.equal(
      jobs.find((j) => j.user_id === managed).provider_choice_snapshot.primary,
      "default",
    );
    await pool.query("UPDATE ai_providers SET enabled=false WHERE id=$1", [
      provider,
    ]);
    assert.equal(await eligible(personal), true);
    assert.equal(await eligible(managed), false);
    assert.equal(await eligible(disconnected), false);
    await pool.query("UPDATE ai_providers SET enabled=true WHERE id=$1", [
      provider,
    ]);
    await pool.query("UPDATE ai_settings SET model='' WHERE id");
    assert.equal(await eligible(personal), true);
    assert.equal(await eligible(managed), false);
    assert.equal(await eligible(disconnected), false);
  } finally {
    await pool.query(
      "UPDATE ai_settings SET provider_id=NULL,model='' WHERE id",
    );
    await pool.query("DELETE FROM ai_providers WHERE id=$1", [provider]);
  }
});
