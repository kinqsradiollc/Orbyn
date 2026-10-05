-- Reviewed OAuth captures cannot overwrite a newer canonical refresh/reconnect.
ALTER TABLE agent_channel_bot_vaults ADD COLUMN credential_generation bigint NOT NULL DEFAULT 1 CHECK(credential_generation>0);
ALTER TABLE agent_channel_oauth_pending
 ADD COLUMN bot_vault_id uuid REFERENCES agent_channel_bot_vaults(id) ON DELETE SET NULL,
 ADD COLUMN bot_credential_generation bigint CHECK(bot_credential_generation>=0);
UPDATE agent_channel_oauth_pending SET state='failed',exchange_claim=NULL,installation_encrypted=NULL
 WHERE state IN ('pending','exchanging','ready');
CREATE FUNCTION advance_agent_channel_credential_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.credentials_encrypted IS DISTINCT FROM OLD.credentials_encrypted
 OR NEW.refresh_claim IS DISTINCT FROM OLD.refresh_claim
 OR NEW.refresh_state IS DISTINCT FROM OLD.refresh_state THEN
  NEW.credential_generation:=OLD.credential_generation+1;
 ELSE NEW.credential_generation:=OLD.credential_generation;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_channel_credential_generation BEFORE UPDATE ON agent_channel_bot_vaults
 FOR EACH ROW EXECUTE FUNCTION advance_agent_channel_credential_generation();
