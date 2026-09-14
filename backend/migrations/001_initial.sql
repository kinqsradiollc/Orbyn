CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
 name text NOT NULL, password_hash text NOT NULL, email_reminders boolean NOT NULL DEFAULT true
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 title varchar(200) NOT NULL, notes text NOT NULL DEFAULT '',
 kind text NOT NULL DEFAULT 'task' CHECK (kind IN ('task','event')),
 status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','done')),
 priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
 due_at timestamptz, end_at timestamptz,
 reminder_minutes integer NOT NULL DEFAULT 30 CHECK (reminder_minutes BETWEEN 0 AND 10080),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (end_at IS NULL OR (due_at IS NOT NULL AND end_at > due_at)),
 CHECK (kind != 'event' OR due_at IS NOT NULL)
);
CREATE INDEX items_user ON items(user_id, created_at DESC, id);
CREATE INDEX items_due ON items(due_at) WHERE status = 'todo';
CREATE TABLE devices (token text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE);
CREATE INDEX devices_user ON devices(user_id);
CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 item_id uuid NOT NULL REFERENCES items ON DELETE CASCADE, item_version integer NOT NULL,
 channel text NOT NULL CHECK (channel IN ('inapp','email','push')), destination text NOT NULL DEFAULT '',
 title text NOT NULL, body text NOT NULL, read boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), receipt_id text,
 UNIQUE(item_id,item_version,channel,destination)
);
CREATE INDEX notifications_pending ON notifications(available_at) WHERE state IN ('pending','receipt');
CREATE INDEX notifications_user ON notifications(user_id,created_at DESC);
CREATE TABLE proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 actions jsonb NOT NULL, applied boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);
