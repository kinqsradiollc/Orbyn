import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Webhook delivery end to end against a local receiver. Private addresses
 * are allowed in this test process only; production refuses them.
 */
process.env.ALLOW_PRIVATE_WEBHOOKS = "true";
process.env.SMTP_HOST = "";

const received: { headers: IncomingHttpHeaders; body: string }[] = [];
let answer = 200;
const receiver = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    received.push({ headers: req.headers, body });
    res.writeHead(answer);
    res.end("ok");
  });
});
await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
const hookUrl = `http://127.0.0.1:${(receiver.address() as { port: number }).port}/orbyn`;

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { deliverWebhookOne } = await import("../src/worker/webhooks.js");
const app = await buildApp();

let caller = 0;
const address = () => `10.3.${Math.floor(++caller / 250)}.${caller % 250}`;
async function call(
  token: string | null,
  method: "GET" | "POST",
  url: string,
  payload?: object,
) {
  const r = await app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
  return { status: r.statusCode, body: r.json() };
}

before(async () => {
  await migrate();
});

after(async () => {
  await app.close();
  await pool.end();
  receiver.close();
});

test("webhooks are signed, delivered once, and retried with backoff", async () => {
  const reg = await call(null, "POST", "/auth/register", {
    email: `hooks-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name: "Hooks",
  });
  const token = reg.body.token as string;
  const hook = await call(token, "POST", "/me/webhooks", {
    url: hookUrl,
    events: ["item.created"],
  });
  assert.equal(hook.status, 201);
  // Only this test's deliveries go out: others queued by earlier test files are dropped.
  await pool.query(
    "UPDATE webhook_deliveries SET state = 'failed' WHERE state = 'pending' AND webhook_id <> $1",
    [hook.body.id],
  );

  await call(token, "POST", "/items", { title: "Signed delivery" });
  while (await deliverWebhookOne()) {
    // Drain the queue.
  }
  assert.equal(received.length, 1);
  const [delivery] = received;
  assert.equal(delivery.headers["x-orbyn-event"], "item.created");
  const timestamp = String(delivery.headers["x-orbyn-timestamp"]);
  const expected = createHmac("sha256", hook.body.secret)
    .update(`${timestamp}.${delivery.body}`)
    .digest("hex");
  assert.equal(delivery.headers["x-orbyn-signature"], `sha256=${expected}`);
  const payload = JSON.parse(delivery.body);
  assert.equal(payload.event, "item.created");
  assert.equal(payload.data.title, "Signed delivery");
  const sent = (
    await pool.query<{ state: string }>(
      "SELECT state FROM webhook_deliveries WHERE webhook_id = $1",
      [hook.body.id],
    )
  ).rows;
  assert.deepEqual(
    sent.map((r) => r.state),
    ["sent"],
  );

  // A failing endpoint is retried later, and the webhook shows why.
  answer = 500;
  await call(token, "POST", "/items", { title: "Failed delivery" });
  assert.equal(await deliverWebhookOne(), true);
  const retry = (
    await pool.query<{ state: string; attempts: number; later: boolean }>(
      `SELECT state, attempts, available_at > now() AS later FROM webhook_deliveries
       WHERE webhook_id = $1 AND state <> 'sent'`,
      [hook.body.id],
    )
  ).rows[0];
  assert.deepEqual(retry, { state: "pending", attempts: 1, later: true });
  const listed = await call(token, "GET", "/me/webhooks");
  assert.equal(listed.body[0].last_status, 500);
  assert.match(listed.body[0].last_error, /500/);

  // "Send test" posts a ping straight away.
  answer = 204;
  const ping = await call(token, "POST", `/me/webhooks/${hook.body.id}/test`);
  assert.deepEqual(ping.body, { ok: true, status: 204, error: null });
  assert.equal(received.at(-1)!.headers["x-orbyn-event"], "ping");
});
