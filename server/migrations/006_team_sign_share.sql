-- Team invitations by link, shared team documents, public signing, EN notifications.

-- Who actually joined (filled when the invitation is accepted).
ALTER TABLE team_members ADD COLUMN member_user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE team_members ADD COLUMN invite_token TEXT UNIQUE;
CREATE INDEX idx_team_members_member ON team_members(member_user_id) WHERE member_user_id IS NOT NULL;

-- A document shared with the owner's team (members see it in their list).
ALTER TABLE documents ADD COLUMN team_shared BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_documents_shared ON documents(user_id) WHERE team_shared;

-- Public signing links + captured signatures.
ALTER TABLE signature_recipients ADD COLUMN token TEXT UNIQUE;
ALTER TABLE signature_recipients ADD COLUMN signed_at TIMESTAMPTZ;
ALTER TABLE signature_recipients ADD COLUMN signature_name TEXT;

-- English variant of notification titles (RU stays in `title`).
ALTER TABLE notifications ADD COLUMN title_en TEXT;
