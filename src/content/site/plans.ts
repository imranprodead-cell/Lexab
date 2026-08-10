/**
 * ЕДИНЫЙ ИСТОЧНИК ДАННЫХ О ТАРИФАХ для витрины.
 *
 * До этого файла тарифы были описаны ДВАЖДЫ — в лендинге
 * (components/landing/LandingSections.tsx) и на странице тарифов в кабинете
 * (pages/PlansPage.tsx), — а лимиты, которые сервер реально применяет, лежали
 * третьим местом в server/src/lib/limits.ts. Три списка расходятся молча:
 * никакая сборка не падает, если на витрине обещано больше, чем даёт сервер.
 *
 * Правило: ЛИМИТЫ ЗДЕСЬ — ЗЕРКАЛО server/src/lib/limits.ts (PLAN_LIMITS и
 * PLAN_SEATS), а состав возможностей — зеркало src/lib/planFeatures.ts
 * (FEATURE_MIN_PLAN). Меняете там — правьте здесь; тест не даст забыть.
 */
import type { Text6 } from '../types';

/** Тарифы в порядке показа. Идентификатор совпадает с ключом на сервере. */
export type PlanId = 'Free' | 'Standard' | 'Pro' | 'Business' | 'Enterprise';

export interface PlanLimits {
  /** Обращений к ИИ в месяц. null = без ограничения (сейчас такого нет). */
  ai: number | null;
  /** Документов в месяц. */
  docs: number | null;
  /** Хранилище в мегабайтах. */
  storageMb: number | null;
  /** Рабочих мест. null = без ограничения. */
  seats: number | null;
}

export interface SitePlan {
  id: PlanId;
  /** Цена в долларах за месяц при помесячной оплате. null = договорная. */
  monthlyUsd: number | null;
  limits: PlanLimits;
  tagline: Text6;
}

/**
 * Скидка при оплате за год — как в лендинге и на странице тарифов.
 * Держим числом, чтобы цена за год считалась, а не переписывалась руками.
 */
export const YEARLY_DISCOUNT = 0.15;

/** Цена за месяц при оплате за год, округлённая до целого доллара. */
export function yearlyMonthlyUsd(monthlyUsd: number): number {
  return Math.round(monthlyUsd * (1 - YEARLY_DISCOUNT));
}

export const SITE_PLANS: SitePlan[] = [
  {
    id: 'Free',
    monthlyUsd: 0,
    limits: { ai: 20, docs: 3, storageMb: 50, seats: 1 },
    tagline: {
      ru: 'Посмотреть, что система находит в вашем договоре',
      en: 'See what the system finds in your contract',
      de: 'Sehen, was das System in Ihrem Vertrag findet',
      ar: 'اطّلع على ما يجده النظام في عقدك',
      kk: 'Жүйе шартыңыздан не табатынын көру',
      uz: 'Tizim shartnomangizdan nima topishini koʻrish',
    },
  },
  {
    id: 'Standard',
    monthlyUsd: 15,
    limits: { ai: 100, docs: 20, storageMb: 250, seats: 1 },
    tagline: {
      ru: 'Постоянная работа с договорами в одиночку',
      en: 'Steady solo work with contracts',
      de: 'Regelmäßige Vertragsarbeit allein',
      ar: 'عمل منتظم مع العقود بمفردك',
      kk: 'Шарттармен жалғыз тұрақты жұмыс',
      uz: 'Shartnomalar bilan yolgʻiz doimiy ish',
    },
  },
  {
    id: 'Pro',
    monthlyUsd: 50,
    limits: { ai: 500, docs: 80, storageMb: 500, seats: 1 },
    tagline: {
      ru: 'Сравнение редакций, правила фирмы, согласования, пакеты',
      en: 'Version compare, firm rules, approvals, batches',
      de: 'Versionsvergleich, Kanzleiregeln, Freigaben, Stapel',
      ar: 'مقارنة النسخ وقواعد المكتب والموافقات والدفعات',
      kk: 'Редакцияларды салыстыру, фирма ережелері, келісулер, топтамалар',
      uz: 'Tahrirlarni solishtirish, firma qoidalari, kelishuvlar, paketlar',
    },
  },
  {
    id: 'Business',
    monthlyUsd: 499,
    limits: { ai: 10_000, docs: 500, storageMb: 1024, seats: 5 },
    tagline: {
      ru: 'Команда, единый вход, журнал действий и программный доступ',
      en: 'A team, single sign-on, audit log and API access',
      de: 'Team, Single-Sign-on, Protokoll und API-Zugriff',
      ar: 'فريق ودخول موحّد وسجل أحداث ووصول برمجي',
      kk: 'Команда, бірыңғай кіру, әрекеттер журналы және API',
      uz: 'Jamoa, yagona kirish, harakatlar jurnali va API',
    },
  },
  {
    id: 'Enterprise',
    monthlyUsd: null,
    limits: { ai: 50_000, docs: null, storageMb: null, seats: null },
    tagline: {
      ru: 'Индивидуальные условия и внедрение — по договорённости',
      en: 'Custom terms and onboarding — by arrangement',
      de: 'Individuelle Konditionen und Einführung — nach Absprache',
      ar: 'شروط وتهيئة مخصّصة — بالاتفاق',
      kk: 'Жеке шарттар мен енгізу — келісім бойынша',
      uz: 'Individual shartlar va joriy etish — kelishuv boʻyicha',
    },
  },
];

export const planById = (id: PlanId): SitePlan => SITE_PLANS.find((p) => p.id === id) as SitePlan;
