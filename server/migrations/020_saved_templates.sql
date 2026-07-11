-- Personal saved templates: an AI-drafted contract the user chose to keep in
-- their own library. The global `templates` table is read-only metadata, so
-- saved drafts (with their full text) live here, scoped per user.
CREATE TABLE IF NOT EXISTS saved_templates (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  content            TEXT NOT NULL,
  source_template_id TEXT,
  jurisdiction       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_templates_user ON saved_templates (user_id, created_at DESC);
