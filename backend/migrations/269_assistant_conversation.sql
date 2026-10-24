-- Delivery destinations are independent of execution chats. A retired stream
-- remains a content-free tombstone so pending work cannot target a replacement.
CREATE TABLE assistant_conversation_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  chat_id uuid UNIQUE REFERENCES ai_chats ON DELETE SET NULL,
  personal boolean NOT NULL DEFAULT false,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK(last_sequence >= 0),
  read_sequence bigint NOT NULL DEFAULT 0 CHECK(read_sequence BETWEEN 0 AND last_sequence),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,owner_id),
  CHECK(retired_at IS NOT NULL OR chat_id IS NOT NULL)
);
CREATE UNIQUE INDEX assistant_personal_conversation_active
  ON assistant_conversation_streams(owner_id) WHERE personal AND retired_at IS NULL;

CREATE TABLE assistant_delivery_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  work_kind text NOT NULL CHECK(work_kind IN ('job','page_run','night')),
  -- Kept independently of disposable execution rows for replay identity.
  work_id uuid NOT NULL,
  destination_id uuid NOT NULL,
  FOREIGN KEY(destination_id,owner_id) REFERENCES assistant_conversation_streams(id,owner_id) ON DELETE CASCADE,
  origin_chat_id uuid REFERENCES ai_chats ON DELETE SET NULL,
  origin_turn_id uuid,
  reason text NOT NULL CHECK(reason IN ('origin','personal','schedule')),
  lane text NOT NULL CHECK(lane IN ('background','overnight')),
  sources_checked boolean NOT NULL DEFAULT false,
  timezone text NOT NULL CHECK(length(timezone) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,work_kind,work_id)
);
CREATE TABLE assistant_delivery_sources (
  binding_id uuid NOT NULL REFERENCES assistant_delivery_bindings ON DELETE CASCADE,
  source_kind text NOT NULL CHECK(source_kind IN ('task','doc','project','record','goal','routine','habit','exam','team','calendar','comment')),
  source_id uuid NOT NULL,
  PRIMARY KEY(binding_id,source_kind,source_id)
);

CREATE TABLE assistant_delivery_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id uuid NOT NULL REFERENCES assistant_delivery_bindings ON DELETE CASCADE,
  event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 160),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','deferred','published','suppressed','blocked')),
  reason text CHECK(reason IN ('destination_retired','permission_revoked','unknown_sources','unchanged','empty','muted','rollout_paused','account_disabled')),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND pg_column_size(payload)<=262144),
  fingerprint text CHECK(length(fingerprint) BETWEEN 1 AND 128),
  available_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(binding_id,event_key)
);
CREATE INDEX assistant_delivery_pending ON assistant_delivery_intents(available_at,id)
  WHERE state IN ('pending','deferred');

CREATE TABLE assistant_conversation_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL REFERENCES assistant_conversation_streams ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK(sequence > 0),
  kind text NOT NULL CHECK(kind IN ('turn','update')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  turn_id uuid,
  role text CHECK(role IN ('user','assistant')),
  intent_id uuid UNIQUE REFERENCES assistant_delivery_intents ON DELETE CASCADE,
  reply_to_entry_id uuid REFERENCES assistant_conversation_entries ON DELETE SET NULL,
  -- For turns this is the retained authoritative saved-turn record, updated
  -- under the chat owner's transaction; execution history is a bounded window.
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND pg_column_size(payload)<=262144),
  sources_checked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(destination_id,sequence),
  UNIQUE(destination_id,turn_id,role),
  CHECK((kind='turn' AND turn_id IS NOT NULL AND role IS NOT NULL AND intent_id IS NULL)
     OR (kind='update' AND turn_id IS NULL AND role IS NULL AND intent_id IS NOT NULL))
);
CREATE TABLE assistant_conversation_entry_sources (
  entry_id uuid NOT NULL REFERENCES assistant_conversation_entries ON DELETE CASCADE,
  source_kind text NOT NULL CHECK(source_kind IN ('task','doc','project','record','goal','routine','habit','exam','team','calendar','comment')),
  source_id uuid NOT NULL,
  PRIMARY KEY(entry_id,source_kind,source_id)
);
CREATE TABLE assistant_conversation_alerts (
  entry_id uuid PRIMARY KEY REFERENCES assistant_conversation_entries ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sent','suppressed','blocked')),
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_conversation_alert_pending ON assistant_conversation_alerts(available_at,entry_id)
  WHERE state='pending';

-- Runs never recreate or reroute a retired destination. Erase content and source
-- references on delete/sweep, retaining only work/event identity for replay.
CREATE FUNCTION retire_assistant_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stream_id uuid;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.swept_at IS NULL OR OLD.swept_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  UPDATE assistant_conversation_streams SET retired_at=clock_timestamp()
    WHERE chat_id=OLD.id AND retired_at IS NULL RETURNING id INTO stream_id;
  IF stream_id IS NOT NULL THEN
    DELETE FROM assistant_conversation_entries WHERE destination_id=stream_id;
    DELETE FROM assistant_delivery_sources WHERE binding_id IN (
      SELECT id FROM assistant_delivery_bindings WHERE destination_id=stream_id);
    UPDATE assistant_delivery_intents SET state='blocked',reason='destination_retired',
      payload='{}'::jsonb,fingerprint=NULL,updated_at=clock_timestamp()
      WHERE binding_id IN (SELECT id FROM assistant_delivery_bindings WHERE destination_id=stream_id);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$$;
CREATE TRIGGER assistant_conversation_retire BEFORE DELETE OR UPDATE OF swept_at ON ai_chats
  FOR EACH ROW EXECUTE FUNCTION retire_assistant_conversation();
