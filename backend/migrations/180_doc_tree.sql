-- Pages inside pages (W5): a page may sit under another page of the same
-- space, and pages keep the order someone dragged them into. Deleting a
-- page for good lets its children move up a level (SET NULL); a page in
-- Trash keeps its children, which show at their folder's top level until
-- it is restored. The service refuses cycles, other spaces and mixing
-- Memory or Agent notes with library pages. Safe to run again.
ALTER TABLE docs ADD COLUMN IF NOT EXISTS parent_id uuid
  REFERENCES docs(id) ON DELETE SET NULL;
ALTER TABLE docs ADD COLUMN IF NOT EXISTS sort_order integer;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'docs_parent_not_self' AND conrelid = 'docs'::regclass
  ) THEN
    ALTER TABLE docs ADD CONSTRAINT docs_parent_not_self
      CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS docs_parent_idx ON docs (parent_id, sort_order)
  WHERE parent_id IS NOT NULL;
