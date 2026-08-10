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

const LOCALHOST_URL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * «Боевой запуск» — то, чего в этом проекте раньше не умели определять.
 *
 * NODE_ENV здесь НИКОГДА не выставляется (см. start-скрипт), поэтому все
 * старые guards, завязанные на него, были мертвы в проде. Признак деплоя —
 * публичный адрес приложения: локальный запуск оставляет дефолтный
 * http://localhost:5173, а любой реальный деплой обязан задать APP_BASE_URL.
 * Дополнительно уважаем явные NODE_ENV=production и DEPLOY_ENV.
 *
 * Используется для fail-closed проверок ниже: отладочные переключатели
 * (бесплатные тарифы, перенаправление всей почты на один ящик, мок ИИ)
 * не должны молча доехать до боевого сервера.
 */
const appBaseUrl = env('APP_BASE_URL', 'http://localhost:5173');
export const isProductionRun =
  env('NODE_ENV') === 'production' ||
  ['production', 'prod', 'staging'].includes(env('DEPLOY_ENV').toLowerCase()) ||
  !LOCALHOST_URL.test(appBaseUrl);


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
  /** Пароль демо-аккаунта (только при SEED_DEMO_DATA=true). Дефолта НЕТ намеренно:
   *  прежний 'lexab-demo' опубликован в README, и случайно включённый сид
   *  создавал бы аккаунт с общеизвестным паролем и планом Pro. */
  seedDemoPassword: env('SEED_DEMO_PASSWORD'),
  /** Batch review kicks off background processing from POST /batch. Tests set
   *  BATCH_AUTOSTART=0 and drive runBatch() deterministically instead (the
   *  single-connection PGlite adapter must not race a fire-and-forget loop). */
  batchAutostart: env('BATCH_AUTOSTART') !== '0',
  /** Месячный потолок вызовов публичного API на аккаунт Business (Enterprise —
   *  безлимит). Каждый API-анализ жжёт токены модели, поэтому потолок обязателен:
   *  чужой глючный интегратор не должен накручивать счёт владельцу магазина.
   *  Сверх пакета клиент докупает вызовы через менеджера (вкладка «API» →
   *  «Пополнить баланс»), поэтому базовый пакет намеренно небольшой. */
  apiMonthlyLimit: Math.max(1, Number(env('API_MONTHLY_LIMIT', '100')) || 100),

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
    // Pro намеренно на той же модели, что Standard: решение владельца
    // 2026-08-06. Opus стоил впятеро дороже Sonnet при 500 запросах в месяц —
    // тариф $50 не окупал модель (см. расчёт экономики того же дня).
    Pro: env('ANTHROPIC_MODEL_PRO', 'claude-sonnet-5'),
    Business: env('ANTHROPIC_MODEL_BUSINESS', 'claude-fable-5'),
    Enterprise: env('ANTHROPIC_MODEL_ENTERPRISE', env('ANTHROPIC_MODEL_BUSINESS', 'claude-fable-5')),
  } as Record<string, string>,

  /** Voyage AI — dense embeddings for the legal corpus (empty = FTS-only search). */
  voyageApiKey: env('VOYAGE_API_KEY'),

  /** Audit: failed logins per IP/email in 5 min above this fire a security alert. */
  authBruteforceThreshold: Math.max(3, Number(env('AUTH_BRUTEFORCE_ALERT_THRESHOLD', '10'))),
  /** Неудачных входов за 15 минут (по IP ИЛИ по адресу), после которых вход
   *  временно закрывается. Раньше детектор только слал письмо, но перебору не
   *  мешал. Поднимается в тестовом сьюте, где десятки логинов идут с одного
   *  loopback-адреса. */
  authLockoutFailures: Math.max(5, Number(env('AUTH_LOCKOUT_FAILURES', '20')) || 20),

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
  /* Дефолт перевёрнут на БОЕВОЙ (было '1'): забытая переменная теперь даёт
   * настоящие подписи, а не юридически ничтожные. Песочница — только явным '1'. */
  dropboxSignTestMode: env('DROPBOX_SIGN_TEST_MODE', '0') === '1',
  /** Раздел «Э-подписи» целиком выключен до подключения E-IMZO (решение
   *  владельца, 2026-08-04): полурабочая подпись в юридическом продукте опаснее
   *  выключенной. Сервер отвечает 503 на отправку, интерфейс показывает «скоро».
   *  Включается явным ESIGN_ENABLED=1, когда появится боевой провайдер. */
  esignEnabled: env('ESIGN_ENABLED', '0') === '1',

  /* Lemon Squeezy — реальные платежи за подписки (см. resolveLemonSqueezy). */
  /** 'dev' = прежняя мгновенная бесплатная активация плана (локалка/тесты).
   *  Любое другое значение (включая дефолт) — checkout без LS отвечает 503:
   *  прод без платёжных ключей не должен раздавать планы бесплатно. */

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
  /** Публичный адрес приёма договоров («пришлите файл — получите анализ»),
   *  показывается в Настройках. Только витрина: маршрутизация всё равно идёт
   *  по отправителю. Пусто = карточка в Настройках скрыта. */
  inboundEmailAddress: env('INBOUND_EMAIL_ADDRESS'),
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
  appBaseUrl,
  /** Куда разрешено возвращать пользователя после входа (OAuth/SSO redirect).
   *  ОТДЕЛЬНЫЙ список от CORS_ORIGIN: '*' в CORS не должен превращать
   *  /auth/google?redirect= в открытый редирект с одноразовым login-кодом.
   *  Пусто = разрешён только сам appBaseUrl (+ локалка вне прода). */
  redirectOrigins: env('REDIRECT_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /**
   * Почты владельцев админ-панели (через запятую). НАМЕРЕННО НЕ В БАЗЕ:
   * админство, хранящееся в таблице, назначается любым, кто дотянулся до базы
   * или нашёл дыру в API, — а админ выдаёт платные тарифы и снимает лимиты.
   * Список в окружении изменить из приложения нельзя ВООБЩЕ, только доступом
   * к серверу. Пусто = админки нет ни у кого (безопасное состояние по умолчанию).
   */
  adminEmails: env('ADMIN_EMAILS')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  /** Sentry error monitoring (empty = disabled). */
  sentryDsn: env('SENTRY_DSN'),

  s3Bucket: env('S3_BUCKET'),
  s3Region: env('S3_REGION', 'us-east-1'),
  s3Endpoint: env('S3_ENDPOINT'),
  s3PublicUrl: env('S3_PUBLIC_URL'),
} as const;


/**
 * Fail-closed проверки боевого запуска (аудит 2026-08-03).
 *
 * Каждый переключатель ниже удобен на локальной машине и катастрофичен в проде:
 * MAIL_REDIRECT_TO уводит ВСЮ клиентскую почту (верификация, подписи, счета) на
 * один ящик, LLM_FALLBACK=dev подменяет анализ заглушкой. Раньше их ничто не
 * сторожило. Теперь боевой запуск с любым из них просто не стартует — это
 * дешевле, чем обнаружить постфактум.
 *
 * BILLING_FALLBACK=dev, раздававший платные тарифы бесплатно, из проекта убран
 * целиком вместе с платёжным самообслуживанием: тариф выдаёт только владелец
 * из админ-панели, поэтому сторожить больше нечего.
 */
function assertProductionSafety(): void {
  if (!isProductionRun) return;
  const problems: string[] = [];
  if (config.mailRedirectTo) {
    problems.push(`MAIL_REDIRECT_TO=${config.mailRedirectTo} — вся почта клиентов уходила бы на один ящик`);
  }
  if (config.llmFallback === 'dev') {
    problems.push('LLM_FALLBACK=dev — юридический анализ подменялся бы офлайн-заглушкой');
  }
  if (config.seedDemoData) {
    problems.push('SEED_DEMO_DATA=true — в базу создавался бы демо-аккаунт с известным паролем');
  }
  if (config.dropboxSignTestMode && config.dropboxSignApiKey) {
    problems.push('DROPBOX_SIGN_TEST_MODE=1 при заданном ключе — подписи были бы юридически ничтожными');
  }
  if (config.databaseTlsInsecure) {
    problems.push('DATABASE_TLS_INSECURE=1 — соединение с базой не проверяло бы сертификат');
  }
  if (problems.length) {
    throw new Error(
      'Небезопасные настройки для боевого запуска (APP_BASE_URL не локальный):\n  - ' +
        problems.join('\n  - ') +
        '\nУберите их из окружения. Для локального запуска оставьте APP_BASE_URL по умолчанию (http://localhost:5173).',
    );
  }

  // Не блокируем старт, но и не даём забыть: это настройки, отсутствие которых
  // не ломает продукт немедленно, а проявляется потерянными письмами и
  // непроверенными файлами.
  if (!config.clamdHost) {
    console.warn('[config] CLAMD_HOST не задан — загружаемые файлы НЕ проверяются антивирусом (остаётся только проверка сигнатуры формата).');
  }
  if (!config.contactEmail) {
    console.warn('[config] CONTACT_EMAIL не задан — обращения из формы «связаться», отклики и уведомления о возвратах платежей никуда не уйдут.');
  }
}
assertProductionSafety();

/**
 * CORS_ORIGIN='*' вместе с настроенным входом через Google/SSO — открытый
 * редирект: /auth/google?redirect=<чужой домен> вернёт туда одноразовый
 * login-код. Разрешаем '*' только если задан отдельный REDIRECT_ORIGINS.
 */
if (config.corsOrigins.includes('*') && (config.googleClientId || isProductionRun) && !config.redirectOrigins.length) {
  throw new Error(
    'CORS_ORIGIN=* нельзя сочетать со входом через Google/SSO: адрес возврата после входа стал бы открытым редиректом. ' +
      'Перечислите домены в CORS_ORIGIN либо задайте отдельный REDIRECT_ORIGINS со списком разрешённых адресов возврата.',
  );
}

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

/**
 * Куда МОЖНО вернуть пользователя после входа (OAuth/SSO redirect).
 *
 * Намеренно НЕ isOriginAllowed: CORS_ORIGIN='*' — рабочая настройка для
 * публичного API, но со звёздочкой /auth/google?redirect=<чужой домен> отдавал
 * бы одноразовый login-код на чужой сайт (аудит 2026-08-03). Список редиректов
 * отдельный и звёздочку не понимает.
 */
export function isRedirectAllowed(origin: string): boolean {
  if (config.redirectOrigins.length) return config.redirectOrigins.includes(origin);
  try {
    if (origin === new URL(config.appBaseUrl).origin) return true;
  } catch {
    /* некорректный APP_BASE_URL — падаем на проверки ниже */
  }
  // Явный список CORS (без '*') остаётся валидным источником адресов возврата.
  if (config.corsExplicit && !config.corsOrigins.includes('*') && config.corsOrigins.includes(origin)) return true;
  return !isProductionRun && LOCALHOST_ORIGIN.test(origin);
}

