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
import { config, isOriginAllowed } from '../config.ts';
import type { Db } from '../db.ts';
import { badRequest } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { hashPassword } from '../lib/passwords.ts';
import { getUserById, signToken, toProfile, type UserRow } from '../plugins/auth.ts';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const RATE_LIMIT = { rateLimit: { max: 20, timeWindow: '1 minute' } };

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

/** The frontend URL we may send the user back to (open-redirect protection). */
function validateRedirect(raw: string | undefined): string {
  const fallback = `${config.corsOrigins[0] ?? 'http://localhost:5173'}/login`;
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && isOriginAllowed(url.origin)) {
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
  const byEmail = await db.query<{ id: string; avatar_url: string | null }>(
    'SELECT id, avatar_url FROM users WHERE lower(email) = $1',
    [email],
  );
  if (byEmail.rows[0]) {
    const { id, avatar_url } = byEmail.rows[0];
    await db.query('UPDATE users SET google_sub = $2, avatar_url = COALESCE($3, avatar_url) WHERE id = $1', [
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
     VALUES ($1, $2, $3, $4, $5, 'LexAI', 'United Kingdom', $6, $7)`,
    [id, email, passwordHash, name, initialsOf(name), profile.picture ?? null, profile.sub],
  );
  await db.query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'Free', 'active')`, [id]);
  await db.query(`INSERT INTO user_stats (user_id) VALUES ($1)`, [id]);
  await db.query(`INSERT INTO notifications (id, user_id, icon, title) VALUES ($1, $2, 'docs', $3)`, [
    newId('n'),
    id,
    'Добро пожаловать в LexAI! Загрузите первый контракт для анализа.',
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

    const state = app.jwt.sign({ purpose: 'google-oauth', redirect: backTo }, { expiresIn: '10m' });
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
    try {
      const payload = app.jwt.verify<{ purpose: string; redirect: string }>(query.state ?? '');
      if (payload.purpose !== 'google-oauth') throw new Error('wrong purpose');
      backTo = validateRedirect(payload.redirect);
    } catch {
      throw badRequest('Invalid or expired OAuth state');
    }
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
      const session = { token: signToken(app, user), user: toProfile(user) };
      const fragment = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
      return reply.redirect(`${backTo}#session=${fragment}`, 302);
    } catch (err) {
      req.log.error(err, 'google sign-in failed');
      return fail('google_failed');
    }
  });
}
