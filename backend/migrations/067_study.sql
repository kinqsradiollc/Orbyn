-- Study: flashcards written in pages as "Question :: Answer" lines, each
-- person's spaced-repetition state for them, a log of reviews, and the decks
-- attached to an exam.
CREATE TABLE IF NOT EXISTS study_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  doc_id uuid NOT NULL REFERENCES docs ON DELETE CASCADE,
  -- The line's name, or "q:" and its question for a line without one.
  card_key text NOT NULL,
  block_id text,
  question text NOT NULL,
  answer text NOT NULL,
  stability double precision NOT NULL DEFAULT 0,
  difficulty double precision NOT NULL DEFAULT 0,
  reps integer NOT NULL DEFAULT 0,
  lapses integer NOT NULL DEFAULT 0,
  last_review_at timestamptz,
  due_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, doc_id, card_key)
);
CREATE INDEX IF NOT EXISTS study_cards_due ON study_cards (user_id, due_at);

CREATE TABLE IF NOT EXISTS study_reviews (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES study_cards ON DELETE CASCADE,
  rating text NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS study_reviews_user ON study_reviews (user_id, at DESC);

-- Which pages you're revising for an exam. The exam itself lives in your
-- calendar (a subscribed exams calendar or your own event); it's named here
-- by a key made from its source and start.
CREATE TABLE IF NOT EXISTS study_exams (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  exam_key text NOT NULL,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  doc_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, exam_key)
);
