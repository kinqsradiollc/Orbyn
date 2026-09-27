-- The server's clock against outside time (lib/clock.ts). The worker checks
-- it every ten minutes against the Date of two well-known sites; while both
-- say it is more than two minutes out, one row here says by how much and
-- since when, the status page and Admin → System show it, and admins get a
-- notice once. The row goes when the clock is right again. One row at most.
-- Safe to run again.

CREATE TABLE IF NOT EXISTS server_clock (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Server time minus outside time: positive when the server is fast.
  skew_ms     bigint NOT NULL,
  -- Outside time, so they read right while the server's own is wrong.
  since       timestamptz NOT NULL,
  checked_at  timestamptz NOT NULL,
  -- What each source said: [{ "source": "https://…", "skew_ms": n }].
  sources     jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- Notices to admins about the server itself ("system"), one per occurrence
-- (ref = "clock:<since>").
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template',
    'ask', 'promise', 'calendar', 'import', 'project', 'agent', 'session',
    'review', 'system'));
CREATE UNIQUE INDEX IF NOT EXISTS notifications_system_once
  ON notifications (user_id, ref) WHERE kind = 'system';
