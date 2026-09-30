-- Refresh existing morning cards fairly without starving unsent nights.
ALTER TABLE assistant_nights ADD COLUMN notice_checked_at timestamptz;
