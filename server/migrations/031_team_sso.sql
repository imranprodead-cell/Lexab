-- Per-team OIDC single sign-on (Business feature). One config per team, keyed by
-- the team owner. The client_secret is stored encrypted (see lib/secrets.ts).
CREATE TABLE team_sso_config (
  owner_user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  issuer_url             TEXT NOT NULL,
  client_id              TEXT NOT NULL,
  client_secret_enc      TEXT NOT NULL,          -- AES-256-GCM sealed
  -- One verified corporate domain per team (lowercased). Unique so a domain
  -- can't be claimed by two teams (account-takeover guard).
  email_domain           TEXT NOT NULL UNIQUE,
  -- Cached from the issuer's /.well-known/openid-configuration at save time.
  authorization_endpoint TEXT,
  token_endpoint         TEXT,
  userinfo_endpoint      TEXT,
  default_role           TEXT NOT NULL DEFAULT 'viewer' CHECK (default_role IN ('admin', 'editor', 'viewer')),
  enabled                BOOLEAN NOT NULL DEFAULT false,
  -- When true, members of this domain must sign in via SSO (password/Google are
  -- blocked for them; the team OWNER is always exempt as a break-glass).
  enforce_sso            BOOLEAN NOT NULL DEFAULT false,
  -- DNS TXT domain-ownership proof: a token the admin publishes as
  -- lexai-sso-verify=<token>; domain_verified flips true once checked.
  domain_verify_token    TEXT NOT NULL,
  domain_verified        BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
