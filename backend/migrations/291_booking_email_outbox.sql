-- No historical backfill: only new booking transitions enqueue mail.
ALTER TABLE bookings ADD COLUMN email_revision integer NOT NULL DEFAULT 0;
CREATE TABLE booking_email_outbox (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  payload_encrypted text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN
    ('pending','preparing','sending','sent','uncertain','failed','superseded')),
  claim_id uuid,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  dispatched_at timestamptz,
  settled_at timestamptz,
  last_error text,
  UNIQUE (booking_id, revision)
);
CREATE INDEX booking_email_outbox_pending ON booking_email_outbox(available_at,created_at)
  WHERE state='pending';
CREATE INDEX booking_email_outbox_reclaim ON booking_email_outbox(lease_until)
  WHERE state IN ('preparing','sending');
-- Worker-only table. It has no user-facing route; payload contains the booker's
-- private management link and must remain encrypted through retention/backup.
