-- One Slack bot credential pair per app/workspace/bot. Recipient identities and
-- explicit DM consent remain owner-local. Legacy candidate pairs cannot prove
-- which one-use refresh token survived competing owners: require fresh review.
CREATE TABLE agent_channel_bot_vaults (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider text NOT NULL CHECK(provider='slack'),
 app_id text NOT NULL,
 workspace_id text NOT NULL,
 bot_user_id text NOT NULL,
 installer_external_user_id text NOT NULL,
 scopes text[] NOT NULL,
 credentials_encrypted text,
 token_expires_at timestamptz,
 refresh_state text NOT NULL DEFAULT 'ready' CHECK(refresh_state IN ('ready','refreshing','unknown','reconnect')),
 refresh_claim uuid,
 refresh_lease_until timestamptz,
 refresh_config_hash text,
 refresh_available_at timestamptz NOT NULL DEFAULT now(),
 refresh_attempts integer NOT NULL DEFAULT 0 CHECK(refresh_attempts BETWEEN 0 AND 3),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,app_id,workspace_id,bot_user_id),
 CHECK((refresh_state='refreshing')=(refresh_claim IS NOT NULL AND refresh_lease_until IS NOT NULL AND refresh_config_hash IS NOT NULL)),
 CHECK(refresh_state='refreshing' OR (refresh_claim IS NULL AND refresh_lease_until IS NULL AND refresh_config_hash IS NULL))
);
CREATE INDEX agent_channel_bot_rotation_due ON agent_channel_bot_vaults(token_expires_at,refresh_available_at)
 WHERE refresh_state='ready' AND token_expires_at IS NOT NULL AND credentials_encrypted IS NOT NULL;
ALTER TABLE agent_channel_installations ADD COLUMN bot_vault_id uuid REFERENCES agent_channel_bot_vaults(id);
-- Drop only the two old credential/DM checks, then prohibit owner-local secrets.
DO $$ DECLARE constraint_name text; BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint
 WHERE conrelid='agent_channel_installations'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%credentials_encrypted%'
 LOOP EXECUTE format('ALTER TABLE agent_channel_installations DROP CONSTRAINT %I',constraint_name); END LOOP;
END $$;
UPDATE agent_channel_installations SET credentials_encrypted=NULL,token_expires_at=NULL,
 dm_enabled=false,version=version+1,refresh_state='reconnect',refresh_claim=NULL,
 refresh_lease_until=NULL,refresh_config_hash=NULL,refresh_attempts=0,updated_at=now();
ALTER TABLE agent_channel_installations
 ADD CONSTRAINT agent_channel_no_owner_secret CHECK(credentials_encrypted IS NULL AND token_expires_at IS NULL),
 ADD CONSTRAINT agent_channel_dm_mapping CHECK(NOT dm_enabled OR (disconnected_at IS NULL AND bot_vault_id IS NOT NULL));
CREATE INDEX agent_channel_bot_owners ON agent_channel_installations(bot_vault_id) WHERE disconnected_at IS NULL;
-- Account deletion also removes its mapping. Erase the last locally authorised
-- bot pair without uninstalling the workspace app or disturbing other owners.
CREATE FUNCTION clear_unowned_agent_channel_bot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.bot_vault_id IS NOT NULL AND (TG_OP='DELETE' OR NEW.bot_vault_id IS DISTINCT FROM OLD.bot_vault_id OR NEW.disconnected_at IS NOT NULL) THEN
  PERFORM id FROM agent_channel_bot_vaults WHERE id=OLD.bot_vault_id FOR UPDATE;
  UPDATE agent_channel_bot_vaults v SET credentials_encrypted=NULL,token_expires_at=NULL,
   refresh_state='reconnect',refresh_claim=NULL,refresh_lease_until=NULL,refresh_config_hash=NULL,updated_at=now()
  WHERE v.id=OLD.bot_vault_id AND NOT EXISTS(SELECT 1 FROM agent_channel_installations c
   WHERE c.bot_vault_id=v.id AND c.disconnected_at IS NULL);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER agent_channel_bot_unowned AFTER DELETE OR UPDATE OF bot_vault_id,disconnected_at
 ON agent_channel_installations FOR EACH ROW EXECUTE FUNCTION clear_unowned_agent_channel_bot();
