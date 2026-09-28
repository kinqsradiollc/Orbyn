-- Covers and icons (W6): a project or a page can show a cover picture and
-- an icon. The cover is one of the pictures kept in Orbyn's own file store
-- (page_files, migration 113); deleting the picture takes the cover off.
-- The icon is an emoji, or "icon:<name>" for one of the app's own icons.
--
-- A cover counts as a use of its picture: the sweeper (lib/sweep.ts) keeps
-- a picture any cover (or Home hub, in account_prefs.home) shows, and
-- whoever can see the project or page can see its cover
-- (lib/page-file-access.ts).
--
-- Safe to run again.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS cover_file_id uuid
  REFERENCES page_files(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE docs ADD COLUMN IF NOT EXISTS cover_file_id uuid
  REFERENCES page_files(id) ON DELETE SET NULL;
ALTER TABLE docs ADD COLUMN IF NOT EXISTS icon text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_icon_check'
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_icon_check
      CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 40);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'docs_icon_check'
  ) THEN
    ALTER TABLE docs ADD CONSTRAINT docs_icon_check
      CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 40);
  END IF;
END $$;

-- Found by picture: "is this picture a cover?" for the sweeper and access.
CREATE INDEX IF NOT EXISTS projects_cover_idx ON projects (cover_file_id)
  WHERE cover_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS docs_cover_idx ON docs (cover_file_id)
  WHERE cover_file_id IS NOT NULL;
