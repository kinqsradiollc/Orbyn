-- Give each session an id and some context, so people can see where they're
-- signed in and sign other devices out. Existing sessions get sensible values.
ALTER TABLE sessions
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN user_agent text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX sessions_id ON sessions (id);
