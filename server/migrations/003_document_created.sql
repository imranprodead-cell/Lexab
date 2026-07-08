-- Monthly plan-limit accounting needs a creation timestamp on documents.
ALTER TABLE documents ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
