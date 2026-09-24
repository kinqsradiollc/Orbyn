import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Links saved before webhooks and subscribed calendars went https-only
 * (071_https_links.sql): calendars move to https:// and are read again, http
 * webhooks are turned off with a note saying what to do, and local
 * development addresses are left alone. Running it again changes nothing.
 */

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const MIGRATION = await readFile(
  new URL("../migrations/071_https_links.sql", import.meta.url),
  "utf8",
);

let userId = "";

before(async () => {
  await migrate();
  userId = (
    await pool.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, 'Links', 'x') RETURNING id",
      [`links-${randomUUID()}@example.com`],
    )
  ).rows[0].id;
});

after(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
});

test("http links move to https or are turned off with a note; local ones stay", async () => {
  const calendar = async (url: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO calendar_subscriptions (user_id, url, name, etag, last_fetched_at, last_error)
         VALUES ($1, $2, 'Classes', '"v1"', now(), 'Calendar links start with https://') RETURNING id`,
        [userId, url],
      )
    ).rows[0].id;
  const webhook = async (url: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO webhooks (user_id, url, events, secret_encrypted)
         VALUES ($1, $2, '{item.created}', 'x') RETURNING id`,
        [userId, url],
      )
    ).rows[0].id;
  const school = await calendar("http://calendar.example.edu/classes.ics");
  const secure = await calendar("https://calendar.example.com/work.ics");
  const localCal = await calendar("http://localhost:8080/dev.ics");
  const zapier = await webhook("http://hooks.example.com/orbyn");
  const safe = await webhook("https://hooks.example.com/orbyn");
  const localHook = await webhook("http://192.168.1.20:3000/hook");
  const dockerHook = await webhook("http://host.docker.internal/hook");

  for (let run = 0; run < 2; run++) await pool.query(MIGRATION);

  const cal = async (id: string) =>
    (
      await pool.query(
        "SELECT url, etag, last_fetched_at, last_error FROM calendar_subscriptions WHERE id = $1",
        [id],
      )
    ).rows[0];
  const moved = await cal(school);
  assert.equal(moved.url, "https://calendar.example.edu/classes.ics");
  assert.equal(moved.etag, null);
  assert.equal(moved.last_fetched_at, null, "read again on the next pass");
  assert.equal(moved.last_error, null);
  assert.equal(
    (await cal(secure)).url,
    "https://calendar.example.com/work.ics",
  );
  assert.notEqual((await cal(secure)).last_fetched_at, null, "left alone");
  assert.equal((await cal(localCal)).url, "http://localhost:8080/dev.ics");

  const hook = async (id: string) =>
    (
      await pool.query(
        "SELECT url, active, last_error FROM webhooks WHERE id = $1",
        [id],
      )
    ).rows[0];
  const off = await hook(zapier);
  assert.equal(off.active, false);
  assert.equal(off.url, "http://hooks.example.com/orbyn");
  assert.match(off.last_error, /https:\/\/ addresses.*add it again/);
  assert.equal((await hook(safe)).active, true);
  assert.equal((await hook(safe)).last_error, null);
  assert.equal((await hook(localHook)).active, true);
  assert.equal((await hook(dockerHook)).active, true);
});
