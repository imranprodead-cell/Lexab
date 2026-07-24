import path from 'node:path';
import crypto from 'node:crypto';

function env(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/**
 * Explicit opt-in for the insecure dev fallbacks below. Fail CLOSED by default:
 * a real deploy that forgot JWT_SECRET / DATA_ENCRYPTION_KEY must refuse to
 * start, not silently mint an ephemeral secret or store documents unencrypted.
 *
 * The old guards keyed on NODE_ENV, which this project NEVER sets (see the start
 * script, docker-compose and the LLM_FALLBACK comment below) — so they were dead
 * in production. An operator running locally without secrets sets
 * ALLOW_INSECURE_SECRETS=1 once to acknowledge the risk.
 */
const allowInsecureSecrets = env('ALLOW_INSECURE_SECRETS') === '1';

/**
 * Resolve a safe JWT signing secret. A weak/absent/default secret would let
 * anyone forge tokens for any user, so:
 *  - default: refuse to start unless a strong secret (≥32 chars) is set;
 *  - ALLOW_INSECURE_SECRETS=1: never fall back to the publicly known default —
 *    mint a RANDOM ephemeral secret for this run (tokens reset on restart) and warn.
 */
function resolveJwtSecret(): string {
  const provided = env('JWT_SECRET');
  const weak = !provided || provided === 'change-me-in-production' || provided.length < 32;
  if (!weak) return provided;
  if (!allowInsecureSecrets) {
    throw new Error(
      'JWT_SECRET must be set to a strong value (at least 32 characters). ' +
        'Set it, or export ALLOW_INSECURE_SECRETS=1 for a local dev run with ephemeral sessions.',
    );
  }
  console.warn(
    '[config] JWT_SECRET is unset or weak — using a random ephemeral secret for this dev run ' +
      '(all sessions reset on restart). Set a strong JWT_SECRET for stable sessions.',
  );
  return crypto.randomBytes(48).toString('base64url');
}

/**
 * Master key (KEK) for at-rest encryption of user documents (lib/docCrypto.ts).
 *  - default: REQUIRED (≥32 chars) — refuse to start, so writes can never
 *    happen unencrypted by accident;
 *  - ALLOW_INSECURE_SECRETS=1: optional — encryption is disabled with a loud
 *    warning (reads still tolerate both plaintext and encrypted rows).
 * Deliberately independent of JWT_SECRET: rotating the JWT secret must never
 * make document data undecryptable. Generate:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
 */
function resolveDataEncryptionKey(): string {
  const provided = env('DATA_ENCRYPTION_KEY');
  if (provided.length >= 32) return provided;
  if (!allowInsecureSecrets) {
    throw new Error(
      'DATA_ENCRYPTION_KEY must be set to a strong value (at least 32 characters) — ' +
        'user documents are encrypted at rest with it. Set it, or export ' +
        'ALLOW_INSECURE_SECRETS=1 for a local dev run with encryption disabled. Generate one with: ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`,
    );
  }
  console.warn(
    provided
      ? '[config] DATA_ENCRYPTION_KEY is too short (<32 chars) — document encryption DISABLED for this dev run'
      : '[config] DATA_ENCRYPTION_KEY is not set — document encryption DISABLED for this dev run',
  );
  return '';
}

/* ── DeepSeek (OpenAI-compatible API) — the cheap model for the Free plan ────
   DEEPSEEK_BASE_URL may point at the official api.deepseek.com or at a
   western host serving the open weights (Together / Fireworks / Nebius /
   Azure) — recommended for a legal product, so client documents never leave
   the chosen jurisdiction. DeepSeek is used for the Free plan ONLY when its
   key is configured; otherwise Free stays on Haiku. */
const deepseekApiKey = env('DEEPSEEK_API_KEY');
const deepseekModel = env('DEEPSEEK_MODEL', 'deepseek-v4-pro');
const freeModel = env('MODEL_FREE', deepseekApiKey ? deepseekModel : 'claude-haiku-4-5');

export const config = {
  port: Number(env('PORT', '8080')),
  host: env('HOST', '0.0.0.0'),
  apiPrefix: env('API_PREFIX', '/api'),
  /** Per-minute cap on sensitive auth routes (register/login/verify). Raised only
   *  in the test harness, where many users register from one loopback IP. */
  authRateLimitMax: Number(env('AUTH_RATE_LIMIT_MAX', '10')),
  corsOrigins: env('CORS_ORIGIN', 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** True when CORS_ORIGIN was set explicitly (strict mode). */
  corsExplicit: Boolean(process.env.CORS_ORIGIN),

  databaseUrl: env('DATABASE_URL'),
  /** CA certificate (PEM path) for validating the DATABASE_URL TLS connection.
   *  Default: the bundled Supabase root CA (certs/supabase-root-2021-ca.pem).
   *  Set for other managed-Postgres providers whose CA differs. */
  databaseCaCertPath: env('DATABASE_CA_CERT_PATH'),
  /** Explicit escape hatch: '1' disables DB TLS certificate validation
   *  (encrypted but MITM-able — never use in production). */
  databaseTlsInsecure: env('DATABASE_TLS_INSECURE') === '1',
  dataDir: path.resolve(env('DATA_DIR', './data')),

  jwtSecret: resolveJwtSecret(),
  // 30 days + silent client-side renewal ≈ "stay signed in"; logout / password
  // change still revoke every issued token instantly via token_version.
  jwtExpiresIn: env('JWT_EXPIRES_IN', '30d'),
  // Absolute cap on a refresh chain: however often a session renews, once the
  // ORIGINAL sign-in (auth_at claim) is this old, /auth/refresh answers 401 and
  // the user re-authenticates. Limits how long a stolen token can self-renew.
  sessionMaxDays: Number(env('SESSION_MAX_DAYS', '90')),

  /** Dedicated key for sealing at-rest app secrets (the per-team SSO client
   *  secret — lib/secrets.ts). Decoupled from JWT_SECRET so rotating the JWT
   *  secret never makes SSO secrets undecryptable. Empty → lib/secrets falls
   *  back to the legacy JWT-derived key (backward compatible). Generate:
   *    node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" */
  secretsEncryptionKey: env('SECRETS_ENCRYPTION_KEY'),
  /** Master key for at-rest document encryption (see resolveDataEncryptionKey). */
  dataEncryptionKey: resolveDataEncryptionKey(),
  /** Previous master key — decrypt-only, set during a key rotation window. */
  dataEncryptionKeyPrevious: env('DATA_ENCRYPTION_KEY_PREVIOUS'),
  /** Password for the opt-in seeded demo account (only when SEED_DEMO_DATA=true). */
  seedDemoPassword: env('SEED_DEMO_PASSWORD', 'lexab-demo'),
  /** Batch review kicks off background processing from POST /batch. Tests set
   *  BATCH_AUTOSTART=0 and drive runBatch() deterministically instead (the
   *  single-connection PGlite adapter must not race a fire-and-forget loop). */
  batchAutostart: env('BATCH_AUTOSTART') !== '0',

  anthropicApiKey: env('ANTHROPIC_API_KEY'),
  anthropicModel: env('ANTHROPIC_MODEL', 'claude-opus-4-8'),

  deepseekApiKey,
  deepseekBaseUrl: env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
  deepseekModel,
  /**
   * Deterministic offline fallbacks when the model is unavailable. The mock is
   * enabled ONLY by the explicit value 'dev' (for local offline development);
   * any other value — including the default — fails loud (503) so a legal
   * product never fabricates analysis or citations. Deliberately independent of
   * NODE_ENV (which is never set here) so a keyless deploy can't silently mock.
   */
  llmFallback: env('LLM_FALLBACK', 'off').toLowerCase(),
  /** Per-plan model: better plan → smarter model (see llm.ts modelForPlan).
   *  Models prefixed "deepseek" route to the DeepSeek client, everything else
   *  to Anthropic. Free defaults to DeepSeek when DEEPSEEK_API_KEY is set. */
  planModels: {
    Free: env('ANTHROPIC_MODEL_FREE', freeModel),
    Standard: env('ANTHROPIC_MODEL_STANDARD', 'claude-sonnet-5'),
    Pro: env('ANTHROPIC_MODEL_PRO', 'claude-opus-4-8'),
    Business: env('ANTHROPIC_MODEL_BUSINESS', 'claude-fable-5'),
    Enterprise: env('ANTHROPIC_MODEL_ENTERPRISE', env('ANTHROPIC_MODEL_BUSINESS', 'claude-fable-5')),
  } as Record<string, string>,

  /** Voyage AI — dense embeddings for the legal corpus (empty = FTS-only search). */
  voyageApiKey: env('VOYAGE_API_KEY'),

  /** Audit: failed logins per IP/email in 5 min above this fire a security alert. */
  authBruteforceThreshold: Math.max(3, Number(env('AUTH_BRUTEFORCE_ALERT_THRESHOLD', '10'))),

  /** Reject known-breached passwords at register/change via the HIBP k-anonymity
   *  range API (only a SHA-1 prefix is sent). Fail-open on any network error.
   *  Set PASSWORD_BREACH_CHECK=0 to disable (also off in tests → no network). */
  passwordBreachCheck: env('PASSWORD_BREACH_CHECK', '1') !== '0',
  /** Days a soft-deleted document/analysis is retained before the purge sweep
   *  crypto-shreds it for good (retention policy — Этап 5). */
  dataRetentionDays: Math.max(1, Number(env('DATA_RETENTION_DAYS', '30'))),

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
  /** Ключ Cloud Text-to-Speech для озвучки ответов: JSON сервисного аккаунта
   *  (полная цепочка Gemini-TTS→Chirp) ИЛИ простой API-ключ (только Chirp3-HD).
   *  Пусто = POST /tts отвечает 503, остальное не затронуто. */
  googleTtsCredentialsJson: env('GOOGLE_TTS_CREDENTIALS_JSON'),
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

  /* ClamAV (clamd) для антивирусной проверки загрузок. Пусто = проверка
   * выключена (остаётся сигнатурная magic-byte валидация). */
  clamdHost: env('CLAMD_HOST'),
  clamdPort: Number(env('CLAMD_PORT', '3310')),

  /** Shared secret for the inbound-email webhook (empty = endpoint disabled). */
  inboundEmailToken: env('INBOUND_EMAIL_TOKEN'),
  /** Optional HMAC signing secret for the inbound-email webhook. When set, every
   *  request must carry a valid `X-Inbound-Signature` over `timestamp.from`, so a
   *  leaked static token alone can't inject documents under a spoofed sender. */
  inboundEmailSigningSecret: env('INBOUND_EMAIL_SIGNING_SECRET'),
  /** When 'true', reject inbound messages whose provider-asserted SPF/DKIM/DMARC
   *  result is not a pass — the `from` field is only trusted after authentication. */
  // Fail-closed по умолчанию: `from` доверяем только после проверки подлинности
  // отправителя провайдером; выключать (=false) — осознанно и только локально.
  inboundRequireAuth: env('INBOUND_REQUIRE_SPF_DKIM', 'true') === 'true',
  /* Outbound email (Resend) + links in emails point at the frontend. */
  resendApiKey: env('RESEND_API_KEY'),
  /* Where Enterprise "contact sales" and feedback are delivered. Empty = the
   * send is skipped with a loud log — set it in prod (no personal default). */
  contactEmail: env('CONTACT_EMAIL', ''),
  /* Opt-in demo seeding for local development only. */
  seedDemoData: env('SEED_DEMO_DATA', 'false') === 'true',
  mailFrom: env('MAIL_FROM', 'Lexab <onboarding@resend.dev>'),
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

