-- Applying a drafted project answers with the project it made, also when the
-- same proposal is applied again (a retried request).
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS applied_project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
