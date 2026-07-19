/**
 * Арабский шейпинг для PDF-отчётов. pdf-lib не умеет ни contextual shaping,
 * ни bidi — без этого арабский текст выходит разорванными изолированными
 * буквами в зеркальном порядке. Здесь минимально-достаточная реализация:
 *
 *  1. shapeArabic()  — логический текст → презентационные формы Unicode
 *     (U+FE70–FEFF: isolated/final/initial/medial + лигатуры лам-алеф);
 *     NotoNaskhArabic содержит все эти глифы (проверено fontkit'ом).
 *  2. toVisualRtl()  — строка в визуальный RTL-порядок для отрисовки слева
 *     направо: разворот с сохранением LTR-вкраплений (латиница/цифры) и
 *     зеркалированием скобок.
 *
 * Диакритика (харакаты) прозрачна для соединения. Этого достаточно для
 * договорного текста; каллиграфические лигатуры вне охвата.
 */

// [isolated, final, initial, medial] — отсутствующие формы = undefined.
const FORMS: Record<number, [number, number?, number?, number?]> = {
  0x0621: [0xfe80],
  0x0622: [0xfe81, 0xfe82],
  0x0623: [0xfe83, 0xfe84],
  0x0624: [0xfe85, 0xfe86],
  0x0625: [0xfe87, 0xfe88],
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c],
  0x0627: [0xfe8d, 0xfe8e],
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92],
  0x0629: [0xfe93, 0xfe94],
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98],
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c],
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0],
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4],
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8],
  0x062f: [0xfea9, 0xfeaa],
  0x0630: [0xfeab, 0xfeac],
  0x0631: [0xfead, 0xfeae],
  0x0632: [0xfeaf, 0xfeb0],
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4],
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8],
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc],
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0],
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4],
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8],
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc],
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0],
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4],
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8],
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc],
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0],
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4],
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8],
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec],
  0x0648: [0xfeed, 0xfeee],
  0x0649: [0xfeef, 0xfef0],
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4],
};

// Лам (0644) + алеф-варианты → обязательные лигатуры [isolated, final].
const LAM_ALEF: Record<number, [number, number]> = {
  0x0622: [0xfef5, 0xfef6],
  0x0623: [0xfef7, 0xfef8],
  0x0625: [0xfef9, 0xfefa],
  0x0627: [0xfefb, 0xfefc],
};

/** Буквы, соединяющиеся в обе стороны (есть initial/medial-формы). */
const isDual = (cp: number): boolean => (FORMS[cp]?.length ?? 0) === 4;
/** Любая соединяемая буква (принимает соединение справа). */
const isJoinable = (cp: number): boolean => cp in FORMS && cp !== 0x0621;
/** Прозрачные для соединения: харакаты и пр. комбинируемые знаки. */
const isTransparent = (cp: number): boolean => (cp >= 0x064b && cp <= 0x065f) || cp === 0x0670;

export function hasArabic(s: string): boolean {
  return /[؀-ۿﭐ-﷿ﹰ-﻿]/.test(s);
}

/** Логический арабский текст → презентационные формы (порядок не меняется). */
export function shapeArabic(text: string): string {
  const cps = [...text].map((c) => c.codePointAt(0) as number);
  const out: number[] = [];

  const prevLetter = (i: number): number | null => {
    for (let j = i - 1; j >= 0; j--) {
      if (isTransparent(cps[j])) continue;
      return cps[j] in FORMS ? cps[j] : null;
    }
    return null;
  };
  const nextLetter = (i: number): number | null => {
    for (let j = i + 1; j < cps.length; j++) {
      if (isTransparent(cps[j])) continue;
      return cps[j] in FORMS ? cps[j] : null;
    }
    return null;
  };

  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (!(cp in FORMS)) {
      out.push(cp);
      continue;
    }
    const prev = prevLetter(i);
    const joinsPrev = prev !== null && isDual(prev);

    // Обязательная лигатура лам-алеф.
    if (cp === 0x0644) {
      const next = nextLetter(i);
      if (next !== null && next in LAM_ALEF) {
        const [iso, fin] = LAM_ALEF[next];
        out.push(joinsPrev ? fin : iso);
        // Пропустить сам алеф (и прозрачные между ними уже позади next-поиска
        // быть не могут — лам-алеф в договорном тексте смежные).
        i = cps.indexOf(next, i + 1);
        continue;
      }
    }

    const next = nextLetter(i);
    const joinsNext = isDual(cp) && next !== null && isJoinable(next);
    const [iso, fin, ini, med] = FORMS[cp];
    out.push(joinsPrev && joinsNext ? (med ?? fin ?? iso) : joinsPrev ? (fin ?? iso) : joinsNext ? (ini ?? iso) : iso);
  }
  return String.fromCodePoint(...out);
}

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' };
const AR_CHAR = /[؀-ۿﭐ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-z0-9À-ɏ]/;

/** Строка (уже в презентационных формах) → визуальный порядок для LTR-отрисовки.
 *  Упрощённый bidi: токены → сильные направления → нейтралы по соседям →
 *  разворот порядка токенов; внутри RTL-токенов разворот символов + зеркала
 *  скобок; LTR-токены (латинские фразы, числа, метки вида [High]) — как есть. */
export function toVisualRtl(line: string): string {
  // Токенизация: метка [Word …] целиком LTR; слова; пробелы; одиночные знаки.
  const raw = line.match(/\[[A-Za-z0-9][A-Za-z0-9 ]*\]|[A-Za-z0-9À-ɏ]+(?:[.,:%/-][A-Za-z0-9À-ɏ]+)*|\s+|./gu) ?? [line];
  type Tok = { text: string; dir: 'rtl' | 'ltr' | 'n' };
  const toks: Tok[] = raw.map((t) => ({
    text: t,
    dir: AR_CHAR.test(t) ? 'rtl' : LTR_CHAR.test(t) ? 'ltr' : 'n',
  }));

  // Нейтралы: между одинаковыми сильными направлениями — их направление,
  // иначе (в т.ч. на краях) — направление абзаца (rtl).
  const resolved: ('rtl' | 'ltr')[] = toks.map(() => 'rtl');
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].dir !== 'n') {
      resolved[i] = toks[i].dir as 'rtl' | 'ltr';
      continue;
    }
    let prev: 'rtl' | 'ltr' | null = null;
    for (let j = i - 1; j >= 0; j--) if (toks[j].dir !== 'n') { prev = toks[j].dir as 'rtl' | 'ltr'; break; }
    let next: 'rtl' | 'ltr' | null = null;
    for (let j = i + 1; j < toks.length; j++) if (toks[j].dir !== 'n') { next = toks[j].dir as 'rtl' | 'ltr'; break; }
    resolved[i] = prev !== null && prev === next ? prev : prev === null && next !== null ? next : next === null && prev !== null ? prev : 'rtl';
  }

  // Смежные токены одного направления → один ран; порядок ранов разворачивается.
  const runs: { text: string; dir: 'rtl' | 'ltr' }[] = [];
  for (let i = 0; i < toks.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.dir === resolved[i]) last.text += toks[i].text;
    else runs.push({ text: toks[i].text, dir: resolved[i] });
  }
  const fixNumbers = (s: string): string => s.replace(/[0-9][0-9.,]*/g, (m) => [...m].reverse().join(''));
  return runs
    .reverse()
    .map((r) => (r.dir === 'rtl' ? fixNumbers([...r.text].reverse().map((c) => MIRROR[c] ?? c).join('')) : r.text))
    .join('');
}
