-- Teams has its own reviewed conversation mapping and durable delivery namespace.
CREATE TABLE agent_channel_teams_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES agent_channel_teams_installations(id) ON DELETE CASCADE,
 connection_version integer NOT NULL CHECK(connection_version>0),
 source_kind text NOT NULL CHECK(source_kind IN ('job','night')),
 source_id uuid NOT NULL,
 event_key text NOT NULL,
 event text NOT NULL CHECK(event IN ('done','failed','waiting','overnight')),
 waiting_id text NOT NULL DEFAULT '',
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','dispatching','sent','failed','unknown','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 claim_id uuid,
 lease_until timestamptz,
 activity_id text CHECK(activity_id IS NULL OR length(activity_id) BETWEEN 1 AND 500),
 available_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,connection_version,source_kind,source_id,event_key),
 CHECK((state='dispatching')=(claim_id IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state<>'sent' OR activity_id IS NOT NULL),
 CHECK((source_kind='night')=(event='overnight'))
);
CREATE INDEX agent_channel_teams_outbox_queue ON agent_channel_teams_outbox(available_at,created_at) WHERE state='queued';
