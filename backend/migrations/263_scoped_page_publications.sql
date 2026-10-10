-- A link grants exactly the selected leaves. New content is never implicitly public.
CREATE TABLE scoped_page_publications (
  doc_id uuid PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  publisher_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  revision integer NOT NULL DEFAULT 1,
  mode text NOT NULL CHECK (mode IN ('snapshot','live')),
  block_ids jsonb NOT NULL CHECK (jsonb_typeof(block_ids)='array'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  title text NOT NULL,
  source_version integer NOT NULL,
  source_team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
