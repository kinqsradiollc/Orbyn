-- Let the planner correct optimistic estimates from how long tasks really take.
-- Off by default: the planner uses your estimate as-is until you turn this on.
ALTER TABLE planner_prefs
  ADD COLUMN learn_estimates boolean NOT NULL DEFAULT false;
