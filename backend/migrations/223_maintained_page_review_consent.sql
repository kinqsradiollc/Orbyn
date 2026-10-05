ALTER TABLE assistant_page_runs ADD COLUMN requires_review boolean NOT NULL DEFAULT false;
-- Preserve the stricter consent for work queued before its review flag was captured.
UPDATE assistant_page_runs SET requires_review=true WHERE lane='overnight';
