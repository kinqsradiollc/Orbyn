-- Trash for pages (ORG-04). Deleting a page moves it to Trash rather than
-- deleting it: it disappears from the library, search, study, the assistant
-- and links, and can be restored for 30 days. The sweeper (lib/sweep.ts,
-- rule "doc_trash") deletes it for good after that, taking its history,
-- comments and task links with it as a hard delete always has.
ALTER TABLE docs ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE docs ADD COLUMN IF NOT EXISTS deleted_by uuid
  REFERENCES users(id) ON DELETE SET NULL;

-- The Trash list and the sweeper read only the few pages in Trash.
CREATE INDEX IF NOT EXISTS docs_trash_idx ON docs (deleted_at)
  WHERE deleted_at IS NOT NULL;
