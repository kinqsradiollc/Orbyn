import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { helpers, trapNetwork } from "./mcp-helpers.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");
const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();
const ids: string[] = [];
before(() => migrate());
after(async () => {
  network.restore();
  assert.deepEqual(network.calls, []);
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  await pool.end();
});
const base = "/ai/connections/chatgpt/connect-requests";
async function person() {
  const p = await h.register("one-click");
  ids.push(p.id);
  return p;
}
test("handoff remains session-bound, same-person, one-time and credential-free", async () => {
  const a = await person(),
    b = await person();
  const started = await h.call(a.token, "POST", base, {});
  assert.equal(started.statusCode, 200, started.body);
  const r = started.json();
  assert.equal(r.launch_url, `orbyn://chatgpt?request=${r.id}`);
  assert.equal(
    (await h.call(b.token, "POST", `${base}/${r.id}/claim`, {})).statusCode,
    404,
  );
  const claims = await Promise.all(
    [1, 2].map(() => h.call(a.token, "POST", `${base}/${r.id}/claim`, {})),
  );
  assert.deepEqual(claims.map((c) => c.statusCode).sort(), [200, 409]);
  const connection = randomUUID();
  await pool.query(
    "INSERT INTO chatgpt_identity_connections(id,user_id,issuer,subject,client_id) VALUES($1,$2,'https://auth.openai.com',$3,$4)",
    [connection, a.id, randomUUID(), "oaiapp_fixture"],
  );
  const result = await h.call(a.token, "POST", `${base}/${r.id}/finish`, {
    connection_id: connection,
  });
  assert.equal(result.statusCode, 200, result.body);
  const state = (await h.call(a.token, "GET", `${base}/${r.id}`)).json();
  assert.equal(state.state, "completed");
  assert.equal(state.connection_id, connection);
  assert.equal(
    (
      await h.call(a.token, "POST", `${base}/${r.id}/finish`, {
        connection_id: connection,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await h.call(b.token, "GET", `${base}/${r.id}`)).statusCode,
    404,
  );
  const stored = (
    await pool.query("SELECT * FROM chatgpt_connect_requests WHERE id=$1", [
      r.id,
    ])
  ).rows[0];
  assert.ok(!("access_token" in stored));
  assert.ok(!("id_token" in stored));
});
test("expired requests cannot authorize and API keys cannot request provider sign-in", async () => {
  const a = await person();
  assert.equal((await h.call(null, "POST", base, {})).statusCode, 401);
  const key = (
    await h.call(a.token, "POST", "/me/api-keys", { name: "Handoff test" })
  ).json().key;
  assert.equal((await h.call(key, "POST", base, {})).statusCode, 403);
  assert.equal(
    (await h.call(a.token, "POST", base, { access_token: "forbidden" }))
      .statusCode,
    422,
  );
  const r = (await h.call(a.token, "POST", base, {})).json();
  await pool.query(
    "UPDATE chatgpt_connect_requests SET expires_at=now()-interval '1 second' WHERE id=$1",
    [r.id],
  );
  assert.equal(
    (await h.call(a.token, "POST", `${base}/${r.id}/claim`, {})).statusCode,
    409,
  );
  assert.equal(
    (await h.call(a.token, "GET", `${base}/${r.id}`)).json().state,
    "expired",
  );
  assert.equal(
    (await h.call(a.token, "POST", `${base}/invalid/claim`, {})).statusCode,
    422,
  );
  let limited = false;
  for (let n = 0; n < 7; n++) {
    const r = await h.call(a.token, "POST", base, {});
    if (r.statusCode === 429) {
      limited = true;
      break;
    }
    assert.equal(r.statusCode, 200, r.body);
  }
  assert.equal(limited, true);
});

test("same-person runtime can claim from a different session; the initiating session cannot be replaced", async () => {
  const {
    startChatgptConnectRequest,
    claimChatgptConnectRequest,
    readChatgptConnectRequest,
    finishChatgptConnectRequest,
    pendingChatgptConnectRequests,
  } = await import("../src/modules/auth/chatgpt-connect-requests.js");
  const a = await person();
  const sessions = (
    await pool.query(
      "INSERT INTO sessions(user_id,token_hash) VALUES($1,$2),($1,$3) RETURNING id",
      [a.id, randomUUID(), randomUUID()],
    )
  ).rows;
  const browser = { userId: a.id, sessionId: sessions[0].id },
    runtime = { userId: a.id, sessionId: sessions[1].id };
  const r = await startChatgptConnectRequest(browser);
  assert.ok(
    (await pendingChatgptConnectRequests(runtime)).some((x) => x.id === r.id),
  );
  await claimChatgptConnectRequest(runtime, r.id);
  await assert.rejects(
    readChatgptConnectRequest(runtime, r.id),
    (e: any) => e.statusCode === 404,
  );
  await assert.rejects(
    finishChatgptConnectRequest(browser, r.id, null),
    (e: any) => e.statusCode === 404,
  );
  await finishChatgptConnectRequest(runtime, r.id, null);
  assert.equal(
    (await readChatgptConnectRequest(browser, r.id)).state,
    "failed",
  );
  const stale = await startChatgptConnectRequest(browser);
  await pool.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
    [browser.sessionId],
  );
  await assert.rejects(
    claimChatgptConnectRequest(runtime, stale.id),
    (e: any) => e.statusCode === 401,
  );
});
