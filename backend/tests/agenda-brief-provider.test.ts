import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { Day } from "../src/modules/docs/agenda.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { briefFor } = await import("../src/modules/ai/agenda-brief.js");
const owners: string[] = [];
const bodies: any[] = [];
let hook: (() => Promise<void>) | undefined;
let original: { provider_id: string | null; model: string };
let providerId: string;
const provider = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    void (async () => {
      bodies.push(JSON.parse(raw));
      await hook?.();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content:
                  "You have a quiet day with time available for your priorities.",
              },
            },
          ],
        }),
      );
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
});
before(async () => {
  await migrate();
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  original = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai','Agenda fixture',$1) RETURNING id",
      [`http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='fixture-model' WHERE id",
    [providerId],
  );
});
after(async () => {
  await pool.query("UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id", [
    original.provider_id,
    original.model,
  ]);
  await pool.query("DELETE FROM ai_providers WHERE id=$1", [providerId]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await pool.end();
});
const day: Day = {
  tz: "UTC",
  items: [],
  calendar: [],
  setAside: [],
  comingEvents: [],
  freeMinutes: 60,
  freeStretches: [],
  priorities: [],
  keptOut: new Set(),
  aiPriorities: [],
  study: null,
};
async function person() {
  const id = randomUUID();
  owners.push(id);
  await pool.query(
    "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Agenda fixture','fixture',true)",
    [id, `${id}@fixture.invalid`],
  );
  return id;
}
test("default Agenda briefing sends a bounded request for its current owner", async () => {
  const owner = await person();
  const before = bodies.length;
  assert.match((await briefFor(day, new Date(), owner))!, /quiet day/);
  assert.equal(bodies.length, before + 1);
  assert.equal(bodies.at(-1).max_completion_tokens, 512);
});
test("selected ChatGPT Agenda never silently dispatches to the managed provider", async () => {
  const owner = await person();
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider) VALUES($1,'chatgpt')",
    [owner],
  );
  const before = bodies.length;
  assert.equal(await briefFor(day, new Date(), owner), null);
  assert.equal(bodies.length, before);
});
test("disabled or missing Agenda owner cannot transmit facts", async () => {
  const owner = await person();
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [owner]);
  const before = bodies.length;
  assert.equal(await briefFor(day, new Date(), owner), null);
  assert.equal(await briefFor(day, new Date(), randomUUID()), null);
  assert.equal(bodies.length, before);
});
test("provider choice changes during Agenda completion discard generated output", async () => {
  const owner = await person();
  hook = async () => {
    await pool.query(
      "INSERT INTO user_ai_provider_choice(user_id,primary_provider) VALUES($1,'chatgpt')",
      [owner],
    );
  };
  try {
    assert.equal(await briefFor(day, new Date(), owner), null);
  } finally {
    hook = undefined;
  }
});

test("Agenda dispatch rereads owned AI facts rather than trusting a caller's supplied day", async () => {
  const owner = await person();
  const now = new Date("2026-10-05T09:00:00Z");
  await pool.query(
    "INSERT INTO items(user_id,title,kind,due_at) VALUES($1,'Actual owned task','task',$2)",
    [owner, now],
  );
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name,assistant_off) VALUES($1,'Excluded project',true) RETURNING id",
      [owner],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO items(user_id,title,project_id,kind,due_at) VALUES($1,'Excluded project task',$2,'task',$3)",
    [owner, project, now],
  );
  const before = bodies.length;
  assert.match(
    (await briefFor(
      { ...day, aiPriorities: ["Untrusted supplied priority"] },
      now,
      owner,
    ))!,
    /quiet day/,
  );
  assert.equal(bodies.length, before + 1);
  const request = JSON.stringify(bodies.at(-1));
  assert.ok(request.includes("Actual owned task"));
  assert.ok(!request.includes("Untrusted supplied priority"));
  assert.ok(!request.includes("Excluded project task"));
});

test("Changed Agenda source revision rejects generated text after the provider responds", async () => {
  const owner = await person();
  const now = new Date("2026-10-05T09:00:00Z");
  const id = (
    await pool.query(
      "INSERT INTO items(user_id,title,kind,due_at) VALUES($1,'Current task','task',$2) RETURNING id",
      [owner, now],
    )
  ).rows[0].id;
  const before = bodies.length;
  hook = async () => {
    await pool.query("UPDATE items SET version=version+1 WHERE id=$1", [id]);
  };
  try {
    assert.equal(await briefFor(day, now, owner), null);
    assert.equal(bodies.length, before + 1);
  } finally {
    hook = undefined;
  }
});
