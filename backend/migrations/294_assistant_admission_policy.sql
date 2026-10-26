-- Seed once; runtime startup never overwrites an operator-applied policy.
-- Stop/fence legacy claimers before activation: old binaries do not read this row.
CREATE TABLE assistant_admission_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  revision integer NOT NULL CHECK (revision > 0),
  global_limit integer NOT NULL CHECK (global_limit BETWEEN 0 AND 8),
  interactive_limit integer NOT NULL CHECK (interactive_limit BETWEEN 0 AND 4),
  background_limit integer NOT NULL CHECK (background_limit BETWEEN 0 AND 2),
  overnight_limit integer NOT NULL CHECK (overnight_limit BETWEEN 0 AND 2),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO assistant_admission_policy(id,revision,global_limit,interactive_limit,background_limit,overnight_limit)
VALUES(true,1,8,4,2,2);
