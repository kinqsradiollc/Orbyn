-- Content-only edits should not resend an already delivered deadline reminder.
ALTER TABLE items ADD COLUMN reminder_version integer NOT NULL DEFAULT 1;
UPDATE items SET reminder_version=version;
