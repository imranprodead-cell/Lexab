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
import { config } from './config.ts';
import { fallbackAnalysis, fallbackChatReply, fallbackCompare, fallbackTemplateDraft } from './fallback.ts';
import type { RetrievedChunk } from './rag/types.ts';
import type { DocBlock, Finding, Redline, Severity } from './types.ts';

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!config.anthropicApiKey) return null;
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

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

/** Everything the model produces; id/status are assigned server-side. */
export interface GeneratedAnalysis {
  summary: string;
  riskScore: number;
  riskLevel: 'Low' | 'Elevated' | 'High';
  clausesReviewed: number;
  findings: Omit<Finding, 'id'>[];
  redlines: Omit<Redline, 'status'>[];
  document: DocBlock[];
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
}

const SEVERITY = ['High', 'Medium', 'Low'];

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'riskScore', 'riskLevel', 'clausesReviewed', 'findings', 'redlines', 'document'],
  properties: {
    summary: {
      type: 'string',
      description: '2–4 sentence plain-English overview of the contract and its key legal exposure.',
    },
    riskScore: { type: 'integer', description: 'Overall risk 0–100 (higher = riskier).' },
    riskLevel: { type: 'string', enum: ['Low', 'Elevated', 'High'] },
    clausesReviewed: { type: 'integer', description: 'Number of clauses examined.' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'citation', 'unitId'],
        properties: {
          severity: { type: 'string', enum: SEVERITY },
          title: { type: 'string', description: 'Short title of the legal issue.' },
          citation: { type: 'string', description: 'Statute or case-law citation for the governing jurisdiction.' },
          unitId: {
            type: 'string',
            description:
              'ID of the supporting provision from the LEGAL CONTEXT block (unit_id in square brackets), or "" when no listed provision applies. NEVER invent ids.',
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

const ANALYSIS_SYSTEM = `You are LexAI, a senior commercial contracts lawyer performing a risk review.
Work from the supplied contract (or, when only a file name is available, infer the likely contract type from it and review a realistic model of such a contract).
Identify the clauses with the most material legal exposure under the contract's governing jurisdiction. Cite real statutes and case law.
Produce tracked redlines: quote the exact problematic wording as delText, and provide precise replacement wording as insText.
Reproduce ONLY the clauses that contain redlines in the document array: a heading block (numbered, e.g. "5.  Termination") followed by a paragraph block whose segments interleave the surrounding original text with a single {redlineId} slot where the change belongs. Every redline id must appear in exactly one slot and every slot must reference an existing redline.
Keep it tight: 3–6 findings, 2–5 redlines, and one heading+paragraph pair per redline.`;

export async function generateAnalysis(input: AnalysisInput): Promise<GeneratedAnalysis> {
  const api = getClient();
  if (!api) return fallbackAnalysis(input.fileName, input.jurisdiction);

  try {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.pdf) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: input.pdf.toString('base64') },
      });
    }
    const text = input.text?.slice(0, 150_000);
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
    content.push({
      type: 'text',
      text:
        (text
          ? `File name: ${input.fileName}\n\nContract text:\n<<<\n${text}\n>>>`
          : `File name: ${input.fileName}\n\nNo machine-readable text could be extracted from this file. Infer the contract type from the file name and produce a realistic, jurisdiction-appropriate risk review of a typical contract of that type.`) +
        jurisdictionNote +
        contextNote,
    });

    return await withModelRetry(modelForPlan(input.plan), async (model) => {
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

      const text = textOf(message);
      if (!text) throw new Error('no text block in response');
      return normalizeGenerated(JSON.parse(text));
    });
  } catch (err) {
    console.warn(`[llm] analysis generation failed, using fallback: ${(err as Error).message}`);
    return fallbackAnalysis(input.fileName, input.jurisdiction);
  }
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
      (seg) => typeof seg === 'string' || redlineIds.has(seg.redlineId),
    );
    return { type: 'paragraph', segments };
  });

  return {
    summary: raw.summary,
    riskScore,
    riskLevel,
    clausesReviewed: Math.max(1, Math.round(raw.clausesReviewed)),
    findings: raw.findings.slice(0, 8).map((f) => ({
      severity: (SEVERITY.includes(f.severity) ? f.severity : 'Medium') as Severity,
      title: f.title,
      citation: f.citation,
      unitId: f.unitId?.trim() || null,
    })),
    redlines,
    document,
  };
}

const CHAT_SYSTEM = `You are LexAI, the branded AI legal assistant of the LexAI contract-intelligence platform.
Persona: answer like a seasoned commercial lawyer — precise, confident, businesslike, warm but never chatty. No emoji, no filler, no restating the question.
Be BRIEF and to the point: lead with the answer in as few sentences as the question allows; use a short list only when it genuinely helps. Cite the governing statute or case law when you make a legal claim. Answer in the language the user writes in.
STRICT SCOPE — legal work only: contracts and documents (analysis, risks, redlines, drafting, comparison, templates, signatures, approvals), legislation, compliance, negotiations, and questions about the LexAI product itself.
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
  const api = getClient();
  if (!api) {
    const reply = fallbackChatReply(userText, Boolean(docContext));
    onToken?.(reply);
    return reply;
  }

  try {
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...history.slice(-12).map((t) => ({ role: t.role, content: t.text })),
      { role: 'user' as const, content: userText },
    ];
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
        text: `Relevant provisions from LexAI's verified statute database (official sources; each starts with its [unit id]):\n<legal_context>\n${legalContext}\n</legal_context>\nWhen you cite legislation of this jurisdiction, cite ONLY provisions present in this legal context, with the exact article/section numbers shown. If none of them covers the question, say the database has no matching provision, then answer from general principles and note the citation is not verified. Never invent article numbers.`,
      });
    }
    // Retry on the default model only while nothing has streamed to the client
    // yet — a mid-stream retry would duplicate the visible reply.
    let streamed = false;
    const runChat = async (model: string): Promise<string> => {
      // effort 'medium': visibly faster replies at no extra cost — chat answers
      // are short and grounded, they don't need deep deliberation.
      const stream = startStream(api, { op: 'chat', model, maxTokens: 4096, system, messages, effort: 'medium' });
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
    console.warn(`[llm] chat generation failed, using fallback: ${(err as Error).message}`);
    const reply = fallbackChatReply(userText, Boolean(docContext));
    onToken?.(reply);
    return reply;
  }
}

/**
 * Rolling summary of older chat turns (context-window management): the last
 * ~10 messages reach the model verbatim, everything older is folded into one
 * short summary. Always runs on Haiku — fast and costs a fraction of a cent.
 * Non-fatal: on any failure the previous summary is kept.
 */
export async function generateHistorySummary(prevSummary: string | null, dropped: ChatTurn[]): Promise<string | null> {
  const api = getClient();
  if (!api || dropped.length === 0) return prevSummary;
  try {
    const convo = dropped
      .map((t) => `${t.role === 'user' ? 'User' : 'LexAI'}: ${t.text}`)
      .join('\n')
      .slice(0, 30_000);
    const stream = api.beta.messages.stream({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system:
        'You maintain a running summary of a legal-assistant chat. Merge the previous summary with the new turns into ONE updated summary of at most 120 words, in the language of the conversation. Keep only what matters for future turns: document names, key facts and figures, legal positions taken, decisions made, open questions, user preferences. Output the summary only — no preamble.',
      messages: [
        {
          role: 'user',
          content: `${prevSummary ? `Previous summary:\n${prevSummary}\n\n` : ''}New turns to fold in:\n${convo}`,
        },
      ],
    });
    const message = await stream.finalMessage();
    logUsage('history-summary', 'claude-haiku-4-5', message);
    const text = textOf(message).trim();
    return text || prevSummary;
  } catch (err) {
    console.warn(`[llm] history summary failed (keeping previous): ${(err as Error).message}`);
    return prevSummary;
  }
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

export async function generateCompare(
  textA: string,
  textB: string,
  nameA: string,
  nameB: string,
  plan?: string | null,
): Promise<CompareResult> {
  const api = getClient();
  if (!api) return fallbackCompare();
  try {
    return await withModelRetry(modelForPlan(plan), async (model) => {
      const stream = startStream(api, {
        op: 'compare',
        model,
        maxTokens: 16000,
        system:
          'You are LexAI, a senior contracts lawyer comparing two versions of the same contract. Identify every clause that was added, removed, or materially modified. Quote the clause text (trim to the relevant part, ≤ 60 words each side). Assess how each change shifts legal risk. Report 3–10 changes, most material first.',
        schema: COMPARE_SCHEMA as unknown as Record<string, unknown>,
        messages: [
          {
            role: 'user',
            content: `Version A (${nameA}):\n<<<\n${textA.slice(0, 60_000)}\n>>>\n\nVersion B (${nameB}):\n<<<\n${textB.slice(0, 60_000)}\n>>>`,
          },
        ],
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
    console.warn(`[llm] compare failed, using fallback: ${(err as Error).message}`);
    return fallbackCompare();
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

export async function generateTemplateDraft(
  templateName: string,
  templateDescription: string,
  fields: TemplateFields,
  plan?: string | null,
): Promise<string> {
  const api = getClient();
  if (!api) return fallbackTemplateDraft(templateName, fields);
  try {
    return await withModelRetry(modelForPlan(plan), async (model) => {
      const stream = startStream(api, {
        op: 'template',
        model,
        maxTokens: 16000,
        system:
          'You are LexAI, a senior commercial contracts lawyer. Draft a complete, professionally structured contract from the given template type. Use numbered clauses with headings, defined terms, and jurisdiction-appropriate boilerplate (governing law, notices, entire agreement). Write in the language of the user-provided details (default: English). Output plain text only — no markdown syntax.',
        messages: [
          {
            role: 'user',
            content: `Template: ${templateName} — ${templateDescription}
Party A: ${fields.partyA}
Party B: ${fields.partyB}
Governing jurisdiction: ${fields.jurisdiction}
Term / duration: ${fields.term}
Additional requirements: ${fields.details || '—'}`,
          },
        ],
      });
      const message = await stream.finalMessage();
      logUsage('template', model, message);
      if (message.stop_reason === 'refusal') throw new Error('model refused the request');
      return textOf(message).trim();
    });
  } catch (err) {
    console.warn(`[llm] template generation failed, using fallback: ${(err as Error).message}`);
    return fallbackTemplateDraft(templateName, fields);
  }
}
