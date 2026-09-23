-- Focus sessions: each finished (or cut short) work session and break, so a
-- day's focus adds up, and the one running now, so another device can show it.
CREATE TABLE focus_sessions (
  -- Made on the device: a retried upload is the same row, never a second one.
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('work', 'short_break', 'long_break')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  planned_minutes integer NOT NULL CHECK (planned_minutes >= 0),
  minutes integer NOT NULL CHECK (minutes >= 0),
  completed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at > started_at)
);
CREATE INDEX focus_sessions_user_started ON focus_sessions (user_id, started_at DESC);

CREATE TABLE focus_current (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  -- Where it runs: the name shown ("iPhone") and the device's own id.
  device text,
  device_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
