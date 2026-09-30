-- Monotonic revisions cover every writer, including workers and comment edits.
ALTER TABLE goals ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE agent_routines ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE time_blocks ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE doc_comments ADD COLUMN revision integer NOT NULL DEFAULT 1;
CREATE FUNCTION bump_reminder_undo_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER goals_undo_revision BEFORE UPDATE ON goals FOR EACH ROW EXECUTE FUNCTION bump_reminder_undo_revision();
CREATE TRIGGER routines_undo_revision BEFORE UPDATE ON agent_routines FOR EACH ROW EXECUTE FUNCTION bump_reminder_undo_revision();
CREATE TRIGGER blocks_undo_revision BEFORE UPDATE ON time_blocks FOR EACH ROW EXECUTE FUNCTION bump_reminder_undo_revision();
CREATE TRIGGER comments_undo_revision BEFORE UPDATE ON doc_comments FOR EACH ROW EXECUTE FUNCTION bump_reminder_undo_revision();
