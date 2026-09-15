-- Calendar and events: all-day and free events, colours, several alerts per
-- item, edits to one occurrence of a series, people invited by email,
-- calendars subscribed to by link, and a busy-only calendar feed.

ALTER TABLE items
  -- A whole-day item: due_at is local midnight in its time zone, end_at the
  -- midnight it ends (exclusive). Never busy.
  ADD COLUMN all_day boolean NOT NULL DEFAULT false,
  -- Free events don't block time for the planner, booking pages or teammates.
  ADD COLUMN busy boolean NOT NULL DEFAULT true,
  ADD COLUMN color varchar(9) CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  -- Minutes before due_at to remind; replaces reminder_minutes, which is kept
  -- (as the smallest alert) for older apps.
  ADD COLUMN alerts smallint[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(alerts) <= 5 AND 0 <= ALL (alerts) AND 40320 >= ALL (alerts));
UPDATE items SET alerts = ARRAY[reminder_minutes]::smallint[];
ALTER TABLE items ALTER COLUMN reminder_minutes DROP NOT NULL;
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_reminder_minutes_check;
ALTER TABLE items ADD CONSTRAINT items_reminder_minutes_check
  CHECK (reminder_minutes IS NULL OR reminder_minutes BETWEEN 0 AND 40320);

-- Alerts new items get when they're created without any.
ALTER TABLE planner_prefs
  ADD COLUMN default_alerts jsonb NOT NULL
    DEFAULT '{"event": [30], "task": [30], "all_day": [30]}';

-- A reminder's ref is now the alert it's for ("30"), so each alert is sent
-- once per reminder version. Reminders already queued keep theirs.
UPDATE notifications n SET ref = i.reminder_minutes::text
FROM items i
WHERE n.item_id = i.id AND n.kind = 'reminder' AND n.ref = '';

-- Invitations go out through the email lane with their iCalendar part.
ALTER TABLE notifications ADD COLUMN ical text;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite'));

-- One occurrence of a repeating item changed on its own ("edit this one"),
-- keyed by the occurrence's original start. `data` holds what changed: title,
-- notes, due_at and end_at (always both), location, meeting_url, busy, color,
-- alerts. A cancelled occurrence is an exdate on the item, as before.
CREATE TABLE item_overrides (
  item_id uuid NOT NULL REFERENCES items ON DELETE CASCADE,
  occurrence timestamptz NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, occurrence)
);

-- People invited to an event by email, with their answer. Each gets a private
-- RSVP link, kept encrypted so every invitation repeats it, and hashed for
-- lookups.
CREATE TABLE item_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items ON DELETE CASCADE,
  email varchar(254) NOT NULL,
  name varchar(120) NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'needs_action'
    CHECK (status IN ('needs_action', 'accepted', 'declined', 'tentative')),
  token_hash text NOT NULL UNIQUE,
  token_encrypted text NOT NULL,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, email)
);

-- The busy-only feed has its own link, so it can be shared without the full one.
ALTER TABLE users
  ADD COLUMN calendar_busy_feed_hash text UNIQUE,
  ADD COLUMN calendar_feed_options jsonb NOT NULL DEFAULT '{}';

-- Calendars from other apps, read by their ICS link (never written to).
CREATE TABLE calendar_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  url text NOT NULL CHECK (length(url) <= 1000),
  name varchar(80) NOT NULL,
  color varchar(9) NOT NULL DEFAULT '#6b8fb5',
  -- Count its events as busy for the planner, booking pages and teammates.
  busy boolean NOT NULL DEFAULT false,
  etag text,
  last_modified text,
  last_fetched_at timestamptz,
  last_error text,
  event_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_subscriptions_user ON calendar_subscriptions (user_id);
CREATE INDEX calendar_subscriptions_due ON calendar_subscriptions (last_fetched_at NULLS FIRST);

-- A subscription's events as last fetched. Repeating ones keep their rule and
-- are expanded when read; `recurrence_id` marks one occurrence changed on its own.
CREATE TABLE external_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES calendar_subscriptions ON DELETE CASCADE,
  uid text NOT NULL,
  recurrence_id timestamptz,
  title text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  location text NOT NULL DEFAULT '',
  rrule text,
  exdates timestamptz[] NOT NULL DEFAULT '{}',
  timezone text NOT NULL DEFAULT 'UTC',
  -- Marked free (TRANSP:TRANSPARENT) in the source calendar.
  transparent boolean NOT NULL DEFAULT false
);
CREATE INDEX external_events_subscription ON external_events (subscription_id, starts_at);
