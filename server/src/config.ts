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
  authMode: env('AUTH_MODE', 'demo') as 'demo' | 'required',
  seedDemoPassword: env('SEED_DEMO_PASSWORD', 'lexai-demo'),

  anthropicApiKey: env('ANTHROPIC_API_KEY'),
  anthropicModel: env('ANTHROPIC_MODEL', 'claude-opus-4-8'),

  googleClientId: env('GOOGLE_CLIENT_ID'),
  googleClientSecret: env('GOOGLE_CLIENT_SECRET'),
  googleRedirectUri: env('GOOGLE_REDIRECT_URI', 'http://localhost:8080/api/auth/google/callback'),

  supabaseUrl: env('SUPABASE_URL'),
  supabaseAnonKey: env('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  /** When set (and Supabase is configured), uploads go to this Storage bucket. */
  supabaseStorageBucket: env('SUPABASE_STORAGE_BUCKET'),

  /** Shared secret for the inbound-email webhook (empty = endpoint disabled). */
  inboundEmailToken: env('INBOUND_EMAIL_TOKEN'),
  /** Sentry error monitoring (empty = disabled). */
  sentryDsn: env('SENTRY_DSN'),

  s3Bucket: env('S3_BUCKET'),
  s3Region: env('S3_REGION', 'us-east-1'),
  s3Endpoint: env('S3_ENDPOINT'),
  s3PublicUrl: env('S3_PUBLIC_URL'),
} as const;

export const DEMO_USER_ID = 'u_demo';

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
