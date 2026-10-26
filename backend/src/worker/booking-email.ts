import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { transaction, type Db } from "../db/pool.js";
import { encryptSecret, decryptSecret } from "../lib/secrets.js";
import {
  emailEnabled,
  sendEmail,
  type EmailNotification,
} from "./channels/email.js";

type Payload = Pick<EmailNotification, "destination" | "title" | "body">;
type Claim = {
  id: string;
  booking_id: string;
  revision: number;
  payload_encrypted: string;
  claim_id: string;
  attempts: number;
};
const MAX_ATTEMPTS = 8;

/** Called in the booking transaction; no provider/SMTP request occurs here. */
export async function queueBookingEmail(
  db: Db,
  bookingId: string,
  payload: Payload,
  options: { expiresAt?: Date } = {},
): Promise<string> {
  const booking = (
    await db.query<{ email_revision: number; at: Date }>(
      "UPDATE bookings SET email_revision=email_revision+1 WHERE id=$1 RETURNING email_revision,clock_timestamp() AS at",
      [bookingId],
    )
  ).rows[0];
  if (!booking) throw new Error("Booking email requires an existing booking.");
  // The booking lock orders concurrent producers. Prepared but not dispatched
  // mail may be superseded; an already-started SMTP exchange cannot be recalled.
  await db.query(
    "UPDATE booking_email_outbox SET state='superseded',settled_at=clock_timestamp(),claim_id=NULL,lease_until=NULL WHERE booking_id=$1 AND state IN ('pending','preparing')",
    [bookingId],
  );
  const id = randomUUID();
  const encrypted = await encryptSecret(
    JSON.stringify({
      ...payload,
      body: `${payload.body}\n\nAs of ${booking.at.toISOString()} (UTC), booking update ${booking.email_revision}. This email describes that update; use the booking link to check its current state.`,
    }),
  );
  await db.query(
    "INSERT INTO booking_email_outbox(id,booking_id,revision,payload_encrypted,expires_at) VALUES($1,$2,$3,$4,$5)",
    [
      id,
      bookingId,
      booking.email_revision,
      encrypted,
      options.expiresAt ?? null,
    ],
  );
  return id;
}

/** Only errors proven to precede message submission may be automatically retried. */
function beforeSubmission(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, command } = error as { code?: string; command?: string };
  return (
    (code === "EDNS" && command === "CONN") ||
    (code === "EAUTH" &&
      (command === "AUTH" || command?.startsWith("AUTH ") === true))
  );
}
async function settle(
  claim: Claim,
  outcome: "sent" | "uncertain" | "retry",
  reason: string | null,
) {
  await transaction(async (db) => {
    const failed = outcome === "retry" && claim.attempts >= MAX_ATTEMPTS;
    await db.query(
      `UPDATE booking_email_outbox SET state=$3,claim_id=NULL,lease_until=NULL,
      settled_at=CASE WHEN $3='pending' THEN NULL ELSE clock_timestamp() END,
      available_at=clock_timestamp()+($4::int * interval '1 second'),last_error=$5
      WHERE id=$1 AND claim_id=$2 AND state IN ('preparing','sending')`,
      [
        claim.id,
        claim.claim_id,
        outcome === "retry" ? (failed ? "failed" : "pending") : outcome,
        Math.min(3600, 30 * 2 ** Math.min(claim.attempts, 7)),
        reason,
      ],
    );
  });
}

/**
 * Commit a claim, prepare privately, commit dispatch, then contact SMTP with no
 * transaction held. A dispatch crash is uncertain and is never blindly resent.
 * Dependencies are internal test seams; routes cannot supply a sender or clock.
 */
export async function deliverBookingEmailOne(
  deps: {
    enabled?: typeof emailEnabled;
    send?: typeof sendEmail;
  } = {},
): Promise<boolean> {
  if (env.BOOKING_EMAIL_DELIVERY_ENABLED !== "true") return false;
  const claim = await transaction(async (db) => {
    await db.query(`WITH batch AS (SELECT id FROM booking_email_outbox
      WHERE state IN ('pending','preparing') AND expires_at<=statement_timestamp()
      ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT 100)
      UPDATE booking_email_outbox o SET state='superseded',settled_at=clock_timestamp(),
      last_error='intent_expired',claim_id=NULL,lease_until=NULL
      FROM batch WHERE o.id=batch.id`);
    await db.query(`WITH batch AS (SELECT id FROM booking_email_outbox
      WHERE state='sending' AND lease_until<statement_timestamp()
      ORDER BY lease_until,id FOR UPDATE SKIP LOCKED LIMIT 100)
      UPDATE booking_email_outbox o SET state='uncertain',settled_at=clock_timestamp(),
      last_error='dispatch_lease_expired',claim_id=NULL,lease_until=NULL
      FROM batch WHERE o.id=batch.id`);
    await db.query(`WITH batch AS (SELECT id FROM booking_email_outbox
      WHERE state='preparing' AND lease_until<statement_timestamp()
      ORDER BY lease_until,id FOR UPDATE SKIP LOCKED LIMIT 100)
      UPDATE booking_email_outbox o SET state='pending',claim_id=NULL,lease_until=NULL
      FROM batch WHERE o.id=batch.id`);
    const row = (
      await db.query<Claim>(`SELECT id,booking_id,revision,payload_encrypted,claim_id,attempts
      FROM booking_email_outbox o WHERE state='pending' AND available_at<=statement_timestamp()
      AND NOT EXISTS (SELECT 1 FROM booking_email_outbox active
        WHERE active.booking_id=o.booking_id AND active.state IN ('preparing','sending'))
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)
    ).rows[0];
    if (!row) return null;
    row.claim_id = randomUUID();
    row.attempts++;
    await db.query(
      "UPDATE booking_email_outbox SET state='preparing',claim_id=$2,attempts=attempts+1,lease_until=clock_timestamp()+interval '5 minutes' WHERE id=$1",
      [row.id, row.claim_id],
    );
    return row;
  });
  if (!claim) return false;
  let payload: Payload;
  try {
    if (!(await (deps.enabled ?? emailEnabled)())) {
      // Disabled SMTP is an operator pause, not eight failed sends. Keep the
      // durable intent until mail is configured without exhausting its budget.
      await transaction(async (db) => {
        await db.query(
          `UPDATE booking_email_outbox SET state='pending',claim_id=NULL,lease_until=NULL,
           attempts=GREATEST(0,attempts-1),available_at=clock_timestamp()+interval '5 minutes',
           last_error='smtp_unavailable' WHERE id=$1 AND claim_id=$2 AND state='preparing'`,
          [claim.id, claim.claim_id],
        );
      });
      return true;
    }
    payload = JSON.parse(await decryptSecret(claim.payload_encrypted));
    if (
      !payload ||
      typeof payload.destination !== "string" ||
      typeof payload.title !== "string" ||
      typeof payload.body !== "string"
    )
      throw new Error("Invalid email payload");
  } catch {
    await settle(claim, "retry", "preparation_failed");
    return true;
  }
  const dispatch = await transaction(async (db) => {
    // Same producer lock order: booking, then its intent. A revision change can
    // therefore cancel preparation atomically before the SMTP boundary.
    const booking = (
      await db.query<{ email_revision: number }>(
        "SELECT email_revision FROM bookings WHERE id=$1 FOR UPDATE",
        [claim.booking_id],
      )
    ).rows[0];
    if (!booking || booking.email_revision !== claim.revision) {
      await db.query(
        "UPDATE booking_email_outbox SET state='superseded',settled_at=clock_timestamp(),claim_id=NULL,lease_until=NULL WHERE id=$1 AND claim_id=$2 AND state='preparing'",
        [claim.id, claim.claim_id],
      );
      return false;
    }
    await db.query(
      "UPDATE booking_email_outbox SET state='superseded',settled_at=clock_timestamp(),last_error='intent_expired',claim_id=NULL,lease_until=NULL WHERE id=$1 AND claim_id=$2 AND state='preparing' AND expires_at<=clock_timestamp()",
      [claim.id, claim.claim_id],
    );
    return !!(
      await db.query(
        "UPDATE booking_email_outbox SET state='sending',dispatched_at=clock_timestamp(),lease_until=clock_timestamp()+interval '5 minutes' WHERE id=$1 AND claim_id=$2 AND state='preparing' AND lease_until>clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp()) RETURNING id",
        [claim.id, claim.claim_id],
      )
    ).rowCount;
  });
  if (!dispatch) return true;
  try {
    await (deps.send ?? sendEmail)({ id: claim.id, ...payload });
  } catch (error) {
    await settle(
      claim,
      beforeSubmission(error) ? "retry" : "uncertain",
      beforeSubmission(error)
        ? "smtp_pre_submission_failed"
        : "smtp_outcome_unknown",
    );
    return true;
  }
  // If this settlement fails, the durable 'sending' record becomes uncertain
  // after its lease expires, even though SMTP may already have accepted it.
  await settle(claim, "sent", null);
  return true;
}
