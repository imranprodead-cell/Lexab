/**
 * GET /templates?category — the global template library.
 * POST /templates/:id/generate — AI-drafted contract from a template + form fields.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { notFound } from '../lib/errors.ts';
import { decTextStrict, encText } from '../lib/docCrypto.ts';
import { toIso } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { assertFeature, withAiRequest } from '../lib/limits.ts';
import { asObject, optionalString, requireString } from '../lib/validate.ts';
import { generateTemplateDraft } from '../llm.ts';
import type { SavedTemplate, Template } from '../types.ts';

interface SavedRow {
  id: string;
  title: string;
  content: string;
  source_template_id: string | null;
  jurisdiction: string | null;
  created_at: Date | string;
}

function toSaved(row: SavedRow): SavedTemplate {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    ...(row.source_template_id ? { sourceTemplateId: row.source_template_id } : {}),
    ...(row.jurisdiction ? { jurisdiction: row.jurisdiction } : {}),
    createdAt: toIso(row.created_at),
  };
}

export function templateRoutes(app: FastifyInstance, db: Db): void {
  // Ordered by category then name — TEXT `ORDER BY id` scrambles t10 before t2
  // once ids pass single digits.
  const COLS =
    'id, name, name_ru AS "nameRu", category, description, description_ru AS "descriptionRu", jurisdiction, clauses';
  app.get('/templates', { preHandler: [app.authenticate] }, async (req): Promise<Template[]> => {
    const { category } = req.query as { category?: string };
    if (category && category !== 'All') {
      const res = await db.query<Template>(
        `SELECT ${COLS} FROM templates WHERE category = $1 ORDER BY category, name`,
        [category],
      );
      return res.rows;
    }
    const res = await db.query<Template>(`SELECT ${COLS} FROM templates ORDER BY category, name`);
    return res.rows;
  });

  app.post(
    '/templates/:id/generate',
    { preHandler: [app.authenticateReal], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req): Promise<{ title: string; content: string }> => {
      await assertFeature(db, req.currentUser.id, 'templates');
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
        // Краткое описание сделки — обязательно: без него выходит типовая
        // «рыба», а не договор под конкретную сделку пользователя.
        details: requireString(body, 'details', { min: 5, max: 4000 }),
      };
      // Atomic reservation right before the model call; released on failure.
      const content = await withAiRequest(db, req.currentUser.id, (plan) =>
        generateTemplateDraft(template.name, template.description, fields, plan),
      );
      return { title: `${template.name} — ${fields.partyA} / ${fields.partyB}`, content };
    },
  );

  // ── Personal saved-template library (per user) ──────────────────────────────
  app.get('/templates/saved', { preHandler: [app.authenticate] }, async (req): Promise<SavedTemplate[]> => {
    const res = await db.query<SavedRow>(
      `SELECT id, title, content, source_template_id, jurisdiction, created_at
       FROM saved_templates WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.currentUser.id],
    );
    // Drafted contract text is encrypted at rest — decrypt for the wire shape.
    const out: SavedTemplate[] = [];
    for (const row of res.rows) {
      out.push(toSaved({ ...row, content: await decTextStrict(db, req.currentUser.id, row.content) }));
    }
    return out;
  });

  app.post('/templates/saved', { preHandler: [app.authenticateReal] }, async (req, reply): Promise<SavedTemplate> => {
    const body = asObject(req.body);
    const title = requireString(body, 'title', { min: 1, max: 300 });
    const content = requireString(body, 'content', { min: 1, max: 100_000 });
    const sourceTemplateId = optionalString(body, 'sourceTemplateId')?.slice(0, 60) ?? null;
    const jurisdiction = optionalString(body, 'jurisdiction')?.slice(0, 120) ?? null;
    const id = newId('st');
    const res = await db.query<SavedRow>(
      `INSERT INTO saved_templates (id, user_id, title, content, source_template_id, jurisdiction)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, content, source_template_id, jurisdiction, created_at`,
      [id, req.currentUser.id, title, await encText(db, req.currentUser.id, content), sourceTemplateId, jurisdiction],
    );
    reply.code(201);
    // RETURNING carries the ciphertext — answer with the plaintext the user sent.
    return toSaved({ ...res.rows[0], content });
  });

  // Правки из воркспейса шаблонов: обновляем текст сохранённого черновика.
  app.patch('/templates/saved/:id', { preHandler: [app.authenticateReal] }, async (req): Promise<SavedTemplate> => {
    const { id } = req.params as { id: string };
    const body = asObject(req.body);
    const content = requireString(body, 'content', { min: 1, max: 100_000 });
    // Ownership is enforced by the WHERE clause — a foreign id updates nothing.
    const res = await db.query<SavedRow>(
      `UPDATE saved_templates SET content = $1 WHERE id = $2 AND user_id = $3
       RETURNING id, title, content, source_template_id, jurisdiction, created_at`,
      [await encText(db, req.currentUser.id, content), id, req.currentUser.id],
    );
    if (!res.rows[0]) throw notFound('Saved template not found');
    // RETURNING carries the ciphertext — answer with the plaintext the user sent.
    return toSaved({ ...res.rows[0], content });
  });

  app.delete('/templates/saved/:id', { preHandler: [app.authenticateReal] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    // Ownership is enforced by the WHERE clause — a foreign id deletes nothing.
    // RETURNING lets us detect "not found" on both the Postgres and PGlite adapters.
    const res = await db.query<{ id: string }>(
      'DELETE FROM saved_templates WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.currentUser.id],
    );
    if (!res.rows[0]) throw notFound('Saved template not found');
    reply.code(204);
  });
}
