import nodemailer from "nodemailer";
import { pool, transaction } from "./db.js";
import { config } from "./config.js";
const mail = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE === "true",
  auth: config.SMTP_USER
    ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
    : undefined,
  connectionTimeout: 10000,
  socketTimeout: 15000,
});
const expoHeaders = {
  "Content-Type": "application/json",
  ...(config.EXPO_ACCESS_TOKEN
    ? { Authorization: `Bearer ${config.EXPO_ACCESS_TOKEN}` }
    : {}),
};
export async function enqueue() {
  await transaction(async (db) => {
    // Serialize schedulers, while delivery workers can run concurrently.
    await db.query("SELECT pg_advisory_xact_lock(786240)");
    await db.query(
      `INSERT INTO notifications(user_id,item_id,item_version,channel,destination,title,body,state)
   SELECT i.user_id,i.id,i.reminder_version,c.channel,c.destination,'Coming up: '||i.title,
    i.title||' — '||to_char(i.due_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI')||' UTC',
    CASE WHEN c.channel='inapp' THEN 'sent' ELSE 'pending' END
   FROM items i JOIN users u ON u.id=i.user_id
   CROSS JOIN LATERAL (
    SELECT 'inapp' AS channel,'' AS destination
    UNION ALL SELECT 'email',u.email WHERE u.email_reminders AND $1::boolean
    UNION ALL SELECT 'push',d.token FROM devices d WHERE d.user_id=i.user_id
   ) c WHERE i.status='todo' AND i.due_at IS NOT NULL
    AND i.due_at-make_interval(mins=>i.reminder_minutes)<=now()
   ON CONFLICT(item_id,item_version,channel,destination) DO NOTHING`,
      [!!config.SMTP_HOST],
    );
    await db.query("DELETE FROM sessions WHERE expires_at<now()");
    await db.query(
      "DELETE FROM proposals WHERE expires_at<now()-interval '1 day'",
    );
  });
}
export async function deliverOne(): Promise<boolean> {
  return transaction(async (db) => {
    const n = (
      await db.query(
        "SELECT * FROM notifications WHERE state IN ('pending','receipt') AND available_at<=now() ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!n) return false;
    const i = (
      await db.query(
        "SELECT i.*,u.email_reminders FROM items i JOIN users u ON u.id=i.user_id WHERE i.id=$1",
        [n.item_id],
      )
    ).rows[0];
    const device =
      n.channel === "push"
        ? (
            await db.query(
              "SELECT 1 FROM devices WHERE token=$1 AND user_id=$2",
              [n.destination, n.user_id],
            )
          ).rowCount
        : true;
    if (
      !i ||
      i.status === "done" ||
      i.reminder_version !== n.item_version ||
      (n.channel === "email" && !i.email_reminders) ||
      !device
    ) {
      await db.query("UPDATE notifications SET state='cancelled' WHERE id=$1", [
        n.id,
      ]);
      return true;
    }
    try {
      let state = "sent";
      let receipt: string | null = null;
      if (n.channel === "email") {
        if (!config.SMTP_HOST) throw new Error("SMTP unavailable");
        await mail.sendMail({
          from: config.SMTP_FROM,
          to: n.destination,
          subject: n.title,
          text: n.body,
          messageId: `<${n.id}@orbyn.local>`,
        });
      } else if (n.channel === "push") {
        const checking = n.state === "receipt";
        const response = await fetch(
          `https://exp.host/--/api/v2/push/${checking ? "getReceipts" : "send"}`,
          {
            method: "POST",
            headers: expoHeaders,
            signal: AbortSignal.timeout(15000),
            body: JSON.stringify(
              checking
                ? { ids: [n.receipt_id] }
                : {
                    to: n.destination,
                    title: n.title,
                    body: n.body,
                    data: { itemId: n.item_id },
                    sound: "default",
                  },
            ),
          },
        );
        if (!response.ok) throw new Error("Push transport failed");
        const result = (await response.json()) as { data: any };
        const ticket = checking ? result.data[n.receipt_id] : result.data;
        if (ticket?.details?.error === "DeviceNotRegistered") {
          await db.query("DELETE FROM devices WHERE token=$1", [n.destination]);
          state = "cancelled";
        } else if (!ticket || ticket.status !== "ok")
          throw new Error("Push receipt unavailable or rejected");
        else if (!checking) {
          if (!ticket.id) throw new Error("Missing push receipt");
          state = "receipt";
          receipt = ticket.id;
        }
      }
      await db.query(
        "UPDATE notifications SET state=$1,receipt_id=COALESCE($2,receipt_id),available_at=now()+interval '15 minutes' WHERE id=$3",
        [state, receipt, n.id],
      );
    } catch {
      await db.query(
        "UPDATE notifications SET attempts=attempts+1,state=CASE WHEN attempts>=7 THEN 'failed' ELSE state END,available_at=now()+make_interval(secs=>LEAST(3600,30*power(2,attempts)::int)) WHERE id=$1",
        [n.id],
      );
      console.error(
        JSON.stringify({
          event: "notification_retry",
          id: n.id,
          attempt: n.attempts + 1,
        }),
      );
    }
    return true;
  });
}
let stopping = false;
async function run() {
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stopping = true;
    });
  while (!stopping) {
    try {
      await enqueue();
      for (let i = 0; i < 100 && !stopping; i++)
        if (!(await deliverOne())) break;
    } catch (error) {
      console.error(
        "Worker cycle failed",
        error instanceof Error ? error.message : "unknown",
      );
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  await pool.end();
  mail.close();
}
if (
  process.argv[1]?.endsWith("/worker.js") ||
  process.argv[1]?.endsWith("/worker.ts")
)
  await run();
