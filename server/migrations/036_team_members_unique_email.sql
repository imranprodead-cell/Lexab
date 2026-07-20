-- One membership row per (team owner, email). Without this, two near-simultaneous
-- POST /team/invite for the same address both pass the SELECT-then-INSERT check
-- and create a duplicate "ghost" row that occupies a seat in the 5-member limit
-- and can't be accepted.
--
-- Emails are already normalised to lower-case on write (requireEmail), so a plain
-- column index is sufficient. Deduplicate first so the index can be created even
-- if a race already produced duplicates — keeping the best row per group
-- (an 'active' membership beats an 'invited' one; ties broken by oldest, then id).
DELETE FROM team_members t
USING team_members k
WHERE t.owner_user_id = k.owner_user_id
  AND t.email = k.email
  AND t.id <> k.id
  AND ROW(CASE WHEN k.status = 'active' THEN 0 ELSE 1 END, k.created_at, k.id)
    < ROW(CASE WHEN t.status = 'active' THEN 0 ELSE 1 END, t.created_at, t.id);

CREATE UNIQUE INDEX IF NOT EXISTS team_members_owner_email_uidx
  ON team_members (owner_user_id, email);
