-- Approval workflows (маршруты согласования): ordered sign-off chains with
-- deadlines, public decision links and reminders. Plus billing period on
-- subscriptions for the pre-Stripe purchase flow.

ALTER TABLE subscriptions ADD COLUMN period TEXT NOT NULL DEFAULT 'monthly';

CREATE TABLE approval_flows (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'approved', 'rejected', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_approval_flows_doc ON approval_flows(document_id, created_at DESC);

CREATE TABLE approval_steps (
  id             TEXT PRIMARY KEY,
  flow_id        TEXT NOT NULL REFERENCES approval_flows(id) ON DELETE CASCADE,
  ord            INTEGER NOT NULL,
  approver_name  TEXT NOT NULL,
  approver_email TEXT NOT NULL,
  role_label     TEXT,
  status         TEXT NOT NULL DEFAULT 'waiting'
                 CHECK (status IN ('waiting', 'pending', 'approved', 'rejected')),
  due_at         TIMESTAMPTZ,
  token          TEXT UNIQUE,
  decided_at     TIMESTAMPTZ,
  comment        TEXT,
  reminded       BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX idx_approval_steps_flow ON approval_steps(flow_id, ord);

ALTER TABLE approval_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_steps ENABLE ROW LEVEL SECURITY;
