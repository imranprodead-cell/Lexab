/**
 * Линт серверного кода. До аудита 2026-08-03 сервер не линтился ВООБЩЕ:
 * корневой конфиг явно игнорирует `server`, а своего у него не было — при этом
 * работа в CI называлась «Server (lint · typecheck · tests)».
 *
 * Набор намеренно скромный: `eslint:recommended` + типизированные правила
 * TypeScript. Задача — ловить настоящие ошибки (недостижимый код, забытый
 * await, «плавающие» промисы), а не переформатировать существующий код.
 */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  ignorePatterns: ['data', 'dist', 'node_modules', '.eslintrc.cjs', 'evals/reports'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    // Сервер исполняет TypeScript нативно; `any` встречается на границах с
    // внешними API — предупреждение, а не ошибка.
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-empty': ['error', { allowEmptyCatch: true }],
    // Диапазоны арабских символов в регулярках заканчиваются на U+FEFF, который
    // формально «нестандартный пробел». Это НАМЕРЕННО (см. lib/arabicShaper.ts,
    // lib/pdf.ts) — правило проверяет только код и строки.
    'no-irregular-whitespace': ['error', { skipRegExps: true }],
  },
};
