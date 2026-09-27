-- H4: study from anything, practice first.
--
-- Cards remember the notes line they were made from (a
-- `[src: …](orbyn://doc/<id>#<line>)` link on the card's line) and the
-- picture they ask about (a card line right under a picture), both copied
-- from the page when it is synced. `misses` counts "again" answers, so
-- Study can show what the person keeps getting wrong and quizzes can ask
-- those first; `needs_work_at` is set when an explanation of the card
-- fell short (explain-it-back) and cleared when it is next recalled well.
ALTER TABLE study_cards
  ADD COLUMN IF NOT EXISTS source_doc_id uuid REFERENCES docs ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_block_id text,
  ADD COLUMN IF NOT EXISTS picture_file text,
  ADD COLUMN IF NOT EXISTS misses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS needs_work_at timestamptz,
  ADD COLUMN IF NOT EXISTS needs_work_note text;

-- Misses so far, from the review log (once: only cards still at 0).
UPDATE study_cards c
   SET misses = r.n
  FROM (SELECT card_id, count(*)::int AS n FROM study_reviews
         WHERE rating = 'again' GROUP BY card_id) r
 WHERE r.card_id = c.id AND c.misses = 0;

CREATE INDEX IF NOT EXISTS study_cards_misses
  ON study_cards (user_id, misses DESC) WHERE misses > 0;
CREATE INDEX IF NOT EXISTS study_cards_needs_work
  ON study_cards (user_id) WHERE needs_work_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS study_cards_source
  ON study_cards (source_doc_id) WHERE source_doc_id IS NOT NULL;

-- Exams the person (or their agent) names themselves, not only ones found
-- on the calendar (`own`, keyed "own:<uuid>"), and a goal for any exam.
ALTER TABLE study_exams
  ADD COLUMN IF NOT EXISTS own boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS target text;
