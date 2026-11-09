/**
 * Стороны договора по его шапке — для уточняющего вопроса «Чью сторону вы
 * представляете?» перед разбором (решение владельца 2026-11-09: вопрос при
 * необходимости, человек выбирает вариант или пишет свой). Без ИИ: формула
 * «ООО «Альфа», именуемое в дальнейшем «Поставщик»» (RU), «… bundan buyon
 * «Sotuvchi» deb ataladi» (UZ), «… hereinafter referred to as the “Supplier”» (EN).
 * Не нашли двух сторон — вопроса нет, разбор нейтральный, как раньше.
 */
import type { ContractSide } from './contractSide.ts';

export interface ContractParty {
  /** Роль, как в договоре: «Поставщик», «Арендатор», «Sotuvchi». */
  role: string;
  /** Название стороны: «ООО «Альфа Трейд»» (может быть пустым). */
  name: string;
  /** Роль из списка разбора (lib/contractSide.ts) или null — передадим текстом. */
  side: ContractSide | null;
}

/** Слова роли → сторона разбора (основы RU/UZ/EN). Порядок важен: «субподрядчик» — тоже подрядчик. */
const ROLE_SIDES: [RegExp, ContractSide][] = [
  [/покупател|получател|xaridor|buyer|purchaser/iu, 'buyer'],
  [/поставщик|продав|sotuvchi|yetkazib|supplier|seller|vendor/iu, 'seller'],
  [/заказчик|buyurtmachi|customer|client/iu, 'customer'],
  [/подрядчик|исполнител|pudratchi|ijrochi|contractor|provider/iu, 'contractor'],
  [/арендатор|нанимател|ijarachi|tenant|lessee/iu, 'lessee'],
  [/арендодател|наймодател|ijaraga beruvchi|landlord|lessor/iu, 'lessor'],
  [/заёмщик|заемщик|qarz oluvchi|borrower/iu, 'borrower'],
  [/займодав|кредитор|qarz beruvchi|lender/iu, 'lender'],
  [/работодател|ish beruvchi|employer/iu, 'employer'],
  [/работник|xodim|employee/iu, 'employee'],
];

export function sideOfRole(role: string): ContractSide | null {
  for (const [re, side] of ROLE_SIDES) if (re.test(role)) return side;
  return null;
}

/** Свободный ответ пользователя («мы покупатель…») → роль, если названа однозначно. */
export function sideFromText(text: string): ContractSide | null {
  const found = new Set(ROLE_SIDES.filter(([re]) => re.test(text)).map(([, s]) => s));
  return found.size === 1 ? [...found][0] : null;
}

const LEGAL_FORM = /(ООО|ОАО|ЗАО|АО|ИП|ЧП|СП|ГУП|ГУ|ЧУП|ИЧП|МЧЖ|MChJ|AJ|YaTT|XK|LLC|Ltd|JSC|Inc|Общество|Акционерное|Индивидуальный|Частное|Государственное|Гражданин|Гражданка|гражданин|гражданка)\b/u;

/** Название стороны: хвост текста перед «именуемое…», начиная с организационной формы. */
function partyName(before: string): string {
  const tail = before.slice(-160).replace(/\s+/g, ' ');
  const cut = tail.split(/(?:^|[.;:\n]|\s(?:и|с одной стороны|с другой стороны|between|and)\s)/u).pop() ?? tail;
  const m = cut.match(new RegExp(`${LEGAL_FORM.source}[\\s\\S]*$`, 'u'));
  const name = (m ? m[0] : cut).replace(/[,\s]+$/u, '').replace(/\s*\(.*$/u, '').trim();
  return name.length > 90 ? `${name.slice(0, 89)}…` : name;
}

const ROLE_PATTERNS = [
  /(?:именуем\S*|далее)\s+(?:в\s+дальнейшем\s+)?(?:-\s*)?[«"“„]([^»"”“]{3,30})[»"”“]/giu,
  /bundan\s+buyon\s+[«"“„]([^»"”“]{3,30})[»"”“]\s+deb\s+atal/giu,
  /hereinafter\s+(?:referred\s+to\s+as\s+|called\s+)?(?:the\s+)?[«"“„]([^»"”“]{3,30})[»"”“]/giu,
];

/** Стороны из шапки договора (первые 6000 знаков), без повторов, не больше 4. */
export function extractParties(text: string): ContractParty[] {
  const head = text.slice(0, 6000);
  const found: { at: number; party: ContractParty }[] = [];
  for (const re of ROLE_PATTERNS) {
    for (const m of head.matchAll(re)) {
      const role = m[1].trim().replace(/^(the)\s+/i, '');
      found.push({ at: m.index ?? 0, party: { role: role.charAt(0).toUpperCase() + role.slice(1), name: partyName(head.slice(0, m.index ?? 0)), side: sideOfRole(role) } });
    }
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .map((f) => f.party)
    .filter((p) => {
      const key = p.role.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}
