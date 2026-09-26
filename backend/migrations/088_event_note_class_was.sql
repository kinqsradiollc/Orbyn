-- A class's note whose class is gone (DAY-02): skipped, deleted, dropped by
-- a new pattern, or lost when the repeat is taken off. The note is kept as a
-- note of the whole event (`occurrence` is cleared), and `class_was` keeps
-- the class it was for, so the series' own note — the running note of a
-- weekly one-to-one — still opens first, and a former class's note stands
-- in only when the series has none of its own. Empty for every other page.
ALTER TABLE docs ADD COLUMN IF NOT EXISTS class_was timestamptz;
