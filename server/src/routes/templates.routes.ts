/**
 * GET /templates?category — the global template library.
 * POST /templates/:id/generate — AI-drafted contract from a template + form fields.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { notFound } from '../lib/errors.ts';
import { asObject, optionalString, requireString } from '../lib/validate.ts';
import { generateTemplateDraft } from '../llm.ts';
import type { Template } from '../types.ts';

export function templateRoutes(app: FastifyInstance, db: Db): void {
  app.get('/templates', { preHandler: [app.authenticate] }, async (req): Promise<Template[]> => {
    const { category } = req.query as { category?: string };
    if (category && category !== 'All') {
      const res = await db.query<Template>(
        'SELECT id, name, category, description, jurisdiction, clauses FROM templates WHERE category = $1 ORDER BY name',
        [category],
      );
      return res.rows;
    }
    const res = await db.query<Template>(
      'SELECT id, name, category, description, jurisdiction, clauses FROM templates ORDER BY id',
    );
    return res.rows;
  });

  app.post(
    '/templates/:id/generate',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req): Promise<{ title: string; content: string }> => {
      const { id } = req.params as { id: string };
      const tpl = await db.query<Template>(
        'SELECT id, name, category, description, jurisdiction, clauses FROM templates WHERE id = $1',
        [id],
      );
      const template = tpl.rows[0];
      if (!template) throw notFound('Template not found');

      const body = asObject(req.body);
      const fields = {
        partyA: requireString(body, 'partyA', { min: 1, max: 200 }),
        partyB: requireString(body, 'partyB', { min: 1, max: 200 }),
        jurisdiction: optionalString(body, 'jurisdiction')?.trim() || template.jurisdiction,
        term: optionalString(body, 'term')?.trim() || '',
        details: (optionalString(body, 'details') ?? '').slice(0, 4000),
      };
      const content = await generateTemplateDraft(template.name, template.description, fields);
      return { title: `${template.name} — ${fields.partyA} / ${fields.partyB}`, content };
    },
  );
}
