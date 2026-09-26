-- Page templates (DAY-02): a page kept to start the next one from, with
-- blanks ({date}, {title}, {project}, {event}) that fill themselves in. The
-- starters live in code (packages/core/src/page-templates.ts); these are the
-- ones people and teams save. A template can say which folder its pages go
-- in and which tags they start with.
CREATE TABLE IF NOT EXISTS page_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who made it; with a team, it belongs to the team.
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id     uuid REFERENCES teams(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  -- The new page's title, blanks and all.
  title       text NOT NULL DEFAULT '',
  -- The page's lines, as the editor stores them.
  content     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Where pages made from it are filed. A folder that goes leaves them unfiled.
  folder_id   uuid REFERENCES folders(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS page_templates_user
  ON page_templates (user_id) WHERE team_id IS NULL;
CREATE INDEX IF NOT EXISTS page_templates_team
  ON page_templates (team_id) WHERE team_id IS NOT NULL;

-- The tags a template's pages start with, from the same vocabulary as
-- everything else. A tag that is deleted simply drops off the template.
CREATE TABLE IF NOT EXISTS page_template_tags (
  template_id uuid NOT NULL REFERENCES page_templates(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, tag_id)
);
CREATE INDEX IF NOT EXISTS page_template_tags_tag ON page_template_tags (tag_id);

-- The day an agenda is for (DAY-01), so the agenda can step to yesterday or
-- tomorrow and a page written ahead of its day files under that day. Agendas
-- written before this are dated by when they were written, in their
-- writer's own zone (or UTC for a zone Postgres doesn't know).
ALTER TABLE docs ADD COLUMN IF NOT EXISTS agenda_date date;

UPDATE docs d
   SET agenda_date = (d.created_at AT TIME ZONE coalesce(
         (SELECT p.timezone FROM planner_prefs p
           WHERE p.user_id = d.user_id
             AND p.timezone IN (SELECT name FROM pg_timezone_names)),
         'UTC'))::date
 WHERE d.kind = 'agenda' AND d.agenda_date IS NULL;

CREATE INDEX IF NOT EXISTS docs_agenda_day_idx
  ON docs (user_id, agenda_date) WHERE kind = 'agenda';
