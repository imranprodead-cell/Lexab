/**
 * Текст из старого формата Word (.doc, Word 97–2003) — аудит загрузок
 * 2026-10-18 (решение владельца: .doc читаем, а не отказываем).
 *
 * Раньше интерфейс обещал DOC, а сервер текста не доставал: файл сохранялся,
 * занимал место, и анализ падал с неверным «похоже, PDF-скан».
 *
 * .doc — составной файл OLE (CFB): внутри потоки WordDocument и 0Table/1Table.
 * Текст лежит кусками (piece table в Clx): каждый кусок — либо однобайтный
 * (кодовая страница 1252), либо UTF-16. Здесь собирается основной текст и
 * сноски; коды полей ({ PAGE }, { HYPERLINK … }) выбрасываются, их результат
 * остаётся; ячейки таблиц — через « | ».
 *
 * Чего нет: автонумерация пунктов (в .doc номера хранятся в свойствах списка,
 * а не в тексте), колонтитулы и надписи. Набранные руками номера — в тексте.
 *
 * Возвращает null, если файл не разобрать; бросает DocEncryptedError для
 * файла под паролем — вызывающий отвечает понятной подсказкой.
 */
import { looksRussian } from './format.ts';

export class DocEncryptedError extends Error {}

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;

/** Потоки корня составного файла (имя → байты). null — не CFB / повреждён. */
function readCfbRootStreams(buf: Buffer, wanted: string[]): Map<string, Buffer> | null {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xe011cfd0 || buf.readUInt32LE(4) !== 0xe11ab1a1) return null;
  const sectorShift = buf.readUInt16LE(0x1e);
  const miniShift = buf.readUInt16LE(0x20);
  if (sectorShift !== 9 && sectorShift !== 12) return null;
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const sectorCount = Math.floor((buf.length - sectorSize) / sectorSize) + 1;
  const sectorAt = (sid: number) => (sid + 1) * sectorSize;

  // FAT: номера её секторов — 109 в заголовке, дальше цепочка DIFAT. Секторов
  // FAT не может быть больше, чем секторов в файле, а цепочка DIFAT не может
  // ходить по кругу: иначе испорченный файл раздул бы таблицу до гигабайтов.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const sid = buf.readUInt32LE(0x4c + i * 4);
    if (sid !== FREESECT) fatSectors.push(sid);
  }
  const difatSeen = new Set<number>();
  let difat = buf.readUInt32LE(0x44);
  while (difat !== ENDOFCHAIN && difat !== FREESECT) {
    if (difatSeen.has(difat) || fatSectors.length > sectorCount) return null;
    difatSeen.add(difat);
    const off = sectorAt(difat);
    if (off + sectorSize > buf.length) return null;
    for (let i = 0; i < sectorSize / 4 - 1; i++) {
      const sid = buf.readUInt32LE(off + i * 4);
      if (sid !== FREESECT) fatSectors.push(sid);
    }
    difat = buf.readUInt32LE(off + sectorSize - 4);
  }
  if (fatSectors.length > sectorCount) return null;
  const fat: number[] = [];
  for (const sid of fatSectors) {
    const off = sectorAt(sid);
    if (off + sectorSize > buf.length) return null;
    for (let i = 0; i < sectorSize / 4; i++) fat.push(buf.readUInt32LE(off + i * 4));
  }

  const chain = (start: number, table: number[]): number[] => {
    const out: number[] = [];
    for (let sid = start; sid !== ENDOFCHAIN && sid !== FREESECT; sid = table[sid]) {
      if (sid >= table.length || out.length > table.length) return []; // цикл / битая цепочка
      out.push(sid);
    }
    return out;
  };
  const readChain = (start: number, size?: number): Buffer => {
    const parts = chain(start, fat).map((sid) => buf.subarray(sectorAt(sid), sectorAt(sid) + sectorSize));
    const all = Buffer.concat(parts);
    return size === undefined ? all : all.subarray(0, size);
  };

  // Каталог: записи по 128 байт.
  const dir = readChain(buf.readUInt32LE(0x30));
  const entry = (i: number) => {
    const o = i * 128;
    if (o + 128 > dir.length) return null;
    const nameLen = Math.min(64, dir.readUInt16LE(o + 64));
    return {
      name: dir.toString('utf16le', o, o + Math.max(0, nameLen - 2)),
      type: dir[o + 66],
      left: dir.readUInt32LE(o + 68),
      right: dir.readUInt32LE(o + 72),
      child: dir.readUInt32LE(o + 76),
      start: dir.readUInt32LE(o + 116),
      size: dir.readUInt32LE(o + 120),
    };
  };
  const root = entry(0);
  if (!root || root.type !== 5) return null;

  // Ministream (мелкие потоки < 4096 байт) — внутри потока корня.
  const miniCutoff = buf.readUInt32LE(0x38) || 4096;
  const miniStream = readChain(root.start, root.size);
  const miniFat: number[] = [];
  const miniFatBytes = readChain(buf.readUInt32LE(0x3c));
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(miniFatBytes.readUInt32LE(i));

  // Прямые потомки корня (вложенные объекты со своим WordDocument не берём).
  // Обход дерева — стеком, а не рекурсией: длинная цепочка записей в
  // испорченном файле не должна переполнять стек вызовов.
  const out = new Map<string, Buffer>();
  const seen = new Set<number>();
  const stack = [root.child];
  while (stack.length) {
    const id = stack.pop() as number;
    if (id === FREESECT || seen.has(id)) continue;
    if (seen.size > 10_000) return null;
    seen.add(id);
    const e = entry(id);
    if (!e) continue;
    stack.push(e.left, e.right);
    if (e.type === 2 && wanted.includes(e.name) && !out.has(e.name)) {
      if (e.size < miniCutoff) {
        const sids = chain(e.start, miniFat);
        out.set(e.name, Buffer.concat(sids.map((sid) => miniStream.subarray(sid * miniSize, (sid + 1) * miniSize))).subarray(0, e.size));
      } else {
        out.set(e.name, readChain(e.start, e.size));
      }
    }
  }
  return out;
}

const cp1252 = new TextDecoder('windows-1252');

/** Кусок текста: диапазон CP и где лежат его символы в потоке WordDocument. */
interface Piece {
  cpStart: number;
  cpEnd: number;
  fc: number;
  compressed: boolean;
}

/** Символы документа в диапазоне CP [from, to) по таблице кусков. */
function pieceText(word: Buffer, pieces: Piece[], from: number, to: number): string {
  let out = '';
  for (const p of pieces) {
    const a = Math.max(from, p.cpStart);
    const b = Math.min(to, p.cpEnd);
    if (a >= b) continue;
    const skip = a - p.cpStart;
    const len = b - a;
    if (p.compressed) {
      const off = p.fc / 2 + skip;
      if (off + len > word.length) return out;
      out += cp1252.decode(word.subarray(off, off + len));
    } else {
      const off = p.fc + skip * 2;
      if (off + len * 2 > word.length) return out;
      out += word.toString('utf16le', off, off + len * 2);
    }
  }
  return out;
}

/** Метка конца ячейки таблицы (0x07 в .doc) на время разбора. */
const CELL_END = '\uE007';

/** Служебные символы Word → обычный текст; коды полей выбрасываются.
 *  noteMark получает CP символа-ссылки 0x02 и возвращает метку «[n]».
 *  Экспортируется для теста. */
export function cleanStory(raw: string, noteMark: ((cp: number) => string) | null): string {
  let text = '';
  // Стек полей: true — внутри кода поля (до разделителя 0x14). Счётчик полей
  // «в коде» ведётся отдельно: проверка на каждом символе — O(1), иначе
  // миллион незакрытых полей в испорченном файле делал разбор квадратичным.
  const fields: boolean[] = [];
  let inCode = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const c = raw.charCodeAt(i);
    if (c === 0x13) {
      fields.push(true);
      inCode++;
      continue;
    }
    if (c === 0x14) {
      if (fields.length && fields[fields.length - 1]) {
        fields[fields.length - 1] = false;
        inCode--;
      }
      continue;
    }
    if (c === 0x15) {
      if (fields.pop()) inCode--;
      continue;
    }
    if (inCode > 0) continue;
    if (c === 0x02) text += noteMark ? noteMark(i) : '';
    else if (c === 0x0d) text += '\n\n';
    else if (c === 0x0b || c === 0x0c || c === 0x0e) text += '\n';
    else if (c === 0x07) text += CELL_END;
    else if (ch === CELL_END) continue; // такой символ в тексте спутал бы таблицу
    else if (c === 0x09) text += '\t';
    else if (c === 0x1e) text += '-';
    else if (c === 0xa0) text += ' ';
    else if (c < 0x20 || c === 0x1f) continue; // картинки, объекты, мягкий перенос
    else text += ch;
  }
  // Таблицы: каждая ячейка кончается 0x07, строка — ещё одним 0x07.
  return text
    .replace(/\uE007\uE007/g, '\n')
    .replace(/\uE007/g, ' | ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Clx → PlcPcd (таблица кусков). Блоки Prc (0x01) пропускаются, Pcdt (0x02) —
 * сама таблица. Размер Prc по стандарту неотрицательный: отрицательный в
 * испорченном файле не двигал бы разбор вперёд, и цикл вешал бы весь сервер.
 * Экспортируется для теста.
 */
export function readPlcPcd(table: Buffer, fc: number, lcb: number): Buffer | null {
  let pos = fc;
  const end = Math.min(fc + lcb, table.length);
  while (pos + 3 <= end) {
    const kind = table[pos];
    if (kind === 0x01) {
      const cb = table.readInt16LE(pos + 1);
      if (cb < 0) return null;
      pos += 3 + cb;
    } else if (kind === 0x02) {
      if (pos + 5 > table.length) return null;
      const size = table.readUInt32LE(pos + 1);
      return table.subarray(pos + 5, pos + 5 + size);
    } else {
      return null;
    }
  }
  return null;
}

export function docToText(buffer: Buffer): string | null {
  const streams = readCfbRootStreams(buffer, ['WordDocument', '0Table', '1Table']);
  const word = streams?.get('WordDocument');
  if (!streams || !word || word.length < 0x22 || word.readUInt16LE(0) !== 0xa5ec) return null;
  const nFib = word.readUInt16LE(2);
  const flags = word.readUInt16LE(0x0a);
  if (flags & 0x0100) throw new DocEncryptedError('encrypted .doc');
  if (nFib < 0xc0) return null; // Word 6/95 — другой формат кусков

  const csw = word.readUInt16LE(0x20);
  const lwStart = 0x22 + csw * 2 + 2;
  const cslw = word.readUInt16LE(0x22 + csw * 2);
  const fcLcbCountAt = lwStart + cslw * 4;
  if (fcLcbCountAt + 2 > word.length || cslw < 11) return null;
  const lw = (i: number) => word.readInt32LE(lwStart + i * 4);
  const ccpText = lw(3);
  const ccpFtn = lw(4);
  // Подтексты идут за основным текстом: сноски, колонтитулы, макросы, примечания, концевые сноски.
  const ednStart = ccpText + ccpFtn + lw(5) + lw(6) + lw(7);
  const ccpEdn = lw(8);
  const blob = fcLcbCountAt + 2;
  const fcLcb = (i: number) => ({ fc: word.readUInt32LE(blob + i * 8), lcb: word.readUInt32LE(blob + i * 8 + 4) });
  if (word.readUInt16LE(fcLcbCountAt) < 34 || blob + 34 * 8 > word.length) return null;

  const table = streams.get(flags & 0x0200 ? '1Table' : '0Table');
  const clx = fcLcb(33);
  if (!table || clx.fc + clx.lcb > table.length || ccpText <= 0) return null;

  const plc = readPlcPcd(table, clx.fc, clx.lcb);
  if (!plc || plc.length < 16) return null;
  const n = (plc.length - 4) / 12;
  if (!Number.isInteger(n)) return null;
  const pieces: Piece[] = [];
  for (let i = 0; i < n; i++) {
    const fcRaw = plc.readUInt32LE((n + 1) * 4 + i * 8 + 2);
    const compressed = (fcRaw & 0x40000000) !== 0;
    pieces.push({ cpStart: plc.readUInt32LE(i * 4), cpEnd: plc.readUInt32LE((i + 1) * 4), fc: fcRaw & 0x3fffffff, compressed });
  }

  // Сноски и концевые сноски. Ссылка на обе в тексте — один и тот же символ
  // 0x02, поэтому сноски опознаются по точным позициям (PlcffndRef), а
  // остальные 0x02 — концевые. Номера — по порядку появления в тексте (как в
  // DOCX): неверный номер хуже, чем никакого.
  const plcCps = (pair: number, max: number): number[] => {
    const { fc, lcb } = fcLcb(pair);
    if (!lcb || fc + lcb > table.length) return [];
    const cps: number[] = [];
    for (let k = 0; k < max && fc + k * 4 + 4 <= fc + lcb; k++) cps.push(table.readUInt32LE(fc + k * 4));
    return cps;
  };
  const story = (from: number, to: number) => cleanStory(pieceText(word, pieces, from, to), null).replace(/\s+/g, ' ').trim();
  const fndRefLcb = fcLcb(2).lcb;
  const footnoteCount = fndRefLcb >= 10 && (fndRefLcb - 4) % 6 === 0 ? (fndRefLcb - 4) / 6 : 0;
  const footnoteRefs = new Set(plcCps(2, footnoteCount));
  const footnoteBounds = plcCps(3, footnoteCount + 1);
  const footnoteTexts = footnoteBounds.slice(0, -1).map((cp, k) => story(ccpText + cp, ccpText + footnoteBounds[k + 1]));
  const endnoteTexts =
    ccpEdn > 0
      ? pieceText(word, pieces, ednStart, ednStart + ccpEdn)
          .split('\u0002')
          .slice(1)
          .map((s) => cleanStory(s, null).replace(/\s+/g, ' ').trim())
      : [];
  const notes: string[] = [];
  let nextFootnote = 0;
  let nextEndnote = 0;
  const body = cleanStory(pieceText(word, pieces, 0, ccpText), (cp) => {
    const text = footnoteRefs.has(cp) ? footnoteTexts[nextFootnote++] : endnoteTexts[nextEndnote++];
    if (!text) return '';
    notes.push(text);
    return `[${notes.length}]`;
  });
  if (!body) return null;
  if (!notes.length) return body;
  const title = looksRussian(body.slice(0, 2000)) ? 'Сноски' : 'Notes';
  return `${body}\n\n${title}:\n${notes.map((f, i) => `[${i + 1}] ${f}`).join('\n')}`;
}
