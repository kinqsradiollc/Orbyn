-- Later page, navigation and mobile features (D5).
--
-- - NAV-07: stars reach tasks and one heading or line of a page, not only
--   pages, projects and views. A star on a heading is the page's id plus the
--   line's block id (favourites.block_id); every other star has ''.
-- - NAV-08, NAV-09, SHR-08: choices that follow the account (account_prefs):
--   the sidebar's order and what it hides, changed shortcuts, and view
--   choices (a task list's layout, grouping and sort; the calendar set shown).
--   Theme, text size and what opens at start stay on each device.
-- - SRCH-03: a page or a folder can be archived. Archived pages leave the
--   library, the quick switcher, search, the link picker and "Mentioned
--   without a link", and come back with "Include archived". A page in an
--   archived folder counts as archived.
-- - OTH-04: team switches beside publishing: the assistant on team pages,
--   and external booking pages.
-- - CAP-02..04: keys for the Orbyn Clipper (ocl_…). A Clipper key can only
--   save clips and list where they may go; it is refused everywhere else.
--
-- account_prefs has one row per person and clip_keys a few per person, so
-- the sweeper needs no rule for them. Safe to run again.

-- ------------------------------------------------------------- stars ---

ALTER TABLE favourites ADD COLUMN IF NOT EXISTS block_id text NOT NULL DEFAULT '';

DO $$
BEGIN
  -- The key gains the line, so a page and two of its headings are three stars.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'favourites_pkey'
       AND array_length(conkey, 1) = 3
  ) THEN
    ALTER TABLE favourites DROP CONSTRAINT favourites_pkey;
    ALTER TABLE favourites
      ADD CONSTRAINT favourites_pkey PRIMARY KEY (user_id, kind, target_id, block_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'favourites_kind_check'
  ) THEN
    ALTER TABLE favourites ADD CONSTRAINT favourites_kind_check
      CHECK (kind IN ('doc', 'project', 'view', 'task', 'heading'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'favourites_block_check'
  ) THEN
    ALTER TABLE favourites ADD CONSTRAINT favourites_block_check
      CHECK ((kind = 'heading') = (block_id <> '') AND length(block_id) <= 80);
  END IF;
END;
$$;

-- --------------------------------------------------- account choices ---

CREATE TABLE IF NOT EXISTS account_prefs (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- { order: [...], hidden: [...] } of the sidebar's destinations.
  sidebar    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { "<command id>": ["mod", "shift", "P"] | [] } — [] takes a key away.
  shortcuts  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { "<place>": { layout, group, sort, ... } } for lists and the calendar.
  views      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------- archive ---

ALTER TABLE docs ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS docs_archived_idx ON docs (archived_at)
  WHERE archived_at IS NOT NULL;

-- ------------------------------------------------- team switches ---

ALTER TABLE teams ADD COLUMN IF NOT EXISTS assistant_allowed boolean
  NOT NULL DEFAULT true;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS booking_allowed boolean
  NOT NULL DEFAULT true;

-- ------------------------------------------------------ clipper keys ---

CREATE TABLE IF NOT EXISTS clip_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  key_hash     text NOT NULL UNIQUE,
  -- The last four characters, to tell keys apart.
  hint         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS clip_keys_user_idx ON clip_keys (user_id);
