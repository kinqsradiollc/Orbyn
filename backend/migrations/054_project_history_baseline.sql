-- Projects made before the activity log existed have no creation event. Capture
-- their present planning state once, so later snapshots have an honest start.
INSERT INTO project_activity
  (project_id, actor_id, kind, entity_type, entity_id, summary, after_state)
SELECT p.id, NULL, 'project_changed', 'project', p.id,
  'Project history starts here',
  jsonb_build_object(
    'name', p.name, 'summary', p.summary, 'status', p.status,
    'deadline', p.deadline,
    'baseline_stages', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'position', s.position) ORDER BY s.position), '[]'::jsonb)
      FROM project_stages s WHERE s.project_id = p.id),
    'baseline_tasks', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'title', i.title, 'status', i.status,
      'due_at', i.due_at, 'progress', i.progress, 'stage_id', i.stage_id)), '[]'::jsonb)
      FROM items i WHERE i.project_id = p.id AND i.kind = 'task'),
    'baseline_notes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'title', d.title, 'version', d.version)), '[]'::jsonb)
      FROM docs d WHERE d.project_id = p.id),
    'baseline_records', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'kind', w.kind, 'title', w.title, 'status', w.status,
      'due_at', w.due_at, 'review_at', w.review_at)), '[]'::jsonb)
      FROM work_records w WHERE w.project_id = p.id)
  )
FROM projects p
WHERE NOT EXISTS (
  SELECT 1 FROM project_activity a
  WHERE a.project_id = p.id AND a.kind = 'project_created'
);
