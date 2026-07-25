/**
 * Человекочитаемый экспорт данных аккаунта (DSAR): самодостаточный HTML-файл,
 * открывается в любом браузере. Машиночитаемый вариант остаётся доступен по
 * ?format=json (см. GET /me/export). Все значения экранируются.
 */

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(v: unknown): string {
  if (!v) return '—';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return esc(v);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function fmtBytes(n: unknown): string {
  const b = Number(n);
  if (!Number.isFinite(b)) return '—';
  return b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

function dash(v: unknown): string {
  return v === null || v === undefined || v === '' ? '—' : esc(v);
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return `<p class="empty">— нет данных / no data —</p>`;
  return `<div class="twrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

/* Разделы читают тот же объект, что собирает buildExport (security.routes). */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function renderExportHtml(data: Record<string, any>): string {
  const account = data.account ?? {};
  const sub = data.subscription ?? null;
  const stats = data.stats ?? null;
  const documents: any[] = data.documents ?? [];
  const analyses: any[] = data.analyses ?? [];
  const terms: any[] = data.contractTerms ?? [];
  const chats: any[] = data.chats ?? [];
  const templates: any[] = data.templates ?? [];
  const playbooks: any[] = data.playbooks ?? [];
  const uploads: any[] = data.uploads ?? [];

  const docName = new Map<string, string>(documents.map((d) => [d.id, d.name]));

  const statsRows = stats
    ? Object.entries(stats)
        .filter(([k, v]) => k !== 'user_id' && (typeof v === 'number' || typeof v === 'string'))
        .map(([k, v]) => [esc(k), dash(v)])
    : [];

  const sections: string[] = [];

  sections.push(`<section><h2>Аккаунт · Account</h2>${table(
    ['Поле / Field', 'Значение / Value'],
    [
      ['Имя / Name', dash(account.name)],
      ['Email', dash(account.email)],
      ['Компания / Firm', dash(account.firm)],
      ['Юрисдикция / Jurisdiction', dash(account.jurisdiction)],
      ['ID', dash(account.id)],
    ],
  )}</section>`);

  sections.push(`<section><h2>Подписка · Subscription</h2>${
    sub ? table(['План / Plan', 'Статус / Status'], [[dash(sub.plan), dash(sub.status)]]) : '<p class="empty">— бесплатный тариф / free plan —</p>'
  }</section>`);

  if (statsRows.length > 0) {
    sections.push(`<section><h2>Статистика · Usage stats</h2>${table(['Показатель / Metric', 'Значение / Value'], statsRows)}</section>`);
  }

  sections.push(`<section><h2>Документы · Documents (${documents.length})</h2>${table(
    ['Название / Name', 'Контрагент / Counterparty', 'Статус / Status', 'Риск / Risk', 'Юрисдикция', 'Создан / Created'],
    documents.map((d) => [dash(d.name), dash(d.counterparty), dash(d.status), dash(d.risk), dash(d.jurisdiction), fmtDate(d.created_at)]),
  )}</section>`);

  const analysesHtml = analyses
    .map((a) => {
      const findings: any[] = a.findings ?? [];
      return `<article class="card"><h3>${dash(a.fileName)}</h3>
<p class="meta">Риск / Risk: <strong>${dash(a.riskLevel)}</strong> · ${dash(a.riskScore)}/100 · ${fmtDate(a.createdAt)}</p>
${a.summary ? `<p>${esc(a.summary)}</p>` : ''}
${
  findings.length
    ? `<ul>${findings.map((f) => `<li><strong>${dash(f.severity)}</strong> — ${dash(f.title)}${f.citation ? ` <span class="cite">(${esc(f.citation)})</span>` : ''}</li>`).join('')}</ul>`
    : ''
}</article>`;
    })
    .join('');
  sections.push(`<section><h2>Анализы договоров · Contract reviews (${analyses.length})</h2>${analysesHtml || '<p class="empty">— нет данных / no data —</p>'}</section>`);

  sections.push(`<section><h2>Условия договоров · Contract terms (${terms.length})</h2>${table(
    ['Документ / Document', 'Действует с / Effective', 'Истекает / Expires', 'Автопродление / Auto-renew', 'Сумма / Value', 'Право / Law'],
    terms.map((t) => [
      dash(docName.get(t.document_id) ?? t.document_id),
      dash(t.effective_date),
      dash(t.expiry_date),
      t.auto_renew === true ? 'да / yes' : t.auto_renew === false ? 'нет / no' : '—',
      t.contractValue ? `${esc(t.contractValue)}${t.currency ? ` ${esc(t.currency)}` : ''}` : '—',
      dash(t.governing_law),
    ]),
  )}</section>`);

  const chatsHtml = chats
    .map((c) => {
      const msgs: any[] = c.messages ?? [];
      const body = msgs
        .map((m) => {
          if (m.kind === 'file') return `<p class="msg file">📎 ${dash(m.fileName)}</p>`;
          const who = m.role === 'user' ? 'Вы / You' : 'Lexab';
          return `<p class="msg ${m.role === 'user' ? 'user' : 'ai'}"><strong>${who}:</strong> ${esc(m.text ?? '')}</p>`;
        })
        .join('');
      return `<article class="card"><h3>${dash(c.title)}</h3><p class="meta">${fmtDate(c.createdAt)} · сообщений / messages: ${msgs.length}</p>${body}</article>`;
    })
    .join('');
  sections.push(`<section><h2>Чаты · Chats (${chats.length})</h2>${chatsHtml || '<p class="empty">— нет данных / no data —</p>'}</section>`);

  const templatesHtml = templates
    .map((t) => `<article class="card"><h3>${dash(t.title)}</h3><p class="meta">${dash(t.jurisdiction)} · ${fmtDate(t.createdAt)}</p><pre>${esc(t.content ?? '')}</pre></article>`)
    .join('');
  sections.push(`<section><h2>Сохранённые шаблоны · Saved templates (${templates.length})</h2>${templatesHtml || '<p class="empty">— нет данных / no data —</p>'}</section>`);

  const playbooksHtml = playbooks
    .map((p) => `<article class="card"><h3>${dash(p.name)}</h3><p class="meta">${dash(p.jurisdiction ?? 'все юрисдикции / all jurisdictions')}</p><ol>${(p.rules ?? [])
      .map((r: unknown) => `<li>${esc(r ?? '')}</li>`)
      .join('')}</ol></article>`)
    .join('');
  sections.push(`<section><h2>Плейбуки · Playbooks (${playbooks.length})</h2>${playbooksHtml || '<p class="empty">— нет данных / no data —</p>'}</section>`);

  sections.push(`<section><h2>Загруженные файлы · Uploads (${uploads.length})</h2>${table(
    ['Файл / File', 'Размер / Size', 'Дата / Date'],
    uploads.map((u) => [dash(u.fileName), fmtBytes(u.sizeBytes), fmtDate(u.createdAt)]),
  )}</section>`);

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Lexab — экспорт данных / data export</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 20px 60px; font: 15px/1.6 -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #22203a; background: #f6f4fb; }
  .page { max-width: 900px; margin: 0 auto; }
  header.top { margin-bottom: 28px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .sub { color: #6f6a8f; margin: 0; }
  h2 { font-size: 19px; margin: 34px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #8b7cf6; }
  h3 { font-size: 15.5px; margin: 0 0 4px; }
  .card { background: #fff; border: 1px solid #e3dff2; border-radius: 12px; padding: 14px 16px; margin: 0 0 12px; }
  .meta { color: #6f6a8f; font-size: 13px; margin: 0 0 8px; }
  .cite { color: #6f6a8f; }
  .msg { margin: 0 0 8px; white-space: pre-wrap; }
  .msg.user strong { color: #6a55e8; }
  .empty { color: #6f6a8f; }
  .twrap { overflow-x: auto; background: #fff; border: 1px solid #e3dff2; border-radius: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eeebf7; vertical-align: top; }
  th { background: #f1eefc; font-weight: 600; white-space: nowrap; }
  tr:last-child td { border-bottom: none; }
  pre { white-space: pre-wrap; word-break: break-word; background: #f6f4fb; border-radius: 8px; padding: 10px 12px; font: 13px/1.5 ui-monospace, Menlo, monospace; }
  footer { margin-top: 40px; color: #6f6a8f; font-size: 13px; }
</style>
</head>
<body>
<div class="page">
  <header class="top">
    <h1>Lexab — экспорт данных аккаунта</h1>
    <p class="sub">Account data export · ${fmtDate(data.exportedAt)} UTC</p>
  </header>
  ${sections.join('\n')}
  <footer>Файл создан автоматически по запросу владельца аккаунта. Машиночитаемая версия: кнопка экспорта с параметром ?format=json.</footer>
</div>
</body>
</html>`;
}
