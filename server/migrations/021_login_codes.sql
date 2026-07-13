-- One-time codes for the Google OAuth hand-off. The callback parks the freshly
-- signed session behind a short-lived, single-use code and redirects the browser
-- with `#code=<code>`; the SPA immediately POSTs it to /auth/google/exchange to
-- receive the real token. This keeps the long-lived session JWT out of the URL
-- (and thus out of browser history / referrers).

CREATE TABLE login_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE login_codes ENABLE ROW LEVEL SECURITY;
