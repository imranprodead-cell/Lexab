-- Organisation name for a team. Lives on the OWNER's user row; members
-- resolve it through their membership. Set once, never changed.

ALTER TABLE users ADD COLUMN team_name TEXT;
