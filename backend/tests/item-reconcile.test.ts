import "./setup.js";
import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import pg from "pg";
// A distinct pool at the same disposable database lets primary routing be
// checked without contacting another database or configuring a replica.
process.env.DATABASE_READ_URL = process.env.TEST_DATABASE_URL;
const { pool, readPool, readTransaction, insideReadTransaction } =
  await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");
const { digest } = await import("../src/lib/auth.js");
const app = await buildApp();
const people: string[] = [],
  teams: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("External network disabled in reconciliation fixtures");
};
before(() => migrate());
afterEach(async () => {
  await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [
    teams.splice(0),
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    people.splice(0),
  ]);
});
after(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
  await readPool.end();
  await pool.end();
});
async function user() {
  const id = randomUUID(),
    token = randomUUID();
  people.push(id);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Reconciliation fixture',true)",
    [id, `reconcile-${id}@example.invalid`],
  );
  await pool.query("INSERT INTO sessions(user_id,token_hash) VALUES($1,$2)", [
    id,
    digest(token),
  ]);
  return { id, token };
}
const reconcile = (token?: string) =>
  app.inject({
    method: "GET",
    url: "/items/reconcile",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
async function seed(owner: string, n: number, team: string | null = null) {
  return (
    await pool.query(
      `INSERT INTO items(user_id,title,status,team_id,created_at)
    SELECT $1,'Synthetic task '||n,'done',$3,timestamptz '2026-01-01'+n*interval '1 second'
    FROM generate_series(1,$2::int) n RETURNING id`,
      [owner, n, team],
    )
  ).rows.map((r) => r.id as string);
}
const queryText = (arg: unknown) =>
  typeof arg === "string" ? arg : ((arg as { text?: string })?.text ?? "");
const isPage = (text: string) =>
  text.includes("ORDER BY i.created_at DESC, i.id LIMIT 500 OFFSET $2");

test("static reconciliation route requires a valid session and returns the complete visible set", async () => {
  assert.equal((await reconcile()).statusCode, 401);
  assert.equal((await reconcile("invalid")).statusCode, 401);
  const owner = await user(),
    member = await user(),
    other = await user();
  const team = (
    await pool.query(
      "INSERT INTO teams(name,created_by) VALUES('Reconciliation team',$1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  teams.push(team);
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
    [team, owner.id, member.id],
  );
  const own = await seed(member.id, 2),
    shared = await seed(owner.id, 2, team);
  await seed(other.id, 2);
  const response = await reconcile(member.token);
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual(
    body.items.map((i: any) => i.id).sort(),
    [...own, ...shared].sort(),
  );
  assert.ok(Number.isFinite(Date.parse(body.updated_after)));
  assert.ok(body.items.every((i: any) => i.score === null));
});

test("membership gains and losses reconcile historical items without item writes", async () => {
  const owner = await user(),
    member = await user();
  const team = (
    await pool.query(
      "INSERT INTO teams(name,created_by) VALUES('Historical access',$1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  teams.push(team);
  const shared = await seed(owner.id, 1, team),
    own = await seed(member.id, 1);
  assert.deepEqual(
    (await reconcile(member.token)).json().items.map((i: any) => i.id),
    own,
  );
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'member')",
    [team, member.id],
  );
  assert.deepEqual(
    (await reconcile(member.token))
      .json()
      .items.map((i: any) => i.id)
      .sort(),
    [...shared, ...own].sort(),
  );
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    team,
    member.id,
  ]);
  assert.deepEqual(
    (await reconcile(member.token)).json().items.map((i: any) => i.id),
    own,
  );
});

test("multiple SQL pages keep ordinary newest order and one snapshot despite intervening changes", async () => {
  const owner = await user();
  const ids = await seed(owner.id, 1001);
  const expected = (
    await pool.query(
      "SELECT id,title FROM items WHERE user_id=$1 ORDER BY created_at DESC,id",
      [owner.id],
    )
  ).rows;
  const removed = expected[600].id,
    edited = expected[700].id;
  let pages = 0,
    transactionId: string | null = null;
  const prototype = pg.Client.prototype as any,
    original = prototype.query;
  prototype.query = function (...args: any[]) {
    const text = queryText(args[0]),
      snapshot = insideReadTransaction.getStore();
    const result = original.apply(this, args);
    if (!snapshot || !isPage(text)) return result;
    return result.then(async (value: any) => {
      pages++;
      const state = (
        await original.call(
          this,
          "SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS readonly,txid_current_snapshot()::text AS snapshot",
        )
      ).rows[0];
      assert.equal(state.isolation, "repeatable read");
      assert.equal(state.readonly, "on");
      if (transactionId === null) transactionId = state.snapshot;
      else assert.equal(state.snapshot, transactionId);
      assert.ok(value.rows.length <= 500);
      if (pages === 1)
        await insideReadTransaction.exit(async () => {
          await pool.query("DELETE FROM items WHERE id=$1", [removed]);
          await pool.query(
            "UPDATE items SET title='Concurrent new title' WHERE id=$1",
            [edited],
          );
          await pool.query(
            "INSERT INTO items(user_id,title,status) VALUES($1,'Concurrent new row','done')",
            [owner.id],
          );
        });
      return value;
    });
  };
  let response;
  try {
    response = await reconcile(owner.token);
  } finally {
    prototype.query = original;
  }
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(pages, 3);
  assert.equal(body.items.length, ids.length);
  assert.deepEqual(
    body.items.map((i: any) => ({ id: i.id, title: i.title })),
    expected,
  );
  const latest = (await reconcile(owner.token)).json();
  assert.equal(
    latest.items.some((i: any) => i.id === removed),
    false,
  );
  assert.equal(
    latest.items.find((i: any) => i.id === edited).title,
    "Concurrent new title",
  );
  assert.equal(
    latest.items.some((i: any) => i.title === "Concurrent new row"),
    true,
  );
});

test("reconciliation uses primary read-only transaction and captures its watermark before item pages", async () => {
  const owner = await user();
  await seed(owner.id, 1);
  await pool.query("UPDATE items SET status='todo' WHERE user_id=$1", [
    owner.id,
  ]);
  const primary = pool as any,
    originalPrimaryQuery = primary.query,
    originalPrimaryConnect = primary.connect;
  primary.connect = function (...args: any[]) {
    assert.equal(
      insideReadTransaction.getStore(),
      undefined,
      "A reconciliation helper escaped its transaction through pool.connect",
    );
    return originalPrimaryConnect.apply(this, args);
  };
  primary.query = function (...args: any[]) {
    assert.equal(
      insideReadTransaction.getStore(),
      undefined,
      "A reconciliation helper escaped its transaction through pool.query",
    );
    return originalPrimaryQuery.apply(this, args);
  };
  assert.notEqual(readPool, pool);
  const replica = readPool as any,
    originalConnect = replica.connect,
    originalQuery = replica.query;
  replica.connect = () => {
    throw new Error("Reconciliation must not connect to replica");
  };
  replica.query = () => {
    throw new Error("Reconciliation must not query replica");
  };
  const prototype = pg.Client.prototype as any,
    original = prototype.query;
  let watermark: string | null = null,
    pageAt: Date | null = null;
  prototype.query = function (...args: any[]) {
    const text = queryText(args[0]);
    const result = original.apply(this, args);
    if (!insideReadTransaction.getStore()) return result;
    if (text === "SELECT transaction_timestamp() AS at")
      return result.then((value: any) => {
        watermark = value.rows[0].at.toISOString();
        return value;
      });
    if (isPage(text)) {
      assert.ok(watermark);
      pageAt = new Date();
    }
    return result;
  };
  let response;
  try {
    response = await reconcile(owner.token);
  } finally {
    prototype.query = original;
    replica.connect = originalConnect;
    replica.query = originalQuery;
    primary.query = originalPrimaryQuery;
    primary.connect = originalPrimaryConnect;
  }
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().updated_after, watermark);
  assert.ok(pageAt && Date.parse(watermark!) <= (pageAt as Date).getTime());
  await assert.rejects(
    readTransaction(
      (db) =>
        db.query(
          "INSERT INTO items(user_id,title) VALUES($1,'Forbidden read write')",
          [owner.id],
        ),
      { primary: true, isolation: "repeatable read" },
    ),
    { code: "25006" },
  );
});

test("score fields use ordinary list semantics for open tasks, events and closed tasks", async () => {
  const owner = await user();
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name,deadline) VALUES($1,'Scoring fixture',now()+interval '2 days') RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO items(user_id,title,kind,status,priority,project_id,estimate_minutes,due_at,end_at)
    VALUES($1,'Open task','task','todo','high',$2,25,now()+interval '3 days',NULL),
      ($1,'Closed task','task','done','medium',NULL,NULL,NULL,NULL),
      ($1,'Event','event','todo','medium',NULL,NULL,now()+interval '1 day',now()+interval '1 day 1 hour')`,
    [owner.id, project],
  );
  const ordinary = await app.inject({
    method: "GET",
    url: "/items",
    headers: { authorization: `Bearer ${owner.token}` },
  });
  const response = await reconcile(owner.token);
  assert.equal(ordinary.statusCode, 200, ordinary.body);
  assert.equal(response.statusCode, 200, response.body);
  const scores = new Map(ordinary.json().map((i: any) => [i.id, i.score]));
  for (const item of response.json().items)
    assert.equal(item.score, scores.get(item.id));
  assert.equal(
    typeof response.json().items.find((i: any) => i.title === "Open task")
      .score,
    "number",
  );
});

for (const size of [100, 1000, 5000])
  test(`synthetic reconciliation baseline with ${size} items`, async () => {
    const owner = await user();
    await seed(owner.id, size);
    const memoryBefore = process.memoryUsage();
    const started = performance.now();
    const response = await reconcile(owner.token);
    const elapsed = performance.now() - started;
    const memoryAfter = process.memoryUsage();
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().items.length, size);
    console.info(
      "Synthetic reconciliation baseline:",
      JSON.stringify({
        items: size,
        http_requests: 1,
        response_bytes: Buffer.byteLength(response.body),
        elapsed_ms: Math.round(elapsed * 100) / 100,
        heap_before_bytes: memoryBefore.heapUsed,
        heap_after_bytes: memoryAfter.heapUsed,
        rss_after_bytes: memoryAfter.rss,
      }),
    );
  });
