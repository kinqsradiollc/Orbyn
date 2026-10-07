-- Retry state is independent of pgvector so stock databases and late extension
-- installation share the same schema. One bounded record per existing page.
CREATE TABLE doc_embedding_failures (
  doc_id uuid PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  queue_revision uuid NOT NULL,
  embedding_generation uuid NOT NULL,
  doc_version integer NOT NULL,
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 16),
  error_code text NOT NULL CHECK (error_code IN ('provider_unavailable','worker_error')),
  failed_at timestamptz NOT NULL DEFAULT now(),
  retry_at timestamptz NOT NULL
);
