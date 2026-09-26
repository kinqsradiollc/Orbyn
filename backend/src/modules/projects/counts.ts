/**
 * A project's counts, as "7 of 12 done": its open and finished tasks, for a
 * query over `projects p`. Cancelled tasks and events filed in a project
 * aren't work to do, so neither side counts them.
 */
export const PROJECT_COUNTS = `(SELECT count(*)::int FROM items i
    WHERE i.project_id = p.id AND i.kind = 'task' AND i.status <> 'cancelled') AS task_count,
  (SELECT count(*)::int FROM items i
    WHERE i.project_id = p.id AND i.kind = 'task' AND i.status = 'done') AS done_count`;
