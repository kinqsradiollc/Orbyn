-- Proposal metadata is reviewed before creating any project, item or block.
ALTER TABLE proposals ADD COLUMN project jsonb;

-- Edges belong to existing tasks; removing a task removes its edges too.
CREATE TABLE item_dependencies (
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  prerequisite_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, prerequisite_id),
  CHECK (item_id <> prerequisite_id)
);
CREATE INDEX item_dependencies_prerequisite ON item_dependencies(prerequisite_id);
