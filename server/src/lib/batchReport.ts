/**
 * Сводный отчёт массового разбора — один самодостаточный HTML-файл:
 * все договоры пачки, отсортированные по риску, с топ-находками каждого.
 * Это «дью-дилидженс дельиверабл»: то, что юрист кладёт клиенту на стол.
 * Стиль и подход — как у lib/exportHtml.ts (всё экранируется, без внешних
 * ресурсов, печатается в PDF средствами браузера).
 */

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface BatchReportItem {
  fileName: string;
  status: string;
  riskScore: number | null;
  riskLevel: string | null;
  findingsCount: number | null;
  error: string | null;
  topFindings: { severity: string; title: string; citation: string; verified: boolean }[];
}

export interface BatchReportData {
  jobId: string;
  createdAt: string;
  jurisdiction: string | null;
  ownerName: string;
  ownerFirm: string;
  items: BatchReportItem[];
}

const LEVEL_COLOR: Record<string, string> = { High: '#c0392b', Elevated: '#b9770e', Low: '#1e8449' };
const LEVEL_RU: Record<string, string> = { High: 'Высокий', Elevated: 'Повышенный', Low: 'Низкий' };
const SEV_RU: Record<string, string> = { High: 'Высокая', Medium: 'Средняя', Low: 'Низкая' };

export function renderBatchReportHtml(data: BatchReportData): string {
  const done = data.items.filter((i) => i.status === 'done' && i.riskScore !== null);
  const failed = data.items.filter((i) => i.status !== 'done');
  const sorted = [...done].sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
  const avg = done.length ? Math.round(done.reduce((s, i) => s + (i.riskScore ?? 0), 0) / done.length) : 0;
  const high = done.filter((i) => i.riskLevel === 'High').length;
  const findingsTotal = done.reduce((s, i) => s + (i.findingsCount ?? 0), 0);

  const rows = sorted
    .map((i, idx) => {
      const tone = LEVEL_COLOR[i.riskLevel ?? ''] ?? '#555';
      const tf = i.topFindings
        .map(
          (f) =>
            `<li><span class="sev" style="color:${LEVEL_COLOR[f.severity === 'Medium' ? 'Elevated' : f.severity] ?? '#555'}">${esc(SEV_RU[f.severity] ?? f.severity)}</span> ${esc(f.title)} <span class="cite">${esc(f.citation)}${f.verified ? ' ✓' : ''}</span></li>`,
        )
        .join('');
      return `<tr>
        <td class="num">${idx + 1}</td>
        <td><strong>${esc(i.fileName)}</strong>${tf ? `<ul class="tf">${tf}</ul>` : ''}</td>
        <td class="score" style="color:${tone}">${i.riskScore}</td>
        <td style="color:${tone}">${esc(LEVEL_RU[i.riskLevel ?? ''] ?? i.riskLevel ?? '—')}</td>
        <td class="num">${i.findingsCount ?? 0}</td>
      </tr>`;
    })
    .join('');

  const failedRows = failed
    .map((i) => `<tr><td colspan="2"><strong>${esc(i.fileName)}</strong></td><td colspan="3" class="err">${esc(i.error ?? i.status)}</td></tr>`)
    .join('');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lexab — сводный отчёт разбора</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; margin: 0; background: #f6f6f8; color: #16181d; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 40px 24px 64px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .sub { color: #6b7078; margin: 0 0 24px; font-size: 14px; }
  .tiles { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 28px; }
  .tile { background: #fff; border: 1px solid #e3e5ea; border-radius: 12px; padding: 14px 20px; min-width: 140px; }
  .tile b { display: block; font-size: 22px; }
  .tile span { color: #6b7078; font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e3e5ea; border-radius: 12px; overflow: hidden; }
  th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7078; padding: 10px 12px; border-bottom: 1px solid #e3e5ea; }
  td { padding: 12px; border-bottom: 1px solid #eef0f3; vertical-align: top; font-size: 14px; }
  td.num, td.score { text-align: center; white-space: nowrap; }
  td.score { font-weight: 700; font-size: 16px; }
  ul.tf { margin: 8px 0 0; padding-inline-start: 18px; color: #40454d; font-size: 13px; }
  ul.tf li { margin-bottom: 3px; }
  .sev { font-weight: 600; }
  .cite { color: #6b7078; font-family: ui-monospace, monospace; font-size: 12px; }
  .err { color: #c0392b; font-size: 13px; }
  .foot { margin-top: 28px; color: #8a8f98; font-size: 12.5px; }
  @media print { body { background: #fff; } .wrap { padding: 0; } }
</style>
</head>
<body>
<div class="wrap">
  <h1>Сводный отчёт массового разбора</h1>
  <p class="sub">${esc(data.ownerFirm)} · ${esc(data.ownerName)} · ${esc(new Date(data.createdAt).toLocaleDateString('ru-RU'))}${data.jurisdiction ? ` · ${esc(data.jurisdiction)}` : ''} · задание ${esc(data.jobId)}</p>
  <div class="tiles">
    <div class="tile"><b>${done.length}</b><span>договоров разобрано</span></div>
    <div class="tile"><b style="color:${high ? '#c0392b' : '#1e8449'}">${high}</b><span>с высоким риском</span></div>
    <div class="tile"><b>${avg}</b><span>средний балл риска</span></div>
    <div class="tile"><b>${findingsTotal}</b><span>находок всего</span></div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Договор и ключевые находки</th><th>Балл</th><th>Риск</th><th>Находки</th></tr></thead>
    <tbody>${rows}${failedRows}</tbody>
  </table>
  <p class="foot">Сформировано в Lexab. Цитаты с отметкой ✓ подтверждены по базе официальных источников законодательства. Отчёт носит информационный характер и не является юридическим заключением.</p>
</div>
</body>
</html>`;
}
