-- Comments on a document: one thread per document, so a remark survives the
-- blocks being rewritten around it. Resolving keeps the comment but takes it
-- out of the open thread.
CREATE TABLE doc_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        text NOT NULL,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX doc_comments_doc_idx ON doc_comments (doc_id, created_at);
