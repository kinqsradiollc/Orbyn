-- Route a round-robin booking to a specific host based on an answer, e.g.
-- "Plan = Enterprise" -> Sam. Rules are tried in order; a match prefers that
-- host when they're free, otherwise the fair pick still applies.
ALTER TABLE booking_pages
  ADD COLUMN routing jsonb NOT NULL DEFAULT '[]';
