-- Booking pages you can shape (hours, date overrides, questions, approval,
-- rescheduling, look and wording) and bookings you can track (answers, a
-- timeline, host notes, no-shows, one private manage link per booking).

ALTER TABLE booking_pages
  ADD COLUMN color varchar(9) NOT NULL DEFAULT '#376c51',
  ADD COLUMN slot_interval_minutes smallint NOT NULL DEFAULT 15
    CHECK (slot_interval_minutes IN (5, 10, 15, 20, 30, 60)),
  ADD COLUMN buffer_before_minutes smallint NOT NULL DEFAULT 0
    CHECK (buffer_before_minutes BETWEEN 0 AND 120),
  ADD COLUMN buffer_after_minutes smallint NOT NULL DEFAULT 0
    CHECK (buffer_after_minutes BETWEEN 0 AND 120),
  ADD COLUMN max_per_week smallint
    CHECK (max_per_week IS NULL OR max_per_week BETWEEN 1 AND 200),
  -- {"mode":"working_hours"} or {"mode":"custom","timezone":..,"weekly":[{day,start,end}]}
  ADD COLUMN availability jsonb NOT NULL DEFAULT '{"mode":"working_hours"}',
  -- [{"date":"2026-09-18","hours":[{"start":"10:00","end":"14:00"}]}]; no hours = closed.
  ADD COLUMN date_overrides jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN questions jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN requires_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN allow_reschedule boolean NOT NULL DEFAULT true,
  ADD COLUMN event_title varchar(200) NOT NULL DEFAULT '{page} with {name}',
  ADD COLUMN confirmation_message text NOT NULL DEFAULT ''
    CHECK (length(confirmation_message) <= 1000);
UPDATE booking_pages
SET buffer_before_minutes = buffer_minutes, buffer_after_minutes = buffer_minutes;
ALTER TABLE booking_pages DROP COLUMN buffer_minutes;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'awaiting_approval', 'confirmed', 'declined', 'cancelled'));
ALTER TABLE bookings
  ADD COLUMN answers jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN host_note text NOT NULL DEFAULT '' CHECK (length(host_note) <= 4000),
  ADD COLUMN no_show boolean NOT NULL DEFAULT false,
  ADD COLUMN cancel_reason text NOT NULL DEFAULT '' CHECK (length(cancel_reason) <= 500),
  ADD COLUMN cancelled_by text CHECK (cancelled_by IN ('booker', 'host')),
  -- One private link the booker uses to see, reschedule or cancel. Stored
  -- encrypted so later emails can repeat it, and hashed for lookups.
  ADD COLUMN manage_token_hash text UNIQUE,
  ADD COLUMN manage_token_encrypted text,
  ADD COLUMN reschedule_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX bookings_status ON bookings (page_id, status, start_at);

-- What happened to each booking, for the timeline hosts see.
CREATE TABLE booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('requested', 'email_confirmed', 'approved',
    'declined', 'confirmed', 'rescheduled', 'cancelled', 'no_show', 'note')),
  actor text NOT NULL DEFAULT 'system' CHECK (actor IN ('host', 'booker', 'system')),
  actor_id uuid REFERENCES users ON DELETE SET NULL,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_booking ON booking_events (booking_id, created_at);
INSERT INTO booking_events (booking_id, kind, actor, created_at)
SELECT id, 'requested', 'booker', created_at FROM bookings;
INSERT INTO booking_events (booking_id, kind, actor, created_at)
SELECT id, status, 'system', created_at FROM bookings
WHERE status IN ('confirmed', 'cancelled');

-- Booking notices point at the booking (in `ref`), not a calendar item, so a
-- cancellation notice survives the event being removed.
ALTER TABLE notifications ALTER COLUMN item_id DROP NOT NULL;
