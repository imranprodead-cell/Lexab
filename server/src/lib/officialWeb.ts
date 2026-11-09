/**
 * Официальные сайты для агента (решение владельца 2026-11-09): когда нужного
 * акта нет в проверенной базе Lexab, агент ищет его на lex.uz и читает
 * страницы официальных баз законов и сайтов госорганов.
 *
 * Правила:
 *  - только https и только хосты из белого списка (OFFICIAL_HOSTS); переадресация
 *    вне списка — отказ (защита от SSRF), потолок размера и времени;
 *  - текст с сайта НЕ попадает в корпус законов (правило 1 CLAUDE.md: корпус —
 *    только через ингест) — он уходит модели в ответ с пометкой «с официального
 *    сайта, не из проверенной базы Lexab»;
 *  - предупреждения lex.uz («утратил силу», «изложен в новой редакции», «текст на
 *    узбекском языке») передаются модели как есть.
 * Чистые функции разбора — покрыты тестами (test/official-web.test.ts).
 */
import { scorePassages, stemsOf } from './firmMemory.ts';

/** Официальные базы законов (тот же белый список, что у ингеста) и сайты госорганов. */
export const OFFICIAL_HOSTS = [
  // Узбекистан: база законов и госорганы
  'lex.uz', 'gov.uz', 'president.uz', 'cbu.uz', 'soliq.uz', 'mf.uz', 'adliya.uz', 'minjust.uz',
  'mehnat.uz', 'customs.uz', 'stat.uz', 'supcourt.uz', 'sud.uz', 'senat.uz', 'my.gov.uz',
  // Официальные базы других стран корпуса
  'adilet.zan.kz', 'legislation.gov.uk', 'caselaw.nationalarchives.gov.uk', 'gesetze-im-internet.de',
  'govinfo.gov', 'legisquebec.gouv.qc.ca', 'uaelegislation.gov.ae',
];

/** Хост разрешён: точное совпадение, поддомен разрешённого или любой *.gov.uz. */
export function isOfficialHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]+$/.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
  return h.endsWith('.gov.uz') || OFFICIAL_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Проверенный URL официального сайта или null. http → https. */
export function officialUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/^http:\/\//i, 'https://'));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  return isOfficialHost(u.hostname) ? u : null;
}

const UA = 'Mozilla/5.0 (compatible; LexabBot/1.0; +https://lexabai.com)';
const MAX_BYTES = 3_000_000;

/** Скачать страницу официального сайта: переадресации — только внутри списка. */
export async function fetchOfficial(raw: string, timeoutMs = 12_000): Promise<{ url: string; html: string }> {
  let url = officialUrl(raw);
  if (!url) throw new Error('not an official site from the allowed list');
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 300 && res.status < 400) {
      const next = officialUrl(new URL(res.headers.get('location') ?? '', url).toString());
      if (!next) throw new Error('redirect outside the allowed official sites');
      url = next;
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) throw new Error('page too large');
    const html = (await res.text()).slice(0, MAX_BYTES);
    return { url: url.toString(), html };
  }
  throw new Error('too many redirects');
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
const strip = (s: string) => decode(s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export interface LexSearchHit {
  title: string;
  /** «Постановление Кабинета Министров Республики Узбекистан, от 21.06.2023 г. № 253» */
  act: string;
  inForce: boolean;
  url: string;
}

/** Результаты поиска lex.uz: строки таблицы с иконкой статуса, ссылкой и видом акта. */
export function parseLexSearch(html: string, limit = 8): LexSearchHit[] {
  const out: LexSearchHit[] = [];
  const rows = html.split('<tr class="dd-table__main-item">').slice(1);
  for (const row of rows) {
    const link = row.match(/<a class="lx_link\s*" href="(\/(?:ru\/)?docs\/-?\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const act = row.match(/<span class="badge[^"]*">([\s\S]*?)<\/span>/);
    out.push({
      title: strip(link[2]),
      act: act ? strip(act[1]) : '',
      inForce: /status_code_y/.test(row),
      url: `https://lex.uz${link[1].startsWith('/ru/') ? link[1] : `/ru${link[1]}`}`,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchLexUz(query: string, limit = 8): Promise<LexSearchHit[]> {
  const { html } = await fetchOfficial(`https://lex.uz/ru/search/nat?query=${encodeURIComponent(query.slice(0, 200))}`);
  return parseLexSearch(html, limit);
}

/* ── Акты с официальных сайтов во вкладке Sources (как нормы из базы) ──── */

/** Строка вкладки Sources для акта с официального сайта. */
export interface OfficialActRef {
  /** «ПКМ № 428 от 31.08.2023», «УП-157 от 08.09.2025» — как «Статья 333» у нормы из базы. */
  label: string;
  /** Название акта: «О мерах по …» (или сайт, если названия нет). */
  doc: string;
  url: string;
  /** Номер акта — по нему видно, что ответ называет этот акт: «428», «УП-157», «2303-7». */
  number: string | null;
}

/** Вид акта → короткое имя (номера без буквенного кода: «№ 428», «рег. номер 2303-7»). */
const ACT_KINDS: [RegExp, string][] = [
  [/^Постановление\s+Кабинета\s+Министров/iu, 'ПКМ'],
  [/^Распоряжение\s+Кабинета\s+Министров/iu, 'РКМ'],
  [/^Постановление\s+Пленума\s+Верховного\s+суда/iu, 'Пленум ВС'],
  [/^Постановление\s+Пленума\s+Высшего\s+хозяйственного/iu, 'Пленум ВХС'],
  [/^Постановление\s+Правления\s+Центрального\s+банка/iu, 'ЦБ'],
  [/^Указ/iu, 'Указ'],
  [/^Постановление\s+Президента/iu, 'ПП'],
  [/^Распоряжение/iu, 'Распоряжение'],
  [/^Закон/iu, 'Закон'],
  [/^Кодекс/iu, 'Кодекс'],
  [/^Приказ/iu, 'Приказ'],
  [/^Постановление/iu, 'Постановление'],
  [/^Решение/iu, 'Решение'],
  // Узбекские шапки (оригинал, когда русского текста нет).
  [/Вазирлар\s+Маҳкамаси/iu, 'ПКМ'],
];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Вид, номер и дата из строки поиска lex.uz («Постановление Кабинета Министров
 * Республики Узбекистан, от 31.08.2023 г. № 428») → «ПКМ № 428 от 31.08.2023».
 * Номер с буквенным кодом — без вида: «УП-157 от 08.09.2025», «ЗРУ-913 …».
 * Не разобрали — null (подписью станет название акта).
 */
export function shortActName(act: string): { label: string; number: string | null } | null {
  const a = act.replace(/\s+/g, ' ').trim();
  if (!a) return null;
  const date = a.match(/(?<!\d)(\d{2}\.\d{2}\.\d{4})(?!\d)/)?.[1] ?? null;
  const reg = a.match(/рег\.\s*номер\s*([^\s,;]+)/iu)?.[1];
  // Узбекская строка: «…, 23.11.2023 йилдаги ПҚ-373-сон».
  const raw = reg ?? a.match(/№\s*([^\s,;]+)/u)?.[1] ?? a.match(/(\p{L}{1,5}-\d[\d-]*?)-сон(?!\p{L})/u)?.[1] ?? null;
  const num = raw ? raw.replace(/[.)]+$/u, '') : null;
  const kind = ACT_KINDS.find(([re]) => re.test(a))?.[1] ?? null;
  const when = date ? ` от ${date}` : '';
  let label: string;
  if (num && /^\p{L}{1,5}-\d/u.test(num)) label = `${num}${when}`;
  else if (num && reg) label = `${kind ?? 'Акт'}, рег. № ${num}${when}`;
  else if (num) label = `${kind ?? 'Акт'} № ${num}${when}`;
  else if (kind && date) label = `${kind}${when}`;
  else return null;
  return { label, number: num };
}

/** id документа lex.uz из адреса: https://lex.uz/ru/docs/6591660 → «6591660». */
export function lexDocId(url: string): string | null {
  return url.match(/(?:^|\/\/)(?:www\.)?lex\.uz\/(?:[a-z]{2}\/)?docs\/(-?\d+)/i)?.[1] ?? null;
}

/** Результат поиска lex.uz → строка Sources. */
export function officialActRef(hit: LexSearchHit): OfficialActRef {
  const title = hit.title.replace(/\s+/g, ' ').trim();
  const short = shortActName(hit.act);
  return short
    ? { label: short.label, doc: clip(title || hit.act, 60), url: hit.url, number: short.number }
    : { label: clip(title || 'lex.uz', 40), doc: 'lex.uz', url: hit.url, number: null };
}

/** Буквенные коды одного вида акта по-русски и по-узбекски (кириллица и латиница). */
const CODE_ALIASES: string[][] = [
  ['УП', 'ПФ', 'PF', 'UP'],
  ['ПП', 'ПҚ', 'ПК', 'PQ', 'PP'],
  ['ЗРУ', 'ЎРҚ', 'ORQ', 'O‘RQ', "O'RQ", 'OʻRQ', 'ZRU'],
  ['РП', 'Ф', 'F'],
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Называет ли ответ этот акт: ссылкой на его страницу lex.uz или номером —
 * «УП-157» (и узбекское «ПФ-157»), «№ 428», «ПКМ-428», «рег. № 2303-7».
 * Акты из поиска, которые ответ не называет, в Sources не идут — как нормы
 * из базы, которые лишь всплыли в поиске.
 */
export function mentionsOfficialAct(reply: string, act: { url: string; number: string | null }): boolean {
  const id = lexDocId(act.url);
  if (id && new RegExp(`docs/${esc(id)}(?!\\d)`).test(reply)) return true;
  if (!act.number) return false;
  const end = '(?![\\p{L}\\d]|[-–]\\d)';
  const coded = act.number.match(/^(\p{L}{1,5})-(\d.*)$/u);
  if (coded) {
    const code = coded[1].toUpperCase();
    const codes = CODE_ALIASES.find((g) => g.includes(code)) ?? [code];
    const digits = esc(coded[2]).replace(/-/g, '[-–]');
    return new RegExp(`(?<![\\p{L}\\d])(?:${codes.map(esc).join('|')})\\s?[-–]\\s?${digits}${end}`, 'iu').test(reply);
  }
  const n = esc(act.number).replace(/-/g, '[-–]');
  return new RegExp(`(?:№|No\\.?)\\s?${n}${end}|(?<![\\p{L}\\d])\\p{L}{2,5}\\s?[-–]\\s?${n}${end}|рег\\.?\\s*(?:номер|№)\\s*${n}${end}`, 'iu').test(reply);
}

export interface LexPage {
  title: string;
  /** Предупреждения lex.uz: «утратил силу», «в новой редакции», «на узбекском языке». */
  warnings: string[];
  /** Ссылка на оригинал на узбекском, если русского текста нет. */
  originalUrl?: string;
  /** Вид, орган, дата и номер — как в поиске lex.uz: «Постановление Кабинета
   *  Министров Республики Узбекистан, от 31.08.2023 г. № 428» (или ''). */
  act: string;
  text: string;
}

/** Текст акта со страницы lex.uz: блоки «… lx_elem» с внутренним <div name id>. */
export function parseLexPage(html: string): LexPage {
  const head = (cls: string) => strip(html.match(new RegExp(`<div class="${cls}[" ][\\s\\S]*?<div name="\\d+" id="\\d+">([\\s\\S]*?)<\\/div>`))?.[1] ?? '');
  const title = head('ACT_TITLE');
  // Шапка акта: «Постановление» + «Кабинета Министров Республики Узбекистан»;
  // дата и номер — из строки «от 05.10.2020 г. № УП-9999» или из заголовка
  // вкладки «428-сон 31.08.2023. О мерах…».
  const kind = [head('ACT_FORM'), head('ACCEPTING_BODY')].filter(Boolean).join(' ');
  const num = strip(html.match(/class="ACT_NUM"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '');
  const tab = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').match(/([^\s;]+?)-сон\s+(\d{2}\.\d{2}\.\d{4})/u);
  const numbered = /№/.test(num) ? num : tab ? `от ${tab[2]} г. № ${tab[1]}` : '';
  const act = numbered ? [kind, numbered].filter(Boolean).join(', ') : '';
  const warnings: string[] = [];
  let originalUrl: string | undefined;
  for (const m of html.matchAll(/class="COMMENT_FOR_WARNING"[^>]*>([\s\S]*?)<\/div>/g)) {
    const w = strip(m[1]);
    if (w) warnings.push(w);
    const orig = /узбекском/i.test(w) ? m[1].match(/href="(\/(?:ru\/)?docs\/-?\d+)"/) : null;
    if (orig) originalUrl = `https://lex.uz${orig[1]}`;
  }
  const blocks: string[] = [];
  const re = /<div class="([A-Z_]+)(?: lx_elem)?"[^>]*>(?:(?!<div class="[A-Z_]+(?: lx_elem)?")[\s\S])*?<div name="(\d+)" id="\2">([\s\S]*?)<\/div>/g;
  for (const m of html.matchAll(re)) {
    if (m[1] === 'COMMENT_FOR_WARNING' || m[1].startsWith('INDEXES')) continue;
    const t = strip(m[3]);
    if (t) blocks.push(t);
  }
  return { title, warnings, ...(originalUrl ? { originalUrl } : {}), act, text: blocks.join('\n') };
}

/** Текст обычной страницы госоргана: <main>/<article>, иначе <body>. */
export function pageText(html: string): { title: string; text: string } {
  const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const main = html.match(/<(main|article)\b[\s\S]*?<\/\1>/i)?.[0] ?? html.match(/<body\b[\s\S]*?<\/body>/i)?.[0] ?? html;
  const cleaned = main.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n');
  const text = decode(cleaned.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return { title, text };
}

/** Самое нужное из длинного текста: по запросу — лучшие фрагменты, иначе начало. */
export function excerpt(text: string, query: string | undefined, max = 6000): string {
  if (query) {
    const top = scorePassages(text, stemsOf(query))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .sort((a, b) => a.start - b.start);
    if (top.length) return top.map((p) => p.text).join('\n…\n').slice(0, max);
  }
  return text.length > max ? `${text.slice(0, max)}\n[…cut — pass a query to get the relevant part]` : text;
}

/* ── Пометка об источнике в ответе (код, не просьба к модели) ──────────── */

type ReplyLang = 'ru' | 'en' | 'uz' | 'kk' | 'de' | 'ar';

/** Язык ответа по самому тексту — для строки-пометки на том же языке. */
export function replyLanguage(text: string): ReplyLang {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const cyr = (text.match(/[А-Яа-яЁёЎўҚқҒғҲҳӘәҢңӨөҰұҮүҺһІі]/g) ?? []).length;
  const lat = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic > cyr && arabic > lat) return 'ar';
  if (cyr >= lat) {
    if (/[ӘәҢңӨөҰұҮүҺһІі]/.test(text)) return 'kk';
    if (/[Ўў]/.test(text) || /\b(ва|бўйича|учун)\b/iu.test(text)) return 'uz';
    return 'ru';
  }
  if (/[oOgG][ʻ'’`]|\b(va|bo['ʻ]yicha|uchun|qonun)\b/iu.test(text)) return 'uz';
  if (/[äöüß]|\b(und|der|die|das|nicht)\b/i.test(text)) return 'de';
  return 'en';
}

const OFFICIAL_NOTE: Record<ReplyLang, string> = {
  ru: 'ℹ️ Часть сведений взята с официальных сайтов ({hosts}), а не из проверенной базы Lexab. Сверьте по ссылке перед использованием.',
  en: 'ℹ️ Some information comes from official websites ({hosts}), not from Lexab\'s verified database. Check it via the link before relying on it.',
  uz: 'ℹ️ Ayrim maʼlumotlar rasmiy saytlardan ({hosts}) olingan, Lexab tekshirilgan bazasidan emas. Foydalanishdan oldin havola orqali tekshiring.',
  kk: 'ℹ️ Кейбір мәліметтер ресми сайттардан ({hosts}) алынған, Lexab тексерілген базасынан емес. Пайдаланбас бұрын сілтеме арқылы тексеріңіз.',
  de: 'ℹ️ Einige Angaben stammen von offiziellen Websites ({hosts}), nicht aus der geprüften Lexab-Datenbank. Bitte vor der Verwendung über den Link prüfen.',
  ar: 'ℹ️ بعض المعلومات مأخوذة من مواقع رسمية ({hosts}) وليست من قاعدة بيانات Lexab الموثقة. يُرجى التحقق عبر الرابط قبل الاعتماد عليها.',
};

/**
 * Строка в конец ответа, если агент брал сведения с официальных сайтов.
 * links — акты, на которые ответ опирается: «Сверьте по ссылке…» получает сами
 * ссылки (кодом, а не на усмотрение модели — она их часто не пишет).
 */
export function officialSourceNote(reply: string, hosts: Iterable<string>, links: { label: string; url: string }[] = []): string {
  const list = [...new Set(hosts)].slice(0, 4).join(', ');
  if (!list) return '';
  const note = OFFICIAL_NOTE[replyLanguage(reply)].replace('{hosts}', list);
  const md = links
    .slice(0, 4)
    .map((l) => `[${l.label.replace(/[[\]]/g, '')}](${l.url.replace(/\(/g, '%28').replace(/\)/g, '%29')})`)
    .join(', ');
  return md ? `${note.replace(/\.\s*$/u, '')}: ${md}.` : note;
}
