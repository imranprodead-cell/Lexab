/**
 * GET /law/units/:unitId — официальный текст нормы для «раскрыть под ссылкой».
 *
 * Превращает бейдж «Проверено по базе законов» из слова в доказательство:
 * пользователь видит САМ текст статьи, официальный источник и дату снимка.
 * Только чтение из корпуса (тексты попадают туда исключительно из официальных
 * источников — правило №1 CLAUDE.md), никакой генерации.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { notFound } from '../lib/errors.ts';

/**
 * Куда вести «открыть на официальном сайте»: точный адрес статьи
 * (lex.uz/…#4739232, legislation.gov.uk/…/section/12), иначе адрес всего
 * закона. Только https — http-адреса источников переводим на https.
 */
export function officialLink(unitUri: string | null | undefined, sourceUrl: string | null | undefined): string | null {
  for (const u of [unitUri, sourceUrl]) {
    if (!u) continue;
    try {
      const url = new URL(u.replace(/^http:\/\//i, 'https://'));
      if (url.protocol === 'https:') return url.toString();
    } catch {
      /* битый адрес — пробуем следующий */
    }
  }
  return null;
}

export function lawRoutes(app: FastifyInstance, db: Db): void {
  app.get(
    '/law/units/:unitId',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      const { unitId } = req.params as { unitId: string };
      // Та же валидность «на сегодня», что у валидатора цитат: статья,
      // исключённая из закона, не должна показываться как действующая.
      const res = await db.query<{
        text: string | null;
        breadcrumb: string;
        source_url: string | null;
        official_unit_uri: string | null;
        retrieved_at: Date | string | null;
        title: string;
        jurisdiction: string;
      }>(
        `SELECT u.text, u.breadcrumb, u.source_url, u.official_unit_uri, u.retrieved_at, d.title, d.jurisdiction
         FROM legal_units u JOIN legal_documents d ON d.id = u.document_id
         WHERE u.id = $1
           AND (u.valid_from IS NULL OR u.valid_from <= CURRENT_DATE)
           AND (u.valid_to   IS NULL OR u.valid_to   >= CURRENT_DATE)`,
        [unitId.slice(0, 200)],
      );
      const row = res.rows[0];
      if (!row || !row.text) throw notFound('Провизия не найдена / Provision not found');
      return {
        text: row.text,
        breadcrumb: row.breadcrumb,
        actTitle: row.title,
        jurisdiction: row.jurisdiction,
        sourceUrl: row.source_url,
        officialUrl: officialLink(row.official_unit_uri, row.source_url),
        retrievedAt: row.retrieved_at ? new Date(row.retrieved_at as string).toISOString() : null,
      };
    },
  );
}
