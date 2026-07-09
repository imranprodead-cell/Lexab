import path from 'node:path';

function env(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
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

  jwtSecret: env('JWT_SECRET', 'change-me-in-production'),
  jwtExpiresIn: env('JWT_EXPIRES_IN', '12h'),
  /** "demo": unauthenticated requests act as the seeded demo user. */
  seedDemoPassword: env('SEED_DEMO_PASSWORD', 'lexai-demo'),

  anthropicApiKey: env('ANTHROPIC_API_KEY'),
  anthropicModel: env('ANTHROPIC_MODEL', 'claude-opus-4-8'),
  /** Per-plan Claude model: better plan → smarter model (see llm.ts modelForPlan). */
  planModels: {
    Free: env('ANTHROPIC_MODEL_FREE', 'claude-haiku-4-5'),
    Standard: env('ANTHROPIC_MODEL_STANDARD', 'claude-sonnet-5'),
    Pro: env('ANTHROPIC_MODEL_PRO', 'claude-opus-4-8'),
    Business: env('ANTHROPIC_MODEL_BUSINESS', 'claude-fable-5'),
    Enterprise: env('ANTHROPIC_MODEL_ENTERPRISE', env('ANTHROPIC_MODEL_BUSINESS', 'claude-fable-5')),
  } as Record<string, string>,

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

if (config.jwtSecret === 'change-me-in-production' && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production');
}
