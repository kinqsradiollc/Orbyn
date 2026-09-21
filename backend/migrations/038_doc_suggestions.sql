-- A change somebody proposes to one line, waiting for an editor to take it
-- or leave it. The page is untouched until then, so two people can propose
-- changes to the same sentence without one of them losing a version race.
CREATE TABLE doc_suggestions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  block_id    text NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('replace', 'insert', 'delete')),
  range_start integer NOT NULL,
  range_end   integer NOT NULL,
  -- What it should say instead. Empty for a deletion.
  text        text NOT NULL DEFAULT '',
  -- What it said when the change was proposed, so the card still reads
  -- after the line moves and so the proposal can be followed.
  quote       text NOT NULL DEFAULT '',
  note        text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'accepted', 'rejected')),
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  detached    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (range_end >= range_start)
);

CREATE INDEX doc_suggestions_doc_idx
  ON doc_suggestions (doc_id, created_at);
CREATE INDEX doc_suggestions_open_idx
  ON doc_suggestions (doc_id, block_id) WHERE status = 'open';
