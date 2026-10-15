import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import "./setup.js";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
const users: string[] = [],
  teams: string[] = [],
  owners: string[] = [];
let loseKey = "";
app.addHook("onSend", async (request, reply, payload) => {
  if (
    request.headers["idempotency-key"] === loseKey &&
    reply.statusCode === 200
  ) {
    loseKey = "";
    throw new Error("Synthetic delivery failure after import commit");
  }
  return payload;
});
before(() => migrate());
after(async () => {
  try {
    if (teams.length)
      await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
    if (users.length)
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    if (owners.length)
      await pool.query(
        "DELETE FROM idempotency_keys WHERE owner=ANY($1::text[])",
        [owners],
      );
  } finally {
    await app.close();
    await pool.end();
  }
});
async function account() {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `receipts-${randomUUID()}@example.test`,
      password: "synthetic-receipt-password",
      name: "Receipt fixture",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const value = response.json();
  users.push(value.user.id);
  owners.push(
    createHash("sha256").update(`Bearer ${value.token}`).digest("hex"),
  );
  return { id: value.user.id as string, token: value.token as string };
}
const fixtures = [
  {
    route: "/me/import",
    table: "items",
    body: (name: string) => ({
      format: "csv",
      data: `title\n${name}`,
      dry_run: false,
    }),
  },
  {
    route: "/imports/pages",
    table: "docs",
    body: (name: string) => ({
      format: "markdown",
      file_name: `${name}.md`,
      data: Buffer.from(`# ${name}\n\nReceipt fixture`).toString("base64"),
      dry_run: false,
    }),
  },
] as const;
for (const fixture of fixtures) {
  const send = (token: string, key: string, body: object) =>
    app.inject({
      method: "POST",
      url: fixture.route,
      headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
      payload: body,
    });
  const count = async (id: string) =>
    (
      await pool.query(
        `SELECT count(*)::int n FROM ${fixture.table} WHERE user_id=$1`,
        [id],
      )
    ).rows[0].n as number;
  test(`${fixture.route}: exact replay and concurrent duplicates create once; changed input rejects`, async () => {
    const user = await account(),
      key = randomUUID(),
      body = fixture.body(`Once-${randomUUID()}`);
    const responses = await Promise.all([
      send(user.token, key, body),
      send(user.token, key, body),
    ]);
    assert.ok(responses.some((r) => r.statusCode === 200));
    for (const response of responses)
      assert.ok([200, 409].includes(response.statusCode), response.body);
    const first = responses.find((r) => r.statusCode === 200)!;
    const replay = await send(user.token, key, body);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.headers["idempotent-replay"], "true");
    assert.deepEqual(replay.json(), first.json());
    assert.equal(await count(user.id), 1);
    assert.equal(
      (await send(user.token, key, fixture.body("Changed"))).statusCode,
      422,
    );
    assert.equal(await count(user.id), 1);
  });
  test(`${fixture.route}: failed receipt rolls back content and allows the same-key retry`, async () => {
    const user = await account(),
      key = randomUUID(),
      body = fixture.body(`Rollback-${randomUUID()}`);
    const suffix = randomUUID().replaceAll("-", "");
    const trigger = `receipt_fixture_${suffix}`;
    // Fail at the final write inside the transaction, after all imported content.
    await pool.query(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='${key}' AND NEW.status=200 THEN RAISE EXCEPTION 'synthetic receipt failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE UPDATE ON idempotency_keys FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    );
    try {
      const failed = await send(user.token, key, body);
      assert.equal(failed.statusCode, 500, failed.body);
      assert.equal(await count(user.id), 0);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM idempotency_keys WHERE key=$1",
            [key],
          )
        ).rows[0].n,
        0,
      );
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON idempotency_keys`);
      await pool.query(`DROP FUNCTION ${trigger}()`);
    }
    assert.equal((await send(user.token, key, body)).statusCode, 200);
    assert.equal(await count(user.id), 1);
  });
  test(`${fixture.route}: committed receipt survives response failure and deleted authentication cannot replay`, async () => {
    const user = await account(),
      key = randomUUID(),
      body = fixture.body(`Delivery-${randomUUID()}`);
    loseKey = key;
    assert.equal((await send(user.token, key, body)).statusCode, 500);
    assert.equal(await count(user.id), 1);
    const replay = await send(user.token, key, body);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.headers["idempotent-replay"], "true");
    assert.equal(await count(user.id), 1);
    await pool.query("DELETE FROM users WHERE id=$1", [user.id]);
    const denied = await send(user.token, key, body);
    assert.equal(denied.statusCode, 401, denied.body);
    assert.ok(!denied.headers["idempotent-replay"]);
  });
}
test("page receipt rechecks team membership before returning cached private output", async () => {
  const owner = await account(),
    member = await account();
  const team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams(name,created_by) VALUES('Receipt team',$1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  teams.push(team);
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
    [team, owner.id, member.id],
  );
  const key = randomUUID(),
    body = { ...fixtures[1].body("Team private import"), team_id: team };
  const send = () =>
    app.inject({
      method: "POST",
      url: "/imports/pages",
      headers: {
        authorization: `Bearer ${member.token}`,
        "idempotency-key": key,
      },
      payload: body,
    });
  assert.equal((await send()).statusCode, 200);
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    team,
    member.id,
  ]);
  const denied = await send();
  assert.equal(denied.statusCode, 404, denied.body);
  assert.ok(!denied.headers["idempotent-replay"]);
});
