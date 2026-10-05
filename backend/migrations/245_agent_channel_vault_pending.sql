-- Candidate-era unconfirmed bot pairs may already have been replaced by another
-- installer. They cannot bypass the canonical-vault upgrade's explicit reconnect.
UPDATE agent_channel_oauth_pending SET state='failed',exchange_claim=NULL,installation_encrypted=NULL
 WHERE state IN ('pending','exchanging','ready');
