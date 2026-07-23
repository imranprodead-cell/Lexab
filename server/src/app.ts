/** Fastify app assembly: plugins, error shape, and all routes under API_PREFIX. */
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { config, isOriginAllowed } from './config.ts';
import type { Db } from './db.ts';
import { HttpError } from './lib/errors.ts';
import { registerAuth } from './plugins/auth.ts';
import { analysisRoutes } from './routes/analysis.routes.ts';
import { approvalRoutes } from './routes/approvals.routes.ts';
import { analyticsRoutes } from './routes/analytics.routes.ts';
import { authRoutes } from './routes/auth.routes.ts';
import { billingRoutes } from './routes/billing.routes.ts';
import { chatRoutes } from './routes/chats.routes.ts';
import { compareRoutes } from './routes/compare.routes.ts';
import { documentRoutes } from './routes/documents.routes.ts';
import { feedbackRoutes } from './routes/feedback.routes.ts';
import { googleRoutes } from './routes/google.routes.ts';
import { inboundRoutes } from './routes/inbound.routes.ts';
import { integrationRoutes } from './routes/integrations.routes.ts';
import { notificationRoutes } from './routes/notifications.routes.ts';
import { signRoutes } from './routes/sign.routes.ts';
import { signatureRoutes } from './routes/signatures.routes.ts';
import { teamRoutes } from './routes/team.routes.ts';
import { auditRoutes } from './routes/audit.routes.ts';
import { ssoRoutes } from './routes/sso.routes.ts';
import { templateRoutes } from './routes/templates.routes.ts';
import { playbookRoutes } from './routes/playbooks.routes.ts';
import { contractRoutes } from './routes/contracts.routes.ts';
import { batchRoutes } from './routes/batch.routes.ts';
import { workflowRoutes } from './routes/workflows.routes.ts';
import { securityRoutes } from './routes/security.routes.ts';
import { uploadRoutes } from './routes/uploads.routes.ts';
import { userRoutes } from './routes/user.routes.ts';
import { ttsRoutes } from './routes/tts.routes.ts';

export async function buildApp(db: Db): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Fastify's default request log prints the raw URL, which for public
    // capability routes (/sign/:token, /approve/:token, /team/invite-info/:token,
    // ?code=…) would persist a live bearer-equivalent secret in the log stream.
    // Disable it and emit our own line with the token redacted (hook below).
    disableRequestLogging: true,
    bodyLimit: 12 * 1024 * 1024, // avatar data-URLs + JSON payloads
    // Behind a trusted reverse proxy/CDN, honour X-Forwarded-For so req.ip is
    // the real client. Off by default (direct exposure must not trust a
    // spoofable header); set TRUST_PROXY=true (or a hop count) in that deploy.
    trustProxy: process.env.TRUST_PROXY === 'true' ? true : Number(process.env.TRUST_PROXY) || false,
  });

  // Security headers. This is a JSON API (the SPA is served separately), so the
  // CSP is a hard lock — it never serves a document that loads scripts/styles.
  // CORP is cross-origin because the frontend runs on its own origin and access
  // is already gated by CORS below.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 15_552_000, includeSubDomains: true }, // 180 days
    referrerPolicy: { policy: 'no-referrer' },
  });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || isOriginAllowed(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['X-Total-Count', 'Content-Disposition'],
  });
  await app.register(jwt, { secret: config.jwtSecret });
  // Cookies are used only for the short-lived OAuth anti-CSRF nonce (httpOnly,
  // SameSite=Lax) — the session itself stays a Bearer token, so no CSRF surface
  // is introduced for the API's mutating routes.
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, {
    global: true,
    max: 300, // generous global ceiling; sensitive routes override to 10–20/min
    timeWindow: '1 minute',
    // Key authenticated requests by user id (so users behind one shared IP /
    // NAT aren't throttled together, and rotating IPs can't multiply an
    // account's budget); fall back to IP otherwise. The token is VERIFIED here —
    // an unverified `sub` would let an attacker rotate a forged claim to dodge
    // the per-IP brute-force limit on /auth/login etc.
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        try {
          const payload = app.jwt.verify<{ sub?: string }>(auth.slice(7));
          if (payload.sub) return `u:${payload.sub}`;
        } catch {
          /* invalid/expired token — fall through to IP */
        }
      }
      return req.ip;
    },
  });

  // Uniform error shape: non-2xx + { message } (what the frontend surfaces).
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send(err.code ? { message: err.message, code: err.code } : { message: err.message });
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 429) {
      return reply.code(429).send({ message: 'Too many requests — please slow down.' });
    }
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ message: (err as Error).message });
    }
    req.log.error(err);
    if (config.sentryDsn) {
      // Lazy import keeps Sentry fully out of the picture when disabled.
      void import('@sentry/node').then((Sentry) => Sentry.captureException(err));
    }
    return reply.code(500).send({ message: 'Internal server error' });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ message: 'Not found' });
  });

  // Redacted access log: never records the capability token in the path or the
  // OAuth code/state/token query params (CWE-532).
  const redactUrl = (url: string): string =>
    url
      .replace(/(\/(?:sign|approve|invite-info|tts\/stream)\/)[^/?#]+/g, '$1[redacted]')
      .replace(/([?&](?:code|token|state)=)[^&]+/gi, '$1[redacted]');
  app.addHook('onResponse', (req, reply, done) => {
    req.log.info(
      { method: req.method, url: redactUrl(req.url), statusCode: reply.statusCode, ms: Math.round(reply.elapsedTime) },
      'request completed',
    );
    done();
  });

  registerAuth(app, db);

  await app.register(
    async (api) => {
      // Живой readiness: без реального запроса к базе умершее соединение
      // выглядело бы «здоровым» и платформа продолжала бы слать трафик.
      api.get('/health', async (_req, reply) => {
        try {
          await db.query('SELECT 1');
          return { ok: true, db: db.kind };
        } catch {
          reply.code(503);
          return { ok: false, db: db.kind };
        }
      });
      authRoutes(api, db);
      googleRoutes(api, db);
      userRoutes(api, db);
      securityRoutes(api, db);
      chatRoutes(api, db);
      analysisRoutes(api, db);
      compareRoutes(api, db);
      inboundRoutes(api, db);
      uploadRoutes(api, db);
      documentRoutes(api, db);
      signRoutes(api, db);
      approvalRoutes(api, db);
      templateRoutes(api, db);
      playbookRoutes(api, db);
      contractRoutes(api, db);
      batchRoutes(api, db);
      workflowRoutes(api, db);
      signatureRoutes(api, db);
      analyticsRoutes(api, db);
      notificationRoutes(api, db);
      billingRoutes(api, db);
      teamRoutes(api, db);
      auditRoutes(api, db);
      ssoRoutes(api, db);
      integrationRoutes(api, db);
      feedbackRoutes(api, db);
      ttsRoutes(api);
    },
    { prefix: config.apiPrefix },
  );

  return app;
}
