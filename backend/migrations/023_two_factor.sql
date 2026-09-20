-- Two-step verification. The TOTP secret is encrypted like other secrets, and
-- recovery codes are stored only as hashes. A row exists once setup starts;
-- confirmed_at is set when the first correct code proves it works.
CREATE TABLE user_totp (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  confirmed_at timestamptz,
  recovery_hashes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
