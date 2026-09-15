-- Settings admins change in the app (Admin -> System) and maintenance mode.
-- Every instance re-reads them within seconds, so no restart is needed.
-- Anything not stored here falls back to the server's .env.
CREATE TABLE IF NOT EXISTS system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
