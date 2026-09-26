-- One assistant-suggested session move or removal is reviewed with the turn.
-- Applying it rechecks the owner's current session and calendar.
ALTER TABLE proposals ADD COLUMN session_change jsonb;
