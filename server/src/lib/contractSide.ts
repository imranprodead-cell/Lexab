/**
 * «На чьей вы стороне» в разборе договора (решение владельца 2026-11-09):
 * пользователь выбирает свою роль переключателем у прикреплённого файла; разбор
 * ищет риски ЭТОЙ стороны и предлагает правки в её пользу. По умолчанию —
 * нейтральный разбор, как раньше. Роль хранится у разбора (analyses.side):
 * повторный разбор её помнит, карточка показывает «Разбор в пользу: …».
 */

export const CONTRACT_SIDES = ['buyer', 'seller', 'customer', 'contractor', 'lessee', 'lessor', 'borrower', 'lender', 'employee', 'employer'] as const;
export type ContractSide = (typeof CONTRACT_SIDES)[number];

/** Как роль называется в договорах (модель ищет сторону по этим словам). */
const ROLE_NAMES: Record<ContractSide, string> = {
  buyer: 'the Buyer / purchaser / recipient of the goods (Покупатель, Получатель; Xaridor)',
  seller: 'the Seller / supplier (Продавец, Поставщик; Sotuvchi, Yetkazib beruvchi)',
  customer: 'the Customer who orders works or services (Заказчик; Buyurtmachi)',
  contractor: 'the Contractor / service provider (Подрядчик, Исполнитель; Pudratchi, Ijrochi)',
  lessee: 'the Tenant / lessee (Арендатор, Наниматель; Ijarachi)',
  lessor: 'the Landlord / lessor (Арендодатель, Наймодатель; Ijaraga beruvchi)',
  borrower: 'the Borrower (Заёмщик; Qarz oluvchi)',
  lender: 'the Lender (Займодавец, Кредитор; Qarz beruvchi)',
  employee: 'the Employee (Работник; Xodim)',
  employer: 'the Employer (Работодатель; Ish beruvchi)',
};

/** Роль из запроса или null (нейтрально). Чужое значение — тоже null. */
export function parseSide(value: unknown): ContractSide | null {
  return typeof value === 'string' && (CONTRACT_SIDES as readonly string[]).includes(value) ? (value as ContractSide) : null;
}

/** Указание модели — часть запроса на разбор. */
export function sideInstruction(side: ContractSide): string {
  return (
    `\n\nCLIENT SIDE: the user represents ${ROLE_NAMES[side]} under this contract. Review from THAT party's point of view: ` +
    'findings are the risks for this party — clauses that burden or expose it and protections it lacks — with severity as it affects this party; ' +
    'redlines change the wording in this party\'s favour while staying reasonable for the other side to accept. ' +
    'Do not flag clauses that only burden the other party unless they create a risk for the user (for example, an unenforceable clause the user relies on). ' +
    'In the summary\'s first sentence, name the party you reviewed for as it is named in the contract. ' +
    'If no party of this contract has this role, say so in the summary and review neutrally.'
  );
}
