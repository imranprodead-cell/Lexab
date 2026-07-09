-- Monthly usage counters: deleting documents/chats no longer frees quota.
CREATE TABLE usage_counters (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month        DATE NOT NULL,
  ai_requests  INTEGER NOT NULL DEFAULT 0,
  docs_created INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

-- Backfill the current month from live rows so nobody gets a free reset.
INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
SELECT
  u.id,
  date_trunc('month', now())::date,
  coalesce((SELECT count(*) FROM analyses a
            WHERE a.user_id = u.id AND a.created_at >= date_trunc('month', now())), 0)
  + coalesce((SELECT count(*) FROM chat_messages m
              JOIN chat_sessions s ON s.id = m.session_id
              WHERE s.user_id = u.id AND m.role = 'assistant'
                AND m.created_at >= date_trunc('month', now())), 0),
  coalesce((SELECT count(*) FROM documents d
            WHERE d.user_id = u.id AND d.created_at >= date_trunc('month', now())), 0)
FROM users u;
