/**
 * LLM integration (Anthropic Claude).
 *
 * - Contract analysis: one streamed request with a strict JSON schema
 *   (structured outputs), so the response parses directly into the
 *   AnalysisResult wire shape the frontend expects.
 * - Chat: streamed text; each delta is forwarded to the caller (SSE).
 *
 * When ANTHROPIC_API_KEY is unset — or a request fails/refuses — both paths
 * fall back to deterministic generators (see fallback.ts) so the product
 * still works end-to-end.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from './config.ts';
import { HttpError, serviceUnavailable } from './lib/errors.ts';
import {
  fallbackAnalysis,
  fallbackChatReply,
  fallbackCompare,
  fallbackContractDraft,
  fallbackTemplateDraft,
} from './fallback.ts';
import type { RetrievedChunk } from './rag/types.ts';
import type { DocBlock, Finding, Redline, Severity } from './types.ts';

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!config.anthropicApiKey) return null;
  // 5 минут вместо SDK-шных 10: зависший провайдер не должен держать
  // пользовательский запрос (и соединение) дольше самого долгого анализа.
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey, timeout: 300_000 });
  return client;
}

/* ── DeepSeek (OpenAI-compatible) — the cheap Free-plan model ─────────────────
   Models whose id contains "deepseek" route here; everything else stays on
   Anthropic. DEEPSEEK_BASE_URL may point at api.deepseek.com or at a western
   host serving the open weights (recommended for confidentiality). */

let dsClient: OpenAI | null = null;
function getDeepseek(): OpenAI | null {
  if (!config.deepseekApiKey) return null;
  // maxRetries 0: у нас свой ретрай (withModelRetry → Anthropic); дефолтные 2
  // SDK-ретрая по 300с держали бы запрос Free-пользователя до 15 минут.
  if (!dsClient) dsClient = new OpenAI({ apiKey: config.deepseekApiKey, baseURL: config.deepseekBaseUrl, timeout: 300_000, maxRetries: 0 });
  return dsClient;
}

/** Which provider serves this model id. */
export function isDeepSeekModel(model: string): boolean {
  return model.toLowerCase().includes('deepseek');
}

/** At least one generation provider is configured. */
function hasAnyLlm(): boolean {
  return Boolean(config.anthropicApiKey || config.deepseekApiKey);
}

/** Honest 422 when DeepSeek gets a file with no extractable text (a scan). */
const SCAN_NEEDS_TEXT =
  'Из этого файла не удалось извлечь текст (похоже, PDF-скан). Загрузите DOCX/TXT или PDF с текстовым слоем. / ' +
  'No machine-readable text in this file (likely a scanned PDF). Upload a DOCX/TXT or a text-layer PDF.';

/**
 * DeepSeek returns JSON via `json_object` mode (no server-side schema
 * enforcement), so the model may wrap it in fences or prose — cut out the
 * outermost object before parsing. Exported for unit tests.
 */
export function extractJsonObject(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in model response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

interface DeepseekCall {
  op: string;
  model: string;
  maxTokens: number;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** JSON output: json_object mode + the schema embedded in the system prompt. */
  schema?: Record<string, unknown>;
  /** Streaming: fires per text delta (chat). */
  onToken?: (delta: string) => void;
  /** Бросить при усечении по max_tokens (шаблон/драфт: молча обрезанный
   *  договор хуже честной ошибки — withModelRetry переиграет на Anthropic). */
  failOnLength?: boolean;
  /** Отключить «размышления» reasoning-модели (deepseek-v4-pro). На микро-бюджете
   *  (сводка, аннотации) reasoning съедает весь max_tokens → content пустой,
   *  finish_reason=length. Ставим для коротких запросов. */
  thinkingDisabled?: boolean;
}

/** One DeepSeek chat-completions call (streamed or not); returns the full text. */
async function runDeepseek(call: DeepseekCall): Promise<string> {
  const api = getDeepseek();
  if (!api) throw new Error('DEEPSEEK_API_KEY is not set');
  const system = call.schema
    ? `${call.system}\n\nReturn ONLY one valid JSON object that conforms to this JSON Schema — no markdown fences, no commentary before or after:\n${JSON.stringify(call.schema)}`
    : call.system;
  const params = {
    model: call.model,
    max_tokens: Math.min(call.maxTokens, 8000),
    messages: [{ role: 'system' as const, content: system }, ...call.messages],
    ...(call.schema ? { response_format: { type: 'json_object' as const } } : {}),
    // deepseek-v4-pro рассуждает по умолчанию; на коротком max_tokens это
    // выжигает весь бюджет в reasoning (content пустой). Отключаем для микрозапросов.
    ...(call.thinkingDisabled ? ({ thinking: { type: 'disabled' } } as Record<string, unknown>) : {}),
  };

  if (call.onToken) {
    const stream = await api.chat.completions.create({ ...params, stream: true });
    let full = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        full += delta;
        call.onToken(delta);
      }
    }
    if (!full.trim()) throw new Error('empty response');
    console.log(`[llm] ${call.op}: ${call.model} (DeepSeek, streamed ${full.length} chars)`);
    return full;
  }

  const res = await api.chat.completions.create(params);
  const text = res.choices[0]?.message?.content ?? '';
  const u = res.usage as (typeof res.usage & { prompt_cache_hit_tokens?: number }) | undefined;
  console.log(
    `[llm] ${call.op}: ${call.model} (DeepSeek), in ${u?.prompt_tokens ?? '?'} / out ${u?.completion_tokens ?? '?'} tokens` +
      (u?.prompt_cache_hit_tokens ? `, cache hit ${u.prompt_cache_hit_tokens}` : ''),
  );
  if (call.failOnLength && res.choices[0]?.finish_reason === 'length') {
    throw new Error(`output truncated at max_tokens (${call.op})`);
  }
  if (!text.trim()) throw new Error('empty response');
  return text;
}

/**
 * Whether a deterministic offline fallback may stand in for a real model
 * response. A legal product must NEVER fabricate analysis or citations, so the
 * mock is gated behind one EXPLICIT opt-in — `LLM_FALLBACK=dev` — and nothing
 * else. In particular it does NOT depend on NODE_ENV (which the project never
 * sets), so a keyless production deploy fails loud (503) instead of silently
 * fabricating and persisting invented legal content. Local offline dev sets
 * LLM_FALLBACK=dev to get the deterministic mocks.
 */
function llmFallbackAllowed(): boolean {
  return config.llmFallback === 'dev';
}

/** User-facing message when the model is unavailable and we won't fabricate. */
const LLM_UNAVAILABLE =
  'ИИ временно недоступен — попробуйте позже. / The AI is temporarily unavailable — please try again.';

/** Plan → model. Unknown or missing plan falls back to the global default model. */
export function modelForPlan(plan?: string | null): string {
  return (plan && config.planModels[plan]) || config.anthropicModel;
}

/** Haiku 4.5 (and other pre-4.6 models) reject `thinking: adaptive` — omit it there. */
function supportsAdaptiveThinking(model: string): boolean {
  return !/haiku|-4-5/.test(model);
}

interface LlmCall {
  op: string;
  model: string;
  maxTokens: number;
  /** Plain string, or blocks (lets large stable parts carry a cache_control breakpoint). */
  system: string | Anthropic.Beta.BetaTextBlockParam[];
  messages: Anthropic.Beta.BetaMessageParam[];
  /** Structured outputs: force the response to match this JSON schema. */
  schema?: Record<string, unknown>;
  /** Reasoning effort — 'medium' makes chat replies noticeably faster (and cheaper). */
  effort?: 'low' | 'medium' | 'high';
}

/**
 * Start a streamed request with per-model parameters. On Fable 5 a server-side
 * fallback re-runs a safety-refused request on Opus 4.8 within the same call —
 * contract texts occasionally trip its classifiers on benign legal work.
 */
function startStream(api: Anthropic, call: LlmCall) {
  const fable = call.model.includes('fable') || call.model.includes('mythos');
  const adaptive = supportsAdaptiveThinking(call.model);
  const outputConfig = {
    ...(call.schema ? { format: { type: 'json_schema' as const, schema: call.schema } } : {}),
    // effort is a thinking control — only valid on adaptive-thinking models.
    ...(call.effort && adaptive ? { effort: call.effort } : {}),
  };
  return api.beta.messages.stream({
    model: call.model,
    max_tokens: call.maxTokens,
    system: call.system,
    messages: call.messages,
    ...(adaptive ? { thinking: { type: 'adaptive' as const } } : {}),
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
    ...(fable ? { betas: ['server-side-fallback-2026-06-01'], fallbacks: [{ model: 'claude-opus-4-8' }] } : {}),
  });
}

/** All text blocks joined — a rescued (fallback) response can carry several. */
function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Run the request; when a plan-specific model fails (e.g. a document too large
 * for a smaller model's context), try once more on the default model before
 * surfacing the error.
 */
async function withModelRetry<T>(model: string, run: (model: string) => Promise<T>): Promise<T> {
  try {
    return await run(model);
  } catch (err) {
    // A deliberate user-facing error (e.g. scanned PDF on the DeepSeek path)
    // is not a model outage — surface it instead of retrying elsewhere.
    if (err instanceof HttpError) throw err;
    if (model === config.anthropicModel) throw err;
    console.warn(`[llm] ${model} failed (${(err as Error).message}); retrying on ${config.anthropicModel}`);
    return run(config.anthropicModel);
  }
}

function logUsage(op: string, requested: string, message: Anthropic.Beta.BetaMessage): void {
  const rescued = (message.usage.iterations ?? []).some((i) => i.type === 'fallback_message');
  // The API may echo a dated alias of the requested model (same model) — only
  // show the arrow when a genuinely different model served the request.
  const sameModel = message.model.startsWith(requested);
  const served = sameModel ? message.model : `${requested} → served by ${message.model}`;
  const cached = message.usage.cache_read_input_tokens
    ? `, cache read ${message.usage.cache_read_input_tokens}`
    : '';
  console.log(
    `[llm] ${op}: ${served}${rescued ? ' (refusal rescued by fallback)' : ''}, in ${message.usage.input_tokens} / out ${message.usage.output_tokens} tokens${cached}`,
  );
}

/** CLM (Этап 2): contract-management metadata extracted alongside the review.
 *  Every field is null when the contract does not state it — the model must
 *  never guess dates or amounts (a wrong date in a legal calendar is worse
 *  than an empty one). Dates are ISO YYYY-MM-DD strings. */
export interface ContractTerms {
  effectiveDate: string | null;
  expiryDate: string | null;
  autoRenew: boolean | null;
  renewalNoticeDays: number | null;
  contractValue: string | null;
  currency: string | null;
  governingLaw: string | null;
  obligations: { text: string; dueDate: string | null; responsible: string | null }[];
}

/** Everything the model produces; id/status are assigned server-side. */
export interface GeneratedAnalysis {
  summary: string;
  riskScore: number;
  riskLevel: 'Low' | 'Elevated' | 'High';
  clausesReviewed: number;
  findings: Omit<Finding, 'id'>[];
  redlines: Omit<Redline, 'status'>[];
  document: DocBlock[];
  /** The other contracting party's name, if clearly identifiable — powers the
   *  "By counterparty" analytics. Null when not confidently identifiable. */
  counterparty?: string | null;
  /** CLM metadata (dates/renewal/value/obligations); null when none stated. */
  terms?: ContractTerms | null;
}

export interface AnalysisInput {
  fileName: string;
  /** Extracted contract text (txt/docx), if available. */
  text?: string | null;
  /** Raw PDF bytes, sent to Claude as a native document block. */
  pdf?: Buffer | null;
  /** User's default jurisdiction (e.g. "German law") from the country selector. */
  jurisdiction?: string | null;
  /** Subscription plan of the requesting user — selects the Claude model. */
  plan?: string | null;
  /** Verified provisions from the legal corpus (RAG) — findings must cite them via unitId. */
  legalContext?: RetrievedChunk[];
  /** The team's playbook: standard positions the contract is checked against.
   *  A clause breaking one of these becomes a finding with playbookDeviation=true. */
  playbook?: string | null;
}

const SEVERITY = ['High', 'Medium', 'Low'];

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'riskScore', 'riskLevel', 'clausesReviewed', 'findings', 'redlines', 'document'],
  properties: {
    summary: {
      type: 'string',
      description: "2–4 sentence plain-language overview of the contract and its key legal exposure, written in the contract's language.",
    },
    riskScore: {
      type: 'integer',
      description:
        'Overall risk 0–100. Calibrated scale: 0–20 clean/market-standard; 21–40 minor issues only; 41–65 material issues; 66–85 serious exposure; 86–100 critical. The score MUST be consistent with the highest finding severity — do not report a high score with only minor findings.',
    },
    riskLevel: { type: 'string', enum: ['Low', 'Elevated', 'High'] },
    clausesReviewed: { type: 'integer', description: 'Number of clauses examined.' },
    counterparty: {
      type: ['string', 'null'],
      description:
        "The name of the OTHER contracting party (the counterparty to the user/client), e.g. the company or person on the other side, exactly as written in the contract. Null if it cannot be identified with confidence — never guess or invent a name.",
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'citation', 'unitId', 'redlineId'],
        properties: {
          severity: { type: 'string', enum: SEVERITY },
          title: { type: 'string', description: "Short title of the legal issue, in the contract's language." },
          citation: { type: 'string', description: 'Statute or case-law citation in the official format of the governing jurisdiction.' },
          unitId: {
            type: 'string',
            description:
              'ID of the supporting provision from the LEGAL CONTEXT block (unit_id in square brackets), or "" when no listed provision applies. NEVER invent ids.',
          },
          redlineId: {
            type: 'string',
            description:
              'Id of the redline (r1, r2, …) that fixes this issue, or "" when the issue has no redline. Never invent ids.',
          },
          playbookDeviation: {
            type: 'boolean',
            description:
              'True ONLY when this finding flags a clause that deviates from a PLAYBOOK position supplied in the prompt. Omit or false for ordinary statutory-risk findings.',
          },
        },
      },
    },
    redlines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'delText', 'insText', 'severity'],
        properties: {
          id: { type: 'string', description: 'Sequential id: r1, r2, r3, …' },
          delText: { type: 'string', description: 'Exact contract wording to strike.' },
          insText: { type: 'string', description: 'Replacement wording.' },
          severity: { type: 'string', enum: SEVERITY },
        },
      },
    },
    terms: {
      type: 'object',
      additionalProperties: false,
      description:
        'Contract-management metadata. Extract ONLY facts the contract states explicitly — never estimate or invent; use null (or [] for obligations) when absent or unclear.',
      required: ['effectiveDate', 'expiryDate', 'autoRenew', 'renewalNoticeDays', 'contractValue', 'currency', 'governingLaw', 'obligations'],
      properties: {
        effectiveDate: { type: ['string', 'null'], description: 'Start/effective date, ISO YYYY-MM-DD. Null when not stated.' },
        expiryDate: {
          type: ['string', 'null'],
          description:
            'End/expiry date, ISO YYYY-MM-DD. When the contract states an effective date plus a fixed term, compute the end date. Null for perpetual or unstated.',
        },
        autoRenew: { type: ['boolean', 'null'], description: 'True when the contract renews automatically unless a party gives notice; null when silent.' },
        renewalNoticeDays: { type: ['integer', 'null'], description: 'Days before expiry by which a non-renewal notice must be given, when stated.' },
        contractValue: { type: ['string', 'null'], description: 'Total price/value exactly as written (e.g. "1 500 000"). Null when no explicit total amount.' },
        currency: { type: ['string', 'null'], description: 'ISO 4217 code of contractValue (USD, EUR, UZS, GBP, …).' },
        governingLaw: { type: ['string', 'null'], description: 'Governing law as stated, short form (e.g. "England and Wales", "Республика Узбекистан").' },
        obligations: {
          type: 'array',
          description:
            "Up to 10 concrete deliverable obligations (payments, deliveries, notices, reports) with the responsible party, written in the contract's language. Empty array when none are clearly stated.",
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'dueDate', 'responsible'],
            properties: {
              text: { type: 'string', description: 'One obligation in one sentence.' },
              dueDate: { type: ['string', 'null'], description: 'ISO YYYY-MM-DD when a specific calendar deadline is stated or computable; else null.' },
              responsible: { type: ['string', 'null'], description: 'The party owing the obligation, as named in the contract.' },
            },
          },
        },
      },
    },
    document: {
      type: 'array',
      description:
        'Excerpt of the contract as blocks. Paragraph segments interleave plain strings with {redlineId} slots; each redline id must appear in exactly one slot.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type'],
        properties: {
          type: { type: 'string', enum: ['heading', 'paragraph'] },
          text: { type: 'string', description: 'Heading text (headings only).' },
          segments: {
            type: 'array',
            description: 'Paragraph content (paragraphs only).',
            items: {
              anyOf: [
                { type: 'string' },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['redlineId'],
                  properties: { redlineId: { type: 'string' } },
                },
              ],
            },
          },
        },
      },
    },
  },
} as const;

const ANALYSIS_SYSTEM = `You are Lexab, a senior commercial contracts lawyer performing a risk review.
Work from the supplied contract (or, when only a file name is available, infer the likely contract type from it and review a realistic model of such a contract).
WRITE IN THE CONTRACT'S LANGUAGE: the summary, every finding title and every insText must be in the same language as the contract text (Russian contract → Russian output, English contract → English output). When only a file name is available, use the language suggested by the file name and jurisdiction. Citations always use the official citation format of the governing jurisdiction (e.g. «ст. 260 ГК» for UZ/KZ, "s.14 Sale of Goods Act 1979" for UK) regardless of output language.
Identify the clauses with the most material legal exposure under the contract's governing jurisdiction. Cite real statutes and case law.
CITATION CONSISTENCY: the citation text and the unitId MUST refer to the SAME provision — never cite one section (e.g. "s.11") while pointing unitId at a different section's id. If none of the LEGAL CONTEXT provisions is the provision your citation names, set unitId to "" rather than picking a near-miss.
Produce tracked redlines: quote the exact problematic wording as delText, and provide precise replacement wording as insText.
Reproduce ONLY the clauses that contain redlines in the document array: a heading block (numbered, e.g. "5.  Termination") followed by a paragraph block whose segments interleave the surrounding original text with a single {redlineId} slot where the change belongs. Every redline id must appear in exactly one slot and every slot must reference an existing redline.
When a finding is fixed by one of your redlines, set that finding's redlineId to the redline's id (r1, r2, …) so the user can click the finding and jump to the clause; use "" when a finding has no redline. Never invent ids.
Keep it tight: 0–6 findings, 0–5 redlines, and one heading+paragraph pair per redline. If the contract is genuinely clean and market-standard, say so honestly — do NOT invent issues to fill a quota.
PLAYBOOK: if a PLAYBOOK block is supplied, additionally check the contract against each of the client's standard positions. A clause that breaks a position is a finding with playbookDeviation=true (name the position in the title) — this is separate from the tightness limit above and may add findings. Never flag a position the contract already meets.
TERMS: also fill the terms object with contract-management metadata (dates, auto-renewal, value, governing law, key obligations). Extract ONLY what the contract explicitly states — a wrong date in a legal deadline calendar is worse than an empty one. Use null / [] when not stated; dates in ISO YYYY-MM-DD.`;

/** User-prompt text for the analysis request — shared by both providers. */
function buildAnalysisPrompt(input: AnalysisInput, text: string | null): string {
  const jurisdictionNote = input.jurisdiction
    ? `\n\nThe user's default jurisdiction is ${input.jurisdiction}. Review under that law (and cite its statutes/case law) unless the contract explicitly states a different governing law.`
    : '';
  // RAG: verified provisions from the official corpus. Findings that rest on
  // one of them must reference it via unitId — the citation validator then
  // confirms or demotes each finding (rule enforced in code, see Этап 4).
  const contextNote = input.legalContext?.length
    ? `\n\nLEGAL CONTEXT — verified provisions from official sources. When a finding relies on one of them, set its unitId to the id in square brackets. Never invent ids; use "" when none of these provisions applies.\n` +
      input.legalContext
        .map((c) => `[${c.unitId}] ${c.breadcrumb}\n${c.body.slice(0, 900)}`)
        .join('\n---\n')
    : '';
  // The team's standard positions. Any clause that breaks one of these must
  // become a finding with playbookDeviation=true — even if it is otherwise
  // legal — so the reviewer sees where the contract departs from house rules.
  const playbookNote = input.playbook?.trim()
    ? `\n\nPLAYBOOK — the client's standard positions for this contract. For EACH position, check whether the contract complies. If a clause deviates from a position, add a finding for it, set playbookDeviation=true, and name the position in the title. Do NOT flag a position that the contract already satisfies.\n${input.playbook.trim().slice(0, 4000)}`
    : '';
  return (
    (text
      ? `File name: ${input.fileName}\n\nContract text:\n<<<\n${text}\n>>>`
      : `File name: ${input.fileName}\n\nNo machine-readable text could be extracted from this file. Infer the contract type from the file name and produce a realistic, jurisdiction-appropriate risk review of a typical contract of that type.`) +
    jurisdictionNote +
    contextNote +
    playbookNote
  );
}

export async function generateAnalysis(input: AnalysisInput): Promise<GeneratedAnalysis> {
  if (!hasAnyLlm()) {
    if (llmFallbackAllowed()) return fallbackAnalysis(input.fileName, input.jurisdiction);
    throw serviceUnavailable(LLM_UNAVAILABLE);
  }

  try {
    const text = input.text?.slice(0, 150_000) ?? null;
    const prompt = buildAnalysisPrompt(input, text);

    return await withModelRetry(modelForPlan(input.plan), async (model) => {
      // ── DeepSeek path (Free plan): text-only. No visual PDF reading, so a
      // scan without a text layer fails honestly instead of fabricating.
      if (isDeepSeekModel(model)) {
        if (!text?.trim()) throw new HttpError(422, SCAN_NEEDS_TEXT);
        const raw = await runDeepseek({
          op: 'analysis',
          model,
          maxTokens: 8000,
          system: ANALYSIS_SYSTEM,
          schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
          messages: [{ role: 'user', content: prompt }],
        });
        const parsed = extractJsonObject(raw) as GeneratedAnalysis;
        assertAnalysisShape(parsed); // malformed JSON → throw → retry on Anthropic
        return normalizeGenerated(parsed);
      }

      // ── Anthropic path: native PDF blocks (scans read visually).
      const api = getClient();
      if (!api) throw new Error('ANTHROPIC_API_KEY is not set');
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (input.pdf) {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: input.pdf.toString('base64') },
        });
      }
      content.push({ type: 'text', text: prompt });

      const stream = startStream(api, {
        op: 'analysis',
        model,
        maxTokens: 16000,
        system: ANALYSIS_SYSTEM,
        schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
        messages: [{ role: 'user', content }],
      });
      const message = await stream.finalMessage();
      logUsage('analysis', model, message);
      if (message.stop_reason === 'refusal') throw new Error('model refused the request');

      const out = textOf(message);
      if (!out) throw new Error('no text block in response');
      return normalizeGenerated(JSON.parse(out));
    });
  } catch (err) {
    // Deliberate user-facing errors (scanned PDF) surface as-is — even the dev
    // fallback must not paper over them with a fabricated review.
    if (err instanceof HttpError && err.status < 500) throw err;
    if (llmFallbackAllowed()) {
      console.warn(`[llm] analysis generation failed, using dev fallback: ${(err as Error).message}`);
      return fallbackAnalysis(input.fileName, input.jurisdiction);
    }
    console.error(`[llm] analysis generation failed (failing loud, no fabrication): ${(err as Error).message}`);
    throw serviceUnavailable(LLM_UNAVAILABLE);
  }
}

/**
 * Strict shape check for JSON coming from DeepSeek (json_object mode enforces
 * only syntax — the schema lives in the prompt, unlike Anthropic's server-side
 * structured outputs). A malformed object must throw HERE, inside the retry
 * closure, so the cross-provider retry fires — otherwise NaN/undefined would
 * survive normalization and only explode later at the NOT NULL database layer.
 */
function assertAnalysisShape(raw: GeneratedAnalysis): void {
  const bad = (what: string): never => {
    throw new Error(`malformed analysis JSON from model: ${what}`);
  };
  if (typeof raw.summary !== 'string' || !raw.summary.trim()) bad('summary');
  if (!Number.isFinite(raw.riskScore)) bad('riskScore');
  if (!Number.isFinite(raw.clausesReviewed)) bad('clausesReviewed');
  if (!Array.isArray(raw.findings)) bad('findings');
  for (const f of raw.findings) {
    if (typeof f?.title !== 'string' || typeof f?.citation !== 'string') bad('finding item');
  }
  if (!Array.isArray(raw.redlines)) bad('redlines');
  for (const r of raw.redlines) {
    if (typeof r?.delText !== 'string' || typeof r?.insText !== 'string') bad('redline item');
  }
  if (!Array.isArray(raw.document)) bad('document');
}

/** Clamp and cross-check the model output before it becomes an API response. */
function normalizeGenerated(raw: GeneratedAnalysis): GeneratedAnalysis {
  const riskScore = Math.max(0, Math.min(100, Math.round(raw.riskScore)));
  const riskLevel = ['Low', 'Elevated', 'High'].includes(raw.riskLevel)
    ? raw.riskLevel
    : riskScore < 34
      ? 'Low'
      : riskScore < 67
        ? 'Elevated'
        : 'High';

  // Slice and dedupe redlines FIRST, then filter document slots against the
  // kept ids — otherwise slots could reference dropped rows, and duplicate ids
  // from the model would violate the redlines primary key on insert.
  const redlineIds = new Set<string>();
  const redlines: GeneratedAnalysis['redlines'] = [];
  for (const [i, r] of raw.redlines.slice(0, 8).entries()) {
    const id = r.id || `r${i + 1}`;
    if (redlineIds.has(id)) continue; // duplicate id from the model — keep the first
    redlineIds.add(id);
    redlines.push({
      id,
      delText: r.delText,
      insText: r.insText,
      severity: (SEVERITY.includes(r.severity) ? r.severity : 'Medium') as Severity,
    });
  }

  const document: DocBlock[] = raw.document.map((block) => {
    if (block.type === 'heading') return { type: 'heading', text: block.text ?? '' };
    const segments = (block.segments ?? []).filter(
      (seg) => typeof seg === 'string' || !('redlineId' in seg) || redlineIds.has(seg.redlineId),
    );
    return { type: 'paragraph', segments };
  });

  return {
    summary: raw.summary,
    riskScore,
    riskLevel,
    clausesReviewed: Math.max(1, Math.round(raw.clausesReviewed)),
    findings: raw.findings.slice(0, 8).map((f) => {
      // Only keep a redlineId that points at a redline we actually kept — the
      // model (esp. DeepSeek, prompt-only JSON) may emit a bogus or dropped id;
      // an unknown id becomes null so the finding is simply not clickable.
      const rid = f.redlineId?.trim();
      return {
        severity: (SEVERITY.includes(f.severity) ? f.severity : 'Medium') as Severity,
        title: f.title,
        citation: f.citation,
        unitId: f.unitId?.trim() || null,
        redlineId: rid && redlineIds.has(rid) ? rid : null,
        playbookDeviation: Boolean(f.playbookDeviation),
      };
    }),
    redlines,
    document,
    counterparty:
      typeof raw.counterparty === 'string' && raw.counterparty.trim() ? raw.counterparty.trim().slice(0, 200) : null,
    terms: normalizeTerms(raw.terms),
  };
}

/** Sanitize the model's CLM metadata: dates must be real ISO days in a sane
 *  range, numbers bounded, strings trimmed — anything malformed becomes null
 *  rather than a bogus calendar entry. Returns null when nothing was stated. */
function normalizeTerms(raw: unknown): ContractTerms | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const date = (v: unknown): string | null => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    if (v < '1900-01-01' || v > '2200-12-31') return null;
    // Reject impossible days (e.g. 2026-02-30): a Date round-trip must agree.
    const d = new Date(`${v}T00:00:00Z`);
    return d.toISOString().slice(0, 10) === v ? v : null;
  };
  const str = (v: unknown, max: number): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

  const obligations: ContractTerms['obligations'] = [];
  if (Array.isArray(t.obligations)) {
    for (const o of t.obligations.slice(0, 20)) {
      if (!o || typeof o !== 'object') continue;
      const oo = o as Record<string, unknown>;
      const text = str(oo.text, 500);
      if (!text) continue;
      obligations.push({ text, dueDate: date(oo.dueDate), responsible: str(oo.responsible, 200) });
    }
  }

  const noticeRaw =
    typeof t.renewalNoticeDays === 'number' && Number.isFinite(t.renewalNoticeDays) ? Math.round(t.renewalNoticeDays) : null;
  const terms: ContractTerms = {
    effectiveDate: date(t.effectiveDate),
    expiryDate: date(t.expiryDate),
    autoRenew: typeof t.autoRenew === 'boolean' ? t.autoRenew : null,
    renewalNoticeDays: noticeRaw !== null && noticeRaw >= 0 && noticeRaw <= 3650 ? noticeRaw : null,
    contractValue: str(t.contractValue, 100),
    currency: typeof t.currency === 'string' && /^[A-Za-z]{3}$/.test(t.currency.trim()) ? t.currency.trim().toUpperCase() : null,
    governingLaw: str(t.governingLaw, 200),
    obligations,
  };
  const hasAny =
    terms.effectiveDate !== null ||
    terms.expiryDate !== null ||
    terms.autoRenew !== null ||
    terms.renewalNoticeDays !== null ||
    terms.contractValue !== null ||
    terms.governingLaw !== null ||
    obligations.length > 0;
  return hasAny ? terms : null;
}

const CHAT_SYSTEM = `You are Lexab, the branded AI legal assistant of the Lexab contract-intelligence platform.
Persona: answer like a seasoned commercial lawyer — precise, confident, businesslike, warm but never chatty. No filler, no restating the question.
FORMAT: write in clean Markdown and structure for scanability. Lead with the direct answer, then use short "###" headings for distinct sections, **bold** for key terms, amounts and deadlines, bulleted or numbered lists for steps and options, and a compact table when comparing three or more items (clauses, options, jurisdictions). A tasteful emoji may anchor a point (⚠️ a risk, ✅ a safe position, 📌 a key takeaway) — a few per answer at most, never inside drafted contract text or legal citations. A simple question still deserves a brief plain answer: do not scaffold headings around one sentence. Cite the governing statute or case law when you make a legal claim. Answer in the language the user writes in.
GROUNDING: when asked to translate, quote or summarise the contract, use ONLY the text inside the <contract> block — never reconstruct or invent clauses that are not there. If the context says the full contract text is unavailable, state that openly and work only with the excerpts you have.
STRICT SCOPE — legal work only: contracts and documents (analysis, risks, redlines, drafting, comparison, templates, signatures, approvals), legislation, compliance, negotiations, and questions about the Lexab product itself.
If the user asks anything outside that scope (write code, recipes, homework, small talk, general trivia, etc.), do NOT answer it even partially. Reply with ONE short, polite sentence in the user's language saying you only help with legal questions and contract/document analysis, and invite a legal question instead.
You are not the user's solicitor — for high-stakes decisions, recommend review by qualified counsel in one short sentence at most.`;

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Generate an assistant reply. `onToken` fires for each streamed text delta;
 * resolves with the full reply text. `docContext` (optional) grounds the reply
 * in a specific contract — used for document Q&A.
 */
export async function generateChatReply(
  history: ChatTurn[],
  userText: string,
  onToken?: (delta: string) => void,
  docContext?: string,
  jurisdiction?: string,
  plan?: string | null,
  historySummary?: string | null,
  legalContext?: string | null,
): Promise<string> {
  if (!hasAnyLlm()) {
    if (!llmFallbackAllowed()) throw serviceUnavailable(LLM_UNAVAILABLE);
    const reply = fallbackChatReply(userText, Boolean(docContext));
    onToken?.(reply);
    return reply;
  }

  try {
    const rawTurns: { role: 'user' | 'assistant'; content: string }[] = [
      ...history.slice(-12).map((t) => ({ role: t.role, content: t.text })),
      { role: 'user' as const, content: userText },
    ];
    // Anthropic requires the first message to have role 'user'. The rolling-summary
    // window can start on an assistant turn (splitHistory trims by characters, one
    // turn at a time), which made the request 400 → the chat failed with a 503 for
    // paid plans (Anthropic). Drop any leading assistant turns — their context is
    // preserved in historySummary — so the window always starts with a user turn.
    let firstUser = 0;
    while (firstUser < rawTurns.length && rawTurns[firstUser].role !== 'user') firstUser++;
    const turns = rawTurns.slice(firstUser);
    let base = CHAT_SYSTEM;
    if (jurisdiction) {
      base += `\n\nThe user's default jurisdiction is ${jurisdiction}. Answer under that law unless the user or their document indicates otherwise.`;
    }
    // System blocks, most stable first: the big contract context carries a
    // cache breakpoint (reused turn after turn — cached reads are ~90% cheaper
    // and faster), while the rolling summary changes and stays after it.
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: base }];
    if (docContext) {
      system.push({
        type: 'text',
        text: `The user is working on the following contract. Ground every answer in it and quote the relevant clause when you make a claim about it.\n<contract>\n${docContext.slice(0, 100_000)}\n</contract>`,
        cache_control: { type: 'ephemeral' },
      });
    }
    if (historySummary) {
      system.push({
        type: 'text',
        text: `Summary of the earlier part of this conversation (rely on it as established context):\n${historySummary}`,
      });
    }
    // Statute grounding (RAG): provisions retrieved for THIS question — they
    // change every turn, so the block stays last, after the cache breakpoint.
    if (legalContext) {
      system.push({
        type: 'text',
        text: `Relevant provisions from Lexab's verified statute database (official sources; each starts with its [unit id]):\n<legal_context>\n${legalContext}\n</legal_context>\nWhen you cite legislation of this jurisdiction, cite ONLY provisions present in this legal context, with the exact article/section numbers shown. If none of them covers the question, say the database has no matching provision, then answer from general principles and note the citation is not verified. Never invent article numbers.`,
      });
    }
    // Retry on the default model only while nothing has streamed to the client
    // yet — a mid-stream retry would duplicate the visible reply.
    let streamed = false;
    const runChat = async (model: string): Promise<string> => {
      // ── DeepSeek path: same system content flattened to one string (its API
      // has no cache-control blocks — DeepSeek caches context automatically).
      if (isDeepSeekModel(model)) {
        return runDeepseek({
          op: 'chat',
          model,
          maxTokens: 4096,
          system: system.map((b) => b.text).join('\n\n'),
          messages: turns,
          onToken: onToken
            ? (delta) => {
                streamed = true;
                onToken(delta);
              }
            : undefined,
        });
      }

      const api = getClient();
      if (!api) throw new Error('ANTHROPIC_API_KEY is not set');
      // effort 'medium': visibly faster replies at no extra cost — chat answers
      // are short and grounded, they don't need deep deliberation.
      const stream = startStream(api, { op: 'chat', model, maxTokens: 4096, system, messages: turns, effort: 'medium' });
      if (onToken) {
        stream.on('text', (delta) => {
          streamed = true;
          onToken(delta);
        });
      }
      const message = await stream.finalMessage();
      logUsage('chat', model, message);
      if (message.stop_reason === 'refusal') throw new Error('model refused the request');
      return textOf(message);
    };
    const primary = modelForPlan(plan);
    try {
      return await runChat(primary);
    } catch (err) {
      if (primary === config.anthropicModel || streamed) throw err;
      console.warn(`[llm] ${primary} failed (${(err as Error).message}); retrying on ${config.anthropicModel}`);
      return await runChat(config.anthropicModel);
    }
  } catch (err) {
    if (!llmFallbackAllowed()) {
      console.error(`[llm] chat generation failed (failing loud, no fabrication): ${(err as Error).message}`);
      throw serviceUnavailable(LLM_UNAVAILABLE);
    }
    console.warn(`[llm] chat generation failed, using dev fallback: ${(err as Error).message}`);
    const reply = fallbackChatReply(userText, Boolean(docContext));
    onToken?.(reply);
    return reply;
  }
}

const SUMMARY_SYSTEM =
  'You maintain a running summary of a legal-assistant chat. Merge the previous summary with the new turns into ONE updated summary of at most 120 words, in the language of the conversation. Keep only what matters for future turns: document names, key facts and figures, legal positions taken, decisions made, open questions, user preferences. Output the summary only — no preamble.';

/**
 * Rolling summary of older chat turns (context-window management): the last
 * ~10 messages reach the model verbatim, everything older is folded into one
 * short summary. Costs a fraction of a cent: Free-plan chats summarize on the
 * Free model (DeepSeek when configured), while PAID plans stay pinned to
 * Anthropic Haiku — a paying customer's conversation must never flow to a
 * second provider just because the operator enabled DeepSeek for Free.
 * Non-fatal: on any failure the previous summary is kept.
 */
export async function generateHistorySummary(
  prevSummary: string | null,
  dropped: ChatTurn[],
  plan?: string | null,
): Promise<string | null> {
  if (!hasAnyLlm() || dropped.length === 0) return prevSummary;
  const model = plan === 'Free' ? (config.planModels.Free ?? 'claude-haiku-4-5') : 'claude-haiku-4-5';
  try {
    const convo = dropped
      .map((t) => `${t.role === 'user' ? 'User' : 'Lexab'}: ${t.text}`)
      .join('\n')
      .slice(0, 30_000);
    const userContent = `${prevSummary ? `Previous summary:\n${prevSummary}\n\n` : ''}New turns to fold in:\n${convo}`;

    let text: string;
    if (isDeepSeekModel(model)) {
      text = (
        await runDeepseek({
          op: 'history-summary',
          model,
          maxTokens: 500,
          system: SUMMARY_SYSTEM,
          messages: [{ role: 'user', content: userContent }],
          // Микрозапрос (≤500 токенов): без этого reasoning deepseek-v4-pro съедает
          // весь бюджет и сводка приходит пустой → контекст диалога теряется навсегда.
          thinkingDisabled: true,
        })
      ).trim();
    } else {
      const api = getClient();
      if (!api) return prevSummary; // summary model unavailable — non-fatal
      const stream = api.beta.messages.stream({
        model,
        max_tokens: 500,
        system: SUMMARY_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
      });
      const message = await stream.finalMessage();
      logUsage('history-summary', model, message);
      text = textOf(message).trim();
    }
    return text || prevSummary;
  } catch (err) {
    console.warn(`[llm] history summary failed (keeping previous): ${(err as Error).message}`);
    return prevSummary;
  }
}

/* ── Prompt improver («улучшить промпт» в композере) ───────────────────────── */

const IMPROVE_PROMPT_SYSTEM = `You rewrite a user's draft message into a clear, well-structured prompt for an AI legal assistant.
Rules:
- Preserve the user's intent, facts, names, figures and jurisdiction exactly; invent nothing the draft does not state or clearly imply.
- Make the request specific: state the task, the relevant context, and the expected output (e.g. "list the risks", "draft the clause", "explain in plain terms").
- Write in the SAME language as the draft.
- Do NOT answer the question. Do NOT add greetings, preamble, commentary or surrounding quotes.
- Output ONLY the rewritten prompt text. If the draft is already clear, return it with only light polish.`;

/**
 * Rewrite a draft into a clear prompt. Deliberately the cheapest possible
 * call: DeepSeek when configured (thinking off — a micro-request), otherwise
 * Anthropic Haiku. Does NOT charge the monthly AI quota (see route comment).
 */
export async function improvePrompt(draft: string): Promise<string> {
  if (!hasAnyLlm()) {
    if (!llmFallbackAllowed()) throw serviceUnavailable(LLM_UNAVAILABLE);
    return `[dev] ${draft.trim()}`; // deterministic offline stub (LLM_FALLBACK=dev)
  }
  const primary = config.deepseekApiKey ? config.deepseekModel : config.anthropicModel;
  const text = await withModelRetry(primary, async (model) => {
    if (isDeepSeekModel(model)) {
      return runDeepseek({
        op: 'improve-prompt',
        model,
        maxTokens: 1000,
        system: IMPROVE_PROMPT_SYSTEM,
        messages: [{ role: 'user', content: draft }],
        // Микрозапрос: без этого reasoning deepseek-v4-pro съедает весь бюджет
        // и ответ приходит пустым (та же ловушка, что у history-summary).
        thinkingDisabled: true,
      });
    }
    // Anthropic path pins Haiku: a prompt rewrite must not run on the
    // user's plan-tier model — it would cost more than the reply itself.
    const api = getClient();
    if (!api) throw serviceUnavailable(LLM_UNAVAILABLE);
    const stream = api.beta.messages.stream({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      system: IMPROVE_PROMPT_SYSTEM,
      messages: [{ role: 'user', content: draft }],
    });
    const message = await stream.finalMessage();
    logUsage('improve-prompt', 'claude-haiku-4-5', message);
    return textOf(message);
  });
  return text.trim() || draft;
}

/* ── Version comparison ─────────────────────────────────────────────────────── */

export interface CompareChange {
  heading: string;
  kind: 'added' | 'removed' | 'modified';
  before: string;
  after: string;
  severity: Severity;
  comment: string;
}

export interface CompareResult {
  summary: string;
  changes: CompareChange[];
}

const COMPARE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'changes'],
  properties: {
    summary: { type: 'string', description: '2–3 sentences: what changed between the versions and how the risk shifted.' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'kind', 'before', 'after', 'severity', 'comment'],
        properties: {
          heading: { type: 'string', description: 'Clause heading, e.g. "5. Termination".' },
          kind: { type: 'string', enum: ['added', 'removed', 'modified'] },
          before: { type: 'string', description: 'Clause text in version A ("" when added).' },
          after: { type: 'string', description: 'Clause text in version B ("" when removed).' },
          severity: { type: 'string', enum: SEVERITY },
          comment: { type: 'string', description: 'One-sentence legal assessment of the change, in the language the texts are written in.' },
        },
      },
    },
  },
} as const;

const COMPARE_SYSTEM =
  'You are Lexab, a senior contracts lawyer comparing two versions of the same contract. Identify every clause that was added, removed, or materially modified. Quote the clause text (trim to the relevant part, ≤ 60 words each side). Assess how each change shifts legal risk. Report 3–10 changes, most material first.';

export async function generateCompare(
  textA: string,
  textB: string,
  nameA: string,
  nameB: string,
  plan?: string | null,
): Promise<CompareResult> {
  if (!hasAnyLlm()) {
    if (llmFallbackAllowed()) return fallbackCompare();
    throw serviceUnavailable(LLM_UNAVAILABLE);
  }
  try {
    const userContent = `Version A (${nameA}):\n<<<\n${textA.slice(0, 60_000)}\n>>>\n\nVersion B (${nameB}):\n<<<\n${textB.slice(0, 60_000)}\n>>>`;

    return await withModelRetry(modelForPlan(plan), async (model) => {
      if (isDeepSeekModel(model)) {
        const raw = await runDeepseek({
          op: 'compare',
          model,
          maxTokens: 8000,
          system: COMPARE_SYSTEM,
          schema: COMPARE_SCHEMA as unknown as Record<string, unknown>,
          messages: [{ role: 'user', content: userContent }],
        });
        const parsed = extractJsonObject(raw) as CompareResult;
        if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.changes)) {
          throw new Error('malformed compare JSON');
        }
        // Per-item shape check: the frontend diffs before/after with .split(),
        // so an undefined field would crash the results render.
        for (const c of parsed.changes) {
          if (
            typeof c?.heading !== 'string' ||
            typeof c?.before !== 'string' ||
            typeof c?.after !== 'string' ||
            typeof c?.comment !== 'string' ||
            !['added', 'removed', 'modified'].includes(c?.kind) ||
            !SEVERITY.includes(c?.severity)
          ) {
            throw new Error('malformed compare change item');
          }
        }
        return { summary: parsed.summary, changes: parsed.changes.slice(0, 12) };
      }

      const api = getClient();
      if (!api) throw new Error('ANTHROPIC_API_KEY is not set');
      const stream = startStream(api, {
        op: 'compare',
        model,
        maxTokens: 16000,
        system: COMPARE_SYSTEM,
        schema: COMPARE_SCHEMA as unknown as Record<string, unknown>,
        messages: [{ role: 'user', content: userContent }],
      });
      const message = await stream.finalMessage();
      logUsage('compare', model, message);
      if (message.stop_reason === 'refusal') throw new Error('model refused the request');
      const text = textOf(message);
      if (!text) throw new Error('no text block in response');
      const parsed = JSON.parse(text) as CompareResult;
      return { summary: parsed.summary, changes: parsed.changes.slice(0, 12) };
    });
  } catch (err) {
    if (llmFallbackAllowed()) {
      console.warn(`[llm] compare failed, using dev fallback: ${(err as Error).message}`);
      return fallbackCompare();
    }
    console.error(`[llm] compare failed (failing loud, no fabrication): ${(err as Error).message}`);
    throw serviceUnavailable(LLM_UNAVAILABLE);
  }
}

/* ── Contract generation from a template ────────────────────────────────────── */

export interface TemplateFields {
  partyA: string;
  partyB: string;
  jurisdiction: string;
  term: string;
  details: string;
}

const TEMPLATE_SYSTEM = `You are Lexab, a senior commercial contracts lawyer. Draft a COMPLETE, ready-to-review contract of the given template type — the professional register a qualified lawyer would sign off, not a layman's summary.
Structure: title; parties block with placeholders like [ПОЛНОЕ НАИМЕНОВАНИЕ / FULL LEGAL NAME] for requisites you were not given (NEVER invent registration numbers, addresses or bank details); numbered clauses with headings covering at least: definitions (Defined Terms, capitalised and used consistently), subject matter, term, obligations of each party, price and payment, confidentiality, liability (with a sensible cap), termination, force majeure, dispute resolution, governing law, notices, entire agreement; signature blocks.
Consistency: cross-references must point only to sections that exist; numbering continuous; a term defined once and used with the same meaning throughout — no clause may contradict another.
Legal accuracy: use the drafting terminology of the governing jurisdiction. Do NOT cite specific statute article numbers unless you are certain they exist — prefer wording like «в соответствии с действующим законодательством» over an invented citation.
Write in the language of the user-provided details (default: English). Output plain text only — no markdown syntax.`;

export async function generateTemplateDraft(
  templateName: string,
  templateDescription: string,
  fields: TemplateFields,
  plan?: string | null,
): Promise<string> {
  if (!hasAnyLlm()) {
    if (llmFallbackAllowed()) return fallbackTemplateDraft(templateName, fields);
    throw serviceUnavailable(LLM_UNAVAILABLE);
  }
  try {
    const userContent = `Template: ${templateName} — ${templateDescription}
Party A: ${fields.partyA}
Party B: ${fields.partyB}
Governing jurisdiction: ${fields.jurisdiction}
Term / duration: ${fields.term}
Contract brief from the user (what the deal is about + key terms — reflect ALL of it in the clauses): ${fields.details || '—'}`;

    return await withModelRetry(modelForPlan(plan), async (model) => {
      if (isDeepSeekModel(model)) {
        const raw = await runDeepseek({
          op: 'template',
          model,
          maxTokens: 8000,
          system: TEMPLATE_SYSTEM,
          messages: [{ role: 'user', content: userContent }],
          failOnLength: true, // обрезанный посреди клаузы договор → ретрай на Anthropic
        });
        return raw.trim();
      }

      const api = getClient();
      if (!api) throw new Error('ANTHROPIC_API_KEY is not set');
      const stream = startStream(api, {
        op: 'template',
        model,
        maxTokens: 16000,
        system: TEMPLATE_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
      });
      const message = await stream.finalMessage();
      logUsage('template', model, message);
      if (message.stop_reason === 'refusal') throw new Error('model refused the request');
      if (message.stop_reason === 'max_tokens') throw new Error('output truncated at max_tokens (template)');
      return textOf(message).trim();
    });
  } catch (err) {
    if (llmFallbackAllowed()) {
      console.warn(`[llm] template generation failed, using dev fallback: ${(err as Error).message}`);
      return fallbackTemplateDraft(templateName, fields);
    }
    console.error(`[llm] template generation failed (failing loud, no fabrication): ${(err as Error).message}`);
    throw serviceUnavailable(LLM_UNAVAILABLE);
  }
}

// ── Contract drafting from a free-text prompt (chat → editable sheet) ─────────
export interface ContractDraft {
  title: string;
  summary: string;
  document: DocBlock[];
}

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'document'],
  properties: {
    title: { type: 'string', description: 'Short document title, e.g. "Service Agreement".' },
    summary: { type: 'string', description: '1–2 sentence plain-language description of the drafted contract.' },
    document: {
      type: 'array',
      description: 'The full contract as ordered blocks: numbered clause headings each followed by its paragraph(s).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type'],
        properties: {
          type: { type: 'string', enum: ['heading', 'paragraph'] },
          text: { type: 'string', description: 'Heading text (headings only), e.g. "5.  Termination".' },
          segments: {
            type: 'array',
            description: 'Paragraph text as one or more plain strings (paragraphs only).',
            items: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

const DRAFT_SYSTEM = `You are Lexab, a senior commercial contracts lawyer. Draft a COMPLETE, ready-to-review contract from the user's request.
Structure it as ordered blocks: numbered clause headings ("1.  Parties", "2.  Term", …), each followed by one or more paragraph blocks.
Include the operative and boilerplate clauses appropriate to the contract type and jurisdiction (parties, term, obligations, payment, confidentiality, liability, termination, governing law, notices, entire agreement, signatures).
Write in the same language as the user's request (default: English). Leave party-specific gaps as [ ... ] placeholders.
Do NOT fabricate statutory citations or quote specific legislation section numbers — a governing-law clause names the jurisdiction only. This is a contract to be edited by the user, not legal advice.`;

/** Clamp model output to a well-formed ContractDraft (never trust raw JSON). */
function normalizeDraft(raw: unknown): ContractDraft {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawBlocks = Array.isArray(obj.document) ? obj.document : [];
  const document: DocBlock[] = [];
  for (const b of rawBlocks) {
    const block = (b ?? {}) as Record<string, unknown>;
    if (block.type === 'heading') {
      const text = typeof block.text === 'string' ? block.text : '';
      if (text.trim()) document.push({ type: 'heading', text });
    } else if (block.type === 'paragraph') {
      const segs = Array.isArray(block.segments)
        ? block.segments.filter((s): s is string => typeof s === 'string')
        : typeof block.text === 'string'
          ? [block.text]
          : [];
      if (segs.join('').trim()) document.push({ type: 'paragraph', segments: segs });
    }
  }
  const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : 'Draft contract';
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  return { title: title.slice(0, 200), summary: summary.slice(0, 2000), document };
}

export async function generateContractDraft(
  prompt: string,
  jurisdiction?: string | null,
  plan?: string | null,
): Promise<ContractDraft> {
  if (!hasAnyLlm()) {
    if (llmFallbackAllowed()) return fallbackContractDraft(prompt, jurisdiction);
    throw serviceUnavailable(LLM_UNAVAILABLE);
  }
  try {
    const userContent = `${jurisdiction ? `Governing jurisdiction: ${jurisdiction}\n\n` : ''}Draft this contract:\n${prompt}`;

    return await withModelRetry(modelForPlan(plan), async (model) => {
      if (isDeepSeekModel(model)) {
        const raw = await runDeepseek({
          op: 'draft',
          model,
          maxTokens: 8000,
          system: DRAFT_SYSTEM,
          schema: DRAFT_SCHEMA as unknown as Record<string, unknown>,
          messages: [{ role: 'user', content: userContent }],
          failOnLength: true, // обрезанный JSON-драфт → ретрай на Anthropic
        });
        const draft = normalizeDraft(extractJsonObject(raw));
        if (!draft.document.length) throw new Error('draft had no usable blocks');
        return draft;
      }

      const api = getClient();
      if (!api) throw new Error('ANTHROPIC_API_KEY is not set');
      const stream = startStream(api, {
        op: 'draft',
        model,
        maxTokens: 16000,
        system: DRAFT_SYSTEM,
        schema: DRAFT_SCHEMA as unknown as Record<string, unknown>,
        messages: [{ role: 'user', content: userContent }],
      });
      const message = await stream.finalMessage();
      logUsage('draft', model, message);
      if (message.stop_reason === 'refusal') throw new Error('model refused the request');
      if (message.stop_reason === 'max_tokens') throw new Error('output truncated at max_tokens (draft)');
      const text = textOf(message);
      if (!text) throw new Error('no text block in response');
      const draft = normalizeDraft(JSON.parse(text));
      if (!draft.document.length) throw new Error('draft had no usable blocks');
      return draft;
    });
  } catch (err) {
    if (llmFallbackAllowed()) {
      console.warn(`[llm] draft generation failed, using dev fallback: ${(err as Error).message}`);
      return fallbackContractDraft(prompt, jurisdiction);
    }
    console.error(`[llm] draft generation failed (failing loud, no fabrication): ${(err as Error).message}`);
    throw serviceUnavailable(LLM_UNAVAILABLE);
  }
}
