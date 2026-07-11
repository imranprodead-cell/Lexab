-- Optional feedback category chosen in the form (general / bug / legal / …).
ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS category TEXT;
