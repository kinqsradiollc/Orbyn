-- A record may cite one line of a note. Clear that line before the note FK
-- sets source_doc_id to NULL, so deleting the note cannot violate the
-- record's source_doc/source_block pairing constraint.
CREATE FUNCTION clear_work_record_source_block() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE work_records SET source_block_id = NULL
  WHERE source_doc_id = OLD.id AND source_block_id IS NOT NULL;
  RETURN OLD;
END;
$$;

CREATE TRIGGER docs_clear_work_record_source_block BEFORE DELETE ON docs
  FOR EACH ROW EXECUTE FUNCTION clear_work_record_source_block();
