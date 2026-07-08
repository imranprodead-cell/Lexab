/** Fastify app assembly: plugins, error shape, and all routes under API_PREFIX. */
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { config, isOriginAllowed } from './config.ts';
import type { Db } from './db.ts';
import { HttpError } from './lib/errors.ts';
import { registerAuth } from './plugins/auth.ts';
import { analysisRoutes } from './routes/analysis.routes.ts';
import { analyticsRoutes } from './routes/analytics.routes.ts';
import { authRoutes } from './routes/auth.routes.ts';
import { billingRoutes } from './routes/billing.routes.ts';
import { chatRoutes } from './routes/chats.routes.ts';
import { compareRoutes } from './routes/compare.routes.ts';
import { documentRoutes } from './routes/documents.routes.ts';
import { googleRoutes } from './routes/google.routes.ts';
import { inboundRoutes } from './routes/inbound.routes.ts';
import { notificationRoutes } from './routes/notifications.routes.ts';
import { signatureRoutes } from './routes/signatures.routes.ts';
import { teamRoutes } from './routes/team.routes.ts';
import { templateRoutes } from './routes/templates.routes.ts';
import { uploadRoutes } from './routes/uploads.routes.ts';
import { userRoutes } from './routes/user.routes.ts';

export async function buildApp(db: Db): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 12 * 1024 * 1024, // avatar data-URLs + JSON payloads
  });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || isOriginAllowed(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['X-Total-Count', 'Content-Disposition'],
  });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, {
    global: true,
    max: 300, // generous global ceiling; sensitive routes override to 10–20/min
    timeWindow: '1 minute',
  });

  // Uniform error shape: non-2xx + { message } (what the frontend surfaces).
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ message: err.message });
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

  registerAuth(app, db);

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true, db: db.kind }));
      authRoutes(api, db);
      googleRoutes(api, db);
      userRoutes(api, db);
      chatRoutes(api, db);
      analysisRoutes(api, db);
      compareRoutes(api, db);
      inboundRoutes(api, db);
      uploadRoutes(api, db);
      documentRoutes(api, db);
      templateRoutes(api, db);
      signatureRoutes(api, db);
      analyticsRoutes(api, db);
      notificationRoutes(api, db);
      billingRoutes(api, db);
      teamRoutes(api, db);
    },
    { prefix: config.apiPrefix },
  );

  return app;
}
