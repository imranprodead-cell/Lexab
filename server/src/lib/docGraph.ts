/**
 * Граф документов фирмы (этап 4, 2026-11-09; идея — «context graph» Harvey:
 * агенту нужно знать, какой документ к какому относится, прежде чем отвечать).
 *
 * Связи строятся КОДОМ из шапки документа, без ИИ и без хранения: на каждый
 * ответ — по тем документам, которые пользователь и так может открыть
 * (lib/firmMemory.ts). Узнаём:
 *  - допсоглашение: «Дополнительное соглашение № 2 к Договору поставки № 45
 *    от 12.03.2025» → к договору № 45 от 12.03.2025;
 *  - приложение / спецификацию: «Приложение № 1 к договору № 45…»;
 *  - версии одного договора: тот же номер и дата (проект и подписанный).
 * Сомнение → связи нет: договор ищем по номеру И дате; если у кого-то даты
 * нет — номер должен быть единственным среди договоров ИЛИ совпасть контрагент.
 * DOC_GRAPH=off — выключить (сравнение «до/после»).
 */

export type DocKind = 'contract' | 'amendment' | 'annex' | 'other';

export interface DocIdentity {
  kind: DocKind;
  /** Номер самого документа: договора — «45», допсоглашения — «2». */
  number?: string;
  /** Дата самого документа, YYYY-MM-DD. */
  date?: string;
  /** Для допсоглашения и приложения — на какой договор ссылается. */
  ref?: { number: string; date?: string };
}

const MONTHS: Record<string, string> = {
  январ: '01', феврал: '02', март: '03', апрел: '04', ма: '05', июн: '06',
  июл: '07', август: '08', сентябр: '09', октябр: '10', ноябр: '11', декабр: '12',
};

/** «12.03.2025», «12 марта 2025 г.», «“12” марта 2025 года» → 2025-03-12. */
export function normalizeDate(s: string): string | undefined {
  const num = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (num) return `${num[3]}-${num[2].padStart(2, '0')}-${num[1].padStart(2, '0')}`;
  const word = s.match(/(\d{1,2})\s*[»"”]?\s*([А-Яа-яЁё]+)\s+(\d{4})/u);
  if (word) {
    const stem = Object.keys(MONTHS).find((k) => word[2].toLowerCase().startsWith(k));
    if (stem) return `${word[3]}-${MONTHS[stem]}-${word[1].padStart(2, '0')}`;
  }
  return undefined;
}

const NUM = String.raw`№\s*([0-9A-Za-zА-Яа-яЁё][0-9A-Za-zА-Яа-яЁё/\-]{0,15})`;
const DATE = String.raw`(?:\s*от\s*[«"“]?\s*(\d{1,2}[./]\d{1,2}[./]\d{4}|\d{1,2}\s*[»"”]?\s*[А-Яа-яЁё]+\s+\d{4}))?`;
const normNum = (n: string) => n.replace(/[.,;:)]+$/u, '').toUpperCase();

/** Что это за документ — по названию файла и первым строкам текста. */
export function docIdentity(name: string, text: string): DocIdentity {
  const head = `${name}\n${text.slice(0, 1500)}`.replace(/\s+/g, ' ');
  const KEY = String.raw`(дополнительн\S*\s+соглашени\S*|доп\.?\s*соглашени\S*|допсоглашени\S*|приложени\S*|спецификаци\S*)`;
  const TAIL = String.raw`[^.]{0,60}?\s+к\s+договор\S*[^№.]{0,60}?${NUM}${DATE}`;
  // Сначала шапка со СВОИМ номером («Приложение № 1 … к договору № 45»), потом
  // без него: иначе слово «Спецификация» в имени файла перехватит совпадение.
  const m = head.match(new RegExp(String.raw`${KEY}\s*${NUM}${TAIL}`, 'iu')) ?? head.match(new RegExp(String.raw`${KEY}\s*()${TAIL}`, 'iu'));
  // Только шапка (название файла и начало текста): в теле договора «Приложение
  // № 1 к Договору № 45 является его неотъемлемой частью» — не делает договор
  // приложением.
  if (m && (m.index ?? 0) <= name.length + 250) {
    const kind: DocKind = /приложени|спецификаци/iu.test(m[1]) ? 'annex' : 'amendment';
    return {
      kind,
      ...(m[2] ? { number: normNum(m[2]) } : {}),
      ref: { number: normNum(m[3]), ...(m[4] ? { date: normalizeDate(m[4]) } : {}) },
    };
  }
  const c = head.match(new RegExp(String.raw`договор\S*[^№.]{0,60}?${NUM}${DATE}`, 'iu'));
  if (c) return { kind: 'contract', number: normNum(c[1]), ...(c[2] ? { date: normalizeDate(c[2]) } : {}) };
  return { kind: 'other' };
}

export interface GraphDoc {
  id: string;
  name: string;
  counterparty: string;
  status: string;
  updated: string;
  text: string;
}

export interface DocRelations {
  /** Договор, к которому относится допсоглашение/приложение. */
  base?: string;
  /** Допсоглашения к этому договору (по номеру). */
  amendments: string[];
  annexes: string[];
  /** Другие файлы того же договора (проект, подписанный…). */
  versions: string[];
}

const normParty = (s: string) => s.toLowerCase().replace(/[«»"“”'ʼ`.,]/gu, '').replace(/\s+/g, ' ').trim();

/** Связи между документами пользователя. */
export function buildDocGraph(docs: GraphDoc[]): { identity: Map<string, DocIdentity>; relations: Map<string, DocRelations> } {
  const identity = new Map(docs.map((d) => [d.id, docIdentity(d.name, d.text)]));
  const relations = new Map(docs.map((d) => [d.id, { amendments: [], annexes: [], versions: [] } as DocRelations]));
  if (process.env.DOC_GRAPH === 'off') return { identity, relations };
  const contracts = docs.filter((d) => identity.get(d.id)?.kind === 'contract');
  const party = new Map(docs.map((d) => [d.id, normParty(d.counterparty)]));

  /** Договоры с этим номером, подходящие по дате; при сомнении — по контрагенту. */
  const contractsFor = (number: string, date: string | undefined, counterparty: string): GraphDoc[] => {
    const sameNumber = contracts.filter((c) => identity.get(c.id)?.number === number);
    const byDate = sameNumber.filter((c) => {
      const cd = identity.get(c.id)?.date;
      return date && cd ? cd === date : false;
    });
    if (byDate.length) return byDate;
    const undated = sameNumber.filter((c) => !(date && identity.get(c.id)?.date));
    if (counterparty) {
      const byParty = undated.filter((c) => party.get(c.id) === counterparty);
      if (byParty.length) return byParty;
    }
    // Номер без даты и контрагента — только если такой договор один.
    return undated.length === 1 ? undated : [];
  };

  // Версии: договоры с одним номером и датой (или одним номером и контрагентом).
  for (const c of contracts) {
    const id = identity.get(c.id)!;
    const same = contractsFor(id.number!, id.date, party.get(c.id) ?? '').filter((o) => o.id !== c.id);
    relations.get(c.id)!.versions.push(...same.map((o) => o.id));
  }
  // Допсоглашения и приложения → к каждой версии договора.
  for (const d of docs) {
    const id = identity.get(d.id)!;
    if (!id.ref || (id.kind !== 'amendment' && id.kind !== 'annex')) continue;
    const bases = contractsFor(id.ref.number, id.ref.date, party.get(d.id) ?? '');
    if (!bases.length) continue;
    // Основа — подписанная версия, если она есть, иначе самая свежая.
    const base = [...bases].sort((a, b) => Number(b.status === 'Signed') - Number(a.status === 'Signed') || b.updated.localeCompare(a.updated))[0];
    relations.get(d.id)!.base = base.id;
    for (const b of bases) (id.kind === 'amendment' ? relations.get(b.id)!.amendments : relations.get(b.id)!.annexes).push(d.id);
  }
  // Допсоглашения — по номеру (№ 1, № 2, …): последнее — последним.
  const order = (a: string, b: string) => (Number(identity.get(a)?.number) || 0) - (Number(identity.get(b)?.number) || 0);
  for (const r of relations.values()) {
    r.amendments.sort(order);
    r.annexes.sort(order);
  }
  return { identity, relations };
}

/** Строки «связанные документы» для модели (пусто — связей нет). */
export function relatedLines(docId: string, graph: ReturnType<typeof buildDocGraph>, byId: Map<string, GraphDoc>): string[] {
  const r = graph.relations.get(docId);
  if (!r) return [];
  const label = (id: string) => {
    const d = byId.get(id);
    return d ? `[${id}] «${d.name}» (status ${d.status})` : `[${id}]`;
  };
  const lines: string[] = [];
  if (r.base) lines.push(`part of the contract ${label(r.base)}`);
  if (r.versions.length) lines.push(`other versions of the same contract: ${r.versions.map(label).join('; ')}`);
  if (r.amendments.length) lines.push(`amendments (in order, the last one is the latest): ${r.amendments.map(label).join('; ')}`);
  if (r.annexes.length) lines.push(`annexes: ${r.annexes.map(label).join('; ')}`);
  return lines;
}
