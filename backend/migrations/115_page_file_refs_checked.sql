-- A page only starts showing a picture or file someone could read (D4b review).
--
-- 114 linked a page to every file id its lines named, so pasting an id you
-- had only seen (as a viewer, or before leaving a team) into your own page
-- gave you the file. Now a save links a file to a page only when:
--
-- - it is the page the file was added to (page_files.doc_id), or
-- - the API checked, in the same transaction, that the person saving can
--   read it, and listed it in the transaction-local setting
--   orbyn.page_files_ok (comma-separated ids; see allowPageFiles in
--   backend/src/modules/page-files/routes.ts).
--
-- Links a page already has stay while its lines still show the file; any
-- other id is left out, so its line shows the file as gone.
--
-- Safe to run again.

CREATE OR REPLACE FUNCTION page_file_refs_from_doc() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ids uuid[];
  ok uuid[];
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.content IS NOT DISTINCT FROM OLD.content
     AND NEW.imported_from IS NOT DISTINCT FROM OLD.imported_from THEN
    RETURN NEW;
  END IF;
  ids := page_file_ids(NEW.content, NEW.imported_from);
  -- Most pages hold no files: nothing to do.
  IF cardinality(ids) = 0 AND (TG_OP = 'INSERT' OR NOT EXISTS (
       SELECT 1 FROM page_file_refs WHERE doc_id = NEW.id)) THEN
    RETURN NEW;
  END IF;
  DELETE FROM page_file_refs
   WHERE doc_id = NEW.id AND NOT (file_id = ANY (ids));
  ok := coalesce(string_to_array(
          nullif(current_setting('orbyn.page_files_ok', true), ''), ',')::uuid[],
        '{}');
  INSERT INTO page_file_refs (file_id, doc_id)
  SELECT f.id, NEW.id FROM page_files f
   WHERE f.id = ANY (ids)
     AND (f.doc_id = NEW.id OR f.id = ANY (ok))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

-- Leaving a team (or being removed) takes back the team's pictures and files
-- someone had pasted into their own pages while they were in it, unless
-- they uploaded them: those pages stop linking them, so an id they kept
-- gives them nothing and no longer holds the uploader's space.
CREATE OR REPLACE FUNCTION page_file_refs_on_leave() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM page_file_refs r
   USING docs holder, page_files f, docs home
   WHERE r.doc_id = holder.id
     AND holder.team_id IS NULL AND holder.user_id = OLD.user_id
     AND f.id = r.file_id AND f.user_id <> OLD.user_id
     AND home.id = f.doc_id AND home.team_id = OLD.team_id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS page_file_refs_leave_trigger ON team_members;
CREATE TRIGGER page_file_refs_leave_trigger
  AFTER DELETE ON team_members
  FOR EACH ROW EXECUTE FUNCTION page_file_refs_on_leave();
