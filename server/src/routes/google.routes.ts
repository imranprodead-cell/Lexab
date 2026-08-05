/**
 * Google OAuth 2.0 (authorization-code flow).
 *
 *   GET /auth/google?redirect=<frontend-url>
 *     → 302 to Google's consent screen. The return URL is validated against
 *       the CORS origin policy and carried inside a short-lived signed
 *       `state` JWT (CSRF protection + no server-side session needed).
 *
 *   GET /auth/google/callback?code&state
 *     → exchanges the code for tokens, fetches the Google profile, finds or
 *       creates the user (by google_sub, then by verified email), issues our
 *       JWT and 302s back to the frontend with `#session=<base64url payload>`
 *       (fragment — it never reaches server logs). Errors return the user to
 *       the frontend with `#error=<code>`.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config, isRedirectAllowed } from '../config.ts';
import type { Db } from '../db.ts';
import { badRequest } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { hashPassword } from '../lib/passwords.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { invalidateTtsAuthCache, getUserById, signToken, toProfile, type UserRow } from '../plugins/auth.ts';
import { audit } from '../lib/audit.ts';
import { assertSsoNotRequired } from './sso.routes.ts';
import { recordSession } from './security.routes.ts';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const RATE_LIMIT = { rateLimit: { max: 20, timeWindow: '1 minute' } };

/** httpOnly cookie that binds the OAuth `state` to the browser that started the
 *  flow (login-CSRF defence). SameSite=Lax so it survives Google's top-level
 *  redirect back to the callback. */
const OAUTH_NONCE_COOKIE = 'lexai_oauth_nonce';
const OAUTH_NONCE_PATH = `${config.apiPrefix}/auth/google`;

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

interface GoogleProfile {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The frontend URL we may send the user back to (open-redirect protection).
 *  Сверка идёт с ОТДЕЛЬНЫМ списком адресов возврата (isRedirectAllowed), а не с
 *  CORS: со звёздочкой в CORS_ORIGIN сюда проходил любой домен и получал
 *  одноразовый код входа. */
function validateRedirect(raw: string | undefined): string {
  const fallback = `${config.appBaseUrl}/login`;
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && isRedirectAllowed(url.origin)) {
      return url.toString();
    }
  } catch {
    /* malformed URL */
  }
  throw badRequest('Invalid redirect URL');
}

async function findOrCreateUser(db: Db, profile: GoogleProfile): Promise<UserRow> {
  // 1. Stable match by Google account id.
  const bySub = await db.query<{ id: string }>('SELECT id FROM users WHERE google_sub = $1', [profile.sub]);
  if (bySub.rows[0]) {
    return (await getUserById(db, bySub.rows[0].id)) as UserRow;
  }

  const email = profile.email?.toLowerCase();
  if (!email || profile.email_verified === false) {
    throw new Error('Google account has no verified email');
  }

  // 2. Existing account with this email → link the Google id to it.
  const byEmail = await db.query<{ id: string; avatar_url: string | null; email_verified: boolean }>(
    'SELECT id, avatar_url, email_verified FROM users WHERE lower(email) = $1',
    [email],
  );
  if (byEmail.rows[0]) {
    const { id, avatar_url, email_verified } = byEmail.rows[0];
    if (!email_verified) {
      // Account pre-hijack defence: an UNVERIFIED row's password was set by
      // whoever registered the email first — not necessarily the mailbox owner.
      // Google has just proven THIS user owns the mailbox, so the planted
      // password must die: overwrite it with a random one (recoverable via the
      // reset flow) and bump token_version to revoke any tokens issued to the
      // pre-registrant.
      const scrubbedHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
      await db.query(
        'UPDATE users SET password_hash = $2, verify_token = NULL, verify_expires = NULL, token_version = token_version + 1 WHERE id = $1',
        [id, scrubbedHash],
      );
      invalidateTtsAuthCache();
    }
    await db.query('UPDATE users SET google_sub = $2, email_verified = true, avatar_url = COALESCE($3, avatar_url) WHERE id = $1', [
      id,
      profile.sub,
      avatar_url ? null : (profile.picture ?? null),
    ]);
    return (await getUserById(db, id)) as UserRow;
  }

  // 3. Brand-new user. Password login stays possible via the reset flow.
  const id = newId('u');
  const name = profile.name?.trim() || email.split('@')[0];
  const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
  await db.query(
    `INSERT INTO users (id, email, password_hash, name, initials, firm, jurisdiction, avatar_url, google_sub)
     VALUES ($1, $2, $3, $4, $5, 'Lexab', 'United Kingdom', $6, $7)`,
    [id, email, passwordHash, name, initialsOf(name), profile.picture ?? null, profile.sub],
  );
  await db.query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'Free', 'active')`, [id]);
  await db.query(`INSERT INTO user_stats (user_id) VALUES ($1)`, [id]);
  // Google has already verified this mailbox.
  await db.query('UPDATE users SET email_verified = true WHERE id = $1', [id]);
  await db.query(`INSERT INTO notifications (id, user_id, icon, title) VALUES ($1, $2, 'docs', $3)`, [
    newId('n'),
    id,
    'Добро пожаловать в Lexab! Загрузите первый контракт для анализа.',
  ]);
  return (await getUserById(db, id)) as UserRow;
}

export function googleRoutes(app: FastifyInstance, db: Db): void {
  app.get('/auth/google', { config: RATE_LIMIT }, async (req, reply) => {
    const { redirect } = req.query as { redirect?: string };
    const backTo = validateRedirect(redirect);

    if (!config.googleClientId || !config.googleClientSecret) {
      // The button navigates the whole tab here — return to the app with an
      // error fragment instead of showing raw JSON.
      return reply.redirect(`${backTo}#error=google_not_configured`, 302);
    }

    // Random nonce: goes into BOTH the signed state and an httpOnly cookie. The
    // callback accepts only a state whose nonce matches this browser's cookie,
    // so an attacker can't feed a victim a pre-made state for the attacker's own
    // Google account (login-CSRF / session fixation).
    const nonce = crypto.randomBytes(18).toString('base64url');
    const state = app.jwt.sign({ purpose: 'google-oauth', redirect: backTo, nonce }, { expiresIn: '10m' });
    reply.setCookie(OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'lax', // must survive Google's cross-site top-level redirect back
      secure: req.protocol === 'https', // auto-Secure in prod (https), works on http://localhost
      path: OAUTH_NONCE_PATH,
      maxAge: 600,
    });
    const params = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: config.googleRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`, 302);
  });

  app.get('/auth/google/callback', { config: RATE_LIMIT }, async (req, reply) => {
    const query = req.query as { code?: string; state?: string; error?: string };

    // Without a valid state we don't know a trusted return URL — plain 400.
    let backTo: string;
    let stateNonce: string | undefined;
    try {
      const payload = app.jwt.verify<{ purpose: string; redirect: string; nonce?: string }>(query.state ?? '');
      if (payload.purpose !== 'google-oauth') throw new Error('wrong purpose');
      backTo = validateRedirect(payload.redirect);
      stateNonce = payload.nonce;
    } catch {
      throw badRequest('Invalid or expired OAuth state');
    }

    // The signed state's nonce must match the httpOnly cookie set when THIS
    // browser began the flow — otherwise it's a replayed/planted state.
    const cookieNonce = req.cookies[OAUTH_NONCE_COOKIE];
    if (!stateNonce || !cookieNonce || !timingSafeEqualStr(cookieNonce, stateNonce)) {
      reply.clearCookie(OAUTH_NONCE_COOKIE, { path: OAUTH_NONCE_PATH });
      throw badRequest('Invalid or expired OAuth state');
    }
    reply.clearCookie(OAUTH_NONCE_COOKIE, { path: OAUTH_NONCE_PATH });

    const fail = (code: string) => reply.redirect(`${backTo}#error=${encodeURIComponent(code)}`, 302);

    if (query.error) return fail('access_denied');
    if (!query.code) return fail('missing_code');

    try {
      // Exchange the authorization code for tokens.
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: query.code,
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          redirect_uri: config.googleRedirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) {
        req.log.error({ status: tokenRes.status, body: await tokenRes.text() }, 'google token exchange failed');
        return fail('exchange_failed');
      }
      const tokens = (await tokenRes.json()) as { access_token?: string };
      if (!tokens.access_token) return fail('exchange_failed');

      // Fetch the verified profile.
      const profileRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!profileRes.ok) return fail('profile_failed');
      const profile = (await profileRes.json()) as GoogleProfile;
      if (!profile.sub) return fail('profile_failed');

      const user = await findOrCreateUser(db, profile);
      // If the user's org enforces SSO, block the Google path too (owner exempt).
      try {
        await assertSsoNotRequired(db, { id: user.id, email: user.email });
      } catch {
        return fail('sso_required');
      }
      await audit(db, req, { type: 'auth.google_login', actorId: user.id, actorLabel: user.email, teamOwnerId: user.id });
      // Don't put the long-lived session JWT in the URL (it would linger in
      // browser history / referrers). Park it behind a short-lived, single-use
      // code and hand only that to the browser; the SPA exchanges it below.
      const code = crypto.randomBytes(24).toString('base64url');
      await db.query('INSERT INTO login_codes (code, user_id) VALUES ($1, $2)', [code, user.id]);
      return reply.redirect(`${backTo}#code=${code}`, 302);
    } catch (err) {
      req.log.error(err, 'google sign-in failed');
      return fail('google_failed');
    }
  });

  // Exchange the one-time code from the callback for a real session. Single-use
  // (DELETE…RETURNING) and short-lived (2 minutes) — a code left in history is
  // already spent and expired, so it grants nothing.
  app.post('/auth/google/exchange', { config: RATE_LIMIT }, async (req) => {
    const body = asObject(req.body);
    const code = requireString(body, 'code', { min: 10, max: 200 });
    await db.query("DELETE FROM login_codes WHERE created_at < now() - interval '2 minutes'");
    const res = await db.query<{ user_id: string }>('DELETE FROM login_codes WHERE code = $1 RETURNING user_id', [code]);
    const row = res.rows[0];
    if (!row) throw badRequest('Ссылка входа устарела — войдите ещё раз / Login link expired — sign in again');
    const user = await getUserById(db, row.user_id);
    if (!user) throw badRequest('Login link expired');
    const sid = await recordSession(db, user.id, req.ip, req.headers['user-agent']);
    return { token: signToken(app, user, undefined, sid), user: toProfile(user) };
  });
}
