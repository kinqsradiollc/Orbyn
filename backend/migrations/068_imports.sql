-- Importing files into Docs. A PDF, Word document or photo is uploaded to the
-- file store (the `files` service), read by the converter, and becomes an
-- ordinary page in the Uploads section. The file itself is deleted as soon as
-- the import ends, and the file store sweeps out anything older than a day.

CREATE TABLE imports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name    text NOT NULL,
  -- pdf, docx, png or jpeg.
  file_type    text NOT NULL,
  bytes        bigint NOT NULL,
  -- waiting, queued, reading, ocr, ready, failed, cancelled.
  status       text NOT NULL DEFAULT 'waiting',
  pages        integer,
  ocr_pages    integer NOT NULL DEFAULT 0,
  ocr_done     integer NOT NULL DEFAULT 0,
  -- The stored file's id in the file store; cleared once it's deleted.
  object_id    text,
  doc_id       uuid REFERENCES docs(id) ON DELETE SET NULL,
  error        text,
  notes        jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempts     integer NOT NULL DEFAULT 0,
  -- When a converter last took it, so a crashed one's work is picked up again.
  claimed_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

CREATE INDEX imports_user_idx ON imports (user_id, created_at DESC);
CREATE INDEX imports_queue_idx ON imports (created_at)
  WHERE status IN ('queued', 'reading');

-- One row per page of an import. Pages read from the file's own text are
-- done at once; scanned pages wait for OCR, one page at a time per OCR
-- worker, taken in page order across every file so no import waits behind
-- another's whole file.
CREATE TABLE import_pages (
  import_id    uuid NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  page         integer NOT NULL,
  needs_ocr    boolean NOT NULL DEFAULT false,
  markdown     text,
  tables       integer NOT NULL DEFAULT 0,
  figures      integer NOT NULL DEFAULT 0,
  attempts     integer NOT NULL DEFAULT 0,
  claimed_at   timestamptz,
  -- How long OCR took, for estimates.
  ocr_ms       integer,
  done_at      timestamptz,
  PRIMARY KEY (import_id, page)
);

CREATE INDEX import_pages_waiting_idx ON import_pages (page, import_id)
  WHERE needs_ocr AND done_at IS NULL;

-- Where a page came from, and whether it's still waiting in Uploads to be
-- filed. Moving it anywhere (a folder, or Unfiled) takes it out of Uploads.
ALTER TABLE docs
  ADD COLUMN imported_from jsonb,
  ADD COLUMN in_uploads boolean NOT NULL DEFAULT false;

CREATE INDEX docs_uploads_idx ON docs (user_id) WHERE in_uploads;

-- "Your file is ready in Uploads" is its own kind of notice.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template', 'ask',
    'promise', 'calendar', 'import'));
