-- The planner preview can look two weeks ahead (its days view).
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_days_check;
ALTER TABLE plans ADD CONSTRAINT plans_days_check CHECK (days BETWEEN 1 AND 14);
