-- Presence: each device's last check-in and sync state, and whether a person
-- lets their teams see when they are active. Off until they turn it on.
CREATE TABLE presence (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('web', 'desktop', 'ios', 'android')),
  label text,
  active boolean NOT NULL DEFAULT true,
  doc_id uuid REFERENCES docs(id) ON DELETE SET NULL,
  pending_changes integer NOT NULL DEFAULT 0 CHECK (pending_changes >= 0),
  failed_changes integer NOT NULL DEFAULT 0 CHECK (failed_changes >= 0),
  synced_at timestamptz,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);
CREATE INDEX presence_doc ON presence (doc_id) WHERE doc_id IS NOT NULL;

ALTER TABLE users ADD COLUMN share_presence boolean NOT NULL DEFAULT false;
