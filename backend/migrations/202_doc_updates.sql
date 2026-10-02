-- Live editing as a CRDT: the update log for open pages. The document's
-- plain blocks stay in docs.content; this holds the binary Yjs updates
-- editors exchange while a page is open, in order. Any replica can serve
-- any editor: NOTIFY carries only the doc id (news, not data), and readers
-- SELECT the updates they have not seen yet. Compaction folds old updates
-- into docs.y_snapshot; see doc-crdt.ts in @orbyn/core for the mapping.
CREATE TABLE doc_updates (
  seq bigserial PRIMARY KEY,
  doc_id uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  editor_id text NOT NULL DEFAULT '',
  update bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_updates_doc_seq_idx ON doc_updates (doc_id, seq);
