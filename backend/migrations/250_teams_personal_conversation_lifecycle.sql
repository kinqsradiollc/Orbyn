-- Lookup only the bot/tenant/conversation proved by a personal linking message.
-- Installation actors need not be the recipient; email and installer IDs cannot revoke other mappings.
ALTER TABLE agent_channel_teams_installations
 ADD COLUMN conversation_route_hash text CHECK(conversation_route_hash IS NULL OR length(conversation_route_hash)=64),
 ADD COLUMN conversation_bound_at timestamptz,
 ADD CHECK((conversation_route_hash IS NULL)=(conversation_bound_at IS NULL)),
 ADD CHECK(conversation_route_hash IS NULL OR conversation_encrypted IS NOT NULL);
CREATE UNIQUE INDEX teams_personal_conversation_owner
 ON agent_channel_teams_installations(bot_app_id,tenant_id,conversation_route_hash)
 WHERE conversation_route_hash IS NOT NULL;
-- Earlier candidate references have no authenticated lifecycle timestamp.
-- Reconnect rather than inventing a proof from encrypted data or installation actors.
UPDATE agent_channel_teams_installations SET dm_enabled=false,version=version+1,updated_at=now()
 WHERE conversation_encrypted IS NOT NULL;
