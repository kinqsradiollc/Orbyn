import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, createHash } from "node:crypto";
import { helpers, trapNetwork, bearer } from "./mcp-helpers.js";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");
const {
  saveAgendaPrivatePermission,
  readAgendaPrivatePermission,
  captureAgendaScheduleGrant,
  assertAgendaScheduleGrant,
} = await import("../src/modules/auth/agenda-private-permission.js");
const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();
const owners: string[] = [];
before(() => migrate());
after(async () => {
  network.restore();
  assert.deepEqual(network.calls, []);
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function fixture() {
  const person = await h.register("agenda-schedule-permission");
  owners.push(person.id);
  const session = (
    await pool.query("SELECT id FROM sessions WHERE user_id=$1", [person.id])
  ).rows[0].id;
  const connection = randomUUID(),
    executor = randomUUID();
  await pool.query(
    "INSERT INTO chatgpt_identity_connections(id,user_id,issuer,subject,client_id) VALUES($1,$2,'https://auth.openai.com',$3,'oaiapp_fixture')",
    [connection, person.id, randomUUID()],
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
    'INSERT INTO chatgpt_executor_catalogs(executor_id,enrollment_epoch,lease_epoch,sequence,models,capabilities) VALUES($1,1,1,1,$2,\'["plan_inference_v1","plan_inference_limits_v1"]\')',
    [
      executor,
      JSON.stringify([{ slug: "fixture-model", display_name: "Fixture" }]),
    ],
  );
  await pool.query(
    "INSERT INTO chatgpt_model_preferences(connection_id,model,version) VALUES($1,'fixture-model',1)",
    [connection],
  );
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider,connection_id,executor_id,version) VALUES($1,'chatgpt',$2,$3,1)",
    [person.id, connection, executor],
  );
  return {
    ...person,
    connection,
    executor,
    binding: { userId: person.id, sessionId: session },
  };
}
const input = {
  enabled: true,
  expected_version: 0,
  expected_provider_choice_version: 1,
  expected_preference_version: 1,
};
test("only explicit owner permission enables the reviewed scheduled model, with CAS and revocation", async () => {
  const f = await fixture();
  assert.equal(
    await transaction((db) => captureAgendaScheduleGrant(db, f.id)),
    null,
  );
  const saved = await saveAgendaPrivatePermission(f.binding, input);
  assert.equal(saved.active, true);
  assert.equal(saved.model, "fixture-model");
  const grant = await transaction((db) => captureAgendaScheduleGrant(db, f.id));
  assert.ok(grant);
  await assert.rejects(
    saveAgendaPrivatePermission(f.binding, input),
    (e: any) => e.statusCode === 409,
  );
  await saveAgendaPrivatePermission(f.binding, {
    ...input,
    enabled: false,
    expected_version: saved.version,
  });
  await assert.rejects(
    transaction((db) => assertAgendaScheduleGrant(db, f.id, grant)),
    (e: any) => e.statusCode === 409,
  );
  assert.equal(
    await transaction((db) => captureAgendaScheduleGrant(db, f.id)),
    null,
  );
  const reenabled = await saveAgendaPrivatePermission(f.binding, {
    ...input,
    expected_version: saved.version + 1,
  });
  assert.equal(reenabled.active, true);
  await assert.rejects(
    transaction((db) => assertAgendaScheduleGrant(db, f.id, grant)),
    (e: any) => e.statusCode === 409,
  );
});

test("concurrent permission writes cannot both accept the same reviewed version", async () => {
  const f = await fixture();
  const attempts = await Promise.allSettled([
    saveAgendaPrivatePermission(f.binding, input),
    saveAgendaPrivatePermission(f.binding, input),
  ]);
  assert.equal(
    attempts.filter((attempt) => attempt.status === "fulfilled").length,
    1,
  );
  const rejected = attempts.find((attempt) => attempt.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.equal(rejected.reason.statusCode, 409);
  assert.equal(
    (
      await pool.query(
        "SELECT version FROM agenda_private_permissions WHERE user_id=$1",
        [f.id],
      )
    ).rows[0].version,
    "1",
  );
});
test("disconnecting the reviewed ChatGPT connection invalidates its scheduled permission", async () => {
  const f = await fixture();
  await saveAgendaPrivatePermission(f.binding, input);
  const grant = await transaction((db) => captureAgendaScheduleGrant(db, f.id));
  assert.ok(grant);
  const { revokeChatgptConnection } =
    await import("../src/modules/auth/chatgpt-connections.js");
  await revokeChatgptConnection(f.binding, f.connection);
  const setting = await readAgendaPrivatePermission(f.binding);
  assert.equal(setting.enabled, true);
  assert.equal(setting.active, false);
  assert.equal(
    await transaction((db) => captureAgendaScheduleGrant(db, f.id)),
    null,
  );
  await assert.rejects(
    transaction((db) => assertAgendaScheduleGrant(db, f.id, grant)),
  );
  const disabled = await saveAgendaPrivatePermission(f.binding, {
    ...input,
    enabled: false,
    expected_version: setting.version,
  });
  assert.equal(disabled.enabled, false);
});
test("a changed default model requires renewed explicit scheduling permission", async () => {
  const f = await fixture();
  const saved = await saveAgendaPrivatePermission(f.binding, input);
  const grant = await transaction((db) => captureAgendaScheduleGrant(db, f.id));
  assert.ok(grant);
  await pool.query(
    "UPDATE chatgpt_model_preferences SET version=version+1 WHERE connection_id=$1",
    [f.connection],
  );
  assert.equal((await readAgendaPrivatePermission(f.binding)).active, false);
  await assert.rejects(
    transaction((db) => assertAgendaScheduleGrant(db, f.id, grant)),
  );
  await assert.rejects(
    saveAgendaPrivatePermission(f.binding, {
      ...input,
      expected_version: saved.version,
    }),
    (e: any) => e.statusCode === 409,
  );
  const renewed = await saveAgendaPrivatePermission(f.binding, {
    ...input,
    expected_version: saved.version,
    expected_preference_version: 2,
  });
  assert.equal(renewed.active, true);
  await assert.rejects(
    transaction((db) => assertAgendaScheduleGrant(db, f.id, grant)),
  );
});
test("stale models, unavailable devices and missing capabilities cannot receive scheduled permission", async () => {
  const f = await fixture();
  await assert.rejects(
    saveAgendaPrivatePermission(f.binding, {
      ...input,
      expected_preference_version: 0,
    }),
    (e: any) => e.statusCode === 409,
  );
  await pool.query(
    "UPDATE chatgpt_executor_catalogs SET capabilities='[\"plan_inference_v1\"]' WHERE executor_id=$1",
    [f.executor],
  );
  await assert.rejects(
    saveAgendaPrivatePermission(f.binding, input),
    (e: any) => e.statusCode === 503,
  );
  await pool.query("DELETE FROM chatgpt_executor_leases WHERE executor_id=$1", [
    f.executor,
  ]);
  await assert.rejects(saveAgendaPrivatePermission(f.binding, input));
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM agenda_private_permissions WHERE user_id=$1",
        [f.id],
      )
    ).rows[0].n,
    0,
  );
});
test("permission routes require a first-party session, strict bodies, owner-only reads and rate limits", async () => {
  const person = await h.register("agenda-grant-routes");
  owners.push(person.id);
  const url = "/ai/agenda/private-permission";
  const key = (
    await h.call(person.token, "POST", "/me/api-keys", {
      name: "Grant fixture",
    })
  ).json().key;
  for (const method of ["GET", "PUT"] as const) {
    assert.equal(
      (await h.call(null, method, url, method === "PUT" ? input : undefined))
        .statusCode,
      401,
    );
    assert.equal(
      (await h.call(key, method, url, method === "PUT" ? input : undefined))
        .statusCode,
      403,
    );
  }
  const read = await h.call(person.token, "GET", url);
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.headers["cache-control"], "no-store");
  assert.equal(read.json().enabled, false);
  assert.equal(read.json().id, null);
  const malformed = await app.inject({
    method: "PUT",
    url,
    headers: { ...bearer(person.token), "content-type": "application/json" },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(
    (
      await h.call(person.token, "PUT", url, {
        ...input,
        user_id: randomUUID(),
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (await h.call(person.token, "GET", `${url}?user_id=${randomUUID()}`))
      .statusCode,
    422,
  );
  let limited = false;
  for (let n = 0; n < 15; n++) {
    const result = await h.call(person.token, "PUT", url, { forbidden: true });
    if (result.statusCode === 429) {
      limited = true;
      break;
    }
    assert.equal(result.statusCode, 422);
  }
  assert.ok(limited);
});

test("summary status is owner-only, excludes private context, rejects keys and obeys strict limits", async () => {
  const person = await h.register("agenda-summary-status");
  const other = await h.register("agenda-summary-other");
  owners.push(person.id, other.id);
  const url = "/ai/agenda/private-summary";
  const key = (
    await h.call(person.token, "POST", "/me/api-keys", {
      name: "Status fixture",
    })
  ).json().key;
  assert.equal((await h.call(null, "GET", url)).statusCode, 401);
  assert.equal((await h.call(key, "GET", url)).statusCode, 403);
  const first = await h.call(person.token, "GET", url);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.headers["cache-control"], "no-store");
  assert.deepEqual(first.json(), { run: null });
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title,kind,content) VALUES($1,'Status fixture','agenda','[]') RETURNING id",
      [person.id],
    )
  ).rows[0].id;
  const id = randomUUID();
  await pool.query(
    `INSERT INTO agenda_summary_runs(id,user_id,doc_id,local_day,target_block_id,target_hash,snapshot,permission,expires_at)
    VALUES($1,$2,$3,current_date,'summary','hash','{"private_fact":"must not be returned"}','{"private_permission":"must not be returned"}',now()+interval '1 hour')`,
    [id, person.id, doc],
  );
  const read = await h.call(person.token, "GET", url);
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.json().run.id, id);
  assert.equal(read.json().run.state, "queued");
  assert.deepEqual(
    Object.keys(read.json().run).sort(),
    [
      "id",
      "doc_id",
      "local_day",
      "state",
      "expires_at",
      "updated_at",
      "reason",
      "provider",
    ].sort(),
  );
  assert.ok(!read.body.includes("private_fact"));
  assert.ok(!read.body.includes("private_permission"));
  assert.deepEqual((await h.call(other.token, "GET", url)).json(), {
    run: null,
  });
  assert.equal(
    (await h.call(other.token, "GET", `${url}?user_id=${person.id}`))
      .statusCode,
    422,
  );
  const malformed = await app.inject({
    method: "GET",
    url,
    headers: { ...bearer(person.token), "content-type": "application/json" },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  let limited = false;
  for (let n = 0; n < 15; n++) {
    const response = await h.call(person.token, "GET", url);
    if (response.statusCode === 429) {
      limited = true;
      break;
    }
    assert.equal(response.statusCode, 200, response.body);
  }
  assert.ok(limited);
});
