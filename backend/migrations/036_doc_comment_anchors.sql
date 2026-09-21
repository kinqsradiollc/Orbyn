-- A comment can be written about one line rather than the whole page. The
-- anchor is the stable name the block carries, not its position, because
-- editing a document moves blocks around; `quote` keeps what the line said at
-- the time, so a comment whose line has since gone can still be read and
-- shown for what it was.
ALTER TABLE doc_comments
  ADD COLUMN block_id text,
  ADD COLUMN quote    text;

CREATE INDEX doc_comments_block_idx
  ON doc_comments (doc_id, block_id) WHERE block_id IS NOT NULL;
