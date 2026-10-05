-- A refresh token can be consumed only once. Persist its claim before HTTP and
-- require reconnect after uncertain completion rather than replaying the token.
ALTER TABLE agent_channel_installations
 ADD COLUMN refresh_state text NOT NULL DEFAULT 'ready'
   CHECK(refresh_state IN ('ready','refreshing','unknown','reconnect')),
 ADD COLUMN refresh_claim uuid,
 ADD COLUMN refresh_lease_until timestamptz,
 ADD COLUMN refresh_config_hash text,
 ADD COLUMN refresh_available_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN refresh_attempts integer NOT NULL DEFAULT 0 CHECK(refresh_attempts BETWEEN 0 AND 3),
 ADD CONSTRAINT agent_channel_refresh_claim CHECK(
   (refresh_state='refreshing')=(refresh_claim IS NOT NULL AND refresh_lease_until IS NOT NULL AND refresh_config_hash IS NOT NULL)
   AND ((refresh_state='refreshing') OR (refresh_claim IS NULL AND refresh_lease_until IS NULL AND refresh_config_hash IS NULL))
 );
CREATE INDEX agent_channel_refresh_due ON agent_channel_installations(token_expires_at,refresh_available_at)
 WHERE provider='slack' AND disconnected_at IS NULL AND refresh_state='ready' AND token_expires_at IS NOT NULL;
