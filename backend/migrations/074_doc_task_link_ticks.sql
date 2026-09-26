-- The tick a page last sent for each of its task lines, reset to the task's
-- own state whenever the task is finished or reopened anywhere else. A save
-- ticks or unticks a task only when the line differs from both, so saving a
-- page again (from an app that still shows an old tick, say) never finishes
-- a task twice: a repeating task moves on to its next occurrence and reads
-- unticked, but the line itself hasn't changed. Empty for links made before
-- this; those go by the task alone, as before.
ALTER TABLE doc_task_links ADD COLUMN IF NOT EXISTS done boolean;
