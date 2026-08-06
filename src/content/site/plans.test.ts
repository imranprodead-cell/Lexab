/**
 * Витрина тарифов не должна обещать больше, чем даёт сервер.
 *
 * Лимиты живут в двух местах по необходимости: сервер применяет их при каждом
 * запросе (server/src/lib/limits.ts), витрина показывает их посетителю. Пока
 * это два файла, они обязаны совпадать ЧИСЛО В ЧИСЛО — иначе клиент покупает
 * одно, а получает другое. Тест читает серверный файл как текст: тянуть в
 * браузерные тесты серверный модуль нельзя (у него свои зависимости).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_PLANS, YEARLY_DISCOUNT, yearlyMonthlyUsd } from './plans';

const serverLimits = readFileSync(path.resolve(process.cwd(), 'server/src/lib/limits.ts'), 'utf8');

/** Достать блок вида `Free: { ai: 20, docs: 3, storageMb: 100 },` */
function serverPlanLimits(plan: string): { ai: string; docs: string; storageMb: string } {
  const m = serverLimits.match(new RegExp(`${plan}:\\s*\\{\\s*ai:\\s*([^,]+),\\s*docs:\\s*([^,]+),\\s*storageMb:\\s*([^}]+)\\}`));
  if (!m) throw new Error(`в server/src/lib/limits.ts не найден тариф ${plan}`);
  return { ai: m[1].trim(), docs: m[2].trim(), storageMb: m[3].trim() };
}

/** Достать число мест: `Free: 1,` внутри PLAN_SEATS. */
function serverSeats(plan: string): string {
  const block = serverLimits.match(/PLAN_SEATS[^=]*=\s*\{([\s\S]*?)\};/);
  if (!block) throw new Error('в server/src/lib/limits.ts не найден PLAN_SEATS');
  const m = block[1].match(new RegExp(`${plan}:\\s*([^,\\n]+)`));
  if (!m) throw new Error(`в PLAN_SEATS нет тарифа ${plan}`);
  return m[1].trim();
}

/** `50 * 1024` и `51200` — одно и то же число; считаем выражение из кода. */
const evalNumber = (expr: string): number | null => {
  const clean = expr.replace(/_/g, '').trim();
  if (clean === 'null') return null;
  if (!/^[\d\s*+]+$/.test(clean)) throw new Error(`неожиданное выражение лимита: ${expr}`);
  return Number(new Function(`return ${clean}`)());
};

describe('тарифы витрины совпадают с серверными лимитами', () => {
  for (const plan of SITE_PLANS) {
    it(`${plan.id}: лимиты как на сервере`, () => {
      const server = serverPlanLimits(plan.id);
      expect(evalNumber(server.ai), 'обращения к ИИ').toBe(plan.limits.ai);
      expect(evalNumber(server.docs), 'документы').toBe(plan.limits.docs);
      expect(evalNumber(server.storageMb), 'хранилище').toBe(plan.limits.storageMb);
      expect(evalNumber(serverSeats(plan.id)), 'мест').toBe(plan.limits.seats);
    });
  }

  it('порядок тарифов — от дешёвого к дорогому', () => {
    const paid = SITE_PLANS.filter((p) => p.monthlyUsd !== null).map((p) => p.monthlyUsd as number);
    expect([...paid].sort((a, b) => a - b)).toEqual(paid);
  });

  it('годовая цена считается, а не переписывается руками', () => {
    expect(YEARLY_DISCOUNT).toBeGreaterThan(0);
    expect(YEARLY_DISCOUNT).toBeLessThan(0.5);
    expect(yearlyMonthlyUsd(100)).toBe(85);
  });

  it('безлимита по обращениям к ИИ нет ни у одного тарифа', () => {
    // Это обещание из стоп-листа: до аудита 2026-08-03 потолка не было вовсе.
    for (const plan of SITE_PLANS) {
      expect(plan.limits.ai, `${plan.id}: потолок расходов на ИИ обязателен`).not.toBeNull();
    }
  });
});
