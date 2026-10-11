-- Codes consumed concurrently with renewed consent cannot inherit its authority.
ALTER TABLE agent_grants ADD COLUMN consent_version bigint NOT NULL DEFAULT 0;
ALTER TABLE oauth_codes ADD COLUMN consent_version bigint NOT NULL DEFAULT 0;
