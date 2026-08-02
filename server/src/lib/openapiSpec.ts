/**
 * OpenAPI 3.1 спецификация публичного API (/api/v1/*) — Фаза 4.
 *
 * РУЧНАЯ спека (в проекте нет @fastify/swagger и схем на роутах — валидация
 * в validate.ts): единственный источник правды о контракте для интеграторов.
 * Отдаётся публичным GET /api/v1/openapi.json (без ключа — это документация,
 * секретов в ней нет) и рендерится на фронте (/developer/docs).
 *
 * При ЛЮБОМ изменении контракта /v1 — обновить и эту спеку, и API.md.
 */
import { config } from '../config.ts';

const err = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
    },
  },
});

const jobAccepted = {
  description: 'Job accepted (asynchronous). Poll the matching GET endpoint until `status` is `done` or `error`.',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/JobAccepted' },
    },
  },
};

const idempotencyHeader = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  description:
    'Optional client-generated key (≤256 chars). Retrying the same POST with the same key returns the previously created job instead of creating (and charging) a new one. Reusing a key on a different endpoint returns 409 `idempotency_key_reused`.',
  schema: { type: 'string', maxLength: 256 },
};

const idParam = (description: string) => ({
  name: 'id',
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
});

/** Собрать спеку (serverUrl подставляется из конфига среды). */
export function buildOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Lexab Public API',
      version: '1.3.0',
      description:
        'Machine-to-machine API for Business/Enterprise customers: contract analysis, version compare, contract drafting and template generation, with verified legal citations. All AI jobs are **asynchronous**: `POST` returns `202` with a job id — poll the matching `GET` until `status` is `done` or `error`, or register a webhook to be called back. Errors always use `{ "error": { "code", "message" } }`.',
    },
    servers: [{ url: `${config.apiBaseUrl}/api` }],
    security: [{ bearerKey: [] }, { headerKey: [] }],
    tags: [
      { name: 'Analyses', description: 'Contract analysis (findings, risk score, verified citations)' },
      { name: 'Drafts', description: 'Draft a contract from a prompt' },
      { name: 'Compares', description: 'Compare two contract versions' },
      { name: 'Templates', description: 'Template catalog and generation' },
      { name: 'Webhooks', description: 'Callback notifications on job completion' },
      { name: 'Usage', description: 'Monthly quota' },
    ],
    paths: {
      '/v1/analyses': {
        post: {
          tags: ['Analyses'],
          summary: 'Analyze a contract',
          description:
            'Accepts JSON `{ text }` or `multipart/form-data` with a `file` (pdf, docx, txt…). Requires the `analyses:write` scope.',
          parameters: [idempotencyHeader],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['text'],
                  properties: {
                    text: { type: 'string', minLength: 40, maxLength: 2_000_000 },
                    fileName: { type: 'string', maxLength: 300 },
                    jurisdiction: { type: 'string', maxLength: 60 },
                  },
                },
              },
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: { file: { type: 'string', format: 'binary' } },
                },
              },
            },
          },
          responses: {
            '202': jobAccepted,
            '401': err('Missing/invalid/expired API key'),
            '403': err('Key lacks the required scope (`insufficient_scope`) or plan lost API access'),
            '429': err('Burst limit (60/min) or monthly limit reached'),
          },
        },
        get: {
          tags: ['Analyses'],
          summary: 'List analysis jobs',
          description: 'Requires `analyses:read` or `analyses:write`.',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
          ],
          responses: {
            '200': {
              description: 'Paged job list (newest first)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/AnalysisListItem' } },
                      limit: { type: 'integer' },
                      offset: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '401': err('Missing/invalid/expired API key'),
            '403': err('insufficient_scope'),
          },
        },
      },
      '/v1/analyses/{id}': {
        get: {
          tags: ['Analyses'],
          summary: 'Analysis status / result',
          description: 'Requires `analyses:read` or `analyses:write`. Only your own jobs (foreign id → 404).',
          parameters: [
            idParam('Job id from POST /v1/analyses'),
            {
              name: 'report',
              in: 'query',
              description: 'Pass `1` to include `reportUrl` — a public, shareable report page for humans.',
              schema: { type: 'string', enum: ['1', 'true', 'yes'] },
            },
          ],
          responses: {
            '200': {
              description: 'Job status; when `done`, includes the analysis result',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/AnalysisResult' } } },
            },
            '401': err('Missing/invalid/expired API key'),
            '403': err('insufficient_scope'),
            '404': err('Not found (or not yours)'),
          },
        },
      },
      '/v1/drafts': {
        post: {
          tags: ['Drafts'],
          summary: 'Draft a contract from a prompt',
          description: 'Requires `drafts:write`.',
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['prompt'],
                  properties: {
                    prompt: { type: 'string', minLength: 1, maxLength: 4000 },
                    jurisdiction: { type: 'string', maxLength: 120 },
                  },
                },
              },
            },
          },
          responses: { '202': jobAccepted, '401': err('Missing/invalid/expired API key'), '403': err('insufficient_scope'), '429': err('Rate/monthly limit') },
        },
      },
      '/v1/drafts/{id}': {
        get: {
          tags: ['Drafts'],
          summary: 'Draft status / result',
          description: 'Requires `drafts:write`.',
          parameters: [idParam('Job id from POST /v1/drafts'), { name: 'report', in: 'query', schema: { type: 'string', enum: ['1', 'true', 'yes'] } }],
          responses: {
            '200': { description: 'When `done`: `{ title, summary, document }` (document = array of heading/paragraph blocks) and optional `reportUrl`', content: { 'application/json': { schema: { $ref: '#/components/schemas/Job' } } } },
            '401': err('Missing/invalid/expired API key'),
            '403': err('insufficient_scope'),
            '404': err('Not found'),
          },
        },
      },
      '/v1/compares': {
        post: {
          tags: ['Compares'],
          summary: 'Compare two contract versions',
          description: 'JSON `{ textA, textB }` or multipart `fileA` + `fileB`. Requires `compares:write`.',
          parameters: [idempotencyHeader],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['textA', 'textB'],
                  properties: {
                    textA: { type: 'string', minLength: 40 },
                    textB: { type: 'string', minLength: 40 },
                    nameA: { type: 'string', maxLength: 200 },
                    nameB: { type: 'string', maxLength: 200 },
                  },
                },
              },
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['fileA', 'fileB'],
                  properties: { fileA: { type: 'string', format: 'binary' }, fileB: { type: 'string', format: 'binary' } },
                },
              },
            },
          },
          responses: { '202': jobAccepted, '401': err('Missing/invalid/expired API key'), '403': err('insufficient_scope'), '422': err('Unreadable file / text too short'), '429': err('Rate/monthly limit') },
        },
      },
      '/v1/compares/{id}': {
        get: {
          tags: ['Compares'],
          summary: 'Compare status / result',
          description: 'Requires `compares:write`. When `done`: `{ summary, changes[] }`.',
          parameters: [idParam('Job id from POST /v1/compares')],
          responses: { '200': { description: 'Job status/result', content: { 'application/json': { schema: { $ref: '#/components/schemas/Job' } } } }, '401': err('Missing/invalid/expired API key'), '403': err('insufficient_scope'), '404': err('Not found') },
        },
      },
      '/v1/templates': {
        get: {
          tags: ['Templates'],
          summary: 'Template catalog',
          description: 'Synchronous, no AI unit consumed. Open to any valid key.',
          responses: {
            '200': {
              description: 'Catalog',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Template' } } },
                  },
                },
              },
            },
            '401': err('Missing/invalid/expired API key'),
          },
        },
      },
      '/v1/templates/{id}/generate': {
        post: {
          tags: ['Templates'],
          summary: 'Generate a contract from a template',
          description: 'Requires `templates:write`.',
          parameters: [idParam('Template id from GET /v1/templates'), idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['partyA', 'partyB', 'details'],
                  properties: {
                    partyA: { type: 'string', maxLength: 200 },
                    partyB: { type: 'string', maxLength: 200 },
                    details: { type: 'string', minLength: 5, maxLength: 4000 },
                    jurisdiction: { type: 'string' },
                    term: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '202': jobAccepted, '401': err('Missing/invalid/expired API key'), '403': err('insufficient_scope'), '404': err('Template not found'), '429': err('Rate/monthly limit') },
        },
      },
      '/v1/templates/requests/{id}': {
        get: {
          tags: ['Templates'],
          summary: 'Template generation status / result',
          description: 'Requires `templates:write`. When `done`: `{ title, content }`.',
          parameters: [idParam('Job id from POST /v1/templates/{id}/generate')],
          responses: { '200': { description: 'Job status/result', content: { 'application/json': { schema: { $ref: '#/components/schemas/Job' } } } }, '401': err('Missing/invalid/expired API key'), '403': err('insufficient_scope'), '404': err('Not found') },
        },
      },
      '/v1/webhooks': {
        post: {
          tags: ['Webhooks'],
          summary: 'Register a callback endpoint',
          description:
            'Requires `webhooks:manage`. `url` must be **https** and resolve to a public IP (private/link-local addresses are rejected — `webhook_ssrf`). The `signingSecret` is returned **once**: verify each delivery by comparing `X-Lexab-Signature` with HMAC-SHA256(raw body, secret). Delivery payload is minimal — `{ event, id, kind, status[, error] }` — fetch full results via the API. Retries: 1m/5m/30m/2h/6h, up to 5 attempts.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string', maxLength: 2000, description: 'https:// endpoint on a public host' },
                    events: {
                      type: 'array',
                      maxItems: 20,
                      items: { type: 'string' },
                      description: "Event filter, e.g. ['analysis.done','draft.error']; empty/['*'] = all",
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Endpoint registered; `signingSecret` shown once',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { id: { type: 'string' }, events: { type: 'array', items: { type: 'string' } }, signingSecret: { type: 'string' } },
                  },
                },
              },
            },
            '400': err('Unsafe or invalid URL (`webhook_ssrf`, `webhook_url_invalid`)'),
            '401': err('Missing/invalid/expired API key'),
            '403': err('insufficient_scope'),
          },
        },
        get: {
          tags: ['Webhooks'],
          summary: 'List callback endpoints',
          description: 'Requires `webhooks:manage`. URLs are masked; secrets are never returned.',
          responses: { '200': { description: 'Endpoints', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } } } } } } }, '401': err('Missing/invalid/expired API key'), '403': err('insufficient_scope') },
        },
      },
      '/v1/webhooks/{id}': {
        delete: {
          tags: ['Webhooks'],
          summary: 'Revoke a callback endpoint',
          description: 'Requires `webhooks:manage`.',
          parameters: [idParam('Endpoint id')],
          responses: { '204': { description: 'Revoked' }, '401': err('Missing/invalid/expired API key'), '403': err('insufficient_scope'), '404': err('Not found') },
        },
      },
      '/v1/usage': {
        get: {
          tags: ['Usage'],
          summary: 'Monthly quota usage',
          description: 'Open to any valid key. `limit` is null on unlimited (Enterprise) plans.',
          responses: {
            '200': {
              description: 'Usage',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      month: { type: 'string', example: '2026-08' },
                      used: { type: 'integer' },
                      limit: { type: ['integer', 'null'] },
                      remaining: { type: ['integer', 'null'] },
                    },
                  },
                },
              },
            },
            '401': err('Missing/invalid/expired API key'),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerKey: { type: 'http', scheme: 'bearer', description: 'API key `lxb_…` as a Bearer token' },
        headerKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'API key `lxb_…`' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description:
                    'Machine-readable: missing_api_key | invalid_api_key | plan_required | insufficient_scope | rate_limited | monthly_limit_exceeded | idempotency_key_reused | idempotency_conflict | not_found | webhook_ssrf | text_too_short | unreadable_file | generation_failed | interrupted | internal_error',
                },
                message: { type: 'string' },
              },
            },
          },
        },
        JobAccepted: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Job id — poll the matching GET endpoint' },
            status: { type: 'string', enum: ['processing'] },
            fileName: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Job: {
          type: 'object',
          description: 'Base job envelope; result fields are merged in when `status` = `done`, `error` object when `error`.',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['processing', 'done', 'error'] },
            fileName: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } },
          },
        },
        AnalysisListItem: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['processing', 'done', 'error'] },
            fileName: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            analysisId: { type: 'string' },
            riskScore: { type: 'number' },
            riskLevel: { type: 'string', enum: ['Low', 'Elevated', 'High'] },
          },
        },
        AnalysisResult: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['processing', 'done', 'error'] },
            fileName: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            analysisId: { type: 'string' },
            documentId: { type: 'string' },
            riskScore: { type: 'number' },
            riskLevel: { type: 'string', enum: ['Low', 'Elevated', 'High'] },
            clausesReviewed: { type: 'integer' },
            summary: { type: 'string' },
            reportUrl: { type: 'string', description: 'Public shareable report page (only with ?report=1)' },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  severity: { type: 'string' },
                  title: { type: 'string' },
                  citation: { type: 'string' },
                  verified: { type: 'boolean', description: 'Citation confirmed against the official law corpus' },
                },
              },
            },
          },
        },
        Template: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            nameRu: { type: ['string', 'null'] },
            category: { type: 'string' },
            description: { type: 'string' },
            jurisdiction: { type: ['string', 'null'] },
          },
        },
      },
    },
  };
}
