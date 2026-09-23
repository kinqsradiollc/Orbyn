-- Time spent together is a transparent meeting cost without salary estimates.
ALTER TABLE work_records
  ADD COLUMN meeting_minutes integer CHECK (meeting_minutes BETWEEN 1 AND 1440),
  ADD COLUMN participant_count integer CHECK (participant_count BETWEEN 1 AND 100),
  ADD CONSTRAINT work_records_meeting_effort_pair
    CHECK ((meeting_minutes IS NULL) = (participant_count IS NULL)),
  ADD CONSTRAINT work_records_meeting_effort_kind
    CHECK (meeting_minutes IS NULL OR kind = 'meeting_outcome');
