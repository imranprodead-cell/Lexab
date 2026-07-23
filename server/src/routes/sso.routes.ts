/**
 * Per-team OIDC single sign-on (Business feature). Mirrors google.routes.ts:
 * same state-JWT + nonce-cookie CSRF defence and the same one-time login_code
 * hand-off (the SPA's existing #code= handler is reused unchanged).
 *
 * Admin (owner-only):
 *   GET    /team/sso             — config without the secret + redirect URI + DNS record
 *   PUT    /team/sso             — set issuer/client/secret/domain (fetches discovery)
 *   POST   /team/sso/verify-domain — check the DNS TXT proof
 *   DELETE /team/sso             — remove the config
 * Login (public):
 *   POST /auth/sso/lookup {email} — is SSO available for this email's domain?
 *   GET  /auth/sso/start?email=&redirect= — kick off the IdP flow
 *   GET  /auth/sso/callback?code&state    — finish, JIT-provision, hand off a login code
 *
 * THREE mandatory account-takeover guards (never ship with any missing):
 *   1. DNS TXT domain verification (domain_verified).
 *   2. Public-mail-domain blocklist (gmail.com etc. can't be a team domain).
 *   3. The IdP-asserted email's domain MUST equal the verified team domain.
 */
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import type { FastifyInstance } from 'fastify';
import { config, isOriginAllowed } from '../config.ts';
import type { Db } from '../db.ts';
import { badRequest, HttpError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { hashPassword } from '../lib/passwords.ts';
import { asObject, requireEmail, requireString } from '../lib/validate.ts';
import { assertFeature, planFor, planHasFeature } from '../lib/limits.ts';
import { sealSecret, openSecret } from '../lib/secrets.ts';
import { audit } from '../lib/audit.ts';
import { invalidateTtsAuthCache, getUserById, type UserRow } from '../plugins/auth.ts';

const RATE_LIMIT = { rateLimit: { max: 20, timeWindow: '1 minute' } };
const SSO_NONCE_COOKIE = 'lexai_sso_nonce';
const SSO_NONCE_PATH = `${config.apiPrefix}/auth/sso`;
const REDIRECT_URI = `${config.apiBaseUrl}${config.apiPrefix}/auth/sso/callback`;

// Common public mailbox providers — never a corporate SSO domain (guard #2).
const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com',
  'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'yandex.ru', 'mail.ru', 'aol.com', 'gmx.com',
]);

const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';

interface SsoConfigRow {
  owner_user_id: string;
  issuer_url: string;
  client_id: string;
  client_secret_enc: string;
  email_domain: string;
  authorization_endpoint: string | null;
  token_endpoint: string | null;
  userinfo_endpoint: string | null;
  default_role: string;
  enabled: boolean;
  enforce_sso: boolean;
  domain_verify_token: string;
  domain_verified: boolean;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** The active, usable config for a domain (enabled + verified + owner on Business). */
async function activeConfigForDomain(db: Db, domain: string): Promise<SsoConfigRow | null> {
  if (!domain) return null;
  const res = await db.query<SsoConfigRow>('SELECT * FROM team_sso_config WHERE email_domain = $1', [domain]);
  const cfg = res.rows[0];
  if (!cfg || !cfg.enabled || !cfg.domain_verified) return null;
  const plan = await planFor(db, cfg.owner_user_id);
  if (!planHasFeature(plan, 'sso')) return null; // owner's plan lapsed below Business → fail-open
  return cfg;
}

/**
 * Enforcement guard for every token-issuing endpoint. Throws 403 when the
 * email's domain has SSO ENFORCED and the user is an active team member — but
 * the team OWNER is always exempt (break-glass, so a broken IdP can't lock the
 * whole team out). Fail-open when the owner's plan has lapsed.
 */
export async function assertSsoNotRequired(db: Db, user: { id: string; email: string }): Promise<void> {
  const cfg = await activeConfigForDomain(db, domainOf(user.email));
  if (!cfg || !cfg.enforce_sso) return;
  if (cfg.owner_user_id === user.id) return; // owner break-glass
  const member = await db.query(
    "SELECT 1 FROM team_members WHERE owner_user_id = $1 AND member_user_id = $2 AND status = 'active'",
    [cfg.owner_user_id, user.id],
  );
  if (member.rows.length) {
    throw new HttpError(403, 'Ваша организация требует вход через SSO / Your organisation requires SSO sign-in');
  }
}

export function ssoRoutes(app: FastifyInstance, db: Db): void {
  // ── Admin: read config (never returns the secret) ────────────────────────
  app.get('/team/sso', { preHandler: [app.authenticate] }, async (req) => {
    await assertFeature(db, req.currentUser.id, 'sso');
    const res = await db.query<SsoConfigRow>('SELECT * FROM team_sso_config WHERE owner_user_id = $1', [req.currentUser.id]);
    const cfg = res.rows[0];
    return {
      configured: Boolean(cfg),
      redirectUri: REDIRECT_URI,
      ...(cfg
        ? {
            issuerUrl: cfg.issuer_url,
            clientId: cfg.client_id,
            secretSet: true,
            emailDomain: cfg.email_domain,
            defaultRole: cfg.default_role,
            enabled: cfg.enabled,
            enforceSso: cfg.enforce_sso,
            domainVerified: cfg.domain_verified,
            dnsRecord: `lexai-sso-verify=${cfg.domain_verify_token}`,
          }
        : {}),
    };
  });

  // ── Admin: create/update config ──────────────────────────────────────────
  app.put('/team/sso', { preHandler: [app.authenticate], config: RATE_LIMIT }, async (req) => {
    await assertFeature(db, req.currentUser.id, 'sso');
    const body = asObject(req.body);
    const issuerUrl = requireString(body, 'issuerUrl', { min: 8, max: 300 });
    const clientId = requireString(body, 'clientId', { min: 1, max: 300 });
    const emailDomain = requireString(body, 'emailDomain', { min: 3, max: 200 }).toLowerCase().trim();
    const defaultRole = ['admin', 'editor', 'viewer'].includes(String(body.defaultRole)) ? String(body.defaultRole) : 'viewer';

    let issuer: URL;
    try {
      issuer = new URL(issuerUrl);
    } catch {
      throw badRequest('issuerUrl must be a valid URL');
    }
    if (issuer.protocol !== 'https:') throw badRequest('issuerUrl must be https');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(emailDomain)) throw badRequest('emailDomain must be a bare domain, e.g. acme.com');
    // Guard #2: a public mailbox provider can never be a corporate SSO domain.
    if (PUBLIC_MAIL_DOMAINS.has(emailDomain)) throw badRequest('A public email provider cannot be used as an SSO domain');

    // The domain must be free (or already ours) — one team per domain.
    const clash = await db.query('SELECT owner_user_id FROM team_sso_config WHERE email_domain = $1 AND owner_user_id <> $2', [emailDomain, req.currentUser.id]);
    if (clash.rows.length) throw new HttpError(409, 'Этот домен уже используется другой организацией / This domain is already claimed');

    // Discovery — also validates the issuer is a real OIDC provider (fail loud).
    let disco: { authorization_endpoint?: string; token_endpoint?: string; userinfo_endpoint?: string };
    try {
      const wellKnown = `${issuer.origin}${issuer.pathname.replace(/\/$/, '')}/.well-known/openid-configuration`;
      const res = await fetch(wellKnown, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`discovery ${res.status}`);
      disco = (await res.json()) as typeof disco;
      if (!disco.authorization_endpoint || !disco.token_endpoint || !disco.userinfo_endpoint) throw new Error('incomplete discovery');
    } catch (err) {
      throw badRequest(`Не удалось прочитать конфигурацию OIDC у issuer: ${(err as Error).message}`);
    }

    // Keep an existing secret when the admin doesn't re-enter one; require one on first save.
    const existing = await db.query<{ client_secret_enc: string; domain_verify_token: string; email_domain: string }>(
      'SELECT client_secret_enc, domain_verify_token, email_domain FROM team_sso_config WHERE owner_user_id = $1',
      [req.currentUser.id],
    );
    const providedSecret = typeof body.clientSecret === 'string' && body.clientSecret ? body.clientSecret : null;
    const secretEnc = providedSecret ? sealSecret(providedSecret) : existing.rows[0]?.client_secret_enc;
    if (!secretEnc) throw badRequest('clientSecret is required');
    // A fresh verify token when the domain changes (re-prove ownership).
    const verifyToken = existing.rows[0] && existing.rows[0].email_domain === emailDomain
      ? existing.rows[0].domain_verify_token
      : crypto.randomBytes(18).toString('hex');
    const domainChanged = !existing.rows[0] || existing.rows[0].email_domain !== emailDomain;

    await db.query(
      `INSERT INTO team_sso_config
        (owner_user_id, issuer_url, client_id, client_secret_enc, email_domain, authorization_endpoint, token_endpoint, userinfo_endpoint, default_role, domain_verify_token, domain_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (owner_user_id) DO UPDATE SET
         issuer_url = $2, client_id = $3, client_secret_enc = $4, email_domain = $5,
         authorization_endpoint = $6, token_endpoint = $7, userinfo_endpoint = $8,
         default_role = $9, domain_verify_token = $10,
         domain_verified = CASE WHEN team_sso_config.email_domain = $5 THEN team_sso_config.domain_verified ELSE false END,
         updated_at = now()`,
      [req.currentUser.id, issuerUrl, clientId, secretEnc, emailDomain, disco.authorization_endpoint, disco.token_endpoint, disco.userinfo_endpoint, defaultRole, verifyToken, false],
    );
    await audit(db, req, { type: 'sso.config_changed', teamOwnerId: req.currentUser.id, metadata: { emailDomain, domainChanged } });
    return { ok: true, redirectUri: REDIRECT_URI, dnsRecord: `lexai-sso-verify=${verifyToken}`, domainVerified: !domainChanged };
  });

  // ── Admin: verify domain ownership via DNS TXT (guard #1) ─────────────────
  app.post('/team/sso/verify-domain', { preHandler: [app.authenticate], config: RATE_LIMIT }, async (req) => {
    await assertFeature(db, req.currentUser.id, 'sso');
    const res = await db.query<SsoConfigRow>('SELECT * FROM team_sso_config WHERE owner_user_id = $1', [req.currentUser.id]);
    const cfg = res.rows[0];
    if (!cfg) throw badRequest('Настройте SSO сначала');
    const expected = `lexai-sso-verify=${cfg.domain_verify_token}`;
    let found = false;
    try {
      const records = await dns.resolveTxt(cfg.email_domain);
      found = records.some((chunks) => chunks.join('').trim() === expected);
    } catch {
      found = false;
    }
    if (!found) {
      return { verified: false, dnsRecord: expected };
    }
    await db.query('UPDATE team_sso_config SET domain_verified = true, updated_at = now() WHERE owner_user_id = $1', [req.currentUser.id]);
    await audit(db, req, { type: 'sso.config_changed', teamOwnerId: req.currentUser.id, metadata: { domainVerified: true } });
    return { verified: true };
  });

  // ── Admin: enable / enforce toggles ──────────────────────────────────────
  app.patch('/team/sso', { preHandler: [app.authenticate], config: RATE_LIMIT }, async (req) => {
    await assertFeature(db, req.currentUser.id, 'sso');
    const body = asObject(req.body);
    const res = await db.query<SsoConfigRow>('SELECT * FROM team_sso_config WHERE owner_user_id = $1', [req.currentUser.id]);
    const cfg = res.rows[0];
    if (!cfg) throw badRequest('Настройте SSO сначала');
    // Enabling requires a verified domain (guard #1).
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : cfg.enabled;
    if (enabled && !cfg.domain_verified) throw badRequest('Сначала подтвердите домен через DNS-запись');
    const enforceSso = typeof body.enforceSso === 'boolean' ? body.enforceSso : cfg.enforce_sso;
    await db.query('UPDATE team_sso_config SET enabled = $2, enforce_sso = $3, updated_at = now() WHERE owner_user_id = $1', [req.currentUser.id, enabled, enforceSso]);
    await audit(db, req, { type: 'sso.config_changed', teamOwnerId: req.currentUser.id, metadata: { enabled, enforceSso } });
    return { ok: true, enabled, enforceSso };
  });

  app.delete('/team/sso', { preHandler: [app.authenticate], config: RATE_LIMIT }, async (req, reply) => {
    await assertFeature(db, req.currentUser.id, 'sso');
    await db.query('DELETE FROM team_sso_config WHERE owner_user_id = $1', [req.currentUser.id]);
    await audit(db, req, { type: 'sso.config_changed', teamOwnerId: req.currentUser.id, metadata: { removed: true } });
    reply.code(204);
  });

  // ── Login: does this email's domain have SSO? ────────────────────────────
  app.post('/auth/sso/lookup', { config: RATE_LIMIT }, async (req) => {
    const body = asObject(req.body);
    const email = requireEmail(body);
    const cfg = await activeConfigForDomain(db, domainOf(email));
    return { available: Boolean(cfg) };
  });

  // ── Login: start the IdP flow ────────────────────────────────────────────
  app.get('/auth/sso/start', { config: RATE_LIMIT }, async (req, reply) => {
    const { email, redirect } = req.query as { email?: string; redirect?: string };
    const fallback = `${config.corsOrigins[0] ?? 'http://localhost:5173'}/login`;
    let backTo = fallback;
    try {
      if (redirect) {
        const u = new URL(redirect);
        if ((u.protocol === 'http:' || u.protocol === 'https:') && isOriginAllowed(u.origin)) backTo = u.toString();
      }
    } catch {
      /* keep fallback */
    }
    const cfg = email ? await activeConfigForDomain(db, domainOf(email)) : null;
    if (!cfg || !cfg.authorization_endpoint) return reply.redirect(`${backTo}#error=sso_not_configured`, 302);

    const nonce = crypto.randomBytes(18).toString('base64url');
    const state = app.jwt.sign({ purpose: 'sso-oauth', redirect: backTo, nonce, owner: cfg.owner_user_id }, { expiresIn: '10m' });
    reply.setCookie(SSO_NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      path: SSO_NONCE_PATH,
      maxAge: 600,
    });
    const params = new URLSearchParams({
      client_id: cfg.client_id,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    return reply.redirect(`${cfg.authorization_endpoint}?${params.toString()}`, 302);
  });

  // ── Login: IdP callback → JIT provision → one-time login code ─────────────
  app.get('/auth/sso/callback', { config: RATE_LIMIT }, async (req, reply) => {
    const query = req.query as { code?: string; state?: string; error?: string };
    let backTo: string;
    let stateNonce: string | undefined;
    let ownerId: string;
    try {
      const payload = app.jwt.verify<{ purpose: string; redirect: string; nonce?: string; owner: string }>(query.state ?? '');
      if (payload.purpose !== 'sso-oauth') throw new Error('wrong purpose');
      backTo = payload.redirect;
      stateNonce = payload.nonce;
      ownerId = payload.owner;
    } catch {
      throw badRequest('Invalid or expired SSO state');
    }
    const cookieNonce = req.cookies[SSO_NONCE_COOKIE];
    if (!stateNonce || !cookieNonce || !timingSafeEqualStr(cookieNonce, stateNonce)) {
      reply.clearCookie(SSO_NONCE_COOKIE, { path: SSO_NONCE_PATH });
      throw badRequest('Invalid or expired SSO state');
    }
    reply.clearCookie(SSO_NONCE_COOKIE, { path: SSO_NONCE_PATH });

    const fail = (code: string) => reply.redirect(`${backTo}#error=${encodeURIComponent(code)}`, 302);
    if (query.error) return fail('access_denied');
    if (!query.code) return fail('missing_code');

    const cfgRes = await db.query<SsoConfigRow>('SELECT * FROM team_sso_config WHERE owner_user_id = $1', [ownerId]);
    const cfg = cfgRes.rows[0];
    if (!cfg || !cfg.enabled || !cfg.domain_verified || !cfg.token_endpoint || !cfg.userinfo_endpoint) return fail('sso_not_configured');
    const secret = openSecret(cfg.client_secret_enc);
    if (!secret) return fail('sso_secret_error');

    try {
      const tokenRes = await fetch(cfg.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: query.code, redirect_uri: REDIRECT_URI, client_id: cfg.client_id, client_secret: secret }),
        signal: AbortSignal.timeout(8000),
      });
      if (!tokenRes.ok) return fail('exchange_failed');
      const tokens = (await tokenRes.json()) as { access_token?: string };
      if (!tokens.access_token) return fail('exchange_failed');

      const profileRes = await fetch(cfg.userinfo_endpoint, { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(8000) });
      if (!profileRes.ok) return fail('profile_failed');
      const profile = (await profileRes.json()) as { email?: string; email_verified?: boolean; name?: string; sub?: string };
      const email = profile.email?.toLowerCase();
      if (!email) return fail('profile_failed');

      // Guard #3: the IdP-asserted email's domain MUST equal the verified team
      // domain — otherwise a rogue IdP could mint sessions for other domains.
      if (domainOf(email) !== cfg.email_domain) {
        await audit(db, req, { type: 'sso.enforcement_denied', teamOwnerId: ownerId, actorLabel: email, status: 'denied', metadata: { reason: 'domain_mismatch' } });
        return fail('domain_mismatch');
      }

      const user = await jitProvision(db, cfg, email, profile.name ?? email.split('@')[0]);
      if (user === 'team_full') return fail('team_full');
      await audit(db, req, { type: 'sso.login', teamOwnerId: ownerId, actorId: user.id, actorLabel: email });

      const code = crypto.randomBytes(24).toString('base64url');
      await db.query('INSERT INTO login_codes (code, user_id) VALUES ($1, $2)', [code, user.id]);
      return reply.redirect(`${backTo}#code=${code}`, 302);
    } catch (err) {
      req.log.error(err, 'sso callback failed');
      return fail('sso_failed');
    }
  });
}

/**
 * Find-or-create the user for an SSO login and ensure they're an active member
 * of the team, at the configured default role. Enforces the 5-seat Business cap.
 */
async function jitProvision(db: Db, cfg: SsoConfigRow, email: string, name: string): Promise<UserRow | 'team_full'> {
  const existing = await db.query<{ id: string; email_verified: boolean }>('SELECT id, email_verified FROM users WHERE lower(email) = $1', [email]);
  let userId: string;
  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    // The IdP proved this mailbox → mark verified (and scrub any planted
    // password on a still-unverified row, mirroring the Google pre-hijack fix).
    if (!existing.rows[0].email_verified) {
      const scrubbed = await hashPassword(crypto.randomBytes(32).toString('hex'));
      await db.query('UPDATE users SET password_hash = $2, verify_token = NULL, verify_expires = NULL, email_verified = true, token_version = token_version + 1 WHERE id = $1', [userId, scrubbed]);
      invalidateTtsAuthCache();
    }
  } else {
    userId = newId('u');
    const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
    const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
    await db.query(
      `INSERT INTO users (id, email, password_hash, name, initials, firm, jurisdiction, email_verified)
       VALUES ($1, $2, $3, $4, $5, 'LexAI', 'United Kingdom', true)`,
      [userId, email, passwordHash, name, initials],
    );
    await db.query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'Free', 'active')`, [userId]);
    await db.query(`INSERT INTO user_stats (user_id) VALUES ($1)`, [userId]);
  }

  // Already a member? Done. Otherwise add — respecting the Business 5-seat cap.
  const member = await db.query('SELECT id FROM team_members WHERE owner_user_id = $1 AND member_user_id = $2', [cfg.owner_user_id, userId]);
  if (member.rows.length === 0 && userId !== cfg.owner_user_id) {
    const count = await db.query<{ n: string | number }>("SELECT count(*) AS n FROM team_members WHERE owner_user_id = $1 AND status = 'active'", [cfg.owner_user_id]);
    if (Number(count.rows[0]?.n ?? 0) >= 5) return 'team_full';
    await db.query(
      `INSERT INTO team_members (id, owner_user_id, member_user_id, name, email, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
      [newId('tm'), cfg.owner_user_id, userId, name, email, cfg.default_role],
    );
  }
  return (await getUserById(db, userId)) as UserRow;
}
