-- Keep audit entries attributable after the acting account is deleted:
-- actor_id is cleared on delete, so the actor's email is saved with the entry.
ALTER TABLE audit_log ADD COLUMN actor_email text;
UPDATE audit_log a SET actor_email = u.email FROM users u WHERE u.id = a.actor_id;
