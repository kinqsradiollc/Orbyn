-- Schedule provenance outlives its disposable producing job/chat. Missing source
-- entries remain references so a later admission cannot silently regain access.
CREATE TABLE assistant_schedule_entry_sources (
  owner_id uuid NOT NULL,
  source_kind text NOT NULL,
  source_id uuid NOT NULL,
  source_entry_id uuid NOT NULL,
  FOREIGN KEY(owner_id,source_kind,source_id) REFERENCES assistant_schedule_destinations(owner_id,source_kind,source_id) ON DELETE CASCADE,
  PRIMARY KEY(owner_id,source_kind,source_id,source_entry_id)
);
CREATE TABLE assistant_page_run_entry_sources (
  run_id uuid NOT NULL REFERENCES assistant_page_runs ON DELETE CASCADE,
  source_entry_id uuid NOT NULL,
  PRIMARY KEY(run_id,source_entry_id)
);
