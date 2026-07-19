/**
 * Citation validation (Этап 4, anti-hallucination) — a CODE rule, not a prompt:
 *
 *  1. a finding must reference a legal_units row (unitId) that EXISTS and was
 *     IN FORCE on the analysis date;
 *  2. a cheap Haiku check confirms the cited text actually supports the
 *     finding;
 *  3. anything that fails is demoted to Low severity and flagged
 *     `unverified: true` — it renders as "обратите внимание", never as a
 *     confidently-cited legal conclusion.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from '../config.ts';
import { extractJsonObject, isDeepSeekModel } from '../llm.ts';
import type { Db } from '../db.ts';
import type { Finding } from '../types.ts';
import { resolveCitationText } from './retrieve.ts';

/* Judge model: RAG_VALIDATE_MODEL overrides (ids with "deepseek" route to the
   DeepSeek client). Default stays claude-haiku-4-5 — prod behaviour unchanged. */
const JUDGE_MODEL = process.env.RAG_VALIDATE_MODEL || 'claude-haiku-4-5';

type JudgeApi =
  | { kind: 'anthropic'; api: Anthropic }
  | { kind: 'deepseek'; api: OpenAI };

function makeJudgeApi(): JudgeApi | null {
  if (isDeepSeekModel(JUDGE_MODEL)) {
    if (!config.deepseekApiKey) return null;
    return {
      kind: 'deepseek',
      api: new OpenAI({ apiKey: config.deepseekApiKey, baseURL: config.deepseekBaseUrl, timeout: 60_000, maxRetries: 2 }),
    };
  }
  if (!config.anthropicApiKey) return null;
  return { kind: 'anthropic', api: new Anthropic({ apiKey: config.anthropicApiKey }) };
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supported'],
  properties: {
    supported: {
      type: 'boolean',
      description:
        'true when the provision governs the legal issue the finding is about (it is the correct legal basis to cite); false only when the provision is about something else.',
    },
  },
} as const;

async function unitSupportsFinding(
  judge: JudgeApi,
  unitText: string,
  breadcrumb: string,
  finding: Pick<Finding, 'title' | 'citation'>,
): Promise<boolean> {
  const system =
    'You verify legal citations: is the quoted provision the correct legal basis for the finding? Answer true when the provision governs the legal issue the finding addresses (even if the finding also involves judgement, e.g. a reasonableness assessment). IMPORTANT: this is contract review — a finding typically cites the statute that the reviewed contract clause VIOLATES or deviates from, so the citation is correct when the provision governs that issue, INCLUDING when the contract clause contradicts the provision\'s rule (e.g. a finding about an unlimited-liability clause correctly cites the statute that caps liability). Answer false only when the provision is about a genuinely different legal issue. Apply the same rules regardless of language: the contract, finding and provision may each be in Russian, English, German, Uzbek, Kazakh or Arabic — judge the LEGAL relationship, and treat statutory sub-references (Abs./S./ч./п.) of the cited section as the same provision.';
  const userContent = `Provision (${breadcrumb}):\n${unitText.slice(0, 4000)}\n\nFinding: ${finding.title}\nCited as: ${finding.citation}`;
  try {
    if (judge.kind === 'deepseek') {
      const res = await judge.api.chat.completions.create({
        model: JUDGE_MODEL,
        max_tokens: 100,
        temperature: 0,
        // DeepSeek v4 reasons by default and burns the whole token budget on
        // thinking (empty content, finish_reason=length) — turn it off for
        // this structured micro-verdict.
        ...({ thinking: { type: 'disabled' } } as Record<string, unknown>),
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `${system}\n\nReturn ONLY one valid JSON object that conforms to this JSON Schema — no markdown fences, no commentary:\n${JSON.stringify(VERDICT_SCHEMA)}`,
          },
          { role: 'user', content: userContent },
        ],
      });
      const parsed = extractJsonObject(res.choices[0]?.message?.content ?? '') as { supported?: boolean };
      return Boolean(parsed.supported);
    }
    const msg = await judge.api.beta.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 100,
      temperature: 0, // deterministic verdicts — the same citation must always validate the same way
      system,
      output_config: { format: { type: 'json_schema', schema: VERDICT_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user', content: userContent }],
    });
    const text = msg.content.find((b) => b.type === 'text');
    return text && text.type === 'text' ? Boolean((JSON.parse(text.text) as { supported: boolean }).supported) : false;
  } catch (err) {
    // Validation infrastructure failing must not kill the analysis — but an
    // unvalidated citation stays unverified (fail closed).
    console.warn(`[rag] citation check failed for ${breadcrumb}: ${(err as Error).message}`);
    return false;
  }
}

/** Validate + demote in place; returns findings with unverified flags set. */
export async function validateFindings(
  db: Db,
  findings: Omit<Finding, 'id'>[],
  asOfDate: string = new Date().toISOString().slice(0, 10),
  jurisdiction: string = 'UK',
): Promise<Omit<Finding, 'id'>[]> {
  const api = makeJudgeApi();

  return Promise.all(
    findings.map(async (f) => {
      // Second-pass rescue: a finding without a unitId may still carry a
      // resolvable textual citation ("…Act 1998, s.8", «ст. 260 ГК»).
      const unitId = f.unitId?.trim() || (await resolveCitationText(db, f.citation, jurisdiction, asOfDate));
      const demote = (): Omit<Finding, 'id'> => ({
        ...f,
        unitId,
        unverified: true,
        severity: 'Low',
      });

      if (!unitId) return demote();
      const unit = await db.query<{ text: string; breadcrumb: string }>(
        `SELECT text, breadcrumb FROM legal_units
         WHERE id = $1
           AND (valid_from IS NULL OR valid_from <= $2::date)
           AND (valid_to   IS NULL OR valid_to   >= $2::date)`,
        [unitId, asOfDate],
      );
      const row = unit.rows[0];
      if (!row) return demote(); // unknown or not in force on the analysis date
      if (api && !(await unitSupportsFinding(api, row.text, row.breadcrumb, f))) return demote();
      return { ...f, unitId, unverified: false };
    }),
  );
}
