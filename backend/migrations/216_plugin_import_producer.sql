-- Immutable origin survives grant/client deletion. A missing FK must never turn
-- an external job into a first-party import with the user's broader authority.
ALTER TABLE imports ADD COLUMN IF NOT EXISTS plugin_owned boolean NOT NULL DEFAULT false;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS plugin_grant_id uuid REFERENCES agent_grants(id) ON DELETE SET NULL;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS plugin_client_id text REFERENCES oauth_clients(id) ON DELETE SET NULL;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS plugin_resource text;

-- Existing candidate jobs have no authenticated producer snapshot. Keep origin
-- explicit and fail closed until reimported; never guess an original recipient.
UPDATE imports i SET plugin_owned=true
  WHERE EXISTS (SELECT 1 FROM plugin_import_jobs j WHERE j.import_id=i.id);

-- Also identify legacy synchronous plugin starts while their durable activity
-- attribution remains. Only new starts have a trustworthy recipient snapshot.
UPDATE imports i SET plugin_owned=true
  WHERE EXISTS (
    SELECT 1 FROM agent_activity a JOIN agent_grants g ON g.id=a.grant_id
    WHERE a.user_id=i.user_id AND a.tool='start_import'
      AND a.outcome='ok' AND g.resource_kind='plugin'
      AND a.target_ids @> ARRAY['import:' || i.id::text]
  );
