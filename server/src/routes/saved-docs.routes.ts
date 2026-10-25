/**
 * Сохранённые документы: то, что ИИ написал в чате и человек сохранил из
 * боковой панели (Vault → Documents). Каталога шаблонов и генерации по
 * шаблону больше нет (решение владельца 2026-10-25) — документ на любую тему
 * ИИ пишет в чате после уточняющих вопросов.
 *
 * Таблица saved_templates и адреса /templates/saved оставлены прежними: в них
 * уже лежат данные пользователей, а переименование ничего не дало бы.
 *
 *   GET    /templates/saved[?limit=N] — свои документы, новые сверху
 *   POST   /templates/saved            — сохранить
 *   PATCH  /templates/saved/:id        — записать правки
 *   DELETE /templates/saved/:id        — удалить
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { notFound } from '../lib/errors.ts';
import { decTextStrict, encText } from '../lib/docCrypto.ts';
import { toIso } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { asObject, optionalString, requireString } from '../lib/validate.ts';
import type { SavedDoc } from '../types.ts';

interface SavedRow {
  id: string;
  title: string;
  content: string;
  source_template_id: string | null;
  jurisdiction: string | null;
  created_at: Date | string;
}

function toSaved(row: SavedRow): SavedDoc {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    ...(row.source_template_id ? { sourceTemplateId: row.source_template_id } : {}),
    ...(row.jurisdiction ? { jurisdiction: row.jurisdiction } : {}),
    createdAt: toIso(row.created_at),
  };
}

export function savedDocRoutes(app: FastifyInstance, db: Db): void {
  app.get('/templates/saved', { preHandler: [app.authenticate] }, async (req): Promise<SavedDoc[]> => {
    // ?limit=N — только последние N (список «Недавние файлы» в новом чате):
    // без него расшифровывалась бы вся библиотека ради пяти строк.
    const rawLimit = Number((req.query as { limit?: string }).limit);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(Math.trunc(rawLimit), 200) : null;
    const res = await db.query<SavedRow>(
      `SELECT id, title, content, source_template_id, jurisdiction, created_at
       FROM saved_templates WHERE user_id = $1 ORDER BY created_at DESC${limit ? ' LIMIT $2' : ''}`,
      limit ? [req.currentUser.id, limit] : [req.currentUser.id],
    );
    // Drafted contract text is encrypted at rest — decrypt for the wire shape.
    const out: SavedDoc[] = [];
    for (const row of res.rows) {
      out.push(toSaved({ ...row, content: await decTextStrict(db, req.currentUser.id, row.content) }));
    }
    return out;
  });

  app.post('/templates/saved', { preHandler: [app.authenticateReal] }, async (req, reply): Promise<SavedDoc> => {
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

  // Правки из боковой панели или рабочего окна: обновляем текст документа.
  app.patch('/templates/saved/:id', { preHandler: [app.authenticateReal] }, async (req): Promise<SavedDoc> => {
    const { id } = req.params as { id: string };
    const body = asObject(req.body);
    const content = requireString(body, 'content', { min: 1, max: 100_000 });
    // Ownership is enforced by the WHERE clause — a foreign id updates nothing.
    const res = await db.query<SavedRow>(
      `UPDATE saved_templates SET content = $1 WHERE id = $2 AND user_id = $3
       RETURNING id, title, content, source_template_id, jurisdiction, created_at`,
      [await encText(db, req.currentUser.id, content), id, req.currentUser.id],
    );
    if (!res.rows[0]) throw notFound('Saved document not found');
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
    if (!res.rows[0]) throw notFound('Saved document not found');
    reply.code(204);
  });
}
