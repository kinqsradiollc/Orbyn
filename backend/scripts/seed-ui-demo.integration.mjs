/** Explicit isolated qualification only. Creates a new owned test database;
 * never uses or cleans the shared test/demo database. Requires --env-file. */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { parse } from "dotenv";
import pg from "pg";
import argon2 from "argon2";
import {
  seedOptions,
  seedTarget,
  FIXTURE,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  fixtureId,
} from "./seed-ui-demo-support.mjs";
const root = new URL("../../", import.meta.url).pathname;
const options = seedOptions(process.argv.slice(2), root);
const config = parse(readFileSync(options.envFile));
const source = seedTarget(config.DATABASE_URL, options),
  adminUrl = new URL(source.connectionString);
adminUrl.pathname = "/postgres";
const database = `orbyn_ui_seed_qual_${process.pid}_test`,
  ownership = `${FIXTURE}:qualification:${randomUUID()}`;
const admin = new pg.Client({
  connectionString: adminUrl.toString(),
  options: "",
  connectionTimeoutMillis: 10000,
});
const temp = mkdtempSync(join(tmpdir(), "orbyn-seed-qualification-"));
let created = false,
  c;
const run = (args = []) => {
  const value = spawnSync(
    process.execPath,
    [
      "backend/scripts/seed-ui-demo.mjs",
      "--env-file",
      join(temp, "seed.env"),
      "--date=2026-10-30",
      ...args,
    ],
    {
      cwd: root,
      env: { ...process.env, NODE_ENV: "test" },
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return { status: value.status, stdout: value.stdout, stderr: value.stderr };
};
const success = (value) => {
  assert.equal(value.status, 0, value.stderr);
  return JSON.parse(value.stdout);
};
const snapshot = async (owner) => ({
  user: (
    await c.query("SELECT to_jsonb(u) AS value FROM users u WHERE id=$1", [
      owner,
    ])
  ).rows[0].value,
  tasks: (
    await c.query(
      "SELECT to_jsonb(i) AS value FROM items i WHERE user_id=$1 ORDER BY id",
      [owner],
    )
  ).rows.map((row) => row.value),
  projects: (
    await c.query(
      "SELECT to_jsonb(p) AS value FROM projects p WHERE user_id=$1 ORDER BY id",
      [owner],
    )
  ).rows.map((row) => row.value),
  docs: (
    await c.query(
      "SELECT to_jsonb(d) AS value FROM docs d WHERE user_id=$1 ORDER BY id",
      [owner],
    )
  ).rows.map((row) => row.value),
});
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  created = true;
  await admin.query(`COMMENT ON DATABASE ${database} IS '${ownership}'`);
  await admin.query(`ALTER DATABASE ${database} SET orbyn.environment='test'`);
  const url = new URL(source.connectionString);
  url.pathname = `/${database}`;
  writeFileSync(
    join(temp, "seed.env"),
    `DATABASE_URL=${url}\nNODE_ENV=test\n`,
    { mode: 0o600 },
  );
  const migration = spawnSync(
    process.execPath,
    ["--import", "tsx", "backend/src/migrate.ts"],
    {
      cwd: root,
      env: {
        ...process.env,
        ...config,
        DATABASE_URL: url.toString(),
        DATABASE_READ_URL: "",
        DATABASE_LISTEN_URL: "",
        NODE_ENV: "test",
      },
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  assert.equal(migration.status, 0, migration.stderr);
  assert.notEqual(
    run().status,
    0,
    "An unmarked disposable database must be refused",
  );
  await admin.query(
    `ALTER DATABASE ${database} SET orbyn.ui_fixture='development-demo'`,
  );
  c = new pg.Client({ connectionString: url.toString(), options: "" });
  await c.connect();
  const initial = success(run());
  assert.equal(initial.mode, "dry-run");
  assert.equal(
    (await c.query("SELECT count(*)::int AS n FROM users")).rows[0].n,
    0,
    "Dry run creates no accounts",
  );
  const collision = randomUUID();
  await c.query(
    "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,'admin@orbyn.local','Unrelated human','untouched','member')",
    [collision],
  );
  assert.notEqual(
    run(["--apply"]).status,
    0,
    "An unrelated email collision cannot be promoted",
  );
  assert.equal(
    (await c.query("SELECT count(*)::int AS n FROM users")).rows[0].n,
    1,
    "Collision is atomic",
  );
  assert.equal(
    (await c.query("SELECT role FROM users WHERE id=$1", [collision])).rows[0]
      .role,
    "member",
  );
  await c.query("DELETE FROM users WHERE id=$1", [collision]);
  const existing = fixtureId("qualification-existing-member");
  await c.query(
    "INSERT INTO users(id,email,name,password_hash,role,analytics_opt_out,first_run_at) VALUES($1,'demo@orbyn.local','Human edited Alex','preserve-password','member',false,now())",
    [existing],
  );
  for (let i = 0; i < 3; i++)
    await c.query("INSERT INTO projects(id,user_id,name) VALUES($1,$2,$3)", [
      fixtureId(`prior-project-${i}`),
      existing,
      `Human project ${i}`,
    ]);
  for (let i = 0; i < 12; i++)
    await c.query(
      "INSERT INTO items(id,user_id,title,reminder_minutes) VALUES($1,$2,$3,NULL)",
      [fixtureId(`prior-task-${i}`), existing, `Human task ${i}`],
    );
  for (let i = 0; i < 6; i++)
    await c.query(
      "INSERT INTO docs(id,user_id,title,kind,content) VALUES($1,$2,$3,'note','[]'::jsonb)",
      [fixtureId(`prior-doc-${i}`), existing, `Human note ${i}`],
    );
  const before = await snapshot(existing),
    args = ["--apply", "--existing-member-id", existing];
  const applied = success(run(args));
  assert.ok(applied.inserted.items > 50);
  const after = await snapshot(existing);
  assert.deepEqual(
    after.user,
    before.user,
    "Existing member credentials, role, profile and consent are preserved",
  );
  for (const key of ["tasks", "projects", "docs"])
    for (const row of before[key])
      assert.deepEqual(
        after[key].find((candidate) => candidate.id === row.id),
        row,
        "Existing content is preserved",
      );
  for (const account of DEMO_ACCOUNTS) {
    const row = (await c.query("SELECT * FROM users WHERE id=$1", [account.id]))
      .rows[0];
    assert.equal(row.role, account.role);
    assert.equal(await argon2.verify(row.password_hash, DEMO_PASSWORD), true);
    assert.equal(row.first_run_at === null, account.onboarding);
  }
  for (const key of ["empty", "onboarding"]) {
    const account = DEMO_ACCOUNTS.find((a) => a.key === key);
    assert.equal(
      (
        await c.query("SELECT count(*)::int AS n FROM items WHERE user_id=$1", [
          account.id,
        ])
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await c.query("SELECT count(*)::int AS n FROM docs WHERE user_id=$1", [
          account.id,
        ])
      ).rows[0].n,
      0,
    );
  }
  const member = DEMO_ACCOUNTS.find((account) => account.key === "member");
  const task = fixtureId(`member:${member.id}:task-0`);
  await c.query(
    "UPDATE items SET title='Human edited seeded task',notes='Keep my authored words',version=version+1 WHERE id=$1",
    [task],
  );
  const edited = (
    await c.query("SELECT to_jsonb(i) AS value FROM items i WHERE id=$1", [
      task,
    ])
  ).rows[0].value;
  const again = success(run(args));
  assert.ok(
    Object.values(again.inserted).every((count) => count === 0),
    "Rerun inserts no duplicate rows",
  );
  assert.deepEqual(
    (
      await c.query("SELECT to_jsonb(i) AS value FROM items i WHERE id=$1", [
        task,
      ])
    ).rows[0].value,
    edited,
    "Rerun preserves edits",
  );
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int AS n FROM ai_jobs WHERE state NOT IN ('done','failed') OR run_state IS NOT NULL OR apply_result IS NOT NULL OR terminal_evidence IS NOT NULL",
      )
    ).rows[0].n,
    0,
    "History has no active jobs, resumable state or fabricated effect/qualification receipts",
  );
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int AS n FROM agent_routines WHERE NOT paused",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await c.query("SELECT count(*)::int AS n FROM booking_pages WHERE active"))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await c.query("SELECT count(*)::int AS n FROM agent_grants")).rows[0].n,
    0,
    "Seed creates no execution grants",
  );
  console.log(
    JSON.stringify(
      {
        fixture: FIXTURE,
        database,
        checks: [
          "unmarked refused",
          "dry-run zero writes",
          "foreign email refused without promotion",
          "self-contained accounts and public password",
          "existing member 3 projects/12 tasks/6 notes unchanged",
          "idempotent rerun",
          "human edits preserved",
          "terminal-only history; no grants/runnable routines/active bookings",
        ],
        inserted: applied.inserted,
        result: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  await c?.end();
  if (created) {
    const row = (
      await admin.query(
        "SELECT shobj_description(oid,'pg_database') AS owner FROM pg_database WHERE datname=$1",
        [database],
      )
    ).rows[0];
    if (row?.owner !== ownership)
      throw new Error("Disposable DB ownership changed; refusing cleanup");
    await admin.query(`DROP DATABASE ${database}`);
  }
  await admin.end();
  rmSync(temp, { recursive: true, force: true });
}
