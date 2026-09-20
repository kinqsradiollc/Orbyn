-- A checklist line that became a task stays tied to it, so ticking either one
-- ticks the other. The link is keyed by a stable id carried on the block, not
-- by its position, because editing a document moves blocks around.
CREATE TABLE doc_task_links (
  doc_id    uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  block_id  text NOT NULL,
  item_id   uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, block_id)
);

CREATE INDEX doc_task_links_item_idx ON doc_task_links (item_id);
