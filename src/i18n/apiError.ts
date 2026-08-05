/**
 * Локализация отказов сервера.
 *
 * Сервер отвечает двуязычной строкой (ru/en) — до аудита 2026-08-03 интерфейс
 * показывал её как есть, и пользователь на немецком, казахском, узбекском или
 * арабском видел кириллицу посреди своего языка. Теперь сервер вместе с
 * сообщением присылает машинный код (`feature_locked`, `ai_limit`, …) и поля
 * (`feature`, `plan`, `limit`), а текст собирается здесь из словаря.
 *
 * Сообщение сервера остаётся фолбэком: неизвестный код лучше показать
 * по-русски, чем не показать вовсе.
 */
import { ApiError } from '@/api/util';

/** Ключ словаря с названием функции — по названию раздела, как в меню. */
const FEATURE_KEY: Record<string, string> = {
  docxExport: 'feat.docxExport',
  templates: 'tpl.title',
  compare: 'cmp.title',
  signatures: 'sig.title',
  versions: 'feat.versions',
  approvals: 'appr.title',
  team: 'team.title',
  auditLog: 'audit.title',
  sso: 'feat.sso',
  playbooks: 'nav.playbooks',
  clm: 'nav.contracts',
  batch: 'nav.batch',
  workflows: 'feat.workflows',
  apiAccess: 'nav.api',
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Человеческий текст ошибки на языке интерфейса. */
export function apiErrorMessage(err: unknown, t: Translate): string {
  if (!(err instanceof ApiError)) {
    return err instanceof Error && err.message ? err.message : t('common.error');
  }
  const d = err.details ?? {};
  const plan = String(d.plan ?? '');
  switch (err.code) {
    case 'feature_locked': {
      const key = FEATURE_KEY[String(d.feature ?? '')];
      return t('limits.featureLocked', {
        feature: key ? t(key) : String(d.feature ?? ''),
        plans: String(d.plans ?? ''),
        plan,
      });
    }
    case 'ai_limit':
      return t('limits.aiLimit', { plan, limit: Number(d.limit ?? 0) });
    case 'docs_limit':
      return t('limits.docsLimit', { plan, limit: Number(d.limit ?? 0) });
    case 'storage_limit':
      return t('limits.storageLimit', { plan, limit: Number(d.limit ?? 0), used: Number(d.used ?? 0) });
    case 'seats_limit':
      return t('limits.seatsLimit', { plan, limit: Number(d.limit ?? 0) });
    default:
      return err.message || t('common.error');
  }
}
