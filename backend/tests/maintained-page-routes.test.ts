import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
await migrate();
const { buildApp } = await import("../src/app.js");
const app = await buildApp();
const users: { id: string; token: string }[] = [];
const teams: string[] = [];
let address = 1;
const call = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  payload?: any,
  who = 0,
  remoteAddress?: string,
) =>
  app.inject({
    method,
    url: path,
    remoteAddress:
      remoteAddress ??
      `10.216.${Math.floor(address / 250)}.${(address++ % 250) + 1}`,
    headers: who >= 0 ? { authorization: `Bearer ${users[who].token}` } : {},
    ...(payload === undefined ? {} : { payload }),
  });
before(async () => {
  for (let i = 0; i < 2; i++) {
    const result = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: `10.216.99.${i + 1}`,
      payload: {
        email: `page-route-${randomUUID()}@orbyn.test`,
        password: "long-test-password",
        name: "Page owner",
      },
    });
    assert.equal(result.statusCode, 201, result.body);
    users.push({ id: result.json().user.id, token: result.json().token });
  }
});
after(async () => {
  await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    users.map((u) => u.id),
  ]);
  await app.close();
  await pool.end();
});
async function page(team: string | null = null) {
  return (
    await pool.query(
      `INSERT INTO docs(user_id,team_id,title,content) VALUES($1,$2,'Managed page',$3::jsonb) RETURNING id,version`,
      [
        users[0].id,
        team,
        JSON.stringify([
          { id: "human", type: "paragraph", text: "Keep this human block." },
          { id: "summary", type: "paragraph", text: "Selected summary." },
        ]),
      ],
    )
  ).rows[0];
}
const input = (version: number) => ({
  block_ids: ["summary"],
  expected_doc_version: version,
  instruction: "Refresh the summary.",
  rrule: "FREQ=DAILY",
  timezone: "UTC",
  next_run_at: "2026-10-05T09:00:00Z",
});
const path = (doc: string, binding?: string) =>
  `/docs/${doc}/maintenance${binding ? "/" + binding : ""}`;

test("page maintenance routes enforce auth, owner privacy, validation and rate limits", async () => {
  const doc = await page();
  for (const method of ["GET", "POST", "PUT", "DELETE"] as const) {
    const url = path(
      doc.id,
      method === "PUT" || method === "DELETE" ? randomUUID() : undefined,
    );
    assert.equal(
      (await call(method, url, method === "GET" ? undefined : {}, -1))
        .statusCode,
      401,
    );
  }
  assert.equal((await call("GET", path(doc.id), undefined, 1)).statusCode, 404);
  assert.equal(
    (await call("POST", path(doc.id), input(doc.version), 1)).statusCode,
    404,
  );
  assert.equal((await call("POST", path(doc.id), {})).statusCode, 422);
  assert.equal(
    (
      await call("POST", path(doc.id), {
        ...input(doc.version),
        owner_id: users[1].id,
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call("POST", path(doc.id), {
        ...input(doc.version),
        timezone: "Invalid/Zone",
      })
    ).statusCode,
    422,
  );
  const malformed = await app.inject({
    method: "POST",
    url: path(doc.id),
    remoteAddress: "10.216.98.1",
    headers: {
      authorization: `Bearer ${users[0].token}`,
      "content-type": "application/json",
    },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  for (let i = 0; i < 30; i++)
    assert.equal(
      (await call("POST", path(doc.id), {}, 0, "10.216.98.2")).statusCode,
      422,
    );
  assert.equal(
    (await call("POST", path(doc.id), {}, 0, "10.216.98.2")).statusCode,
    429,
  );
  const team = randomUUID();
  teams.push(team);
  await pool.query(
    "INSERT INTO teams(id,name,created_by) VALUES($1,'Managed team',$2)",
    [team, users[0].id],
  );
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'viewer')",
    [team, users[1].id],
  );
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
    [team, users[0].id],
  );
  const shared = await page(team);
  assert.equal(
    (await call("POST", path(shared.id), input(shared.version), 1)).statusCode,
    403,
  );
});

test("binding edits use CAS, rebinding is explicit, and removal survives assistant suspension", async () => {
  const doc = await page();
  const made = await call("POST", path(doc.id), input(doc.version));
  assert.equal(made.statusCode, 201, made.body);
  const binding = made.json();
  assert.equal(binding.paused, true);
  assert.deepEqual(binding.snapshot.blocks, [
    { block_id: "summary", position: 1 },
  ]);
  assert.ok(!JSON.stringify(binding).includes("Keep this human"));
  assert.equal((await call("GET", path(doc.id))).json().length, 1);
  assert.equal(
    (
      await call(
        "PUT",
        path(doc.id, binding.id),
        { ...input(doc.version), expected_revision: 1 },
        1,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "DELETE",
        path(doc.id, binding.id),
        { expected_revision: 1 },
        1,
      )
    ).statusCode,
    404,
  );
  const changes = {
    ...input(doc.version),
    expected_revision: 1,
    instruction: "A reviewed new instruction.",
  };
  const raced = await Promise.all([
    call("PUT", path(doc.id, binding.id), changes),
    call("PUT", path(doc.id, binding.id), changes),
  ]);
  assert.deepEqual(raced.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(
    (await call("DELETE", path(doc.id, binding.id), { expected_revision: 1 }))
      .statusCode,
    409,
  );
  await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [doc.id]);
  assert.equal(
    (
      await call("PUT", path(doc.id, binding.id), {
        ...changes,
        expected_revision: 2,
      })
    ).statusCode,
    409,
  );
  const rebound = await call("PUT", path(doc.id, binding.id), {
    ...input(doc.version + 1),
    expected_revision: 2,
  });
  assert.equal(rebound.statusCode, 200, rebound.body);
  assert.equal(rebound.json().snapshot.doc_version, doc.version + 1);
  await pool.query(
    "UPDATE agent_grants SET suspended_at=now() WHERE user_id=$1 AND kind='assistant'",
    [users[0].id],
  );
  assert.equal(
    (
      await call("PUT", path(doc.id, binding.id), {
        ...input(doc.version + 1),
        expected_revision: 3,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call("POST", path(doc.id), input(doc.version + 1))).statusCode,
    403,
  );
  assert.equal((await call("GET", path(doc.id))).statusCode, 200);
  assert.equal(
    (await call("DELETE", path(doc.id, binding.id), { expected_revision: 3 }))
      .statusCode,
    200,
  );
  assert.equal(
    (await call("DELETE", path(doc.id, binding.id), { expected_revision: 3 }))
      .statusCode,
    404,
  );
  await pool.query(
    "UPDATE agent_grants SET suspended_at=NULL WHERE user_id=$1 AND kind='assistant'",
    [users[0].id],
  );
});

test("shared page bindings stay private to their owner and stop when membership is lost", async () => {
  const team = randomUUID();
  teams.push(team);
  await pool.query(
    "INSERT INTO teams(id,name,created_by) VALUES($1,'Private binding team',$2)",
    [team, users[0].id],
  );
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'member')",
    [team, users[1].id],
  );
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
    [team, users[0].id],
  );
  const doc = await page(team);
  const made = await call("POST", path(doc.id), input(doc.version), 1);
  assert.equal(made.statusCode, 201, made.body);
  assert.equal((await call("GET", path(doc.id))).json().length, 0);
  assert.equal(
    (await call("GET", path(doc.id), undefined, 1)).json().length,
    1,
  );
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    team,
    users[1].id,
  ]);
  assert.equal((await call("GET", path(doc.id), undefined, 1)).statusCode, 404);
  assert.equal(
    (
      await call(
        "PUT",
        path(doc.id, made.json().id),
        { ...input(doc.version), expected_revision: 1 },
        1,
      )
    ).statusCode,
    404,
  );
});
