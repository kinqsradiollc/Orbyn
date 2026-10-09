-- Existing queued summaries have no captured assistant authority. They fail
-- closed on their next claim; new runs record the reviewed rule revision.
ALTER TABLE agenda_summary_runs ADD COLUMN assistant_rules_revision integer
  CHECK (assistant_rules_revision > 0);
