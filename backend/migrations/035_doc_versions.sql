-- Every saved state of a document, so a page can be read as it was and put
-- back that way. A row is written from the state a save is about to replace,
-- which means the current content is never duplicated here: the table holds
-- the past, the docs table holds the present.
--
-- Saves arrive every second or so while someone types, so a row that is by
-- the same person and within a few minutes of the previous one is replaced
-- rather than added (see the docs module). History then reads as a list of
-- sittings, not keystrokes.
CREATE TABLE doc_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  -- The docs.version the content below carried.
  version     integer NOT NULL,
  title       text NOT NULL,
  content     jsonb NOT NULL,
  -- Who saved the state that replaced this one; null once they are gone.
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_id, version)
);

CREATE INDEX doc_versions_doc_idx ON doc_versions (doc_id, created_at DESC);
