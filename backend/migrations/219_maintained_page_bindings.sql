CREATE UNIQUE INDEX agent_grants_owner_identity ON agent_grants(id,user_id);
CREATE TABLE assistant_page_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_grant_id uuid NOT NULL,
  FOREIGN KEY(agent_grant_id,user_id) REFERENCES agent_grants(id,user_id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'
    AND jsonb_typeof(snapshot->'blocks')='array'
    AND jsonb_array_length(snapshot->'blocks') BETWEEN 1 AND 100),
  instruction text NOT NULL CHECK(length(instruction) BETWEEN 1 AND 4000),
  rrule text NOT NULL CHECK(length(rrule) BETWEEN 1 AND 200),
  timezone text NOT NULL CHECK(length(timezone) BETWEEN 1 AND 64),
  next_run_at timestamptz NOT NULL,
  paused boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_page_bindings_owner ON assistant_page_bindings(user_id,doc_id);
CREATE INDEX assistant_page_bindings_due ON assistant_page_bindings(next_run_at) WHERE NOT paused;
