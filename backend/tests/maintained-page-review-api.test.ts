import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
await migrate();
const { buildApp } = await import("../src/app.js");
const app = await buildApp();
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const {
  queueMaintainedPageRun,
  claimMaintainedPageRun,
  stageMaintainedPageRun,
  applyMaintainedPageRun,
  waitMaintainedPageRun,
} = await import("../src/modules/docs/maintenance-runs.js");
const users: { id: string; token: string }[] = [];
let address = 1;
const request = (
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  who = 0,
  ip?: string,
) =>
  app.inject({
    method,
    url,
    remoteAddress:
      ip ?? `10.237.${Math.floor(address / 250)}.${(address++ % 250) + 1}`,
    headers: who >= 0 ? { authorization: `Bearer ${users[who].token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
before(async () => {
  for (let i = 0; i < 2; i++) {
    const r = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: `10.237.99.${i + 1}`,
      payload: {
        email: `review-${randomUUID()}@orbyn.test`,
        name: "Review owner",
        password: "long-test-password",
      },
    });
    assert.equal(r.statusCode, 201, r.body);
    users.push({ id: r.json().user.id, token: r.json().token });
  }
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    users.map((u) => u.id),
  ]);
  await app.close();
  await pool.end();
});
async function waiting() {
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title,content) VALUES($1,'Review page',$2::jsonb) RETURNING id,version",
      [
        users[0].id,
        JSON.stringify([
          { id: "human", type: "paragraph", text: "Private human block" },
          { id: "summary", type: "paragraph", text: "Selected material" },
        ]),
      ],
    )
  ).rows[0];
  const made = await request("POST", `/docs/${doc.id}/maintenance`, {
    block_ids: ["summary"],
    expected_doc_version: 1,
    instruction: "Update the selected summary.",
    rrule: "FREQ=DAILY",
    timezone: "UTC",
    next_run_at: new Date(Date.now() - 1000).toISOString(),
    paused: false,
  });
  assert.equal(made.statusCode, 201, made.body);
  const user = (
    await pool.query("SELECT * FROM users WHERE id=$1", [users[0].id])
  ).rows[0];
  const p = {
    ...(await assistantPrincipal(user)),
    assistant_lane: "background" as const,
  };
  const run = await transaction((db) =>
    queueMaintainedPageRun(db, user, p, made.json().id, new Date(), {
      kind: "background",
    }),
  );
  assert.ok(run);
  const claimed = await transaction((db) =>
    claimMaintainedPageRun(db, "background", new Date(), run.id),
  );
  assert.ok(claimed?.lease_token);
  await pool.query("UPDATE agent_grants SET trust='ask' WHERE id=$1", [
    p.grant_id,
  ]);
  await transaction((db) =>
    stageMaintainedPageRun(
      db,
      run.id,
      claimed!.lease_token!,
      {
        expected_revision: 1,
        replacements: [
          { id: "summary", type: "paragraph", text: "A saved suggestion." },
        ],
      },
      100,
    ),
  );
  let held: unknown;
  try {
    await transaction((db) =>
      applyMaintainedPageRun(db, run.id, claimed!.lease_token!),
    );
  } catch (e) {
    held = e;
  }
  const waitingId = await transaction((db) =>
    waitMaintainedPageRun(db, run.id, claimed!.lease_token!, held),
  );
  return { doc, run, waitingId, grantId: p.grant_id };
}

test("review reads are owned, omit leases and do not record grant activity; source changes hold previews", async () => {
  const f = await waiting();
  const url = `/docs/${f.doc.id}/maintenance/runs`;
  assert.equal((await request("GET", url, undefined, -1)).statusCode, 401);
  assert.equal((await request("GET", url, undefined, 1)).statusCode, 404);
  const before = (
    await pool.query("SELECT last_used_at FROM agent_grants WHERE id=$1", [
      f.grantId,
    ])
  ).rows[0].last_used_at;
  const r = await request("GET", url);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.json()[0].can_review, true);
  assert.equal(r.json()[0].waiting_id, f.waitingId);
  for (const secret of [
    "lease_token",
    "lease_expires_at",
    "password_hash",
    "Private human block",
    "apiKey",
  ])
    assert.ok(!r.body.includes(secret));
  assert.equal(
    (
      await pool.query("SELECT last_used_at FROM agent_grants WHERE id=$1", [
        f.grantId,
      ])
    ).rows[0].last_used_at.getTime(),
    before.getTime(),
  );
  await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [f.doc.id]);
  const stale = await request("GET", url);
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.json()[0].can_review, false);
  assert.equal(stale.json()[0].replacements, null);
  assert.equal(stale.json()[0].waiting_id, null);
});

test("decision requests reject stale cards, cross-account/wrong-page and malformed bodies and enforce rate limits", async () => {
  const f = await waiting();
  const url = `/docs/${f.doc.id}/maintenance/runs/${f.run.id}/decision`;
  assert.equal((await request("POST", url, {}, -1)).statusCode, 401);
  assert.equal(
    (await request("POST", url, { waiting_id: f.waitingId, approved: true }, 1))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await request("POST", url.replace(f.doc.id, randomUUID()), {
        waiting_id: f.waitingId,
        approved: true,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await request("POST", url, { waiting_id: randomUUID(), approved: true }))
      .statusCode,
    409,
  );
  assert.equal(
    (await request("POST", url, { approved: true })).statusCode,
    422,
  );
  assert.equal(
    (await request("POST", url, { waiting_id: f.waitingId, approved: "true" }))
      .statusCode,
    422,
  );
  const malformed = await app.inject({
    method: "POST",
    url,
    remoteAddress: "10.237.98.1",
    headers: {
      authorization: `Bearer ${users[0].token}`,
      "content-type": "application/json",
    },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  for (let i = 0; i < 30; i++)
    assert.equal(
      (await request("POST", url, {}, 0, "10.237.98.2")).statusCode,
      422,
    );
  assert.equal(
    (await request("POST", url, {}, 0, "10.237.98.2")).statusCode,
    429,
  );
  await pool.query("UPDATE agent_grants SET suspended_at=now() WHERE id=$1", [
    f.grantId,
  ]);
  assert.equal(
    (await request("POST", url, { waiting_id: f.waitingId, approved: true }))
      .statusCode,
    403,
  );
  await pool.query("UPDATE agent_grants SET suspended_at=NULL WHERE id=$1", [
    f.grantId,
  ]);
  const approved = await request("POST", url, {
    waiting_id: f.waitingId,
    approved: true,
  });
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().state, "done");
  assert.equal(
    (await request("POST", url, { waiting_id: f.waitingId, approved: true }))
      .statusCode,
    409,
  );
  const doc = (
    await pool.query("SELECT content,version FROM docs WHERE id=$1", [f.doc.id])
  ).rows[0];
  assert.equal(doc.version, 2);
  assert.equal(doc.content[0].text, "Private human block");
  assert.equal(doc.content[1].text, "A saved suggestion.");
});
