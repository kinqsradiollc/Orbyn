-- Message intent commits before dispatch. Unknown outcomes never return to queued.
CREATE TABLE agent_channel_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES agent_channel_installations(id) ON DELETE CASCADE,
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
 channel_id text,
 message_ts text,
 available_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,connection_version,source_kind,source_id,event_key),
 CHECK((state='dispatching')=(claim_id IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state<>'sent' OR (channel_id IS NOT NULL AND message_ts IS NOT NULL)),
 CHECK((source_kind='night')=(event='overnight'))
);
CREATE INDEX agent_channel_outbox_queue ON agent_channel_outbox(available_at,created_at) WHERE state='queued';

-- Reuse the existing owner source fence for job/chat dependency and policy
-- changes not covered by Agenda's source-table triggers. No outbound snapshot
-- can race a committed dependency/container/account access change.
CREATE FUNCTION fence_agent_channel_source_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 previous jsonb := CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 current_row jsonb := CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
 owners uuid[] := ARRAY[(previous->>'user_id')::uuid,(current_row->>'user_id')::uuid,
   (previous->>'created_by')::uuid,(current_row->>'created_by')::uuid];
 chats uuid[] := ARRAY[(previous->>'chat_id')::uuid,(current_row->>'chat_id')::uuid];
 jobs uuid[] := ARRAY[(previous->>'job_id')::uuid,(current_row->>'job_id')::uuid];
 spaces uuid[] := ARRAY[(previous->>'team_id')::uuid,(current_row->>'team_id')::uuid];
 affected uuid;
BEGIN
 owners := owners || ARRAY(SELECT user_id FROM ai_chats WHERE id=ANY(chats)
   UNION SELECT user_id FROM ai_jobs WHERE id=ANY(jobs));
 FOR affected IN SELECT owner_id FROM unnest(owners) owner_id WHERE owner_id IS NOT NULL
   UNION SELECT user_id FROM team_members WHERE team_id=ANY(spaces) ORDER BY 1 LOOP
   PERFORM pg_advisory_xact_lock_shared(hashtextextended('agenda-sources:' || affected::text,0));
 END LOOP;
 RETURN NULL;
END;
$$;
DO $$
DECLARE source_table text;
BEGIN
 FOREACH source_table IN ARRAY ARRAY['ai_chats','ai_jobs','assistant_chat_sources','assistant_job_sources',
  'goals','agent_routines','work_records','assistant_page_bindings','assistant_nights','agent_grants'] LOOP
  EXECUTE format('CREATE TRIGGER agent_channel_source_fence AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fence_agent_channel_source_write()',source_table);
 END LOOP;
END;
$$;
