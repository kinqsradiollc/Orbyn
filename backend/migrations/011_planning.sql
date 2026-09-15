-- Planning: task sizes, lists and tags, time blocks, repeating items, the
-- planner, team assignment, booking pages, API keys, webhooks and the
-- calendar feed. Everything stays on this server; nothing syncs to outside
-- calendars.

-- Items: size, list, assignee, where, and how they repeat.
ALTER TABLE items
  ADD COLUMN estimate_minutes integer
    CHECK (estimate_minutes IS NULL OR estimate_minutes BETWEEN 1 AND 10080),
  ADD COLUMN spent_minutes integer NOT NULL DEFAULT 0 CHECK (spent_minutes >= 0),
  ADD COLUMN list_id uuid,
  ADD COLUMN assignee_id uuid REFERENCES users ON DELETE SET NULL,
  ADD COLUMN location text NOT NULL DEFAULT '' CHECK (length(location) <= 300),
  ADD COLUMN meeting_url text NOT NULL DEFAULT '' CHECK (length(meeting_url) <= 500),
  -- A subset of RFC 5545 RRULE, expanded in the item's own time zone.
  ADD COLUMN rrule text CHECK (rrule IS NULL OR length(rrule) <= 200),
  ADD COLUMN timezone text NOT NULL DEFAULT 'UTC',
  -- First occurrence of a repeating item; due_at moves to the next one.
  ADD COLUMN series_start timestamptz,
  -- Occurrences removed from a series ("delete this one").
  ADD COLUMN exdates timestamptz[] NOT NULL DEFAULT '{}';
CREATE INDEX items_assignee ON items (assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX items_repeating ON items (due_at) WHERE rrule IS NOT NULL;

-- Lists and tags belong to a person (team_id null) or to a team.
CREATE TABLE lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  color varchar(9) NOT NULL DEFAULT '#376c51',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lists_personal ON lists (user_id) WHERE team_id IS NULL;
CREATE INDEX lists_team ON lists (team_id) WHERE team_id IS NOT NULL;
ALTER TABLE items ADD CONSTRAINT items_list_fk
  FOREIGN KEY (list_id) REFERENCES lists ON DELETE SET NULL;
CREATE INDEX items_list ON items (list_id) WHERE list_id IS NOT NULL;

CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  name varchar(40) NOT NULL,
  color varchar(9) NOT NULL DEFAULT '#6d8a6f',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tags_personal_name ON tags (user_id, lower(name)) WHERE team_id IS NULL;
CREATE UNIQUE INDEX tags_team_name ON tags (team_id, lower(name)) WHERE team_id IS NOT NULL;

CREATE TABLE item_tags (
  item_id uuid NOT NULL REFERENCES items ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX item_tags_tag ON item_tags (tag_id);

-- Time set aside to work on a task. Each person has their own blocks.
CREATE TABLE time_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'planner')),
  plan_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at AND end_at - start_at <= interval '24 hours')
);
CREATE INDEX time_blocks_user ON time_blocks (user_id, start_at);
CREATE INDEX time_blocks_item ON time_blocks (item_id);

-- How each person likes to work; the planner and calendar read these.
CREATE TABLE planner_prefs (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'UTC',
  work_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  work_start time NOT NULL DEFAULT '09:00',
  work_end time NOT NULL DEFAULT '17:00',
  pad_percent smallint NOT NULL DEFAULT 20 CHECK (pad_percent BETWEEN 0 AND 100),
  split_after_minutes smallint NOT NULL DEFAULT 90
    CHECK (split_after_minutes BETWEEN 15 AND 480),
  min_block_minutes smallint NOT NULL DEFAULT 25
    CHECK (min_block_minutes BETWEEN 5 AND 240),
  break_level text NOT NULL DEFAULT 'normal'
    CHECK (break_level IN ('none', 'light', 'normal', 'intense')),
  horizon_days smallint NOT NULL DEFAULT 1 CHECK (horizon_days BETWEEN 1 AND 7),
  buffer_before_minutes smallint NOT NULL DEFAULT 0
    CHECK (buffer_before_minutes BETWEEN 0 AND 120),
  buffer_after_minutes smallint NOT NULL DEFAULT 0
    CHECK (buffer_after_minutes BETWEEN 0 AND 120),
  adaptive_buffers boolean NOT NULL DEFAULT false,
  default_travel_minutes smallint NOT NULL DEFAULT 0
    CHECK (default_travel_minutes BETWEEN 0 AND 240),
  extra_timezones text[] NOT NULL DEFAULT '{}',
  calendar_sets jsonb NOT NULL DEFAULT '[]',
  pinned_user_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (work_end > work_start)
);

-- Recurring windows reserved for kinds of work ("Deep work, weekdays 9-12").
CREATE TABLE frames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  name varchar(60) NOT NULL,
  days smallint[] NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}',
  color varchar(9) NOT NULL DEFAULT '#9ab68c',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK (cardinality(days) BETWEEN 1 AND 7)
);
CREATE INDEX frames_user ON frames (user_id, position);

-- Places and how long it takes to get there, for travel time.
CREATE TABLE places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  label varchar(60) NOT NULL,
  match text NOT NULL CHECK (length(match) BETWEEN 1 AND 200),
  travel_minutes smallint NOT NULL CHECK (travel_minutes BETWEEN 0 AND 240),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX places_user ON places (user_id);

-- A generated plan waiting for the user to apply it.
CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  starts_on date NOT NULL,
  days smallint NOT NULL CHECK (days BETWEEN 1 AND 7),
  options jsonb NOT NULL DEFAULT '{}',
  blocks jsonb NOT NULL DEFAULT '[]',
  unplaced jsonb NOT NULL DEFAULT '[]',
  applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour'
);
CREATE INDEX plans_user ON plans (user_id, created_at DESC);

-- Notifications of other kinds (planner conflicts, bookings). Reminders keep
-- kind 'reminder' and an empty ref, so their existing de-duplication holds.
ALTER TABLE notifications
  ADD COLUMN kind text NOT NULL DEFAULT 'reminder'
    CHECK (kind IN ('reminder', 'conflict', 'booking')),
  ADD COLUMN ref text NOT NULL DEFAULT '';
DO $$
DECLARE old_name text;
BEGIN
  SELECT conname INTO old_name FROM pg_constraint
  WHERE conrelid = 'notifications'::regclass AND contype = 'u';
  IF old_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', old_name);
  END IF;
END $$;
ALTER TABLE notifications ADD CONSTRAINT notifications_once
  UNIQUE (item_id, item_version, channel, destination, kind, ref);

-- Booking pages: people outside Orbyn pick a time the hosts are all free.
CREATE TABLE booking_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  slug varchar(60) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title varchar(120) NOT NULL,
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  durations smallint[] NOT NULL DEFAULT '{30}',
  window_days smallint NOT NULL DEFAULT 14 CHECK (window_days BETWEEN 1 AND 90),
  min_notice_minutes integer NOT NULL DEFAULT 240
    CHECK (min_notice_minutes BETWEEN 0 AND 20160),
  buffer_minutes smallint NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 120),
  max_per_day smallint CHECK (max_per_day IS NULL OR max_per_day BETWEEN 1 AND 50),
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 300),
  meeting_url text NOT NULL DEFAULT '' CHECK (length(meeting_url) <= 500),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_pages_owner ON booking_pages (owner_id);

-- The owner is always a required host; co-hosts can be required or optional.
CREATE TABLE booking_hosts (
  page_id uuid NOT NULL REFERENCES booking_pages ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  required boolean NOT NULL DEFAULT true,
  PRIMARY KEY (page_id, user_id)
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES booking_pages ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  name varchar(120) NOT NULL,
  email varchar(254) NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  confirm_token_hash text UNIQUE,
  cancel_token_hash text UNIQUE,
  item_ids uuid[] NOT NULL DEFAULT '{}',
  -- The booker's time zone, for the times in their emails.
  timezone text NOT NULL DEFAULT 'UTC',
  -- An unconfirmed booking holds its time until then.
  hold_until timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX bookings_page_time ON bookings (page_id, start_at) WHERE status <> 'cancelled';

-- Personal API keys (only a hash is stored) and outgoing webhooks.
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  prefix varchar(16) NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX api_keys_user ON api_keys (user_id);

CREATE TABLE webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  url text NOT NULL CHECK (length(url) <= 500),
  events text[] NOT NULL,
  secret_encrypted text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_status integer,
  last_error text,
  last_delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhooks_user ON webhooks (user_id) WHERE active;

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES webhooks ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  response_status integer,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_pending ON webhook_deliveries (available_at)
  WHERE state = 'pending';

-- A secret link other calendar apps can subscribe to (read-only).
ALTER TABLE users ADD COLUMN calendar_feed_hash text UNIQUE;
