-- Product feedback sent from the in-app "Обратная связь" form (settings menu).
-- Email is snapshotted so feedback stays readable after the account is deleted.
CREATE TABLE IF NOT EXISTS user_feedback (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL,
  page       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
