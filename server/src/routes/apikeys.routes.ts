/**
 * Кабинетные роуты раздела «API» (JWT-сессия, фичегейт apiAccess = Business+):
 * управление ключами + статистика использования публичного API.
 *
 * Секрет ключа возвращается РОВНО один раз — в ответе POST. Дальше в списках
 * живёт только key_prefix («lxb_a1b2c3d4…»). Отзыв мгновенный: authenticateApiKey
 * ищет только строки с revoked_at IS NULL И непросроченным expires_at.
 *
 * КОМАНДНЫЕ КЛЮЧИ (Фаза 3): ключ принадлежит ВЛАДЕЛЬЦУ команды (team_owner_id),
 * вызовы идут под его месячную квоту; создавать/отзывать/ротировать/смотреть
 * могут владелец и активные админы (editor/viewer — 403). created_by хранит,
 * кто из команды создал ключ. Личный аккаунт = сам себе владелец.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { API_SCOPES, generateApiKey, isApiScope, MAX_LIVE_KEYS } from '../lib/apiKeys.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { apiMonthlyUsage, assertFeatureTeamAware, planFor, planHasFeature } from '../lib/limits.ts';
import { activeTeamOwnerFor, teamRoleFor } from '../lib/teamAccess.ts';
import { asObject, requireString } from '../lib/validate.ts';

interface KeyRow {
  id: string;
  label: string;
  key_prefix: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
  scopes: string[] | null;
  expires_at: Date | string | null;
  created_by: string | null;
  created_by_name: string | null;
}

const keyToWire = (r: KeyRow) => ({
  id: r.id,
  label: r.label,
  keyPrefix: `${r.key_prefix}…`,
  createdAt: new Date(r.created_at as string).toISOString(),
  lastUsedAt: r.last_used_at ? new Date(r.last_used_at as string).toISOString() : null,
  scopes: Array.isArray(r.scopes) ? r.scopes : [],
  expiresAt: r.expires_at ? new Date(r.expires_at as string).toISOString() : null,
  expired: r.expires_at ? new Date(r.expires_at as string).getTime() <= Date.now() : false,
  // Имя создателя (для командных ключей). Null у ключей, созданных до Фазы 3.
  createdBy: r.created_by_name ?? null,
});

/** Чей набор ключей открывает кабинет пользователю.
 *  ПРАВИЛО (важно для безопасности): у кого СВОЙ план даёт apiAccess — тот
 *  ВСЕГДА управляет СВОИМИ ключами; членство в чужой команде НЕ отбирает
 *  контроль над собственными секретами (иначе принятие приглашения в чужую
 *  команду запирало бы владельца от его же ключей). Только тот, кто опирается
 *  на Business-МЕСТО команды (личный план без apiAccess), работает с ключами
 *  владельца команды — и лишь будучи активным админом; editor/viewer → 403.
 *  Симметрично assertFeatureTeamAware, который тоже сперва смотрит свой план. */
async function resolveApiKeyTeam(db: Db, uid: string): Promise<string> {
  const ownPlan = await planFor(db, uid);
  if (planHasFeature(ownPlan, 'apiAccess')) return uid; // самодостаточен — свои ключи
  const ownerId = await activeTeamOwnerFor(db, uid);
  if (!ownerId) return uid; // нет команды (сюда не-Business уже отсёк assertFeature)
  const role = await teamRoleFor(db, uid, ownerId);
  if (role !== 'admin') {
    throw new HttpError(
      403,
      `API-ключами управляют владелец команды и админы (ваша роль — «${role ?? 'участник'}»). / Only the team owner or an admin can manage API keys.`,
    );
  }
  return ownerId;
}

/** Разобрать и провалидировать scopes/expiresInDays из тела запроса. */
function parseKeyOptions(body: Record<string, unknown>): { scopes: string[]; expiresInDays: number | null } {
  let scopes: string[] = [];
  if (body.scopes !== undefined && body.scopes !== null) {
    if (!Array.isArray(body.scopes)) throw badRequest('Поле "scopes" должно быть массивом строк-прав. / "scopes" must be an array.');
    const invalid = body.scopes.filter((s) => !isApiScope(s));
    if (invalid.length) throw badRequest(`Неизвестные права: ${invalid.join(', ')}. Допустимо: ${API_SCOPES.join(', ')}`);
    scopes = [...new Set(body.scopes as string[])];
  }
  let expiresInDays: number | null = null;
  if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
    const n = Math.trunc(Number(body.expiresInDays));
    if (!Number.isFinite(n) || n < 1 || n > 3650) throw badRequest('Поле "expiresInDays" — целое 1…3650 или null (бессрочно). / "expiresInDays" must be 1…3650 or null.');
    expiresInDays = n;
  }
  return { scopes, expiresInDays };
}

export function apiKeyRoutes(app: FastifyInstance, db: Db): void {
  // Список живых ключей команды (без секретов). Просроченные показываем с
  // флагом expired — их видно, чтобы отозвать/перевыпустить.
  app.get('/api-keys', { preHandler: [app.authenticate] }, async (req) => {
    await assertFeatureTeamAware(db, req.currentUser.id, 'apiAccess');
    const ownerId = await resolveApiKeyTeam(db, req.currentUser.id);
    const res = await db.query<KeyRow>(
      `SELECT k.id, k.label, k.key_prefix, k.created_at, k.last_used_at, k.scopes, k.expires_at,
              k.created_by, cu.name AS created_by_name
       FROM api_keys k LEFT JOIN users cu ON cu.id = k.created_by
       WHERE k.user_id = $1 AND k.revoked_at IS NULL ORDER BY k.created_at DESC`,
      [ownerId],
    );
    return res.rows.map(keyToWire);
  });

  // Каталог доступных прав — для UI при создании ключа.
  app.get('/api-keys/scopes', { preHandler: [app.authenticate] }, async () => ({ scopes: API_SCOPES }));

  // Создать ключ — секрет в ответе показывается один раз.
  app.post('/api-keys', { preHandler: [app.authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    await assertFeatureTeamAware(db, req.currentUser.id, 'apiAccess');
    const ownerId = await resolveApiKeyTeam(db, req.currentUser.id);
    const body = asObject(req.body);
    const label = requireString(body, 'label', { min: 1, max: 100 });
    const { scopes, expiresInDays } = parseKeyOptions(body);

    const key = generateApiKey();
    // Счёт живых ключей и вставка — в ОДНОЙ транзакции под блокировкой ВЛАДЕЛЬЦА
    // (FOR UPDATE), иначе параллельные создания проскочили бы потолок (TOCTOU
    // между count и INSERT). Потолок MAX_LIVE_KEYS считается по владельцу команды.
    await db.withTx(async (tx) => {
      await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [ownerId]);
      // Живой = не отозван И не просрочен: истёкшие ключи мертвы для аутентификации
      // (findLiveKey их отсекает), поэтому и слот MAX_LIVE_KEYS занимать не должны.
      const live = await tx.query<{ n: string | number }>(
        "SELECT count(*) AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())",
        [ownerId],
      );
      if (Number(live.rows[0]?.n ?? 0) >= MAX_LIVE_KEYS) {
        throw badRequest(`Не больше ${MAX_LIVE_KEYS} активных ключей — отзовите неиспользуемый. / At most ${MAX_LIVE_KEYS} active keys.`);
      }
      await tx.query(
        `INSERT INTO api_keys (id, user_id, label, key_hash, key_prefix, scopes, expires_at, created_by, team_owner_id)
         VALUES ($1, $2, $3, $4, $5, $6,
                 CASE WHEN $7::int IS NULL THEN NULL ELSE now() + ($7::int * interval '1 day') END,
                 $8, $9)`,
        [key.id, ownerId, label, key.hash, key.prefix, scopes, expiresInDays, req.currentUser.id, ownerId],
      );
    });
    // teamOwnerId: событие ложится в тенант ВЛАДЕЛЬЦА (не создавшего админа) —
    // иначе создание/отзыв командного ключа было бы не видно в журнале владельца
    // (единственном, который он может читать), а тихая эмиссия ключей — бесследна.
    await audit(db, req, { type: 'apikey.created', teamOwnerId: ownerId, target: { type: 'api_key', id: key.id, label } });
    reply.code(201);
    return {
      id: key.id,
      label,
      keyPrefix: `${key.prefix}…`,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      scopes,
      expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
      expired: false,
      createdBy: req.currentUser.name,
      /** Полный секрет — ТОЛЬКО здесь; больше не показывается никогда. */
      key: key.raw,
    };
  });

  // Ротация: атомарно отозвать старый ключ и выпустить новый с теми же правами.
  // Секрет нового — в ответе один раз. Счёт живых ключей не меняется (−1 +1).
  app.post('/api-keys/:id/rotate', { preHandler: [app.authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    await assertFeatureTeamAware(db, req.currentUser.id, 'apiAccess');
    const ownerId = await resolveApiKeyTeam(db, req.currentUser.id);
    const { id } = req.params as { id: string };
    const body = asObject(req.body ?? {});
    // Скоупы при ротации НАСЛЕДУЮТСЯ; молча принять и проигнорировать поле —
    // значит позволить клиенту думать, что он сузил права. Честный отказ.
    if (body.scopes !== undefined) {
      throw badRequest('Скоупы при ротации наследуются от старого ключа; чтобы изменить права — создайте новый ключ. / Scopes are inherited on rotation; create a new key to change them.');
    }
    const { expiresInDays } = parseKeyOptions(body); // ротация может задать новый срок

    const key = generateApiKey();
    const created = await db.withTx(async (tx) => {
      await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [ownerId]);
      const old = await tx.query<{ label: string; scopes: string[] | null; expires_at: Date | string | null }>(
        'UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING label, scopes, expires_at',
        [id, ownerId],
      );
      if (!old.rows[0]) throw notFound('Ключ не найден или уже отозван');
      const inheritedScopes = Array.isArray(old.rows[0].scopes) ? old.rows[0].scopes : [];
      const label = old.rows[0].label;
      // Срок НАСЛЕДУЕТСЯ: если тело не задало новый expiresInDays, переносим
      // абсолютный expires_at старого ключа — иначе ротация тайм-боксного ключа
      // молча выдавала бы ВЕЧНЫЙ ключ (обход политики срока). Явный expiresInDays
      // в теле перекрывает (продление). $7 — дни (int|null), $8 — унаследованный
      // timestamp (используется только когда $7 IS NULL).
      const inheritedExpiry = old.rows[0].expires_at ? new Date(old.rows[0].expires_at as string).toISOString() : null;
      const ins = await tx.query<{ expires_at: Date | string | null }>(
        `INSERT INTO api_keys (id, user_id, label, key_hash, key_prefix, scopes, expires_at, created_by, team_owner_id)
         VALUES ($1, $2, $3, $4, $5, $6,
                 CASE WHEN $7::int IS NOT NULL THEN now() + ($7::int * interval '1 day') ELSE $8::timestamptz END,
                 $9, $10)
         RETURNING expires_at`,
        [key.id, ownerId, label, key.hash, key.prefix, inheritedScopes, expiresInDays, inheritedExpiry, req.currentUser.id, ownerId],
      );
      return { label, scopes: inheritedScopes, expiresAt: ins.rows[0]?.expires_at ?? null };
    });
    await audit(db, req, { type: 'apikey.revoked', teamOwnerId: ownerId, target: { type: 'api_key', id, label: created.label } });
    await audit(db, req, { type: 'apikey.created', teamOwnerId: ownerId, target: { type: 'api_key', id: key.id, label: created.label } });
    const rotatedExpiresAt = created.expiresAt ? new Date(created.expiresAt as string).toISOString() : null;
    reply.code(201);
    return {
      id: key.id,
      label: created.label,
      keyPrefix: `${key.prefix}…`,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      scopes: created.scopes,
      expiresAt: rotatedExpiresAt,
      // Унаследованный срок мог быть уже в прошлом (ротация просроченного ключа
      // без нового срока) — честно отражаем это флагом.
      expired: rotatedExpiresAt ? new Date(rotatedExpiresAt).getTime() <= Date.now() : false,
      createdBy: req.currentUser.name,
      key: key.raw,
    };
  });

  // Отозвать ключ (мгновенно перестаёт работать). Владелец/админ отзывает любой
  // ключ команды.
  app.delete('/api-keys/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    await assertFeatureTeamAware(db, req.currentUser.id, 'apiAccess');
    const ownerId = await resolveApiKeyTeam(db, req.currentUser.id);
    const { id } = req.params as { id: string };
    const res = await db.query<{ id: string; label: string }>(
      'UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id, label',
      [id, ownerId],
    );
    if (!res.rows[0]) throw notFound('Ключ не найден или уже отозван');
    await audit(db, req, { type: 'apikey.revoked', teamOwnerId: ownerId, target: { type: 'api_key', id, label: res.rows[0].label } });
    reply.code(204);
  });

  // Статистика для раздела: месяц/остаток, дневная серия 30 дней, последние
  // вызовы, число активных ключей — по КОМАНДЕ (владельцу квоты).
  app.get('/api-keys/usage', { preHandler: [app.authenticate] }, async (req) => {
    await assertFeatureTeamAware(db, req.currentUser.id, 'apiAccess');
    const userId = await resolveApiKeyTeam(db, req.currentUser.id);
    const { used, limit } = await apiMonthlyUsage(db, userId);
    const days = await db.query<{ day: string; count: string | number }>(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*) AS count
       FROM api_requests WHERE user_id = $1 AND created_at > now() - interval '30 days'
       GROUP BY 1 ORDER BY 1`,
      [userId],
    );
    const recent = await db.query<{ id: string; file_name: string; status: string; created_at: Date | string; key_label: string | null }>(
      `SELECT r.id, r.file_name, r.status, r.created_at, k.label AS key_label
       FROM api_requests r LEFT JOIN api_keys k ON k.id = r.key_id
       WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 20`,
      [userId],
    );
    const keys = await db.query<{ n: string | number }>(
      "SELECT count(*) AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())",
      [userId],
    );
    return {
      month: { used, limit, remaining: limit === null ? null : Math.max(limit - used, 0) },
      days: days.rows.map((d) => ({ day: d.day, count: Number(d.count) })),
      recent: recent.rows.map((r) => ({
        id: r.id,
        fileName: r.file_name,
        status: r.status === 'queued' ? 'processing' : r.status,
        keyLabel: r.key_label,
        createdAt: new Date(r.created_at as string).toISOString(),
      })),
      activeKeys: Number(keys.rows[0]?.n ?? 0),
    };
  });
}
