ALTER TABLE proposals
  ADD COLUMN decision_links jsonb NOT NULL DEFAULT '[]'::jsonb;
