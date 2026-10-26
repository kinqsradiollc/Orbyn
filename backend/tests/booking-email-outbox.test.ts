import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import nodemailer from "nodemailer";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { decryptSecret } = await import("../src/lib/secrets.js");
const { queueBookingEmail, deliverBookingEmailOne } =
  await import("../src/worker/booking-email.js");
let pageId: string;
before(async () => {
  await migrate();
  // Worker-global fixtures require an empty queue in this disposable test DB.
  await pool.query("DELETE FROM booking_email_outbox");
  const user = (
    await pool.query(
      "INSERT INTO users(email,password_hash,name) VALUES($1,'fixture','Mail host') RETURNING id",
      [`mail-${randomUUID()}@example.com`],
    )
  ).rows[0];
  pageId = (
    await pool.query(
      "INSERT INTO booking_pages(owner_id,slug,title) VALUES($1,$2,'Outbox fixture') RETURNING id",
      [user.id, `mail-${randomUUID()}`],
    )
  ).rows[0].id;
});
after(async () => {
  await pool.end();
});
async function booking() {
  return (
    await pool.query(
      "INSERT INTO bookings(page_id,start_at,end_at,name,email,timezone) VALUES($1,now()+interval '1 day',now()+interval '1 day 30 minutes','Guest','guest@example.invalid','UTC') RETURNING id",
      [pageId],
    )
  ).rows[0].id as string;
}
const queue = (id: string, title = "Confirmed") =>
  transaction((db) =>
    queueBookingEmail(db, id, {
      destination: "guest@example.invalid",
      title,
      body: "Private manage link: https://example.invalid/manage/synthetic-secret",
    }),
  );
const row = async (id: string) =>
  (await pool.query("SELECT * FROM booking_email_outbox WHERE id=$1", [id]))
    .rows[0];
const enabled = async () => true;

test("booking mail is encrypted and rolls back atomically without sending", async () => {
  const id = await booking();
  await assert.rejects(
    transaction(async (db) => {
      await queueBookingEmail(db, id, {
        destination: "guest@example.invalid",
        title: "Rollback",
        body: "private",
      });
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM booking_email_outbox WHERE booking_id=$1",
        [id],
      )
    ).rows[0].n,
    0,
  );
  const mail = await queue(id);
  const saved = await row(mail);
  assert.equal(saved.state, "pending");
  assert.equal(JSON.stringify(saved).includes("synthetic-secret"), false);
  assert.equal(
    JSON.parse(await decryptSecret(saved.payload_encrypted)).title,
    "Confirmed",
  );
});
test("committed email sends outside a transaction, with stable identity and durable receipt", async () => {
  const id = await queue(await booking());
  let calls = 0;
  while ((await row(id)).state === "pending") {
    assert.equal(
      await deliverBookingEmailOne({
        enabled,
        send: async (mail) => {
          calls++;
          assert.ok(mail.id);
          const saved = await row(mail.id);
          assert.equal(saved.state, "sending");
          // Another connection can update the booking while SMTP is waiting.
          await transaction(async (db) => {
            await db.query(
              "SELECT id FROM bookings WHERE id=$1 FOR UPDATE NOWAIT",
              [saved.booking_id],
            );
          });
          assert.match(mail.body, /As of .*UTC/);
        },
      }),
      true,
    );
  }
  assert.ok(calls >= 1);
  assert.equal((await row(id)).state, "sent");
});
test("new booking revision supersedes unsent old mail", async () => {
  const id = await booking();
  const old = await queue(id);
  const current = await queue(id, "Cancelled");
  assert.equal((await row(old)).state, "superseded");
  const titles: string[] = [];
  while ((await row(current)).state === "pending")
    await deliverBookingEmailOne({
      enabled,
      send: async (mail) => {
        titles.push(mail.title);
      },
    });
  assert.equal(titles.includes("Confirmed"), false);
  assert.ok(titles.includes("Cancelled"));
});
test("pre-send outage retries but ambiguous SMTP outcome is held without resend", async () => {
  const safe = await queue(await booking());
  while ((await row(safe)).attempts === 0)
    await deliverBookingEmailOne({
      enabled,
      send: async () => {
        throw Object.assign(new Error("synthetic connection failure"), {
          code: "EDNS",
          command: "CONN",
        });
      },
    });
  assert.equal((await row(safe)).state, "pending");
  const uncertain = await queue(await booking());
  while ((await row(uncertain)).state === "pending")
    await deliverBookingEmailOne({
      enabled,
      send: async () => {
        throw Object.assign(new Error("synthetic lost DATA response"), {
          code: "ETIMEDOUT",
          command: "DATA",
        });
      },
    });
  assert.equal((await row(uncertain)).state, "uncertain");
  let resent = false;
  await deliverBookingEmailOne({
    enabled,
    send: async (mail) => {
      if (mail.id === uncertain) resent = true;
    },
  });
  assert.equal(resent, false);
});
test("crashed dispatch is uncertain; crashed preparation is reclaimable", async () => {
  const sending = await queue(await booking());
  await pool.query(
    "UPDATE booking_email_outbox SET state='sending',lease_until=now()-interval '1 minute' WHERE id=$1",
    [sending],
  );
  const preparing = await queue(await booking());
  await pool.query(
    "UPDATE booking_email_outbox SET state='preparing',lease_until=now()-interval '1 minute' WHERE id=$1",
    [preparing],
  );
  let sendingCalls = 0;
  while ((await row(preparing)).state !== "sent")
    await deliverBookingEmailOne({
      enabled,
      send: async (mail) => {
        if (mail.id === sending) sendingCalls++;
      },
    });
  assert.equal((await row(sending)).state, "uncertain");
  assert.equal(sendingCalls, 0);
});

test("installed SMTP transport losing its DATA acknowledgement is never auto-resubmitted", async () => {
  let accepted = 0;
  const server = createServer((socket) => {
    socket.write("220 local fixture\r\n");
    let buffer = "",
      data = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") {
            accepted++;
            socket.destroy();
            return;
          }
        } else if (/^DATA$/i.test(line)) {
          data = true;
          socket.write("354 send data\r\n");
        } else socket.write("250 fixture\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const transport = nodemailer.createTransport({
    host: "127.0.0.1",
    port: address.port,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 1000,
    socketTimeout: 1000,
  });
  const id = await queue(await booking());
  try {
    while ((await row(id)).state === "pending")
      await deliverBookingEmailOne({
        enabled,
        send: async (mail) => {
          try {
            await transport.sendMail({
              from: "fixture@example.invalid",
              to: mail.destination,
              subject: mail.title,
              text: mail.body,
              messageId: `<${mail.id}@orbyn.local>`,
            });
          } catch (error) {
            assert.equal((error as any).code, "ECONNECTION");
            assert.equal((error as any).command, "CONN");
            throw error;
          }
        },
      });
    assert.equal((await row(id)).state, "uncertain");
    const before = accepted;
    await deliverBookingEmailOne({
      enabled,
      send: async (mail) => {
        assert.notEqual(mail.id, id);
      },
    });
    assert.equal(accepted, before);
    assert.ok(accepted >= 1);
  } finally {
    transport.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("expired verification intents are suppressed and disabled SMTP preserves pending work", async () => {
  const expired = await transaction((db) =>
    queueBookingEmail(db, randomUUID(), {
      destination: "fixture@example.invalid",
      title: "Missing booking",
      body: "fixture",
    }),
  ).catch(() => null);
  assert.equal(expired, null);
  const id = await transaction(async (db) =>
    queueBookingEmail(
      db,
      await booking(),
      {
        destination: "fixture@example.invalid",
        title: "Verify",
        body: "verification link",
      },
      { expiresAt: new Date(Date.now() - 1000) },
    ),
  );
  let sent = false;
  await deliverBookingEmailOne({
    enabled,
    send: async (mail) => {
      if (mail.id === id) sent = true;
    },
  });
  assert.equal(sent, false);
  assert.equal((await row(id)).state, "superseded");
  const paused = await queue(await booking());
  await deliverBookingEmailOne({
    enabled: async () => false,
    send: async () => {
      throw new Error("must not send");
    },
  });
  assert.equal((await row(paused)).state, "pending");
  assert.equal((await row(paused)).attempts, 0);
});

test("a newer revision during preparation fences the obsolete sender", async () => {
  const id = await booking(),
    old = await queue(id);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let oldSent = false;
  const sending = deliverBookingEmailOne({
    enabled: async () => {
      started();
      await gate;
      return true;
    },
    send: async (mail) => {
      if (mail.id === old) oldSent = true;
    },
  });
  await ready;
  const latest = await queue(id, "Rescheduled");
  release();
  await sending;
  assert.equal(oldSent, false);
  assert.equal((await row(old)).state, "superseded");
  assert.equal((await row(latest)).state, "pending");
  await deliverBookingEmailOne({ enabled, send: async () => {} });
});

test("verification expiring during preparation cannot cross the dispatch boundary", async () => {
  const id = await queue(await booking());
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let sent = false;
  const sending = deliverBookingEmailOne({
    enabled: async () => {
      started();
      await gate;
      return true;
    },
    send: async (mail) => {
      if (mail.id === id) sent = true;
    },
  });
  await ready;
  await pool.query(
    "UPDATE booking_email_outbox SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [id],
  );
  release();
  await sending;
  assert.equal(sent, false);
  assert.equal((await row(id)).state, "superseded");
});

test("two worker connections cannot dispatch the same intent concurrently", async () => {
  const id = await queue(await booking());
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const first = deliverBookingEmailOne({
    enabled,
    send: async (mail) => {
      assert.equal(mail.id, id);
      calls++;
      started();
      await gate;
    },
  });
  await ready;
  await deliverBookingEmailOne({
    enabled,
    send: async (mail) => {
      assert.notEqual(mail.id, id);
    },
  });
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal((await row(id)).state, "sent");
});

test("delivery pause leaves durable work unchanged", async () => {
  const { env } = await import("../src/config/env.js");
  const id = await queue(await booking()),
    before = await row(id);
  const previous = env.BOOKING_EMAIL_DELIVERY_ENABLED;
  env.BOOKING_EMAIL_DELIVERY_ENABLED = "false";
  try {
    assert.equal(
      await deliverBookingEmailOne({
        enabled,
        send: async () => {
          throw new Error("paused sender must not run");
        },
      }),
      false,
    );
    assert.deepEqual(await row(id), before);
  } finally {
    env.BOOKING_EMAIL_DELIVERY_ENABLED = previous;
  }
  await deliverBookingEmailOne({ enabled, send: async () => {} });
});

test("terminal retention excludes pending work and expiry supports an index range", async () => {
  const { SWEEP_RULES } = await import("../src/lib/sweep.js");
  const rule = SWEEP_RULES.find((rule) => rule.key === "booking_email_outbox");
  assert.ok(rule);
  assert.equal(rule.days, 90);
  assert.equal(rule.min, 7);
  const pending = await queue(await booking()),
    uncertain = await queue(await booking());
  await pool.query(
    "UPDATE booking_email_outbox SET settled_at=now()-interval '91 days',state=CASE WHEN id=$1 THEN 'uncertain' ELSE state END WHERE id=ANY($2::uuid[])",
    [uncertain, [pending, uncertain]],
  );
  await pool.query(
    `DELETE FROM booking_email_outbox WHERE ${rule.where}`,
    [90],
  );
  assert.ok(await row(pending));
  assert.equal(await row(uncertain), undefined);
  const plan = await transaction(async (db) => {
    await db.query("SET LOCAL enable_seqscan=off");
    return (
      await db.query(`EXPLAIN (FORMAT JSON,COSTS OFF) SELECT id FROM booking_email_outbox
      WHERE state IN ('pending','preparing') AND expires_at<=statement_timestamp()
      ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT 100`)
    ).rows;
  });
  const output = JSON.stringify(plan);
  assert.match(output, /Index Cond/);
  assert.match(output, /expires_at/);
});
