import path from 'node:path';
import crypto from 'node:crypto';

function env(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/**
 * Resolve a safe JWT signing secret. A weak/absent/default secret would let
 * anyone forge tokens for any user, so:
 *  - production: refuse to start unless a strong secret (≥32 chars) is set;
 *  - dev: never fall back to the publicly known default — mint a RANDOM
 *    ephemeral secret for this run (tokens reset on restart) and warn.
 */
function resolveJwtSecret(): string {
  const provided = env('JWT_SECRET');
  const weak = !provided || provided === 'change-me-in-production' || provided.length < 32;
  if (!weak) return provided;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set to a strong value (at least 32 characters) in production');
  }
  console.warn(
    '[config] JWT_SECRET is unset or weak — using a random ephemeral secret for this dev run ' +
      '(all sessions reset on restart). Set a strong JWT_SECRET for stable sessions.',
  );
  return crypto.randomBytes(48).toString('base64url');
}

export const config = {
  port: Number(env('PORT', '8080')),
  host: env('HOST', '0.0.0.0'),
  apiPrefix: env('API_PREFIX', '/api'),
  corsOrigins: env('CORS_ORIGIN', 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** True when CORS_ORIGIN was set explicitly (strict mode). */
  corsExplicit: Boolean(process.env.CORS_ORIGIN),

  databaseUrl: env('DATABASE_URL'),
  dataDir: path.resolve(env('DATA_DIR', './data')),

  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: env('JWT_EXPIRES_IN', '12h'),
  /** Password for the opt-in seeded demo account (only when SEED_DEMO_DATA=true). */
  seedDemoPassword: env('SEED_DEMO_PASSWORD', 'lexai-demo'),

  anthropicApiKey: env('ANTHROPIC_API_KEY'),
  anthropicModel: env('ANTHROPIC_MODEL', 'claude-opus-4-8'),
  /**
   * Deterministic offline fallbacks when the model is unavailable. The mock is
   * enabled ONLY by the explicit value 'dev' (for local offline development);
   * any other value — including the default — fails loud (503) so a legal
   * product never fabricates analysis or citations. Deliberately independent of
   * NODE_ENV (which is never set here) so a keyless deploy can't silently mock.
   */
  llmFallback: env('LLM_FALLBACK', 'off').toLowerCase(),
  /** Per-plan Claude model: better plan → smarter model (see llm.ts modelForPlan). */
  planModels: {
    Free: env('ANTHROPIC_MODEL_FREE', 'claude-haiku-4-5'),
    Standard: env('ANTHROPIC_MODEL_STANDARD', 'claude-sonnet-5'),
    Pro: env('ANTHROPIC_MODEL_PRO', 'claude-opus-4-8'),
    Business: env('ANTHROPIC_MODEL_BUSINESS', 'claude-fable-5'),
    Enterprise: env('ANTHROPIC_MODEL_ENTERPRISE', env('ANTHROPIC_MODEL_BUSINESS', 'claude-fable-5')),
  } as Record<string, string>,

  /** Voyage AI — dense embeddings for the legal corpus (empty = FTS-only search). */
  voyageApiKey: env('VOYAGE_API_KEY'),

  googleClientId: env('GOOGLE_CLIENT_ID'),
  googleClientSecret: env('GOOGLE_CLIENT_SECRET'),
  googleRedirectUri: env('GOOGLE_REDIRECT_URI', 'http://localhost:8080/api/auth/google/callback'),

  /* Cloud-storage integrations (Settings → Интеграции). Google Drive reuses
   * the Google-login OAuth client unless a dedicated one is provided. */
  apiBaseUrl: env('API_BASE_URL', 'http://localhost:8080'),
  googleDriveClientId: env('GOOGLE_DRIVE_CLIENT_ID', env('GOOGLE_CLIENT_ID')),
  googleDriveClientSecret: env('GOOGLE_DRIVE_CLIENT_SECRET', env('GOOGLE_CLIENT_SECRET')),
  /** Browser API key for the Google Picker (optional but recommended). */
  googleApiKey: env('GOOGLE_API_KEY'),
  msClientId: env('MS_CLIENT_ID'),
  msClientSecret: env('MS_CLIENT_SECRET'),
  dropboxAppKey: env('DROPBOX_APP_KEY'),
  dropboxAppSecret: env('DROPBOX_APP_SECRET'),

  /* Dropbox Sign (HelloSign) — real e-signatures. When DROPBOX_SIGN_API_KEY is
   * set, /signatures sends via the provider (legally-weighted, audit trail,
   * signed PDF). Empty = fall back to the in-app typed-name simulation.
   * DROPBOX_SIGN_TEST_MODE=1 uses the free sandbox (non-legally-binding). */
  dropboxSignApiKey: env('DROPBOX_SIGN_API_KEY'),
  dropboxSignTestMode: env('DROPBOX_SIGN_TEST_MODE', '1') === '1',

  supabaseUrl: env('SUPABASE_URL'),
  supabaseAnonKey: env('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  /** When set (and Supabase is configured), uploads go to this Storage bucket. */
  supabaseStorageBucket: env('SUPABASE_STORAGE_BUCKET'),

  /** Shared secret for the inbound-email webhook (empty = endpoint disabled). */
  inboundEmailToken: env('INBOUND_EMAIL_TOKEN'),
  /* Outbound email (Resend) + links in emails point at the frontend. */
  resendApiKey: env('RESEND_API_KEY'),
  /* Where Enterprise "contact sales" requests are delivered. */
  contactEmail: env('CONTACT_EMAIL', 'imranabidov94@gmail.com'),
  /* Opt-in demo seeding for local development only. */
  seedDemoData: env('SEED_DEMO_DATA', 'false') === 'true',
  mailFrom: env('MAIL_FROM', 'LexAI <onboarding@resend.dev>'),
  /* Test mode without a verified domain: route ALL outgoing mail to this address. */
  mailRedirectTo: env('MAIL_REDIRECT_TO'),
  appBaseUrl: env('APP_BASE_URL', 'http://localhost:5173'),
  /** Sentry error monitoring (empty = disabled). */
  sentryDsn: env('SENTRY_DSN'),

  s3Bucket: env('S3_BUCKET'),
  s3Region: env('S3_REGION', 'us-east-1'),
  s3Endpoint: env('S3_ENDPOINT'),
  s3PublicUrl: env('S3_PUBLIC_URL'),
} as const;


const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * CORS policy. With CORS_ORIGIN unset (local dev), any localhost origin is
 * allowed — Vite picks the next free port (5174, 5175, …) when 5173 is busy,
 * and a strict single-port default would break the app with "Load failed".
 * Setting CORS_ORIGIN switches to the explicit allowlist (production).
 */
export function isOriginAllowed(origin: string): boolean {
  if (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) return true;
  return !config.corsExplicit && LOCALHOST_ORIGIN.test(origin);
}

