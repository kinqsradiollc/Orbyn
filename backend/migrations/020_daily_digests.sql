-- Daily digest emails: a morning agenda and an evening review, off by default
-- and opt-in per person, sent through the workspace's own mail server.
ALTER TABLE planner_prefs
  ADD COLUMN digest jsonb NOT NULL DEFAULT '{}'::jsonb;

-- One row per digest actually sent, so a person gets each digest at most once
-- a day even with several notifier replicas or a restart.
CREATE TABLE digest_sends (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('morning', 'evening')),
  on_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, on_date)
);
