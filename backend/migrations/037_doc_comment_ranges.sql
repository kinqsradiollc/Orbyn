-- Comments move from "beside a line" to "under the words". A remark keeps the
-- character range its quote occupied in the block's Markdown source; the save
-- path follows the quote when the line around it is edited, and marks the
-- remark detached only when the words have gone altogether.
ALTER TABLE doc_comments
  ADD COLUMN range_start integer,
  ADD COLUMN range_end   integer,
  ADD COLUMN parent_id   uuid REFERENCES doc_comments(id) ON DELETE CASCADE,
  ADD COLUMN detached     boolean NOT NULL DEFAULT false;

ALTER TABLE doc_comments
  ADD CONSTRAINT doc_comments_range_check
  CHECK ((range_start IS NULL) = (range_end IS NULL)
     AND (range_start IS NULL OR range_end > range_start));

CREATE INDEX doc_comments_parent_idx
  ON doc_comments (parent_id) WHERE parent_id IS NOT NULL;

-- Naming someone in a comment notifies them, so the names are rows rather
-- than text picked back out of the body.
CREATE TABLE doc_comment_mentions (
  comment_id uuid NOT NULL REFERENCES doc_comments(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX doc_comment_mentions_user_idx ON doc_comment_mentions (user_id);

-- Being named in a comment reaches the bell like any other notice. A mention
-- is not about a task, so it carries no item and is kept to one a comment by
-- its ref.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention'));
CREATE UNIQUE INDEX notifications_mention_once ON notifications (user_id, ref)
  WHERE kind = 'mention';
