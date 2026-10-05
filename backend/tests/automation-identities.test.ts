import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { helpers, trapNetwork } from "./mcp-helpers.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApiService } = await import("../src/app.js");
const { readAutomationIdentity } =
  await import("../src/modules/agent-context/identities.js");
const app = await buildApiService();
const h = helpers(app);
const network = await trapNetwork();
const users: string[] = [];
before(() => migrate());
after(async () => {
  assert.deepEqual(network.calls, []);
  network.restore();
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.end();
});
async function person() {
  const user = await h.register("lane-identity");
  users.push(user.id);
  return user;
}
const path = (lane: string) => `/me/assistant/identity/${lane}`;
test("each runtime keeps its own settings, revision, appearance and owner", async () => {
  const user = await person();
  const other = await person();
  const original = (await h.call(user.token, "GET", path("background"))).json();
  assert.equal(original.revision, 0);
  assert.equal(original.name, "Background");
  const input = {
    name: "Day researcher",
    persona: "Concise with citations",
    expected_revision: 0,
  };
  const saved = await h.call(user.token, "PUT", path("background"), input);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().revision, 1);
  assert.equal(
    (await h.call(user.token, "GET", path("overnight"))).json().name,
    "Overnight",
  );
  assert.equal(
    (await h.call(other.token, "GET", path("background"))).json().revision,
    0,
  );
  const stale = await h.call(user.token, "PUT", path("background"), {
    ...input,
    name: "Stale",
  });
  assert.equal(stale.statusCode, 409, stale.body);
  const night = await h.call(user.token, "PUT", path("overnight"), {
    ...input,
    name: "Night researcher",
  });
  assert.equal(night.statusCode, 200, night.body);
  const profiles = (
    await h.call(user.token, "GET", "/me/assistant/profiles")
  ).json().profiles;
  assert.equal(profiles[0].identity.name, "Day researcher");
  assert.equal(profiles[1].identity.name, "Night researcher");
  const race = await Promise.all(
    ["First", "Second"].map((name) =>
      h.call(user.token, "PUT", path("background"), {
        ...input,
        name,
        expected_revision: 1,
      }),
    ),
  );
  assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(
    (await readAutomationIdentity(pool, user.id, "background")).revision,
    2,
  );
  assert.equal(
    (await readAutomationIdentity(pool, user.id, "overnight")).revision,
    1,
  );
});
test("identity routes shield unauthenticated/API-key writes, invalid lanes, malformed bodies and rate limits", async () => {
  assert.equal((await h.call(null, "GET", path("background"))).statusCode, 401);
  const user = await person();
  const key = (
    await h.call(user.token, "POST", "/me/api-keys", { name: "Identity test" })
  ).json().key;
  assert.equal(
    (
      await h.call(key, "PUT", path("background"), {
        name: "Key",
        expected_revision: 0,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await h.call(user.token, "GET", path("interactive"))).statusCode,
    422,
  );
  assert.equal(
    (
      await h.call(user.token, "PUT", path("background"), {
        name: "Missing revision",
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await h.call(user.token, "PUT", path("background"), {
        name: "Credentials",
        expected_revision: 0,
        access_token: "reject",
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (await h.call(user.token, "GET", path("background") + "?owner_id=other"))
      .statusCode,
    400,
  );
  let limited = false;
  for (let i = 0; i < 70; i++) {
    const r = await h.call(user.token, "PUT", path("background"), {
      name: "Day",
      expected_revision: i,
    });
    if (r.statusCode === 429) {
      limited = true;
      break;
    }
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.headers["cache-control"], "private, no-store");
  }
  assert.equal(limited, true);
});

test("upgrade preserves the legacy character independently and deleting its owner cascades", async () => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const schema = `identity_upgrade_${randomUUID().replaceAll("-", "")}`;
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    await db.query("CREATE TABLE users(id uuid PRIMARY KEY)");
    await db.query(
      "CREATE TABLE agent_settings(user_id uuid PRIMARY KEY,name text,persona text,character jsonb,named_at timestamptz,updated_at timestamptz)",
    );
    const owner = randomUUID();
    await db.query("INSERT INTO users VALUES($1)", [owner]);
    await db.query(
      "INSERT INTO agent_settings VALUES($1,'Existing companion','Direct',$2,now(),now())",
      [owner, { preset: "orbyn" }],
    );
    await db.query(
      await readFile(
        new URL(
          "../migrations/224_automation_agent_identities.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const rows = (
      await db.query(
        "SELECT lane,name,persona,character,revision FROM automation_agent_identities ORDER BY lane",
      )
    ).rows;
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => r.lane),
      ["background", "overnight"],
    );
    for (const row of rows) {
      assert.equal(row.name, "Existing companion");
      assert.equal(row.persona, "Direct");
      assert.deepEqual(row.character, { preset: "orbyn" });
      assert.equal(row.revision, 1);
    }
    await db.query(
      "UPDATE automation_agent_identities SET name='Night' WHERE lane='overnight'",
    );
    assert.equal(
      (
        await db.query(
          "SELECT name FROM automation_agent_identities WHERE lane='background'",
        )
      ).rows[0].name,
      "Existing companion",
    );
    await db.query("DELETE FROM users WHERE id=$1", [owner]);
    assert.equal(
      (await db.query("SELECT * FROM automation_agent_identities")).rowCount,
      0,
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
