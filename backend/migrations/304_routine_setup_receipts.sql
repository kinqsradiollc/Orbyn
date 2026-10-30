-- Person-only atomic setup. Retain a tombstone after routine deletion so a
-- delayed response retry cannot recreate the routine or restore permissions.
CREATE TABLE assistant_routine_setup_receipts (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  routine_id uuid UNIQUE REFERENCES agent_routines(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, request_id)
);
