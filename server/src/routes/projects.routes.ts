/**
 * Проекты (дела юристов): папки, внутри которых живут договоры одного дела/
 * клиента. Доступно ВСЕМ тарифам (включая Free) — это базовая организация
 * работы, не платная фича.
 *
 * Модель намеренно простая: проект принадлежит пользователю; документ несёт
 * необязательный project_id. Удаление проекта возвращает документы в общий
 * список (ON DELETE SET NULL) — дело можно закрыть, договоры остаются.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { asObject, requireString } from '../lib/validate.ts';

/** Потолок проектов на аккаунт — защита от бесконтрольного роста (не тариф). */
const MAX_PROJECTS = 200;

interface ProjectRow {
  id: string;
  name: string;
  created_at: Date | string;
  updated_at: Date | string;
  docs_count?: string | number;
}

const toWire = (r: ProjectRow) => ({
  id: r.id,
  name: r.name,
  createdAt: new Date(r.created_at as string).toISOString(),
  updatedAt: new Date(r.updated_at as string).toISOString(),
  docsCount: Number(r.docs_count ?? 0),
});

export function projectRoutes(app: FastifyInstance, db: Db): void {
  // Список проектов со счётчиком живых документов внутри.
  app.get('/projects', { preHandler: [app.authenticate] }, async (req) => {
    const res = await db.query<ProjectRow>(
      `SELECT p.id, p.name, p.created_at, p.updated_at,
              count(d.id) FILTER (WHERE d.deleted_at IS NULL) AS docs_count
       FROM projects p LEFT JOIN documents d ON d.project_id = p.id
       WHERE p.user_id = $1
       GROUP BY p.id ORDER BY p.updated_at DESC`,
      [req.currentUser.id],
    );
    return res.rows.map(toWire);
  });

  app.post('/projects', { preHandler: [app.authenticate], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = asObject(req.body);
    const name = requireString(body, 'name', { min: 1, max: 120 }).trim();
    const id = newId('proj');
    // Счёт + вставка в ОДНОЙ транзакции под блокировкой пользователя (FOR UPDATE):
    // иначе пачка параллельных POST проскочила бы потолок (TOCTOU между count и
    // INSERT). MAX_PROJECTS — не тариф, просто защита от бесконтрольного роста.
    await db.withTx(async (tx) => {
      await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [req.currentUser.id]);
      const count = await tx.query<{ n: string | number }>('SELECT count(*) AS n FROM projects WHERE user_id = $1', [req.currentUser.id]);
      if (Number(count.rows[0]?.n ?? 0) >= MAX_PROJECTS) {
        throw badRequest(`Не больше ${MAX_PROJECTS} проектов — удалите неиспользуемые. / At most ${MAX_PROJECTS} projects.`);
      }
      await tx.query('INSERT INTO projects (id, user_id, name) VALUES ($1, $2, $3)', [id, req.currentUser.id, name]);
    });
    await audit(db, req, { type: 'project.created', target: { type: 'project', id, label: name } });
    reply.code(201);
    return { id, name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), docsCount: 0 };
  });

  app.patch('/projects/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = asObject(req.body);
    const name = requireString(body, 'name', { min: 1, max: 120 }).trim();
    const res = await db.query<ProjectRow>(
      'UPDATE projects SET name = $3, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id, name, created_at, updated_at',
      [id, req.currentUser.id, name],
    );
    if (!res.rows[0]) throw notFound('Проект не найден / Project not found');
    await audit(db, req, { type: 'project.renamed', target: { type: 'project', id, label: name } });
    const docs = await db.query<{ n: string | number }>(
      'SELECT count(*) AS n FROM documents WHERE project_id = $1 AND deleted_at IS NULL',
      [id],
    );
    return { ...toWire(res.rows[0]), docsCount: Number(docs.rows[0]?.n ?? 0) };
  });

  // Удаление проекта: документы НЕ удаляются — FK возвращает их в общий список.
  app.delete('/projects/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await db.query<{ name: string }>(
      'DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING name',
      [id, req.currentUser.id],
    );
    if (!res.rows[0]) throw notFound('Проект не найден / Project not found');
    await audit(db, req, { type: 'project.deleted', target: { type: 'project', id, label: res.rows[0].name } });
    reply.code(204);
  });
}
