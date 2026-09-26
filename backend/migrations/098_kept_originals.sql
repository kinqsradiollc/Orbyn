-- Keep the original: an optional setting that keeps an imported file in
-- Orbyn's own file service after it becomes a page, for as long as the page
-- exists. Off by default. Each person has a quota for originals; they come
-- with the export, are deleted with their page (after Trash) or on "Delete
-- original", and with the account. The file service holds the encrypted
-- bytes; this table holds whose they are. Safe to run again.

ALTER TABLE users ADD COLUMN IF NOT EXISTS keep_originals boolean NOT NULL DEFAULT false;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS keep_original boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS kept_files (
  -- The file's id in the file service.
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The page it became. When the page is deleted for good the row stays
  -- until the file service has removed the file, then goes.
  doc_id      uuid REFERENCES docs(id) ON DELETE SET NULL,
  import_id   uuid REFERENCES imports(id) ON DELETE SET NULL,
  file_name   text NOT NULL,
  file_type   text NOT NULL,
  bytes       bigint NOT NULL CHECK (bytes >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kept_files_user ON kept_files (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS kept_files_doc ON kept_files (doc_id)
  WHERE doc_id IS NOT NULL;
