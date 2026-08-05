/**
 * Какие функции входят в какой тариф — зеркало серверного FEATURE_MIN_PLAN
 * (server/src/lib/limits.ts).
 *
 * Зачем на фронте: до аудита 2026-08-03 гейтов не было вовсе — человек выбирал
 * два файла, ждал загрузку и получал отказ «Сравнение доступно на Pro» ТОЛЬКО
 * в конце. Теперь страница честно говорит об этом сразу.
 *
 * Список обязан совпадать с серверным: сервер остаётся источником истины и
 * всё равно ответит 402, но расходиться они не должны — при изменении правьте
 * оба места.
 */
export type PlanFeature =
  | 'docxExport'
  | 'templates'
  | 'compare'
  | 'signatures'
  | 'versions'
  | 'approvals'
  | 'team'
  | 'auditLog'
  | 'sso'
  | 'playbooks'
  | 'clm'
  | 'batch'
  | 'workflows'
  | 'apiAccess';

const PAID = ['Standard', 'Pro', 'Business', 'Enterprise'];
const PRO = ['Pro', 'Business', 'Enterprise'];
const BUSINESS = ['Business', 'Enterprise'];

export const FEATURE_MIN_PLAN: Record<PlanFeature, string[]> = {
  docxExport: PAID,
  templates: PAID,
  compare: PRO,
  signatures: PRO,
  versions: PRO,
  approvals: PRO,
  team: BUSINESS,
  auditLog: BUSINESS,
  sso: BUSINESS,
  playbooks: PRO,
  clm: PRO,
  batch: PRO,
  workflows: PRO,
  apiAccess: BUSINESS,
};

/** Человекочитаемый список тарифов для подсказки («Pro и Business»). */
export function plansLabel(feature: PlanFeature): string {
  const plans = FEATURE_MIN_PLAN[feature].filter((p) => p !== 'Enterprise');
  return plans.length > 1 ? `${plans.slice(0, -1).join(', ')} и ${plans[plans.length - 1]}` : plans[0];
}

export function planAllows(plan: string | null | undefined, feature: PlanFeature): boolean {
  return Boolean(plan) && FEATURE_MIN_PLAN[feature].includes(plan as string);
}
