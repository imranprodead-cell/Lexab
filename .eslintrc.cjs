module.exports = {
  root: true,
  env: { browser: true, es2021: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'server'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
  overrides: [
    {
      /*
       * Публичная часть сайта (страницы-разделы, их шапка и подвал) обязана
       * оставаться лёгкой: её читают случайные посетители с телефонов, часто
       * по плохой связи. Один импорт библиотеки анимаций добавляет 48 КБ gzip
       * — треть всей первой загрузки. Запрет стоит здесь, а не в договорённости
       * «мы помним»: договорённости не переживают полгода и смену рук.
       *
       * Появление блоков делает хук useReveal (IntersectionObserver, 0.8 КБ),
       * плавные состояния — обычные CSS-переходы.
       */
      files: ['src/pages/public/**/*.{ts,tsx}', 'src/components/public/**/*.{ts,tsx}', 'src/content/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['motion', 'motion/*', 'framer-motion', 'framer-motion/*'],
                message:
                  'Публичным страницам нельзя тянуть библиотеку анимаций (48 КБ gzip). Появление блоков — useReveal, плавность — CSS-переходы.',
              },
              {
                group: ['@/components/landing/*', '@/pages/AuthPage', '@/components/layout/*'],
                message:
                  'Компоненты лендинга и кабинета тянут за собой анимации и всю ветку приложения. Публичной странице нужен собственный лёгкий компонент.',
              },
            ],
          },
        ],
      },
    },
  ],
};
