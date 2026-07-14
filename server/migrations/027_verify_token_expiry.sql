-- Email-verification links now expire, like password-reset links already do
-- (reset_expires, migration 008). A verification token that never expires is a
-- standing credential: anyone who later finds the letter can still log in.
ALTER TABLE users ADD COLUMN verify_expires TIMESTAMPTZ;
-- Links issued before this migration get a fresh 24-hour window instead of
-- dying instantly (their rows have a token but a NULL expiry).
UPDATE users SET verify_expires = now() + interval '24 hours' WHERE verify_token IS NOT NULL;
