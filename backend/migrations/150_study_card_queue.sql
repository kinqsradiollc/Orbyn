-- Study cards follow their pages when the pages change, not when someone
-- opens Study (A1-late: reads never write). A page whose card lines may have
-- changed, or whose readers may have, is queued here; the API syncs it right
-- after its own saves, and the notifier drains whatever else is left (pages
-- written by imports, templates or the assistant, and team membership
-- changes). Safe to run again.

CREATE TABLE IF NOT EXISTS study_card_queue (
  doc_id    uuid PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now()
);

-- Cards by page: the trigger below asks whether a page has any, and a page's
-- sync replaces its cards, on every save.
CREATE INDEX IF NOT EXISTS study_cards_doc ON study_cards (doc_id);

-- A page's card lines look like "Question :: Answer", "Term ::: Meaning" or
-- a cloze "{{…}}"; one that has cards may have just lost its lines.
CREATE OR REPLACE FUNCTION study_card_queue_doc() RETURNS trigger
LANGUAGE plpgsql AS $t$
BEGIN
  IF NEW.content::text LIKE '% :: %' OR NEW.content::text LIKE '% ::: %'
     OR NEW.content::text LIKE '%{{%}}%'
     OR EXISTS (SELECT 1 FROM study_cards c WHERE c.doc_id = NEW.id) THEN
    INSERT INTO study_card_queue (doc_id) VALUES (NEW.id)
      ON CONFLICT (doc_id) DO UPDATE SET queued_at = now();
  END IF;
  RETURN NULL;
END $t$;

DROP TRIGGER IF EXISTS docs_study_card_queue ON docs;
CREATE TRIGGER docs_study_card_queue
  AFTER INSERT OR UPDATE OF content, team_id, user_id, deleted_at ON docs
  FOR EACH ROW EXECUTE FUNCTION study_card_queue_doc();

-- Joining or leaving a team changes who studies its pages' cards.
CREATE OR REPLACE FUNCTION study_card_queue_team() RETURNS trigger
LANGUAGE plpgsql AS $t$
DECLARE
  team uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.team_id ELSE NEW.team_id END;
BEGIN
  INSERT INTO study_card_queue (doc_id)
    SELECT d.id FROM docs d
     WHERE d.team_id = team
       AND (d.content::text LIKE '% :: %' OR d.content::text LIKE '% ::: %'
            OR d.content::text LIKE '%{{%}}%'
            OR EXISTS (SELECT 1 FROM study_cards c WHERE c.doc_id = d.id))
    ON CONFLICT (doc_id) DO UPDATE SET queued_at = now();
  RETURN NULL;
END $t$;

DROP TRIGGER IF EXISTS team_members_study_card_queue ON team_members;
CREATE TRIGGER team_members_study_card_queue
  AFTER INSERT OR DELETE ON team_members
  FOR EACH ROW EXECUTE FUNCTION study_card_queue_team();

-- Every page with card lines is synced once, when the notifier next runs.
INSERT INTO study_card_queue (doc_id)
  SELECT d.id FROM docs d
   WHERE d.deleted_at IS NULL
     AND (d.content::text LIKE '% :: %' OR d.content::text LIKE '% ::: %'
          OR d.content::text LIKE '%{{%}}%')
  ON CONFLICT DO NOTHING;
