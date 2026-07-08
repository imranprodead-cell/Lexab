-- Google OAuth: stable identity link. Users created (or first signed in) via
-- Google carry their Google account id; email remains the fallback match.
ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE UNIQUE INDEX idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
