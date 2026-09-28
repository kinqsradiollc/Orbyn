-- One private Agent brief for each user's local day.
CREATE TABLE IF NOT EXISTS assistant_briefs (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  doc_id uuid REFERENCES docs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_day)
);

CREATE INDEX IF NOT EXISTS assistant_briefs_doc_idx
  ON assistant_briefs (doc_id) WHERE doc_id IS NOT NULL;
