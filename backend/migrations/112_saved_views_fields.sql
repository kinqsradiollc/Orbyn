-- Saved views and your own fields (D4a: DATA-01, DATA-02, ORG-02, DATA-07).
--
-- saved_views: a named filter, sort, grouping and layout over tasks, pages
-- or projects (the JSON definition in packages/core/src/views.ts, shared by
-- the apps, the live list block and the agents' query and save_view tools).
-- A view is yours (team_id NULL) or shared with a team; it is always run as
-- the person looking, so a shared view never shows anyone more than they
-- can already open. Each person pins their own views to the sidebar
-- (saved_view_pins); stars are favourites of kind 'view'.
--
-- custom_fields: typed fields (text, number, date, choice, person,
-- checkbox) that every page, or every project, in a space shares. Values
-- sit in custom_field_values, one row per field per page or project, and go
-- with the page or project (and with the field). A date field can show on
-- the calendar as a deadline (on_calendar).
--
-- These grow only with what people make themselves (capped per person and
-- per space in the API), so the sweeper has no rule for them. Safe to run
-- again.

CREATE TABLE IF NOT EXISTS saved_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id     uuid REFERENCES teams(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  source      text NOT NULL CHECK (source IN ('tasks', 'pages', 'projects')),
  definition  jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_views_user_idx
  ON saved_views (user_id) WHERE team_id IS NULL;
CREATE INDEX IF NOT EXISTS saved_views_team_idx
  ON saved_views (team_id) WHERE team_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS saved_view_pins (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view_id    uuid NOT NULL REFERENCES saved_views(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, view_id)
);
CREATE INDEX IF NOT EXISTS saved_view_pins_view_idx ON saved_view_pins (view_id);

CREATE TABLE IF NOT EXISTS custom_fields (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id     uuid REFERENCES teams(id) ON DELETE CASCADE,
  applies_to  text NOT NULL CHECK (applies_to IN ('page', 'project')),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  type        text NOT NULL
    CHECK (type IN ('text', 'number', 'date', 'select', 'person', 'checkbox')),
  options     jsonb NOT NULL DEFAULT '[]'::jsonb,
  on_calendar boolean NOT NULL DEFAULT false,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT on_calendar OR type = 'date')
);
-- One name per space and kind: a team's pages can't have two "Due" fields.
CREATE UNIQUE INDEX IF NOT EXISTS custom_fields_name_idx
  ON custom_fields (coalesce(team_id, user_id), applies_to, lower(name));
CREATE INDEX IF NOT EXISTS custom_fields_team_idx
  ON custom_fields (team_id) WHERE team_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS custom_field_values (
  field_id   uuid NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  doc_id     uuid REFERENCES docs(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((doc_id IS NULL) <> (project_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_field_values_doc_idx
  ON custom_field_values (field_id, doc_id) WHERE doc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS custom_field_values_project_idx
  ON custom_field_values (field_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS custom_field_values_doc_lookup_idx
  ON custom_field_values (doc_id) WHERE doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS custom_field_values_project_lookup_idx
  ON custom_field_values (project_id) WHERE project_id IS NOT NULL;
-- Date fields on the calendar, found by day.
CREATE INDEX IF NOT EXISTS custom_field_values_date_idx
  ON custom_field_values ((value #>> '{}'))
  WHERE jsonb_typeof(value) = 'string';
