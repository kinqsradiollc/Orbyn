-- Email-to-task: a per-person secret address. Mail sent to it becomes a task.
-- Null means the person hasn't turned it on. The slug is the address's local
-- part, so it's random and hard to guess.
ALTER TABLE users ADD COLUMN inbox_slug text UNIQUE;
