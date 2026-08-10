/**
 * Гейт админ-панели.
 *
 * ПРОВЕРКА ЖИВЁТ ЗДЕСЬ, НА СЕРВЕРЕ, И БОЛЬШЕ НИГДЕ. Скрыть страницу из меню —
 * не защита: адрес /admin можно набрать руками, а запрос к /api/admin/* послать
 * из консоли браузера. Единственное, что реально закрывает панель, — эта
 * функция перед каждым админским обработчиком.
 *
 * Кто админ — берётся из ADMIN_EMAILS (окружение), а не из базы: см. комментарий
 * в config.ts. Пустой список = панели нет ни у кого.
 */
import type { FastifyRequest } from 'fastify';
import { config } from '../config.ts';
import { HttpError } from './errors.ts';

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return config.adminEmails.includes(email.trim().toLowerCase());
}

/**
 * 404 (а не 403) для не-админа: существование админки не подтверждается тому,
 * у кого нет доступа. Для владельца разница незаметна, для чужого — панели
 * просто нет.
 */
export function assertAdmin(req: FastifyRequest): void {
  // Ключ публичного API НИКОГДА не даёт админских прав, даже если выписан на
  // почту владельца: скоупы ключа про анализ договоров, а не про выдачу тарифов.
  if (req.apiKeyId) throw new HttpError(404, 'Not found');
  if (!isAdminEmail(req.currentUser?.email)) throw new HttpError(404, 'Not found');
}
