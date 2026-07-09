-- Email verification on signup + real password-reset tokens.
ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN verify_token TEXT UNIQUE;
ALTER TABLE users ADD COLUMN reset_token TEXT UNIQUE;
ALTER TABLE users ADD COLUMN reset_expires TIMESTAMPTZ;

-- Existing accounts predate verification — grandfather them in.
UPDATE users SET email_verified = true;
