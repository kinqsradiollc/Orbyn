-- A note is a document, so it gets the editor, comments, proposals, history
-- and live updates without any of them being built again. What makes it a
-- note is where it hangs: a project, a task, a team, or nothing, plus tags.
ALTER TABLE docs
  ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX docs_project_idx
  ON docs (project_id, updated_at DESC) WHERE project_id IS NOT NULL;

-- One tag vocabulary covers tasks and notes, so a tag means the same thing
-- wherever it is used rather than two lists that drift apart.
CREATE TABLE doc_tags (
  doc_id uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (doc_id, tag_id)
);

CREATE INDEX doc_tags_tag_idx ON doc_tags (tag_id);
