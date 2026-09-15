-- Tasks: subtasks, manual order, a cancelled status, links, time left.
-- Booking: open invites, profile pages, reminders for bookers, team pages.
-- Buffers and travel: scope, transport mode, peak times, padding.
-- API: incremental sync with tombstones, new webhook events.

-- ---- Tasks ------------------------------------------------------------------

ALTER TABLE items
  -- A subtask is a task of its own under a parent task (three levels at most,
  -- checked by the API). Deleting the parent deletes its subtasks.
  ADD COLUMN parent_id uuid REFERENCES items ON DELETE CASCADE,
  -- Manual order among the items sharing a parent, else a list, else a space
  -- (personal or a team). Changing it doesn't change the edit version.
  ADD COLUMN position integer NOT NULL DEFAULT 0;
CREATE INDEX items_parent ON items (parent_id) WHERE parent_id IS NOT NULL;
-- Incremental sync reads items in the order they changed.
CREATE INDEX items_updated ON items (updated_at, id);

-- Cancelled: closed without being done.
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_status_check;
ALTER TABLE items ADD CONSTRAINT items_status_check
  CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled'));
ALTER TABLE item_updates DROP CONSTRAINT IF EXISTS item_updates_status_check;
ALTER TABLE item_updates ADD CONSTRAINT item_updates_status_check
  CHECK (status IS NULL OR status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled'));
DROP INDEX IF EXISTS items_due;
CREATE INDEX items_due ON items (due_at) WHERE status NOT IN ('done', 'cancelled');

-- Links on a task (up to 20, checked by the API).
CREATE TABLE item_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items ON DELETE CASCADE,
  url text NOT NULL CHECK (length(url) <= 2000),
  title varchar(200) NOT NULL DEFAULT '',
  position smallint NOT NULL DEFAULT 0
);
CREATE INDEX item_links_item ON item_links (item_id, position);

-- A block's past time is added to its task's time spent once, when the task
-- is completed by someone with count_blocks_as_spent on.
ALTER TABLE time_blocks ADD COLUMN counted boolean NOT NULL DEFAULT false;

-- Deleted items, so incremental sync can report them. The audience is the
-- one at deletion time: the owner of a personal item, or the item's team.
-- Kept for 90 days.
CREATE TABLE deleted_items (
  item_id uuid PRIMARY KEY,
  user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deleted_items_time ON deleted_items (deleted_at, item_id);

-- ---- Planner preferences and places -------------------------------------------

ALTER TABLE planner_prefs
  ADD COLUMN count_blocks_as_spent boolean NOT NULL DEFAULT false,
  -- Which events get buffers: {personal, team_ids (null: all), list_ids,
  -- min_minutes, only_with_others}. Empty: every timed busy event.
  ADD COLUMN buffer_scope jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN travel_padding_minutes smallint NOT NULL DEFAULT 0
    CHECK (travel_padding_minutes BETWEEN 0 AND 30);

ALTER TABLE places
  -- How you get there (a label only; there's no routing service).
  ADD COLUMN mode text CHECK (mode IS NULL OR mode IN ('walk', 'cycle', 'transit', 'drive')),
  -- Travel minutes on weekdays 07:00-09:00 and 16:00-18:00; null: the same as usual.
  ADD COLUMN peak_minutes smallint CHECK (peak_minutes IS NULL OR peak_minutes BETWEEN 0 AND 240);

-- ---- Booking ----------------------------------------------------------------------

-- Public profile: /u/<handle> lists your booking pages.
ALTER TABLE users
  ADD COLUMN handle varchar(40) UNIQUE
    CHECK (handle IS NULL OR handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD COLUMN bio varchar(300) NOT NULL DEFAULT '';

ALTER TABLE booking_pages
  -- Team pages: the team's owners and admins manage them; hosts are members.
  ADD COLUMN team_id uuid REFERENCES teams ON DELETE CASCADE,
  -- Email the booker this many minutes before (up to 3 values).
  ADD COLUMN remind_before_minutes smallint[] NOT NULL DEFAULT '{1440,60}'
    CHECK (cardinality(remind_before_minutes) <= 3
      AND 10 <= ALL (remind_before_minutes) AND 10080 >= ALL (remind_before_minutes));
CREATE INDEX booking_pages_team ON booking_pages (team_id) WHERE team_id IS NOT NULL;

-- A one-off link offering hand-picked windows; the first person to pick a
-- time books it. Its link is kept encrypted so the owner can copy it again.
CREATE TABLE open_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  token_encrypted text NOT NULL,
  title varchar(120) NOT NULL,
  duration smallint NOT NULL CHECK (duration BETWEEN 5 AND 480),
  -- [{"start_at", "end_at"}], up to 20.
  windows jsonb NOT NULL,
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 300),
  meeting_url text NOT NULL DEFAULT '' CHECK (length(meeting_url) <= 500),
  -- Teammates who must also be free, and get the event.
  co_host_ids uuid[] NOT NULL DEFAULT '{}',
  remind_before_minutes smallint[] NOT NULL DEFAULT '{1440,60}'
    CHECK (cardinality(remind_before_minutes) <= 3
      AND 10 <= ALL (remind_before_minutes) AND 10080 >= ALL (remind_before_minutes)),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'booked', 'expired', 'cancelled')),
  -- At most the end of the last window.
  expires_at timestamptz NOT NULL,
  booking_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX open_invites_owner ON open_invites (owner_id, created_at DESC);
CREATE INDEX open_invites_open ON open_invites (expires_at) WHERE status = 'open';

-- A booking comes from a page or from an open invite.
ALTER TABLE bookings ALTER COLUMN page_id DROP NOT NULL;
ALTER TABLE bookings
  ADD COLUMN invite_id uuid REFERENCES open_invites ON DELETE CASCADE,
  ADD CONSTRAINT bookings_source CHECK ((page_id IS NULL) <> (invite_id IS NULL));
CREATE INDEX bookings_invite ON bookings (invite_id) WHERE invite_id IS NOT NULL;
ALTER TABLE open_invites ADD CONSTRAINT open_invites_booking_fk
  FOREIGN KEY (booking_id) REFERENCES bookings ON DELETE SET NULL;

-- Reminders to bookers go through the email lane, once per booking, start
-- time and value (ref = "<booking>:<start epoch>:<minutes>").
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder'));
CREATE UNIQUE INDEX notifications_booker_once ON notifications (ref)
  WHERE kind = 'booker_reminder';

-- ---- Webhooks -----------------------------------------------------------------------

ALTER TABLE webhooks
  -- event.starting goes this many minutes before each busy event.
  ADD COLUMN lead_minutes smallint NOT NULL DEFAULT 15 CHECK (lead_minutes BETWEEN 0 AND 120);
-- Events the notifier sends on a schedule (event.starting, block.started,
-- task.at_risk) go once per webhook and key.
ALTER TABLE webhook_deliveries ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX webhook_deliveries_once ON webhook_deliveries (webhook_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
