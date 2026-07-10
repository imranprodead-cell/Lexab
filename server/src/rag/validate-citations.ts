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
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import type { Finding } from '../types.ts';
import { resolveCitationText } from './retrieve.ts';

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
  api: Anthropic,
  unitText: string,
  breadcrumb: string,
  finding: Pick<Finding, 'title' | 'citation'>,
): Promise<boolean> {
  try {
    const msg = await api.beta.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      temperature: 0, // deterministic verdicts — the same citation must always validate the same way
      system:
        'You verify legal citations: is the quoted provision the correct legal basis for the finding? Answer true when the provision governs the legal issue the finding addresses (even if the finding also involves judgement, e.g. a reasonableness assessment). Answer false only when the provision is about a different issue.',
      output_config: { format: { type: 'json_schema', schema: VERDICT_SCHEMA as unknown as Record<string, unknown> } },
      messages: [
        {
          role: 'user',
          content: `Provision (${breadcrumb}):\n${unitText.slice(0, 4000)}\n\nFinding: ${finding.title}\nCited as: ${finding.citation}`,
        },
      ],
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
  const api = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

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
