/** Playbooks API — team standard positions the AI checks contracts against.
 *  Pro+ feature: the real endpoints answer 402 on Free/Standard (see the page,
 *  which surfaces an upsell). */
import { USE_MOCK, http } from './client';
import { clone, delay } from './util';
import type { Playbook } from '@/types/domain';

export type { Playbook } from '@/types/domain';

/** Fields accepted when creating a playbook (POST). */
export interface CreatePlaybookInput {
  name: string;
  jurisdiction?: string | null;
  rules: string[];
  /** Создать сразу выключенным (по умолчанию true — активный). */
  active?: boolean;
}

/** Partial edit of an existing playbook (PATCH). */
export interface UpdatePlaybookInput {
  name?: string;
  jurisdiction?: string | null;
  active?: boolean;
  rules?: string[];
}

const now = () => new Date().toISOString();

const mockPlaybooks: Playbook[] = [
  {
    id: 'pb1',
    name: 'Стандартные позиции по NDA',
    jurisdiction: 'UK',
    active: true,
    rules: [
      'Срок конфиденциальности не более 3 лет после расторжения',
      'Взаимные обязательства сторон (mutual NDA)',
      'Исключение для сведений, ставших публичными не по вине стороны',
    ],
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'pb2',
    name: 'Коммерческие договоры',
    jurisdiction: null,
    active: true,
    rules: [
      'Неустойка не выше 0,1% в день',
      'Ограничение ответственности суммой договора',
      'Право на односторонний отказ с уведомлением за 30 дней',
    ],
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'pb3',
    name: 'Позиции по поставке',
    jurisdiction: 'UZ',
    active: false,
    rules: ['Переход риска в момент передачи перевозчику', 'Оплата в течение 30 дней с даты поставки'],
    createdAt: now(),
    updatedAt: now(),
  },
];

/** Витрина готового экспертного набора (контент живёт на сервере). */
export interface PlaybookPackInfo {
  id: string;
  jurisdiction: string;
  nameRu: string;
  nameEn: string;
  descRu: string;
  descEn: string;
  rulesCount: number;
}

const MOCK_PACKS: PlaybookPackInfo[] = [
  { id: 'uk-nda', jurisdiction: 'UK', nameRu: 'NDA по праву Англии', nameEn: 'NDA under English law', descRu: 'Соглашения о неразглашении', descEn: 'Non-disclosure agreements', rulesCount: 11 },
  { id: 'uz-supply', jurisdiction: 'UZ', nameRu: 'Поставка (Узбекистан)', nameEn: 'Supply (Uzbekistan)', descRu: 'Договоры поставки, позиция покупателя', descEn: 'Supply agreements, buyer-side', rulesCount: 12 },
];

export const playbooksApi = {
  /** Готовые экспертные наборы (витрина — просмотр без гейта). */
  async packs(signal?: AbortSignal): Promise<PlaybookPackInfo[]> {
    if (USE_MOCK) {
      await delay(40);
      return clone(MOCK_PACKS);
    }
    return http<PlaybookPackInfo[]>('/playbooks/packs', { signal });
  },

  /** Установить набор одним кликом (идемпотентно; язык правил = язык UI). */
  async installPack(packId: string, lang: string): Promise<Playbook> {
    if (USE_MOCK) {
      await delay(300);
      const pack = MOCK_PACKS.find((p) => p.id === packId);
      const pb: Playbook = {
        id: `pb_${packId}`,
        name: pack ? (lang === 'en' ? pack.nameEn : pack.nameRu) : packId,
        jurisdiction: pack?.jurisdiction ?? null,
        active: true,
        rules: ['Ответственность ограничена 100% годовой платы', 'Уведомление о расторжении — 30 дней письменно'],
        createdAt: now(),
        updatedAt: now(),
      };
      mockPlaybooks.unshift(pb);
      return clone(pb);
    }
    return http<Playbook>(`/playbooks/packs/${packId}/install`, { method: 'POST', body: { lang: lang === 'en' ? 'en' : 'ru' } });
  },

  async list(signal?: AbortSignal): Promise<Playbook[]> {
    if (USE_MOCK) {
      await delay(60);
      return clone(mockPlaybooks);
    }
    return http<Playbook[]>('/playbooks', { signal });
  },

  async create(input: CreatePlaybookInput): Promise<Playbook> {
    if (USE_MOCK) {
      await delay(300);
      const pb: Playbook = {
        id: `pb_${Date.now()}`,
        name: input.name,
        jurisdiction: input.jurisdiction ?? null,
        active: input.active ?? true,
        rules: input.rules,
        createdAt: now(),
        updatedAt: now(),
      };
      mockPlaybooks.unshift(pb);
      return clone(pb);
    }
    return http<Playbook>('/playbooks', { method: 'POST', body: input });
  },

  async update(id: string, patch: UpdatePlaybookInput): Promise<Playbook> {
    if (USE_MOCK) {
      await delay(200);
      const pb = mockPlaybooks.find((x) => x.id === id);
      if (pb) {
        if (patch.name !== undefined) pb.name = patch.name;
        if (patch.jurisdiction !== undefined) pb.jurisdiction = patch.jurisdiction;
        if (patch.active !== undefined) pb.active = patch.active;
        if (patch.rules !== undefined) pb.rules = patch.rules;
        pb.updatedAt = now();
      }
      return clone(pb as Playbook);
    }
    return http<Playbook>(`/playbooks/${id}`, { method: 'PATCH', body: patch });
  },

  async remove(id: string): Promise<void> {
    if (USE_MOCK) {
      await delay(200);
      const i = mockPlaybooks.findIndex((x) => x.id === id);
      if (i >= 0) mockPlaybooks.splice(i, 1);
      return;
    }
    await http<void>(`/playbooks/${id}`, { method: 'DELETE' });
  },
};
