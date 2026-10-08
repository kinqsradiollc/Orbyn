-- P-256 lets native runtimes use OS keystores on supported older Android versions.
-- Existing Ed25519 enrollments, signatures, fingerprints and message domains stay unchanged.
ALTER TABLE chatgpt_executor_enrollments
  DROP CONSTRAINT chatgpt_executor_enrollments_public_key_check,
  ADD CONSTRAINT chatgpt_executor_enrollments_public_key_check
  CHECK (public_key ~ '^([A-Za-z0-9_-]{59}|[A-Za-z0-9_-]{122})$');
ALTER TABLE chatgpt_executor_challenges
  DROP CONSTRAINT chatgpt_executor_challenges_public_key_check,
  ADD CONSTRAINT chatgpt_executor_challenges_public_key_check
  CHECK (public_key ~ '^([A-Za-z0-9_-]{59}|[A-Za-z0-9_-]{122})$');
