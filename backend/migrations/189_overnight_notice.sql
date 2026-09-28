-- The claim and queued notices commit together, so restarts cannot send twice.
ALTER TABLE assistant_nights ADD COLUMN notified_at timestamptz;
