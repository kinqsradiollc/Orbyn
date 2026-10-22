-- Destination identity and source scope travel together. Existing snapshots
-- conservatively keep personal-only scope until an explicit new request changes it.
ALTER TABLE assistant_schedule_destinations ADD COLUMN personal_only boolean NOT NULL DEFAULT true;
