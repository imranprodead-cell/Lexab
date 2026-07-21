/**
 * Прод-смоук: проверка ЖИВОГО деплоя без демо-данных и без порчи прода.
 *
 *   BASE_URL=https://api.your-domain.com node scripts/smoke-prod.mjs
 *
 * Базовый прогон (безопасный, ничего не создаёт кроме одной незавершённой
 * регистрации): health(+БД), регистрация → verifyRequired, логин до
 * верификации честно отклонён, публичные страницы фронта отвечают.
 *
 * Полный прогон (нужен заранее созданный смоук-аккаунт):
 *   SMOKE_EMAIL=... SMOKE_PASSWORD=... [SMOKE_AI=1] [FRONT_URL=https://домен]
 * логин → загрузка файла → (SMOKE_AI=1: анализ → report.pdf — тратит 1
 * ИИ-запрос тарифа!) → выход. Артефакты полного прогона остаются в смоук-аккаунте (заводите под это отдельный аккаунт и периодически чистите).
 */

const BASE = (process.env.BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const API = `${BASE}/api`;
const FRONT = (process.env.FRONT_URL ?? '').replace(/\/$/, '');

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed++;
};

const j = async (res) => {
  try {
    return await res.json();
  } catch {
    return {};
  }
};

// ── 1. Health (реальный запрос к БД внутри) ──────────────────────────────────
const health = await fetch(`${API}/health`).catch(() => null);
const healthBody = health ? await j(health) : {};
ok('health 200 + ok:true (БД жива)', health?.status === 200 && healthBody.ok === true, JSON.stringify(healthBody));

// ── 2. Регистрация → письмо-верификация; вход до верификации закрыт ─────────
const email = `smoke-${Date.now()}@smoke-check.invalid`;
const password = `Smoke!${Date.now()}x`; // один раз: login должен идти с ТЕМ ЖЕ паролем,
// чтобы проверялся именно гейт верификации (403), а не «неверный пароль» (401)
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Smoke Check', email, password }),
}).catch(() => null);
const regBody = reg ? await j(reg) : {};
ok('register → 201 + verifyRequired', reg?.status === 201 && regBody.verifyRequired === true);
const preLogin = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
}).catch(() => null);
ok('login до верификации отклонён (гейт верификации)', preLogin !== null && preLogin.status >= 400);

// ── 3. Публичные страницы фронта ─────────────────────────────────────────────
if (FRONT) {
  for (const path of ['/', '/login', '/terms', '/privacy']) {
    const res = await fetch(`${FRONT}${path}`).catch(() => null);
    ok(`front ${path} → 200`, res?.status === 200);
  }
} else {
  console.log('… FRONT_URL не задан — публичные страницы фронта пропущены');
}

// ── 4. Полный путь под смоук-аккаунтом (опционально) ─────────────────────────
const smokeEmail = process.env.SMOKE_EMAIL;
const smokePassword = process.env.SMOKE_PASSWORD;
if (smokeEmail && smokePassword) {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
  }).catch(() => null);
  const session = login ? await j(login) : {};
  ok('smoke-аккаунт: логин', login?.status === 200 && Boolean(session.token));

  if (session.token) {
    const auth = { authorization: `Bearer ${session.token}` };
    const name = `smoke-${Date.now()}.txt`;
    const form = new FormData();
    form.append('file', new Blob(['Договор смоук-проверки. Срок — 12 месяцев.'], { type: 'text/plain' }), name);
    const up = await fetch(`${API}/uploads`, { method: 'POST', headers: auth, body: form }).catch(() => null);
    ok('upload файла', up?.status === 201);

    if (process.env.SMOKE_AI === '1') {
      const an = await fetch(`${API}/analysis`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: name, fileSize: '1 KB' }),
      }).catch(() => null);
      const analysis = an ? await j(an) : {};
      ok('анализ (тратит 1 ИИ-запрос)', an !== null && an.status < 300 && Boolean(analysis.id), analysis.message ?? '');
      if (analysis.id) {
        const pdf = await fetch(`${API}/analysis/${analysis.id}/report.pdf`, { headers: auth }).catch(() => null);
        const bytes = pdf && pdf.status === 200 ? Buffer.from(await pdf.arrayBuffer()) : Buffer.alloc(0);
        ok('report.pdf настоящий PDF', bytes.subarray(0, 5).toString('latin1').startsWith('%PDF'));
      }
    } else {
      console.log('… SMOKE_AI не задан — анализ/отчёт пропущены (не тратим ИИ-квоту)');
    }
  }
} else {
  console.log('… SMOKE_EMAIL/SMOKE_PASSWORD не заданы — полный путь пропущен');
}

console.log(failed ? `\nСМОУК ПРОВАЛЕН: ${failed} проверок ✗` : '\nСМОУК ПРОЙДЕН: все проверки ✓');
process.exit(failed ? 1 : 0);
