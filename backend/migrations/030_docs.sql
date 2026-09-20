-- Documents: notes, project briefs and agendas that live beside the planner.
-- Content is the editor's block JSON; Markdown (with LaTeX intact) is derived
-- from it on export, so nothing is locked into the editor.
CREATE TABLE docs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id     uuid REFERENCES teams(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT 'Untitled',
  -- 'doc' is a plain document; 'agenda' and 'meeting' are generated kinds.
  kind        text NOT NULL DEFAULT 'doc',
  content     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The event a meeting note belongs to, when it has one.
  item_id     uuid REFERENCES items(id) ON DELETE SET NULL,
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX docs_user_updated_idx ON docs (user_id, updated_at DESC);
CREATE INDEX docs_team_updated_idx ON docs (team_id, updated_at DESC) WHERE team_id IS NOT NULL;
CREATE INDEX docs_item_idx ON docs (item_id) WHERE item_id IS NOT NULL;

-- Full-text search over the title and the document's plain text.
CREATE INDEX docs_search_idx ON docs USING gin (
  to_tsvector('english', title || ' ' || coalesce(content::text, ''))
);
