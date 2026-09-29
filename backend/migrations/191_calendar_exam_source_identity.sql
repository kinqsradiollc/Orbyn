-- Legacy exam keys used a calendar's editable name and occurrence start.
-- Retain those keys (and notes, targets, session links and stopped reminders),
-- but bind unambiguous rows to the calendar id and source event uid.
ALTER TABLE study_exams ADD COLUMN IF NOT EXISTS source_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS study_exams_source_ref
  ON study_exams(user_id,source_ref) WHERE source_ref IS NOT NULL;
WITH identities AS (
  SELECT se.user_id,se.exam_key,
    array_agg(DISTINCT 'sub:' || s.id::text || ':' || md5(e.uid) || '|' ||
      to_char(se.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS refs
  FROM study_exams se
  JOIN calendar_subscriptions s ON s.user_id=se.user_id
  JOIN external_events e ON e.subscription_id=s.id
  WHERE NOT se.own AND se.source_ref IS NULL
    AND se.exam_key = 'sub:' || s.name || '|' ||
      to_char(se.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    AND (e.starts_at=se.starts_at OR
      (e.rrule IS NOT NULL AND e.starts_at<=se.starts_at AND e.title=se.title))
  GROUP BY se.user_id,se.exam_key
)
UPDATE study_exams se SET source_ref=i.refs[1]
FROM identities i
WHERE se.user_id=i.user_id AND se.exam_key=i.exam_key
  AND cardinality(i.refs)=1
  AND NOT EXISTS(SELECT 1 FROM study_exams other
    WHERE other.user_id=se.user_id AND other.source_ref=i.refs[1]);
