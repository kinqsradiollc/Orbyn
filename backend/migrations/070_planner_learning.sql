-- What the planner learns from someone's own history, beyond estimates:
-- putting demanding work in the hours that usually go well for them, and not
-- asking more of a day than they usually get through. Both are on by default
-- and do nothing until there's enough history (see backend/src/modules/planner/learning.ts).
ALTER TABLE planner_prefs
  ADD COLUMN learn_rhythm boolean NOT NULL DEFAULT true,
  ADD COLUMN balance_load boolean NOT NULL DEFAULT true;
