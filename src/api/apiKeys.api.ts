/**
 * Раздел «API» (тариф Business): управление ключами публичного API + статистика.
 * Секрет ключа приходит ОДИН раз в ответе create() и больше нигде.
 */
import { USE_MOCK, http } from './client';
import { delay } from './util';

export interface ApiKeyInfo {
  id: string;
  label: string;
  /** Маскированный вид «lxb_a1b2c3d4…» — полный секрет не хранится. */
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Права ключа; пустой массив = полный доступ. */
  scopes: string[];
  /** Срок действия (ISO) или null — бессрочный ключ. */
  expiresAt: string | null;
  expired: boolean;
  /** Имя создателя — для командных ключей; null, если неизвестно. */
  createdBy: string | null;
}

export interface ApiKeyCreated extends ApiKeyInfo {
  /** Полный секрет — показывается один раз сразу после создания. */
  key: string;
}

export interface ApiUsage {
  month: { used: number; limit: number | null; remaining: number | null };
  days: { day: string; count: number }[];
  recent: { id: string; fileName: string; status: string; keyLabel: string | null; createdAt: string }[];
  activeKeys: number;
}

/** Каталог прав — фолбэк на случай, когда GET /api-keys/scopes ещё не ответил. */
export const API_SCOPES_FALLBACK: string[] = [
  'analyses:read',
  'analyses:write',
  'drafts:write',
  'compares:write',
  'templates:write',
  'webhooks:manage',
];

const MOCK_KEY: ApiKeyInfo = {
  id: 'key_mock1',
  label: 'Production backend',
  keyPrefix: 'lxb_a1b2c3d4…',
  createdAt: new Date().toISOString(),
  lastUsedAt: null,
  scopes: [],
  expiresAt: null,
  expired: false,
  createdBy: null,
};

export const apiKeysApi = {
  async list(signal?: AbortSignal): Promise<ApiKeyInfo[]> {
    if (USE_MOCK) {
      await delay(60);
      return [MOCK_KEY];
    }
    return http<ApiKeyInfo[]>('/api-keys', { signal });
  },

  /** Каталог доступных прав ключа (для чекбоксов в модалке создания). */
  async scopes(signal?: AbortSignal): Promise<string[]> {
    if (USE_MOCK) {
      await delay(40);
      return [...API_SCOPES_FALLBACK];
    }
    const res = await http<{ scopes: string[] }>('/api-keys/scopes', { signal });
    return res.scopes;
  },

  async create(label: string, scopes: string[] = [], expiresInDays: number | null = null): Promise<ApiKeyCreated> {
    if (USE_MOCK) {
      await delay(200);
      return { ...MOCK_KEY, label, scopes, key: 'lxb_mock-secret-shown-once' };
    }
    return http<ApiKeyCreated>('/api-keys', { method: 'POST', body: { label, scopes, expiresInDays } });
  },

  /** Ротация: отзывает старый ключ и выпускает новый с теми же label+scopes.
   *  Секрет нового ключа — в ответе один раз, как при создании. */
  async rotate(id: string, expiresInDays: number | null = null): Promise<ApiKeyCreated> {
    if (USE_MOCK) {
      await delay(200);
      return { ...MOCK_KEY, key: 'lxb_mock-rotated-secret-shown-once' };
    }
    return http<ApiKeyCreated>(`/api-keys/${id}/rotate`, { method: 'POST', body: { expiresInDays } });
  },

  async revoke(id: string): Promise<void> {
    if (USE_MOCK) {
      await delay(120);
      return;
    }
    await http<void>(`/api-keys/${id}`, { method: 'DELETE' });
  },

  async usage(signal?: AbortSignal): Promise<ApiUsage> {
    if (USE_MOCK) {
      await delay(80);
      return {
        month: { used: 137, limit: 1000, remaining: 863 },
        days: Array.from({ length: 14 }, (_, i) => ({
          day: new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10),
          count: Math.round(5 + Math.sin(i) * 4),
        })),
        recent: [{ id: 'apireq_mock', fileName: 'msa.pdf', status: 'done', keyLabel: 'Production backend', createdAt: new Date().toISOString() }],
        activeKeys: 1,
      };
    }
    return http<ApiUsage>('/api-keys/usage', { signal });
  },
};
