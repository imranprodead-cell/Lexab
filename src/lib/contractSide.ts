/** «На чьей вы стороне» в разборе договора — те же роли, что на сервере
 *  (server/src/lib/contractSide.ts). null — нейтральный разбор. */
export const CONTRACT_SIDES = ['buyer', 'seller', 'customer', 'contractor', 'lessee', 'lessor', 'borrower', 'lender', 'employee', 'employer'] as const;
export type ContractSide = (typeof CONTRACT_SIDES)[number];
