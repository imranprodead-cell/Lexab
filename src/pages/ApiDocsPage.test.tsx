// @vitest-environment jsdom
/**
 * Смоук рендера документации API: страница строится из НАСТОЯЩЕГО фрагмента
 * OpenAPI-спеки бэкенда (скопирован дословно из server/src/lib/openapiSpec.ts),
 * так что дрейф формата спеки уронит тест. Сеть замокана (unit-тест).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@/i18n/I18nProvider';

// Подменяем только http: остальные экспорты (USE_MOCK, httpSSE…) нужны
// сторам, которые тянет TopBar.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, http: vi.fn() };
});

import { http } from '@/api/client';
import { ApiDocsPage } from './ApiDocsPage';

const mockHttp = http as unknown as ReturnType<typeof vi.fn>;

/** Дословный фрагмент спеки бэкенда: 3 тега, 4 операции, схемы с $ref. */
const SPEC = {
  openapi: '3.1.0',
  info: { title: 'Lexab Public API', version: '1.3.0', description: 'Machine-to-machine API. Errors always use `{ "error": { "code", "message" } }`.' },
  servers: [{ url: 'http://localhost:8080/api' }],
  tags: [
    { name: 'Analyses', description: 'Contract analysis (findings, risk score, verified citations)' },
    { name: 'Webhooks', description: 'Callback notifications on job completion' },
    { name: 'Usage', description: 'Monthly quota' },
  ],
  paths: {
    '/v1/analyses': {
      post: {
        tags: ['Analyses'],
        summary: 'Analyze a contract',
        description: 'Accepts JSON `{ text }` or `multipart/form-data` with a `file`. Requires the `analyses:write` scope.',
        parameters: [
          { name: 'Idempotency-Key', in: 'header', required: false, description: 'Optional client-generated key.', schema: { type: 'string', maxLength: 256 } },
        ],
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
              schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
            },
          },
        },
        responses: {
          '202': { description: 'Job accepted (asynchronous).', content: { 'application/json': { schema: { $ref: '#/components/schemas/JobAccepted' } } } },
          '401': { description: 'Missing/invalid/expired API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      get: {
        tags: ['Analyses'],
        summary: 'List analysis jobs',
        description: 'Requires `analyses:read` or `analyses:write`.',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: { '200': { description: 'Paged job list (newest first)' } },
      },
    },
    '/v1/webhooks/{id}': {
      delete: {
        tags: ['Webhooks'],
        summary: 'Revoke a callback endpoint',
        description: 'Requires `webhooks:manage`.',
        parameters: [{ name: 'id', in: 'path', required: true, description: 'Endpoint id', schema: { type: 'string' } }],
        responses: { '204': { description: 'Revoked' }, '404': { description: 'Not found' } },
      },
    },
    '/v1/usage': {
      get: {
        tags: ['Usage'],
        summary: 'Monthly quota usage',
        description: 'Open to any valid key.',
        responses: { '200': { description: 'Usage' } },
      },
    },
  },
  components: {
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'object' } } },
      JobAccepted: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['processing'] } } },
    },
  },
};

// jsdom-заглушки — те же, что в ChatPage.test.tsx.
window.matchMedia =
  window.matchMedia ??
  ((query: string) =>
    ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList);
globalThis.IntersectionObserver =
  globalThis.IntersectionObserver ??
  (class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver);

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

describe('ApiDocsPage — рендер OpenAPI-спеки', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Спека — только для своего пути; прочие вызовы (уведомления в TopBar и
    // т.п.) получают пустой список.
    mockHttp.mockImplementation((path: string) => Promise.resolve(path === '/v1/openapi.json' ? SPEC : []));
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root.render(
        <I18nProvider>
          <MemoryRouter initialEntries={['/developer/docs']}>
            <ApiDocsPage />
          </MemoryRouter>
        </I18nProvider>,
      );
    });
    await flush();
  });

  it('показывает теги, эндпоинты, методы и ссылку на openapi.json', () => {
    expect(mockHttp).toHaveBeenCalledWith('/v1/openapi.json', expect.anything());
    const html = document.body.innerHTML;
    // Секции по тегам из спеки.
    for (const tag of ['Analyses', 'Webhooks', 'Usage']) expect(html).toContain(tag);
    // Карточки эндпоинтов: путь + метод-бейджи + summary.
    expect(html).toContain('/v1/analyses');
    expect(html).toContain('Analyze a contract');
    for (const m of ['POST', 'GET', 'DELETE']) expect(html).toContain(`>${m}<`);
    // Параметры и тело из схемы.
    expect(html).toContain('Idempotency-Key');
    expect(html).toContain('jurisdiction');
    // Ответы с кодами и именем схемы из $ref.
    expect(html).toContain('202');
    expect(html).toContain('JobAccepted');
    // Ссылка «скачать спеку» (BASE_URL в среде может отличаться от «/api»).
    const dl = document.querySelector('a[download="openapi.json"]');
    expect(dl).not.toBeNull();
    expect(dl!.getAttribute('href')).toMatch(/\/v1\/openapi\.json$/);
  });

  it('cURL-пример собран из схемы; переключатель показывает Python и JavaScript', async () => {
    let html = document.body.innerHTML;
    // cURL по умолчанию: авторизация + реальное JSON-тело из схемы.
    expect(html).toContain('Authorization: Bearer lxb_YOUR_KEY');
    expect(html).toContain('FULL CONTRACT TEXT…');

    // Переключение на Python в первой карточке.
    const pyTab = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Python');
    expect(pyTab).toBeDefined();
    await act(async () => {
      pyTab!.click();
    });
    html = document.body.innerHTML;
    expect(html).toContain('import requests');

    const jsTab = [...document.querySelectorAll('button')].find((b) => b.textContent === 'JavaScript');
    await act(async () => {
      jsTab!.click();
    });
    expect(document.body.innerHTML).toContain('await fetch(');
  });
});
