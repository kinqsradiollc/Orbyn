import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

// Inbound mail must be configured before the app (and its env) load.
process.env.MAIL_INBOUND_SECRET = "inbound-secret";
process.env.MAIL_INBOUND_DOMAIN = "tasks.orbyn.test";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
let token = "";
let email = "";
const auth = () => ({ authorization: `Bearer ${token}` });
const call = (
  method: "GET" | "POST" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: auth(),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const inbound = (payload: object, secret = "inbound-secret") =>
  app.inject({
    method: "POST",
    url: "/inbound/mail",
    headers: { "x-inbound-secret": secret },
    payload,
  });
const items = async () => (await call("GET", "/items")).json();

before(async () => {
  await migrate();
  email = `inbox-${randomUUID()}@example.com`;
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "a-long-test-password", name: "I" },
  });
  token = reg.json().token;
});
after(async () => {
  await app.close();
  await pool.end();
});

let address = "";

test("email-to-task is off until you turn it on, then has an address", async () => {
  const off = (await call("GET", "/me/inbox")).json();
  assert.equal(off.address, null);
  assert.equal(off.configured, true, "the server has inbound mail set up");

  const on = (await call("POST", "/me/inbox/rotate")).json();
  assert.match(on.address, /^task-[a-z0-9_-]+@tasks\.orbyn\.test$/);
  address = on.address;
});

test("the endpoint refuses a wrong or missing secret", async () => {
  assert.equal((await inbound({ to: address }, "wrong")).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/inbound/mail",
        payload: { to: address },
      })
    ).statusCode,
    401,
  );
});

test("a mail from the account holder becomes a task, subject parsed", async () => {
  const before = (await items()).length;
  const r = await inbound({
    to: address,
    from: `Me <${email}>`,
    subject: "Call the plumber #errand",
    text: "Ask about the leak.",
  });
  assert.equal(r.statusCode, 202, r.body);
  const list = await items();
  assert.equal(list.length, before + 1);
  const task = list.find((i: { title: string }) =>
    i.title.includes("Call the plumber"),
  );
  assert.ok(task, "the task was created from the subject");
  assert.match(task.notes, /leak/, "the body became the notes");
});

test("mail to an unknown address or from a stranger is ignored, not filed", async () => {
  const before = (await items()).length;
  // Unknown local part.
  assert.equal(
    (
      await inbound({
        to: "task-nope@tasks.orbyn.test",
        from: email,
        subject: "Ghost",
      })
    ).statusCode,
    202,
  );
  // A stranger sending to the real address.
  assert.equal(
    (
      await inbound({
        to: address,
        from: "stranger@elsewhere.test",
        subject: "Spam",
      })
    ).statusCode,
    202,
  );
  assert.equal((await items()).length, before, "nothing was filed");
});

test("turning it off clears the address", async () => {
  assert.equal((await call("DELETE", "/me/inbox")).statusCode, 204);
  assert.equal((await call("GET", "/me/inbox")).json().address, null);
  // Mail to the old address no longer files anything.
  const before = (await items()).length;
  await inbound({ to: address, from: email, subject: "After off" });
  assert.equal((await items()).length, before);
});
