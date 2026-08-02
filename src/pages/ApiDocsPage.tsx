/**
 * Интерактивная документация публичного API (/developer/docs, Фаза 4).
 *
 * Рендерит OpenAPI 3.1-спеку с публичного GET /api/v1/openapi.json собственным
 * лёгким рендером (НЕ swagger-ui — тяжёлая зависимость ради одной страницы):
 * навигация по тегам, карточка на каждый эндпоинт (метод, путь, параметры,
 * тело, ответы) и примеры cURL / Python / JavaScript, сгенерированные из схем.
 * Названия/описания эндпоинтов — англ. техконтракт, намеренно без перевода.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BASE_URL, http } from '@/api/client';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { ErrorState, SkeletonRows } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useReveal } from '@/hooks/useReveal';
import { useI18n } from '@/i18n/I18nProvider';
import { useUIStore } from '@/store/useUIStore';
import styles from './pages.module.css';

/* ---------------------------------------------------------------- типы спеки */

interface SchemaObj {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, SchemaObj>;
  required?: string[];
  items?: SchemaObj;
  enum?: (string | number)[];
  format?: string;
  description?: string;
  example?: unknown;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
}

interface ParamObj {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: SchemaObj;
}

interface OperationObj {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: ParamObj[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: SchemaObj }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: SchemaObj }> }>;
}

interface OpenApiSpec {
  info?: { title?: string; version?: string; description?: string };
  tags?: { name: string; description?: string }[];
  paths?: Record<string, Record<string, OperationObj>>;
  components?: { schemas?: Record<string, SchemaObj> };
}

/* ------------------------------------------------------------------ хелперы */

/** Markdown-разметку спеки (`code`, **bold**) показываем как чистый текст. */
const stripMd = (s: string) => s.replace(/\*\*/g, '').replace(/`/g, '');

/** Разыменовать $ref вида #/components/schemas/X (в спеке только такие). */
function deref(spec: OpenApiSpec, schema?: SchemaObj): SchemaObj | undefined {
  if (!schema?.$ref) return schema;
  const name = schema.$ref.split('/').pop() ?? '';
  return spec.components?.schemas?.[name] ?? schema;
}

/** Имя схемы из $ref — подпись «→ AnalysisResult» у ответа. */
const refName = (schema?: SchemaObj) => schema?.$ref?.split('/').pop() ?? null;

/** Человекочитаемый тип поля: string (1–100), integer (default 20), enum-список. */
function typeLabel(s?: SchemaObj): string {
  if (!s) return '';
  if (s.enum?.length) return s.enum.map(String).join(' | ');
  const base = Array.isArray(s.type) ? s.type.join(' | ') : (s.type ?? '');
  const extras: string[] = [];
  if (s.format) extras.push(s.format);
  if (s.type === 'array' && s.items) extras.push(`of ${typeLabel(s.items) || 'items'}`);
  if (s.minLength !== undefined || s.maxLength !== undefined)
    extras.push(`${s.minLength ?? 0}–${s.maxLength ?? '∞'} chars`);
  if (s.minimum !== undefined || s.maximum !== undefined) extras.push(`${s.minimum ?? '…'}–${s.maximum ?? '…'}`);
  if (s.default !== undefined) extras.push(`default ${String(s.default)}`);
  return extras.length ? `${base} (${extras.join(', ')})` : base;
}

/** Примерные значения строковых полей — по именам из реальных схем /v1. */
const SAMPLE_STRINGS: Record<string, string> = {
  text: 'FULL CONTRACT TEXT…',
  textA: 'VERSION A TEXT…',
  textB: 'VERSION B TEXT…',
  nameA: 'v1.docx',
  nameB: 'v2.docx',
  fileName: 'msa.txt',
  jurisdiction: 'UK law',
  prompt: 'Mutual NDA between Acme and Globex',
  url: 'https://your-app.com/lexab-callback',
  partyA: 'Acme Ltd',
  partyB: 'Globex Inc',
  details: 'Pilot NDA for a 6-month engagement',
  term: '12 months',
};

/** Значение-пример для поля схемы (для JSON-тела в примерах кода). */
function sampleValue(name: string, schema: SchemaObj): unknown {
  if (schema.example !== undefined) return schema.example;
  if (schema.enum?.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'integer' || type === 'number') return schema.minimum ?? 1;
  if (type === 'boolean') return true;
  if (type === 'array') return name === 'events' ? ['analysis.done'] : [sampleValue(name, schema.items ?? {})];
  if (type === 'object') return sampleBody(schema);
  return SAMPLE_STRINGS[name] ?? '…';
}

/** JSON-тело примера: все поля схемы (схемы /v1 маленькие, это наглядно). */
function sampleBody(schema: SchemaObj): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(schema.properties ?? {})) out[name] = sampleValue(name, prop);
  return out;
}

/** Подставить понятный пример вместо {id} в путь. */
function samplePath(path: string): string {
  if (path.includes('/templates/{id}')) return path.replace('{id}', 't1');
  if (path.includes('/webhooks/{id}')) return path.replace('{id}', 'whep_XXXXXXXX');
  return path.replace('{id}', 'apireq_XXXXXXXX');
}

/** Сдвинуть все строки, кроме первой (вложенный JSON внутри вызова). */
const indentTail = (text: string, pad: string) => text.split('\n').join(`\n${pad}`);

/** Примеры cURL / Python / JavaScript для операции. */
function buildExamples(
  method: string,
  url: string,
  body: Record<string, unknown> | null,
  hasIdempotency: boolean,
): { curl: string; python: string; js: string } {
  const M = method.toUpperCase();
  const auth = '"Authorization": "Bearer lxb_YOUR_KEY"';
  const idemCurl = hasIdempotency ? '\n# optional: -H "Idempotency-Key: your-unique-id"' : '';

  let curl: string;
  if (body) {
    curl = `curl -X ${M} ${url} \\
  -H "Authorization: Bearer lxb_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(body, null, 2)}'${idemCurl}`;
  } else if (M === 'GET') {
    curl = `curl ${url} \\
  -H "Authorization: Bearer lxb_YOUR_KEY"`;
  } else {
    curl = `curl -X ${M} ${url} \\
  -H "Authorization: Bearer lxb_YOUR_KEY"${idemCurl}`;
  }

  const pyBody = body ? `\n    json=${indentTail(JSON.stringify(body, null, 4), '    ')},` : '';
  const python = `import requests

r = requests.${method.toLowerCase()}(
    "${url}",
    headers={${auth}},${pyBody}
)
print(${M === 'DELETE' ? 'r.status_code' : 'r.status_code, r.json()'})`;

  const jsBody = body
    ? `
  method: "${M}",
  headers: {
    ${auth},
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${indentTail(JSON.stringify(body, null, 2), '  ')}),`
    : M === 'GET'
      ? `
  headers: { ${auth} },`
      : `
  method: "${M}",
  headers: { ${auth} },`;
  const js = `const res = await fetch("${url}", {${jsBody}
});
${M === 'DELETE' ? 'console.log(res.status); // 204 No Content' : 'const data = await res.json();'}`;

  return { curl, python, js };
}

const anchorId = (tag: string) => `apidocs-${tag.toLowerCase()}`;

/* --------------------------------------------------------------- компоненты */

/** Честное копирование: тост об успехе только когда буфер реально записан. */
async function copyText(text: string, onOk: () => void, onFail: () => void): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    onOk();
  } catch {
    onFail();
  }
}

/** Блок кода с кнопкой копирования — тот же паттерн, что в ApiPage. */
function CodeBlock({ code, onCopied, onFailed }: { code: string; onCopied: () => void; onFailed: () => void }) {
  return (
    <div className={styles.apiCodeWrap}>
      <pre className={styles.apiCode}>{code}</pre>
      <button
        type="button"
        className={styles.apiCodeCopy}
        aria-label="Copy"
        onClick={() => void copyText(code, onCopied, onFailed)}
      >
        <Icon name="copy" size={15} />
      </button>
    </div>
  );
}

const EXAMPLE_TABS = [
  { id: 'curl', label: 'cURL' },
  { id: 'python', label: 'Python' },
  { id: 'js', label: 'JavaScript' },
] as const;
type ExampleTab = (typeof EXAMPLE_TABS)[number]['id'];

/** Карточка одного эндпоинта: метод, путь, параметры, тело, ответы, примеры. */
function EndpointCard({ spec, path, method, op, base }: { spec: OpenApiSpec; path: string; method: string; op: OperationObj; base: string }) {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [tab, setTab] = useState<ExampleTab>('curl');

  const params = op.parameters ?? [];
  const jsonSchema = deref(spec, op.requestBody?.content?.['application/json']?.schema);
  const bodyProps = jsonSchema?.properties ?? {};
  const bodyRequired = new Set(jsonSchema?.required ?? []);
  const multipartSchema = deref(spec, op.requestBody?.content?.['multipart/form-data']?.schema);
  const multipartFields = multipartSchema ? Object.keys(multipartSchema.properties ?? {}).join(', ') : null;
  const responses = Object.entries(op.responses ?? {}).sort(([a], [b]) => a.localeCompare(b));

  const examples = useMemo(() => {
    const body = jsonSchema ? sampleBody(jsonSchema) : null;
    const hasIdem = params.some((p) => p.in === 'header' && p.name === 'Idempotency-Key');
    return buildExamples(method, `${base}${samplePath(path)}`, body && Object.keys(body).length > 0 ? body : null, hasIdem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, path, method, base]);

  const onCopied = () => pushToast(t('api.copiedCmd'), 'success');
  const onFailed = () => pushToast(t('api.copyFail'), 'error');

  return (
    <article className={styles.apiDocsCard}>
      <div className={styles.apiDocsCardHead}>
        <span className={styles.apiDocsMethod} data-method={method}>
          {method.toUpperCase()}
        </span>
        <code className={styles.apiDocsPath}>{path}</code>
      </div>
      {op.summary ? <h3 className={styles.apiDocsSummary}>{op.summary}</h3> : null}
      {op.description ? <p className={styles.apiDocText}>{stripMd(op.description)}</p> : null}

      {params.length > 0 ? (
        <>
          <h4 className={styles.apiDocsBlockTitle}>{t('api.docsPage.params')}</h4>
          <table className={styles.apiDocsTable}>
            <tbody>
              {params.map((p) => (
                <tr key={`${p.in}:${p.name}`}>
                  <td>
                    {p.name}
                    <div className={styles.apiDocsParamMeta}>
                      {p.in}
                      {p.required ? <span className={styles.apiDocsRequired}> · {t('api.docsPage.required')}</span> : null}
                    </div>
                  </td>
                  <td>
                    {p.description ? stripMd(p.description) : null}
                    {p.schema ? <div className={styles.apiDocsParamMeta}>{typeLabel(p.schema)}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {Object.keys(bodyProps).length > 0 ? (
        <>
          <h4 className={styles.apiDocsBlockTitle}>{t('api.docsPage.reqBody')}</h4>
          <table className={styles.apiDocsTable}>
            <tbody>
              {Object.entries(bodyProps).map(([name, prop]) => (
                <tr key={name}>
                  <td>
                    {name}
                    {bodyRequired.has(name) ? (
                      <div className={styles.apiDocsRequired}>{t('api.docsPage.required')}</div>
                    ) : null}
                  </td>
                  <td>
                    {prop.description ? stripMd(prop.description) : null}
                    <div className={styles.apiDocsParamMeta}>{typeLabel(prop)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {multipartFields ? (
            <p className={styles.apiDocText}>{t('api.docsPage.multipart', { fields: multipartFields })}</p>
          ) : null}
        </>
      ) : null}

      {responses.length > 0 ? (
        <>
          <h4 className={styles.apiDocsBlockTitle}>{t('api.docsPage.responses')}</h4>
          <div>
            {responses.map(([code, resp]) => {
              const schemaRef = refName(resp.content?.['application/json']?.schema);
              return (
                <div key={code} className={styles.apiDocsResp}>
                  <span className={styles.apiDocsRespCode} data-ok={Number(code) < 400 || undefined}>
                    {code}
                  </span>
                  <span>
                    {resp.description ? stripMd(resp.description) : ''}
                    {schemaRef ? <span className={styles.apiDocsParamMeta}> → {schemaRef}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      <div className={styles.apiDocsTabs} role="tablist">
        {EXAMPLE_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={styles.apiDocsTab}
            data-active={tab === id || undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <CodeBlock code={examples[tab]} onCopied={onCopied} onFailed={onFailed} />
    </article>
  );
}

/* ----------------------------------------------------------------- страница */

export function ApiDocsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  usePageTitle(t('api.docsPage.title'));
  const headReveal = useReveal(0.1);

  // Спека публичная (без ключа) — обычный GET тем же http-клиентом проекта.
  const specState = useAsync<OpenApiSpec>((signal) => http<OpenApiSpec>('/v1/openapi.json', { signal }), []);
  const spec = specState.data;

  const base = `${window.location.origin}${BASE_URL}`;
  const specUrl = `${BASE_URL}/v1/openapi.json`;

  // Эндпоинты по первому тегу, в порядке тегов из спеки (+хвост для новых).
  const tagGroups = useMemo(() => {
    if (!spec?.paths) return [];
    const byTag = new Map<string, { path: string; method: string; op: OperationObj }[]>();
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const tag = op.tags?.[0] ?? 'Other';
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag)!.push({ path, method, op });
      }
    }
    const declared = (spec.tags ?? []).filter((tg) => byTag.has(tg.name));
    const extra = [...byTag.keys()]
      .filter((name) => !declared.some((tg) => tg.name === name))
      .map((name) => ({ name, description: undefined as string | undefined }));
    return [...declared, ...extra].map((tg) => ({ ...tg, ops: byTag.get(tg.name)! }));
  }, [spec]);

  const authExample = `curl ${base}/v1/usage \\
  -H "Authorization: Bearer lxb_YOUR_KEY"
# or the header variant:
curl ${base}/v1/usage -H "X-API-Key: lxb_YOUR_KEY"`;

  return (
    <div className={styles.page}>
      <TopBar title={t('api.docsPage.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.pageHead} ref={headReveal}>
            <h1 className={styles.pageTitle}>{t('api.docsPage.title')}</h1>
            <p className={styles.pageSub}>{t('api.docsPage.sub')}</p>
          </div>

          {specState.loading ? (
            <SkeletonRows rows={4} height={120} />
          ) : specState.error ? (
            <ErrorState message={specState.error} onRetry={specState.reload} />
          ) : spec ? (
            <div className={styles.settingsGrid}>
              {/* Аутентификация + скачивание спеки ------------------------- */}
              <section className={styles.section}>
                <div className={styles.apiDocsTop}>
                  <div>
                    <h2 className={styles.sectionTitle}>{t('api.docsAuth')}</h2>
                    <p className={styles.sectionSub}>{t('api.docsAuthBody')}</p>
                  </div>
                  <div className={styles.apiDocsActions}>
                    <Button size="sm" variant="ghost" icon="back" onClick={() => navigate('/developer')}>
                      {t('api.docsPage.back')}
                    </Button>
                    <a className={styles.apiDocsDownload} href={specUrl} download="openapi.json">
                      <Icon name="download" size={15} />
                      {t('api.docsPage.download')}
                    </a>
                  </div>
                </div>
                {spec.info?.description ? <p className={styles.apiDocText}>{stripMd(spec.info.description)}</p> : null}
                <p className={styles.apiDocText}>
                  <strong>{t('api.docsPage.baseUrl')}:</strong> <code className={styles.mono}>{base}</code>
                  {spec.info?.version ? (
                    <span className={styles.apiDocsMeta}> · {t('api.docsPage.version', { v: spec.info.version })}</span>
                  ) : null}
                </p>
                <CodeBlock
                  code={authExample}
                  onCopied={() => pushToast(t('api.copiedCmd'), 'success')}
                  onFailed={() => pushToast(t('api.copyFail'), 'error')}
                />
                <h3 className={styles.apiSubTitle}>{t('api.docsIdem')}</h3>
                <p className={styles.apiDocText}>{t('api.docsIdemBody')}</p>

                {/* Навигация по тегам ------------------------------------- */}
                <h3 className={styles.apiSubTitle}>{t('api.docsPage.endpoints')}</h3>
                <nav className={styles.apiDocsNav} aria-label={t('api.docsPage.endpoints')}>
                  {tagGroups.map((tg) => (
                    <a key={tg.name} className={styles.apiDocsNavLink} href={`#${anchorId(tg.name)}`}>
                      {tg.name}
                    </a>
                  ))}
                </nav>
              </section>

              {/* Секция на каждый тег -------------------------------------- */}
              {tagGroups.map((tg) => (
                <section key={tg.name} id={anchorId(tg.name)} className={`${styles.section} ${styles.apiDocsTag}`}>
                  <h2 className={styles.sectionTitle}>{tg.name}</h2>
                  {tg.description ? <p className={styles.sectionSub}>{stripMd(tg.description)}</p> : null}
                  {tg.ops.map(({ path, method, op }) => (
                    <EndpointCard key={`${method} ${path}`} spec={spec} path={path} method={method} op={op} base={base} />
                  ))}
                </section>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
