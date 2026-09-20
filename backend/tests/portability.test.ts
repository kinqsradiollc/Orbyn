import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { parseCsv } = await import("../src/modules/organize/portability.js");

const app = await buildApp();
let token = "";
const auth = () => ({ authorization: `Bearer ${token}` });
const call = (method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: auth(),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

before(async () => {
  await migrate();
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `port-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "P",
    },
  });
  token = reg.json().token;
});
after(async () => {
  await app.close();
  await pool.end();
});

test("the CSV parser handles quotes, commas and newlines", () => {
  const rows = parseCsv(
    'title,notes\n"Call, Sam","line one\nline two"\nBuy milk,',
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Call, Sam");
  assert.equal(rows[0].notes, "line one\nline two");
  assert.equal(rows[1].title, "Buy milk");
});

test("a dry-run CSV import counts without writing", async () => {
  const csv =
    "title,priority,list,tags,due\nWrite memo,high,Work,writing;urgent,2026-03-02\nCall plumber,,Home,,";
  const preview = await call("POST", "/me/import", {
    format: "csv",
    data: csv,
    dry_run: true,
  });
  assert.equal(preview.statusCode, 200, preview.body);
  const p = preview.json();
  assert.equal(p.created, 2);
  assert.equal(p.lists_added, 2, "Work and Home would be made");
  assert.equal(p.tags_added, 2, "writing and urgent would be made");
  // Nothing was actually written.
  assert.equal((await call("GET", "/items")).json().length, 0);
});

test("importing CSV creates the items, lists and tags", async () => {
  const csv =
    "title,priority,list,tags,due\nWrite memo,high,Work,writing;urgent,2026-03-02\nCall plumber,,Home,,";
  const done = await call("POST", "/me/import", {
    format: "csv",
    data: csv,
    dry_run: false,
  });
  assert.equal(done.json().created, 2, done.body);

  const items = (await call("GET", "/items")).json();
  assert.equal(items.length, 2);
  const memo = items.find((i: { title: string }) => i.title === "Write memo");
  assert.equal(memo.priority, "high");
  assert.ok(memo.due_at, "the due date came through");

  const lists = (await call("GET", "/lists")).json();
  assert.ok(lists.some((l: { name: string }) => l.name === "Work"));
  // A second import reuses the same lists rather than duplicating them.
  const again = await call("POST", "/me/import", {
    format: "csv",
    data: "title,list\nAnother,Work",
    dry_run: false,
  });
  assert.equal(again.json().lists_added, 0, "Work already exists");
});

test("export then import round-trips the items", async () => {
  const archive = (await call("GET", "/me/export")).json();
  assert.equal(archive.version, 1);
  assert.ok(archive.items.length >= 2);
  assert.ok(archive.lists.some((l: { name: string }) => l.name === "Work"));

  // Import the same archive as a fresh user: same items, lists and tags.
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `port2-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "P2",
    },
  });
  const token2 = reg.json().token;
  const r = await app.inject({
    method: "POST",
    url: "/me/import",
    headers: { authorization: `Bearer ${token2}` },
    payload: { format: "orbyn", data: JSON.stringify(archive), dry_run: false },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().created, archive.items.length);
  const items2 = (
    await app.inject({
      url: "/items",
      headers: { authorization: `Bearer ${token2}` },
    })
  ).json();
  assert.equal(items2.length, archive.items.length);
});
