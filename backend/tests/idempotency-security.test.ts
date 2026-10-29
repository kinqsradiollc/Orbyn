import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import "./setup.js";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
const users: string[] = [],
  owners: string[] = [],
  teams: string[] = [];
let accountAddress = 0;
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
    remoteAddress: `10.98.0.${++accountAddress}`,
    payload: {
      email: `idempotency-${randomUUID()}@example.test`,
      password: "synthetic-test-password",
      name: "Idempotency fixture",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const body = response.json();
  users.push(body.user.id);
  const owner = createHash("sha256")
    .update(`Bearer ${body.token}`)
    .digest("hex");
  owners.push(owner);
  return { id: body.user.id as string, token: body.token as string, owner };
}
function send(
  token: string,
  url: string,
  key: string,
  payload: unknown = {},
  method: "POST" | "PUT" | "DELETE" = "POST",
) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
    ...(method === "DELETE" ? {} : { payload: payload as object }),
  });
}

test("keyed credential issuance rejects before creation and cannot cache a secret", async () => {
  const user = await account();
  for (const url of [
    "/me/api-keys",
    "/me/2fa/setup",
    "/me/2fa/enable",
    "/me/webhooks",
    "/me/clip-keys",
    "/me/calendar-feed",
    "/me/agent-keys",
  ]) {
    const key = randomUUID();
    const first = await send(user.token, url, key, { name: "Fixture" });
    assert.equal(first.statusCode, 409, first.body);
    assert.equal(
      (await send(user.token, url, key, { name: "Fixture" })).statusCode,
      409,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM idempotency_keys WHERE owner=$1 AND key=$2",
          [user.owner, key],
        )
      ).rowCount,
      0,
    );
  }
  assert.equal(
    (await pool.query("SELECT 1 FROM api_keys WHERE user_id=$1", [user.id]))
      .rowCount,
    0,
  );
  const arbitrary = await app.inject({
    method: "POST",
    url: "/auth/register",
    headers: {
      authorization: "Bearer arbitrary-fixture-header",
      "idempotency-key": randomUUID(),
    },
    payload: {
      email: `never-created-${randomUUID()}@example.test`,
      password: "synthetic-test-password",
      name: "Never created",
    },
  });
  assert.equal(arbitrary.statusCode, 401, arbitrary.body);
});

test("revoked sessions cannot replay an item receipt; a live exact deletion receipt drains", async () => {
  const user = await account(),
    key = randomUUID();
  const created = await send(user.token, "/items", key, {
    title: "Receipt fixture",
    kind: "task",
  });
  assert.equal(created.statusCode, 201, created.body);
  const again = await send(user.token, "/items", key, {
    title: "Receipt fixture",
    kind: "task",
  });
  assert.equal(again.statusCode, 201, again.body);
  assert.equal(again.body, created.body);
  const item = created.json();
  const deleteKey = randomUUID();
  const remove = () =>
    send(
      user.token,
      `/items/${item.id}?version=${item.version}`,
      deleteKey,
      undefined,
      "DELETE",
    );
  assert.equal((await remove()).statusCode, 204);
  const removedAgain = await remove();
  assert.equal(removedAgain.statusCode, 204, removedAgain.body);
  assert.equal(removedAgain.headers["idempotent-replay"], "true");
  await pool.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
  assert.equal(
    (
      await send(user.token, "/items", key, {
        title: "Receipt fixture",
        kind: "task",
      })
    ).statusCode,
    401,
  );
  assert.equal((await remove()).statusCode, 401);
});

test("legacy receipts retain a non-reexecuting tombstone even with a live credential", async () => {
  const user = await account(),
    key = randomUUID();
  await pool.query(
    "INSERT INTO idempotency_keys(owner,key,method,path,status,body) VALUES($1,$2,'POST','/items',201,$3)",
    [user.owner, key, '{"secret":"synthetic-legacy-credential"}'],
  );
  const row = (
    await pool.query(
      "SELECT status,body,request_hash FROM idempotency_keys WHERE owner=$1 AND key=$2",
      [user.owner, key],
    )
  ).rows[0];
  assert.equal(row.status, 201);
  assert.equal(row.body, null);
  assert.equal(row.request_hash, null);
  const replay = await send(user.token, "/items", key, {
    title: "Must not be made",
    kind: "task",
  });
  assert.equal(replay.statusCode, 409, replay.body);
  assert.equal(
    (await pool.query("SELECT 1 FROM items WHERE user_id=$1", [user.id]))
      .rowCount,
    0,
  );
});

test("migration purges pre-upgrade bodies and fences old and unsupported writers while retaining tombstones", async () => {
  const db = await pool.connect();
  const schema = `receipt_fixture_${randomUUID().replaceAll("-", "")}`;
  try {
    await db.query("BEGIN");
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema}, pg_catalog`);
    await db.query(
      "CREATE TABLE idempotency_keys(owner text,key text,method text,path text,status integer,body text,created_at timestamptz DEFAULT now(),PRIMARY KEY(owner,key))",
    );
    await db.query(
      "INSERT INTO idempotency_keys(owner,key,method,path,status,body) VALUES('fixture','legacy','POST','/me/api-keys',201,'synthetic-pre-upgrade-secret')",
    );
    await db.query(
      await readFile(
        new URL(
          "../migrations/295_idempotency_response_boundary.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const legacy = (
      await db.query(
        "SELECT status,body,request_hash FROM idempotency_keys WHERE key='legacy'",
      )
    ).rows[0];
    assert.deepEqual(legacy, { status: 201, body: null, request_hash: null });
    // Old writer insert and delayed update after the migration cannot repopulate plaintext.
    await db.query(
      "INSERT INTO idempotency_keys(owner,key,method,path,status,body) VALUES('fixture','old-writer','POST','/me/2fa/setup',200,'synthetic-post-upgrade-secret')",
    );
    await db.query(
      "UPDATE idempotency_keys SET body='synthetic-delayed-secret' WHERE key='legacy'",
    );
    assert.equal(
      (await db.query("SELECT 1 FROM idempotency_keys WHERE body IS NOT NULL"))
        .rowCount,
      0,
    );
    // The current writer can keep a supported response, but never a credential response.
    await db.query(
      "INSERT INTO idempotency_keys(owner,key,method,path,status,body,request_hash) VALUES('fixture','current','POST','/items',201,'{\"id\":\"fixture\"}',$1),('fixture','unsupported','POST','/me/api-keys',201,'synthetic-credential',$1)",
      ["a".repeat(64)],
    );
    assert.equal(
      (await db.query("SELECT body FROM idempotency_keys WHERE key='current'"))
        .rows[0].body,
      '{"id":"fixture"}',
    );
    assert.equal(
      (
        await db.query(
          "SELECT body FROM idempotency_keys WHERE key='unsupported'",
        )
      ).rows[0].body,
      null,
    );
    // An older writer can reuse an upgraded row: the route transition clears its marker.
    await db.query(
      "UPDATE idempotency_keys SET path='/me/api-keys',body='synthetic-repurposed-secret' WHERE key='current'",
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT status,body,request_hash FROM idempotency_keys WHERE key='current'",
        )
      ).rows[0],
      { status: 201, body: null, request_hash: null },
    );
    const documentPath = `/docs/${randomUUID()}/content`;
    const originalScope = { user_id: randomUUID(), team_id: randomUUID() };
    await db.query(
      "INSERT INTO idempotency_keys(owner,key,method,path,request_hash) VALUES('fixture','scope','PUT',$1,$2)",
      [documentPath, "b".repeat(64)],
    );
    await db.query(
      "UPDATE idempotency_keys SET original_scope=$1::jsonb WHERE key='scope'",
      [JSON.stringify(originalScope)],
    );
    await db.query(
      "UPDATE idempotency_keys SET original_scope=$1::jsonb WHERE key='scope'",
      [JSON.stringify({ ...originalScope, team_id: randomUUID() })],
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT original_scope FROM idempotency_keys WHERE key='scope'",
        )
      ).rows[0].original_scope,
      originalScope,
    );
    await db.query(
      "UPDATE idempotency_keys SET status=200,body='fixture-document-body' WHERE key='scope'",
    );
    assert.equal(
      (await db.query("SELECT body FROM idempotency_keys WHERE key='scope'"))
        .rows[0].body,
      "fixture-document-body",
    );
    assert.equal(
      (await db.query("SELECT 1 FROM idempotency_keys")).rowCount,
      5,
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("revoked personal keys cannot replay their exact item receipt", async () => {
  const user = await account();
  const issued = await app.inject({
    method: "POST",
    url: "/me/api-keys",
    headers: { authorization: `Bearer ${user.token}` },
    payload: { name: "Receipt fixture key" },
  });
  assert.equal(issued.statusCode, 201, issued.body);
  const credential = issued.json();
  owners.push(
    createHash("sha256").update(`Bearer ${credential.key}`).digest("hex"),
  );
  const key = randomUUID();
  const body = { title: "Personal-key receipt fixture", kind: "task" };
  const first = await send(credential.key, "/items", key, body);
  assert.equal(first.statusCode, 201, first.body);
  const liveReplay = await send(credential.key, "/items", key, body);
  assert.equal(liveReplay.statusCode, 201, liveReplay.body);
  assert.equal(liveReplay.body, first.body);
  const revoked = await app.inject({
    method: "DELETE",
    url: `/me/api-keys/${credential.id}`,
    headers: { authorization: `Bearer ${user.token}` },
  });
  assert.equal(revoked.statusCode, 204, revoked.body);
  const denied = await send(credential.key, "/items", key, body);
  assert.equal(denied.statusCode, 401, denied.body);
  assert.equal(denied.headers["idempotent-replay"], undefined);
  assert.equal(
    (await pool.query("SELECT 1 FROM items WHERE user_id=$1", [user.id]))
      .rowCount,
    1,
  );
});

test("a cached team-item body requires current membership and write permission", async () => {
  const owner = await account(),
    member = await account();
  const team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams(name,created_by) VALUES('Idempotency fixture team',$1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  teams.push(team);
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
    [team, owner.id, member.id],
  );
  const key = randomUUID(),
    body = {
      title: "Private team receipt fixture",
      kind: "task",
      team_id: team,
    };
  const first = await send(member.token, "/items", key, body);
  assert.equal(first.statusCode, 201, first.body);
  const replay = await send(member.token, "/items", key, body);
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal(replay.body, first.body);
  await pool.query(
    "UPDATE team_members SET role='viewer' WHERE team_id=$1 AND user_id=$2",
    [team, member.id],
  );
  assert.equal((await send(member.token, "/items", key, body)).statusCode, 403);
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    team,
    member.id,
  ]);
  const denied = await send(member.token, "/items", key, body);
  assert.equal(denied.statusCode, 404, denied.body);
  assert.equal(denied.headers["idempotent-replay"], undefined);
  assert.equal(
    (await pool.query("SELECT 1 FROM items WHERE user_id=$1", [member.id]))
      .rowCount,
    1,
  );
});

test("project-link creation replays exactly once and loses replay access with team authority", async () => {
  const owner = await account(),
    member = await account();
  const team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams(name,created_by) VALUES('Project-link receipt team',$1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  teams.push(team);
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
    [team, owner.id, member.id],
  );
  const project = (
    await pool.query<{ id: string }>(
      "INSERT INTO projects(name,user_id,team_id) VALUES('Receipt project',$1,$2) RETURNING id",
      [owner.id, team],
    )
  ).rows[0].id;
  const key = randomUUID(),
    body = {
      url: "https://example.test/project-fixture",
      title: "Fixture project link",
    };
  const submit = () =>
    send(member.token, `/projects/${project}/links`, key, body);
  const first = await submit();
  assert.equal(first.statusCode, 201, first.body);
  const replay = await submit();
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal(replay.body, first.body);
  assert.equal(replay.headers["idempotent-replay"], "true");
  await pool.query(
    "UPDATE team_members SET role='viewer' WHERE team_id=$1 AND user_id=$2",
    [team, member.id],
  );
  assert.equal((await submit()).statusCode, 403);
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    team,
    member.id,
  ]);
  const denied = await submit();
  assert.equal(denied.statusCode, 404, denied.body);
  assert.equal(denied.headers["idempotency-outcome"], "unsafe");
  assert.equal(
    (
      await pool.query("SELECT 1 FROM project_links WHERE project_id=$1", [
        project,
      ])
    ).rowCount,
    1,
  );
});

test("structured document receipts keep their locked original scope after a move and revocation", async () => {
  const owner = await account(),
    member = await account();
  const teamIds: string[] = [];
  for (const name of ["Original scope A", "Current scope B"]) {
    const team = (
      await pool.query<{ id: string }>(
        "INSERT INTO teams(name,created_by) VALUES($1,$2) RETURNING id",
        [name, owner.id],
      )
    ).rows[0].id;
    teamIds.push(team);
    teams.push(team);
    await pool.query(
      "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
      [team, owner.id, member.id],
    );
  }
  const made = await app.inject({
    method: "POST",
    url: "/docs",
    headers: { authorization: `Bearer ${member.token}` },
    payload: { title: "Original A document", team_id: teamIds[0] },
  });
  assert.equal(made.statusCode, 201, made.body);
  const doc = made.json(),
    key = randomUUID();
  const body = {
    version: doc.version,
    document: {
      format: 1,
      blocks: [{ type: "paragraph", text: "ORIGINAL_SCOPE_A_PRIVATE_WORDS" }],
    },
  };
  const submit = () =>
    send(member.token, `/docs/${doc.id}/content`, key, body, "PUT");
  const first = await submit();
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(
    first.json().team_id,
    undefined,
    "the reported narrow response omits scope",
  );
  const live = await submit();
  assert.equal(live.statusCode, 200, live.body);
  assert.equal(live.body, first.body);
  const receipt = (
    await pool.query(
      "SELECT original_scope FROM idempotency_keys WHERE owner=$1 AND key=$2",
      [member.owner, key],
    )
  ).rows[0];
  assert.equal(receipt.original_scope.team_id, teamIds[0]);
  const captureKey = randomUUID(),
    captureBody = {
      text: "Capture from original A",
      to: { kind: "page", doc_id: doc.id },
    };
  const captureSubmit = () =>
    send(member.token, "/capture", captureKey, captureBody);
  const captureFirst = await captureSubmit();
  assert.equal(captureFirst.statusCode, 201, captureFirst.body);
  const captureReplay = await captureSubmit();
  assert.equal(captureReplay.statusCode, 201, captureReplay.body);
  assert.equal(captureReplay.body, captureFirst.body);
  await pool.query("UPDATE docs SET team_id=$2 WHERE id=$1", [
    doc.id,
    teamIds[1],
  ]);
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    teamIds[0],
    member.id,
  ]);
  const denied = await submit();
  assert.equal(denied.statusCode, 404, denied.body);
  assert.equal(denied.headers["idempotency-outcome"], "unsafe");
  assert.ok(!denied.body.includes("ORIGINAL_SCOPE_A_PRIVATE_WORDS"));
  const captureDenied = await captureSubmit();
  assert.equal(captureDenied.statusCode, 404, captureDenied.body);
  assert.equal(captureDenied.headers["idempotency-outcome"], "unsafe");
});

test("rolled-back item and document version conflicts are distinguishable and release only unfinished receipts", async () => {
  const user = await account();
  const itemResponse = await app.inject({
    method: "POST",
    url: "/items",
    headers: { authorization: `Bearer ${user.token}` },
    payload: { title: "Current item", kind: "task" },
  });
  assert.equal(itemResponse.statusCode, 201, itemResponse.body);
  const item = itemResponse.json();
  const docResponse = await app.inject({
    method: "POST",
    url: "/docs",
    headers: { authorization: `Bearer ${user.token}` },
    payload: { title: "Current document" },
  });
  assert.equal(docResponse.statusCode, 201, docResponse.body);
  const doc = docResponse.json();
  // Advance the fixtures after the client captured their original versions.
  await pool.query("UPDATE items SET version=version+1 WHERE id=$1", [item.id]);
  await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [doc.id]);
  const cases = [
    {
      route: `/items/${item.id}`,
      body: {
        title: "Must roll back",
        kind: "task",
        version: item.version,
      },
      table: "items",
      id: item.id,
      title: "Current item",
    },
    {
      route: `/docs/${doc.id}`,
      body: { title: "Must roll back", version: doc.version },
      table: "docs",
      id: doc.id,
      title: "Current document",
    },
    {
      route: `/docs/${doc.id}/content`,
      body: {
        version: doc.version,
        document: {
          format: 1,
          blocks: [{ type: "paragraph", text: "Must roll back" }],
        },
      },
      table: "docs",
      id: doc.id,
      title: "Current document",
    },
  ];
  for (const fixture of cases) {
    const key = randomUUID();
    const before = (
      await pool.query(
        `SELECT title,version FROM ${fixture.table} WHERE id=$1`,
        [fixture.id],
      )
    ).rows[0];
    const rejected = await send(
      user.token,
      fixture.route,
      key,
      fixture.body,
      "PUT",
    );
    assert.equal(rejected.statusCode, 409, rejected.body);
    assert.equal(rejected.headers["idempotency-outcome"], "version-conflict");
    assert.deepEqual(
      (
        await pool.query(
          `SELECT title,version FROM ${fixture.table} WHERE id=$1`,
          [fixture.id],
        )
      ).rows[0],
      before,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM idempotency_keys WHERE owner=$1 AND key=$2",
          [user.owner, key],
        )
      ).rowCount,
      0,
    );
  }
  const unsafeKey = randomUUID();
  await pool.query(
    "INSERT INTO idempotency_keys(owner,key,method,path,status,body) VALUES($1,$2,'PUT',$3,409,NULL)",
    [user.owner, unsafeKey, `/items/${item.id}`],
  );
  const unsafe = await send(
    user.token,
    `/items/${item.id}`,
    unsafeKey,
    { title: "Must not run", version: item.version },
    "PUT",
  );
  assert.equal(unsafe.statusCode, 409, unsafe.body);
  assert.equal(unsafe.headers["idempotency-outcome"], "unsafe");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM idempotency_keys WHERE owner=$1 AND key=$2",
        [user.owner, unsafeKey],
      )
    ).rowCount,
    1,
  );
});

test("document origin is captured under its save lock across a B-to-A-to-B interleaving", async () => {
  const owner = await account(),
    member = await account();
  const teamIds: string[] = [];
  for (const name of ["Save origin A", "Before-and-after B"]) {
    const team = (
      await pool.query<{ id: string }>(
        "INSERT INTO teams(name,created_by) VALUES($1,$2) RETURNING id",
        [name, owner.id],
      )
    ).rows[0].id;
    teams.push(team);
    teamIds.push(team);
    await pool.query(
      "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
      [team, owner.id, member.id],
    );
  }
  const created = await app.inject({
    method: "POST",
    url: "/docs",
    headers: { authorization: `Bearer ${member.token}` },
    payload: { title: "Moved document", team_id: teamIds[1] },
  });
  assert.equal(created.statusCode, 201, created.body);
  const doc = created.json(),
    key = randomUUID();
  const body = {
    version: doc.version,
    document: {
      format: 1,
      blocks: [{ type: "paragraph", text: "SAVED_UNDER_A" }],
    },
  };
  const submit = () =>
    send(member.token, `/docs/${doc.id}/content`, key, body, "PUT");
  const suffix = randomUUID().replaceAll("-", ""),
    trigger = `receipt_origin_${suffix}`;
  const lock = parseInt(suffix.slice(0, 7), 16);
  const gate = await pool.connect();
  let pending: ReturnType<typeof submit> | undefined;
  try {
    await pool.query(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='${key}' THEN PERFORM pg_advisory_xact_lock(${lock}); END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON idempotency_keys FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    );
    await gate.query("BEGIN");
    await gate.query("SELECT pg_advisory_xact_lock($1)", [lock]);
    pending = submit();
    // Observe the request waiting at receipt insertion, before the save's row
    // lock. A preHandler sample would see B; the actual save will execute in A.
    const deadline = Date.now() + 5000;
    let waiting = false;
    while (Date.now() < deadline) {
      waiting = !!(
        await pool.query(
          "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND NOT granted",
          [lock],
        )
      ).rowCount;
      if (waiting) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(
      waiting,
      true,
      "request reached the observed receipt-insert barrier",
    );
    await gate.query("UPDATE docs SET team_id=$2 WHERE id=$1", [
      doc.id,
      teamIds[0],
    ]);
    await gate.query("COMMIT");
    const saved = await pending;
    assert.equal(saved.statusCode, 200, saved.body);
    const receipt = (
      await pool.query(
        "SELECT original_scope FROM idempotency_keys WHERE owner=$1 AND key=$2",
        [member.owner, key],
      )
    ).rows[0];
    assert.equal(
      receipt.original_scope.team_id,
      teamIds[0],
      "origin is the locked save's A scope, not pre-insert B",
    );
    await pool.query("UPDATE docs SET team_id=$2 WHERE id=$1", [
      doc.id,
      teamIds[1],
    ]);
    await pool.query(
      "DELETE FROM team_members WHERE team_id=$1 AND user_id=$2",
      [teamIds[0], member.id],
    );
    const denied = await submit();
    assert.equal(denied.statusCode, 404, denied.body);
    assert.equal(denied.headers["idempotency-outcome"], "unsafe");
    assert.ok(!denied.body.includes("SAVED_UNDER_A"));
  } finally {
    await gate.query("ROLLBACK");
    gate.release();
    if (pending) await pending;
    await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON idempotency_keys`);
    await pool.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
  }
});

test("keyed booking replay requires its original team even for a global admin who hosts in the new team", async () => {
  const owner = await account(),
    host = await account();
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [host.id]);
  const teamIds: string[] = [];
  for (const name of ["Booking origin A", "Booking current B"]) {
    const team = (
      await pool.query<{ id: string }>(
        "INSERT INTO teams(name,created_by) VALUES($1,$2) RETURNING id",
        [name, owner.id],
      )
    ).rows[0].id;
    teams.push(team);
    teamIds.push(team);
    // Hosts may view a team's bookings as viewers: original scope uses
    // items:read, which still forbids a system-admin membership override.
    await pool.query(
      "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'viewer')",
      [team, owner.id, host.id],
    );
  }
  const page = (
    await pool.query<{ id: string }>(
      "INSERT INTO booking_pages(owner_id,team_id,slug,title) VALUES($1,$2,$3,'Original private booking page') RETURNING id",
      [owner.id, teamIds[0], `receipt-${randomUUID()}`],
    )
  ).rows[0].id;
  await pool.query("INSERT INTO booking_hosts(page_id,user_id) VALUES($1,$2)", [
    page,
    host.id,
  ]);
  const booking = (
    await pool.query<{ id: string }>(
      "INSERT INTO bookings(page_id,start_at,end_at,name,email,timezone) VALUES($1,now()+interval '1 day',now()+interval '1 day 30 minutes','ORIGINAL_PRIVATE_GUEST','fixture@example.test','UTC') RETURNING id",
      [page],
    )
  ).rows[0].id;
  const key = randomUUID(),
    body = { host_note: "Original private note" };
  const submit = () =>
    send(host.token, `/bookings/${booking}/note`, key, body, "PUT");
  const first = await submit();
  assert.equal(first.statusCode, 200, first.body);
  const savedBooking = (
    await pool.query("SELECT host_note, updated_at FROM bookings WHERE id=$1", [
      booking,
    ])
  ).rows[0];
  const replay = await submit();
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.body, first.body);
  assert.equal(replay.headers["idempotent-replay"], "true");
  const original = (
    await pool.query(
      "SELECT original_scope FROM idempotency_keys WHERE owner=$1 AND key=$2",
      [host.owner, key],
    )
  ).rows[0].original_scope;
  assert.equal(original.team_id, teamIds[0]);
  assert.equal(original.permission, "items:read");
  await pool.query("UPDATE booking_pages SET team_id=$2 WHERE id=$1", [
    page,
    teamIds[1],
  ]);
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    teamIds[0],
    host.id,
  ]);
  // The new team still authorizes this co-host; only original-team authority
  // was removed, and global admin must not substitute for that membership.
  const current = await app.inject({
    method: "GET",
    url: `/bookings/${booking}`,
    headers: { authorization: `Bearer ${host.token}` },
  });
  assert.equal(current.statusCode, 200, current.body);
  const denied = await submit();
  assert.equal(denied.statusCode, 404, denied.body);
  assert.equal(denied.headers["idempotency-outcome"], "unsafe");
  assert.ok(!denied.body.includes("ORIGINAL_PRIVATE_GUEST"));
  assert.deepEqual(
    (
      await pool.query(
        "SELECT host_note, updated_at FROM bookings WHERE id=$1",
        [booking],
      )
    ).rows[0],
    savedBooking,
  );
});
