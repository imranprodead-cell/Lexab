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
import type { DocBlock, Finding, Redline, Severity } from './types.ts';

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!config.anthropicApiKey) return null;
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
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
        required: ['severity', 'title', 'citation'],
        properties: {
          severity: { type: 'string', enum: SEVERITY },
          title: { type: 'string', description: 'Short title of the legal issue.' },
          citation: { type: 'string', description: 'Statute or case-law citation for the governing jurisdiction.' },
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
    const content: Anthropic.ContentBlockParam[] = [];
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
    content.push({
      type: 'text',
      text:
        (text
          ? `File name: ${input.fileName}\n\nContract text:\n<<<\n${text}\n>>>`
          : `File name: ${input.fileName}\n\nNo machine-readable text could be extracted from this file. Infer the contract type from the file name and produce a realistic, jurisdiction-appropriate risk review of a typical contract of that type.`) +
        jurisdictionNote,
    });

    const stream = api.messages.stream({
      model: config.anthropicModel,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: ANALYSIS_SYSTEM,
      output_config: { format: { type: 'json_schema', schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user', content }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('model refused the request');

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('no text block in response');
    return normalizeGenerated(JSON.parse(textBlock.text));
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

  const redlineIds = new Set(raw.redlines.map((r) => r.id));
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
    })),
    redlines: raw.redlines.slice(0, 8).map((r, i) => ({
      id: r.id || `r${i + 1}`,
      delText: r.delText,
      insText: r.insText,
      severity: (SEVERITY.includes(r.severity) ? r.severity : 'Medium') as Severity,
    })),
    document,
  };
}

const CHAT_SYSTEM = `You are LexAI, an AI legal assistant for contract work (analysis, drafting, comparison, translation/localisation).
Answer in the language the user writes in. Be concise and practical; cite the governing statutes or case law when you make a legal claim.
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
): Promise<string> {
  const api = getClient();
  if (!api) {
    const reply = fallbackChatReply(userText, Boolean(docContext));
    onToken?.(reply);
    return reply;
  }

  try {
    const messages: Anthropic.MessageParam[] = [
      ...history.slice(-20).map((t) => ({ role: t.role, content: t.text })),
      { role: 'user' as const, content: userText },
    ];
    let system = CHAT_SYSTEM;
    if (jurisdiction) {
      system += `\n\nThe user's default jurisdiction is ${jurisdiction}. Answer under that law unless the user or their document indicates otherwise.`;
    }
    if (docContext) {
      system += `\n\nThe user is working on the following contract. Ground every answer in it and quote the relevant clause when you make a claim about it.\n<contract>\n${docContext.slice(0, 100_000)}\n</contract>`;
    }
    const stream = api.messages.stream({
      model: config.anthropicModel,
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system,
      messages,
    });
    if (onToken) stream.on('text', onToken);
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('model refused the request');
    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  } catch (err) {
    console.warn(`[llm] chat generation failed, using fallback: ${(err as Error).message}`);
    const reply = fallbackChatReply(userText, Boolean(docContext));
    onToken?.(reply);
    return reply;
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

export async function generateCompare(textA: string, textB: string, nameA: string, nameB: string): Promise<CompareResult> {
  const api = getClient();
  if (!api) return fallbackCompare();
  try {
    const stream = api.messages.stream({
      model: config.anthropicModel,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system:
        'You are LexAI, a senior contracts lawyer comparing two versions of the same contract. Identify every clause that was added, removed, or materially modified. Quote the clause text (trim to the relevant part, ≤ 60 words each side). Assess how each change shifts legal risk. Report 3–10 changes, most material first.',
      output_config: { format: { type: 'json_schema', schema: COMPARE_SCHEMA as unknown as Record<string, unknown> } },
      messages: [
        {
          role: 'user',
          content: `Version A (${nameA}):\n<<<\n${textA.slice(0, 60_000)}\n>>>\n\nVersion B (${nameB}):\n<<<\n${textB.slice(0, 60_000)}\n>>>`,
        },
      ],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('model refused the request');
    const block = message.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('no text block in response');
    const parsed = JSON.parse(block.text) as CompareResult;
    return { summary: parsed.summary, changes: parsed.changes.slice(0, 12) };
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
): Promise<string> {
  const api = getClient();
  if (!api) return fallbackTemplateDraft(templateName, fields);
  try {
    const stream = api.messages.stream({
      model: config.anthropicModel,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
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
    if (message.stop_reason === 'refusal') throw new Error('model refused the request');
    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  } catch (err) {
    console.warn(`[llm] template generation failed, using fallback: ${(err as Error).message}`);
    return fallbackTemplateDraft(templateName, fields);
  }
}
