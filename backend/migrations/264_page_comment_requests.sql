-- Comment requests reuse scoped page leases, budgets and captured provider choices.
ALTER TABLE assistant_page_bindings
  ADD COLUMN source_comment_id uuid UNIQUE REFERENCES doc_comments(id) ON DELETE CASCADE,
  ADD COLUMN source_comment_revision integer,
  ADD CONSTRAINT page_binding_comment_revision CHECK (
    (source_comment_id IS NULL AND source_comment_revision IS NULL) OR
    (source_comment_id IS NOT NULL AND source_comment_revision IS NOT NULL AND source_comment_revision > 0)
  );

-- A committed reply is unique even if a worker retries its transaction.
ALTER TABLE doc_comments
  ADD COLUMN assistant_request_id uuid UNIQUE REFERENCES doc_comments(id) ON DELETE CASCADE;
