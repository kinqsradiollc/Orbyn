-- A stable event order lets the project time machine reconstruct the state
-- after any change. Existing events are ordered by their recorded time and
-- UUID; new events use sequence order, including changes in one transaction.
CREATE SEQUENCE project_activity_event_order_seq;
ALTER TABLE project_activity ADD COLUMN event_order bigint;

WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS ordinal
  FROM project_activity
)
UPDATE project_activity a SET event_order = ordered.ordinal
FROM ordered WHERE ordered.id = a.id;

SELECT setval('project_activity_event_order_seq',
  COALESCE((SELECT max(event_order) FROM project_activity), 0) + 1, false);
ALTER TABLE project_activity
  ALTER COLUMN event_order SET DEFAULT nextval('project_activity_event_order_seq'),
  ALTER COLUMN event_order SET NOT NULL;
ALTER SEQUENCE project_activity_event_order_seq OWNED BY project_activity.event_order;
CREATE UNIQUE INDEX project_activity_event_order_unique ON project_activity(event_order);
CREATE INDEX project_activity_time_machine ON project_activity(project_id, event_order DESC);
