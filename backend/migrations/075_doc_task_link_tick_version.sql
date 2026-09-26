-- The first version of the page that shows each task line as its task now
-- stands: the version a save of the page gave it when the page's tick
-- counted, or the version the page moved on to when the task was finished or
-- reopened anywhere else. An editor says which version its ticks were taken
-- from (the X-Orbyn-Ticks-From header on PUT /docs/:id); a tick taken from
-- this version or later is one the person made on the line as it stands, so
-- it counts even when the page last said the same. Older ticks are ones the
-- page already said. Empty until a line's tick or task changes.
ALTER TABLE doc_task_links ADD COLUMN IF NOT EXISTS done_version integer;
