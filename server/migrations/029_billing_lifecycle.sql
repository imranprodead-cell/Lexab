-- Subscription lifecycle groundwork (before a real payment provider is wired):
-- a proper state machine + an append-only billing_events store that doubles as
-- legal evidence (consent waivers, ToS acceptances).

-- 1. State machine on the existing single-row subscriptions table.
ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN past_due_since TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN dunning_count SMALLINT NOT NULL DEFAULT 0;
-- Existing rows are all 'active', so this CHECK is safe to add now. renews_at
-- doubles as "current period end".
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_chk
  CHECK (status IN ('active', 'past_due', 'canceled'));

-- 2. Shared append-only guard, reused by billing_events now and audit_events
-- (migration 030). Blocks every UPDATE; allows DELETE only for rows older than a
-- per-table retention interval passed as the trigger argument (billing keeps
-- rows indefinitely → a very long interval).
CREATE OR REPLACE FUNCTION append_only_guard() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    RAISE EXCEPTION 'append-only table %: UPDATE is not allowed', TG_TABLE_NAME;
  END IF;
  IF (TG_OP = 'DELETE') THEN
    IF (TG_ARGV[0] IS NOT NULL AND OLD.created_at > now() - (TG_ARGV[0])::interval) THEN
      RAISE EXCEPTION 'append-only table %: cannot delete rows within retention window', TG_TABLE_NAME;
    END IF;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 3. billing_events — lifecycle history AND legal-evidence store. user_id is a
-- plain snapshot (NO foreign key): the record must OUTLIVE the account for
-- dispute/chargeback defence (legitimate under GDPR), and an ON DELETE SET NULL
-- cascade would itself be an UPDATE that the append-only trigger vetoes.
CREATE TABLE billing_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  email      TEXT NOT NULL,
  kind       TEXT NOT NULL,          -- checkout | consent_waiver | terms_accepted | renewal | past_due | canceled | downgraded | dunning
  plan       TEXT,
  payload    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX billing_events_user_idx ON billing_events (user_id, created_at DESC);

-- billing_events keeps everything (10-year retention window — effectively
-- indefinite for legal-evidence purposes).
CREATE TRIGGER billing_events_append_only
  BEFORE UPDATE OR DELETE ON billing_events
  FOR EACH ROW EXECUTE FUNCTION append_only_guard('3650 days');
