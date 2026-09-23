-- A number a task moves towards: "signups from 200 to 500". Key results in
-- OKR tracking are tasks with one. Progress follows it while it's set.
ALTER TABLE items
  ADD COLUMN target_value double precision,
  ADD COLUMN current_value double precision,
  ADD COLUMN value_unit text NOT NULL DEFAULT ''
    CHECK (char_length(value_unit) <= 16);
