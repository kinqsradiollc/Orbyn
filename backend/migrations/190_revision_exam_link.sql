-- Revision bookings follow the exam identity through task and exam renames.
ALTER TABLE items ADD COLUMN study_exam_id uuid REFERENCES study_exams(id) ON DELETE SET NULL;
CREATE INDEX items_study_exam ON items(user_id, study_exam_id) WHERE study_exam_id IS NOT NULL;

-- Only associate old Study tasks when the original title and deadline identify one exam.
UPDATE items i SET study_exam_id = (
  SELECT e.id FROM study_exams e WHERE e.user_id=i.user_id
    AND i.title='Revise for '||e.title AND i.due_at=e.starts_at
) WHERE i.notes LIKE 'Planned by Study.%' AND (
  SELECT count(*) FROM study_exams e WHERE e.user_id=i.user_id
    AND i.title='Revise for '||e.title AND i.due_at=e.starts_at
) = 1;
