-- «На чьей вы стороне» в разборе договора (решение владельца 2026-11-09):
-- роль пользователя по договору (lib/contractSide.ts). NULL — нейтральный
-- разбор, как раньше. Повторный разбор берёт роль отсюда.
-- Номер 069: 064 занят веткой feature/team-workspace.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS side TEXT
  CHECK (side IS NULL OR side IN ('buyer', 'seller', 'customer', 'contractor', 'lessee', 'lessor', 'borrower', 'lender', 'employee', 'employer'));
