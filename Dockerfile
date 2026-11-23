# Сборка и раздача САЙТА (сервис web на Railway). Сервер API живёт в server/
# со своим railway.json и этот файл не использует.
#
# Зачем свой Dockerfile, а не Nixpacks: сборке нужен браузер. После vite build
# скрипт scripts/prerender.mjs открывает каждую публичную страницу в Chromium и
# сохраняет готовый HTML — только так ChatGPT, Claude, Perplexity и поисковики,
# которые не запускают JavaScript, видят текст сайта. В образе Nixpacks браузера
# нет, и с августа по ноябрь 2026 снимки молча не делались: на любом адресе
# боты получали пустую страницу. Теперь без браузера сборка падает (см.
# prerender.mjs), а Railway при упавшей сборке оставляет в работе прошлую версию.

# ── 1. Сборка ────────────────────────────────────────────────────────────────
FROM node:24-slim AS build

# Системный Chromium из Debian: apt сам ставит все библиотеки, которые нужны
# браузеру. Шрифты — чтобы вёрстка в снимке считалась с настоящими глифами.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# puppeteer не качает свой браузер (это ~150 МБ и лишняя точка отказа), а берёт
# системный — путь он читает из PUPPETEER_EXECUTABLE_PATH сам.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Переменные сборки фронтенда. Railway передаёт переменные сервиса в сборку
# Dockerfile ТОЛЬКО если они объявлены здесь через ARG. Новая VITE_-переменная
# в коде = новая строка ARG здесь, иначе на сайте она будет пустой.
ARG VITE_SITE_ORIGIN
ARG VITE_API_BASE_URL
ARG VITE_USE_MOCK_API
ARG VITE_ALLOW_MOCK_IN_PROD
ARG VITE_SENTRY_DSN

RUN npm run build

# ── 2. Раздача ───────────────────────────────────────────────────────────────
# Серверу статики не нужны ни node_modules, ни браузер: только сборка, два
# скрипта на встроенных модулях Node и реестр адресов.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    INDEXNOW_PING=1
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/serve-static.mjs /app/scripts/site-gate.mjs ./scripts/
COPY --from=build /app/src/content/site/routes.json ./src/content/site/routes.json
USER node
CMD ["node", "scripts/serve-static.mjs"]
