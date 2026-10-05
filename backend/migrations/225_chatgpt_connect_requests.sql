-- Authenticated one-click handoff to the user's credential-owning runtime.
-- No OpenAI codes or provider credentials are stored in this table.
CREATE TABLE chatgpt_connect_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 claim_session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','completed','failed')),
 connection_id uuid REFERENCES chatgpt_identity_connections(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
CREATE INDEX chatgpt_connect_requests_expiry ON chatgpt_connect_requests(expires_at);
CREATE INDEX chatgpt_connect_requests_owner ON chatgpt_connect_requests(user_id,session_id);
