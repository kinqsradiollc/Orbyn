-- Agent 2 (H0): everything routes to your agent. Each connection has an
-- inbox of what happened that it may see, fed from one place: the function
-- agent_inbox_emit(). In-app notifications reach it through a trigger (so
-- every path that notifies the person also tells their agents, in the same
-- transaction); the few events that aren't notifications (review decisions,
-- answers, tasks from email, team invites, study, failed imports) call it
-- directly. Kept 14 days (lib/sweep.ts). Safe to run again.

-- Which kinds a connection is not sent, and its wake-up address.
ALTER TABLE agent_grants ADD COLUMN IF NOT EXISTS inbox_mutes text[] NOT NULL DEFAULT '{}';
ALTER TABLE agent_grants ADD COLUMN IF NOT EXISTS wake_url text;
ALTER TABLE agent_grants ADD COLUMN IF NOT EXISTS wake_secret_encrypted text;

CREATE TABLE IF NOT EXISTS agent_inbox (
  id bigserial PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES agent_grants ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('booking', 'mention', 'invite', 'deadline',
    'import', 'study', 'email_task', 'review', 'ask', 'answer')),
  -- One item per connection per key: the same event twice is one item.
  dedupe_key text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  -- Who wrote the words: Orbyn itself, a teammate, a booking guest, an
  -- email or an imported file (fenced or hidden for the agent).
  source text NOT NULL DEFAULT 'orbyn',
  -- What it is about (task, doc, project, record, booking, proposal,
  -- question, team, exam), for links and a visibility check on reading.
  entity_type text,
  entity_id uuid,
  team_id uuid,
  project_id uuid,
  state text NOT NULL DEFAULT 'new'
    CHECK (state IN ('new', 'done', 'snoozed', 'dismissed')),
  snooze_until timestamptz,
  note text,
  acked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grant_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS agent_inbox_grant_idx
  ON agent_inbox (grant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agent_inbox_created_idx ON agent_inbox (created_at);

-- Waking a connection's agent: at most one signed call per 5 minutes per
-- connection, carrying only a count and a link; the worker sends it.
CREATE TABLE IF NOT EXISTS agent_wakes (
  grant_id uuid PRIMARY KEY REFERENCES agent_grants ON DELETE CASCADE,
  due_at timestamptz,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_status integer,
  last_error text
);
CREATE INDEX IF NOT EXISTS agent_wakes_due_idx ON agent_wakes (due_at)
  WHERE due_at IS NOT NULL;

-- Questions an agent asked its person (ask_person), when not answered in
-- the chat: a card in Notifications and a push.
CREATE TABLE IF NOT EXISTS agent_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES agent_grants ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  question text NOT NULL,
  detail text,
  choices text[] NOT NULL,
  yes_no boolean NOT NULL DEFAULT false,
  default_choice text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'answered', 'expired')),
  answer text,
  answered_via text CHECK (answered_via IN ('chat', 'app', 'push', 'default')),
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_questions_user_idx
  ON agent_questions (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_questions_open_idx
  ON agent_questions (expires_at) WHERE status = 'open';

-- Standing rules the person wrote for their agents, in plain words,
-- optionally for one kind of inbox item.
CREATE TABLE IF NOT EXISTS agent_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text CHECK (kind IN ('booking', 'mention', 'invite', 'deadline',
    'import', 'study', 'email_task', 'review', 'ask', 'answer')),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_rules_user_idx ON agent_rules (user_id, created_at);

-- A question's notice in the app and on the phone.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template',
    'ask', 'promise', 'calendar', 'import', 'project', 'agent', 'session',
    'review', 'question', 'system'));

/*
 * The one way into agents' inboxes. For each live connection of p_user that
 * may see it: not muted for this kind; bookings only with the bookings
 * toolset; in a space it reaches (Personal, or a team it was given whose
 * agent policy isn't off and the person still belongs to), unless it is
 * addressed to one connection (p_grant); never in a project kept out of the
 * assistant. Deduped per connection by p_key. Each connection that got a new
 * item hears at once (orbyn_live, for its listen streams) and, when it has a
 * wake-up address, its wake-up is due (no sooner than 5 minutes after the
 * last). Returns how many items were added.
 */
CREATE OR REPLACE FUNCTION agent_inbox_emit(
  p_user uuid, p_kind text, p_key text, p_title text, p_body text,
  p_source text, p_entity_type text, p_entity_id uuid, p_team uuid,
  p_project uuid, p_grant uuid DEFAULT NULL
) RETURNS integer AS $$
DECLARE
  rec record;
  n integer := 0;
BEGIN
  IF p_project IS NOT NULL AND EXISTS (
    SELECT 1 FROM projects ko WHERE ko.id = p_project AND ko.assistant_off
  ) THEN
    RETURN 0;
  END IF;
  FOR rec IN
    INSERT INTO agent_inbox (grant_id, user_id, kind, dedupe_key, title, body,
      source, entity_type, entity_id, team_id, project_id)
    SELECT g.id, p_user, p_kind, left(p_key, 300), left(p_title, 200),
      left(coalesce(p_body, ''), 2000), coalesce(p_source, 'orbyn'),
      p_entity_type, p_entity_id, p_team, p_project
      FROM agent_grants g
     WHERE g.user_id = p_user
       AND g.revoked_at IS NULL AND g.suspended_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at > now())
       AND (g.kind <> 'oauth' OR g.authorized_at IS NOT NULL)
       AND NOT (p_kind = ANY (g.inbox_mutes))
       AND (p_kind <> 'booking' OR 'booking' = ANY (g.toolsets))
       AND CASE
         WHEN p_grant IS NOT NULL THEN g.id = p_grant
         WHEN p_team IS NULL THEN g.personal
         ELSE (g.team_ids IS NULL OR p_team = ANY (g.team_ids))
           AND EXISTS (SELECT 1 FROM teams t
                        JOIN team_members m ON m.team_id = t.id AND m.user_id = p_user
                       WHERE t.id = p_team AND t.agent_access <> 'off')
       END
    ON CONFLICT (grant_id, dedupe_key) DO NOTHING
    RETURNING grant_id
  LOOP
    n := n + 1;
    PERFORM pg_notify('orbyn_live', json_build_object(
      'kind', 'agent_inbox', 'user', p_user, 'entity_id', rec.grant_id)::text);
    INSERT INTO agent_wakes (grant_id, due_at)
      SELECT g.id, now() FROM agent_grants g
       WHERE g.id = rec.grant_id AND g.wake_url IS NOT NULL
    ON CONFLICT (grant_id) DO UPDATE
      SET due_at = coalesce(agent_wakes.due_at,
        greatest(now(), agent_wakes.sent_at + interval '5 minutes')),
          attempts = CASE WHEN agent_wakes.due_at IS NULL THEN 0
                          ELSE agent_wakes.attempts END;
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql;

/*
 * In-app notifications that matter to an agent become inbox items: booking
 * requests, mentions, answers to invites, deadlines at risk or not fully
 * planned, finished imports, and teammates' asks and promises. The space and
 * project come from the task, page, project or record the notice is about.
 * A failure here never stops the notice itself.
 */
CREATE OR REPLACE FUNCTION agent_inbox_from_notice() RETURNS trigger AS $$
DECLARE
  v_kind text;
  v_team uuid;
  v_project uuid;
  v_type text;
  v_id uuid;
  v_source text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent_grants g
                  WHERE g.user_id = NEW.user_id AND g.revoked_at IS NULL) THEN
    RETURN NEW;
  END IF;
  v_kind := CASE NEW.kind
    WHEN 'booking' THEN 'booking'
    WHEN 'mention' THEN 'mention'
    WHEN 'rsvp' THEN 'invite'
    WHEN 'at_risk' THEN 'deadline'
    WHEN 'deadline' THEN 'deadline'
    WHEN 'project' THEN 'deadline'
    WHEN 'import' THEN 'import'
    WHEN 'ask' THEN 'ask'
    WHEN 'promise' THEN 'ask'
  END;
  IF v_kind IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    IF NEW.item_id IS NOT NULL THEN
      SELECT i.team_id, i.project_id INTO v_team, v_project
        FROM items i WHERE i.id = NEW.item_id;
      v_type := 'task';
      v_id := NEW.item_id;
    ELSIF NEW.ref ~ '^doc:[0-9a-f-]{36}' THEN
      v_id := substring(NEW.ref FROM 5 FOR 36)::uuid;
      SELECT d.team_id, d.project_id INTO v_team, v_project
        FROM docs d WHERE d.id = v_id;
      v_type := 'doc';
    ELSIF NEW.kind = 'project' AND NEW.ref ~ '^[0-9a-f-]{36}:' THEN
      v_id := substring(NEW.ref FROM 1 FOR 36)::uuid;
      SELECT p.team_id, p.id INTO v_team, v_project
        FROM projects p WHERE p.id = v_id;
      v_type := 'project';
    ELSIF NEW.kind = 'promise' AND NEW.ref ~ '^[0-9a-f-]{36}$' THEN
      v_id := NEW.ref::uuid;
      SELECT w.team_id, w.project_id INTO v_team, v_project
        FROM work_records w WHERE w.id = v_id;
      v_type := 'record';
    ELSIF NEW.kind = 'booking' AND NEW.ref ~ '^[0-9a-f-]{36}$' THEN
      v_id := NEW.ref::uuid;
      v_type := 'booking';
    END IF;
    v_source := CASE
      WHEN NEW.kind IN ('mention', 'ask', 'promise') THEN 'teammate'
      WHEN NEW.kind = 'booking' THEN 'booking_guest'
      ELSE 'orbyn' END;
    PERFORM agent_inbox_emit(NEW.user_id, v_kind,
      'notice:' || NEW.kind || ':' || coalesce(NEW.ref, '') || ':'
        || coalesce(NEW.item_id::text, '') || ':' || md5(NEW.title),
      NEW.title, NEW.body, v_source, v_type, v_id, v_team, v_project, NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'agent inbox: %', SQLERRM;
  END;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notifications_agent_inbox ON notifications;
CREATE TRIGGER notifications_agent_inbox
  AFTER INSERT ON notifications
  FOR EACH ROW
  WHEN (NEW.channel = 'inapp' AND NEW.kind IN ('booking', 'mention', 'rsvp',
    'at_risk', 'deadline', 'project', 'import', 'ask', 'promise'))
  EXECUTE FUNCTION agent_inbox_from_notice();
