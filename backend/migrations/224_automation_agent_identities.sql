-- Separate identity only: grants, runtime lanes and permissions do not change.
CREATE TABLE automation_agent_identities (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lane text NOT NULL CHECK (lane IN ('background', 'overnight')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  persona text NOT NULL DEFAULT '' CHECK (length(persona) <= 1000),
  character jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(character) = 'object'),
  named_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (user_id, lane)
);
-- Preserve the previous selection once; later edits never cross lanes.
INSERT INTO automation_agent_identities(user_id, lane, name, persona, character, named_at, updated_at)
SELECT a.user_id, lane, coalesce(nullif(btrim(a.name),''),'Orbyn'), a.persona, a.character, a.named_at, a.updated_at
FROM agent_settings a CROSS JOIN (VALUES ('background'), ('overnight')) lanes(lane);
