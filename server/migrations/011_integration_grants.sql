-- Pending OAuth results: the callback parks the provider tokens here and the
-- logged-in frontend claims them with its own auth (binds the flow to the
-- initiating user without cross-origin cookies).

CREATE TABLE integration_grants (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,
  account_email TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE integration_grants ENABLE ROW LEVEL SECURITY;
