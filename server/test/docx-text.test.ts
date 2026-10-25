/**
 * Чтение DOCX «как в Word» (аудит загрузок 2026-10-18): номера пунктов,
 * сноски, колонтитулы, таблицы. Файлы собираются здесь же из XML — так
 * проверяются и редкие конструкции Word, которые генератор docx не делает.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { docxToText } from '../src/lib/docxText.ts';
import { extractText } from '../src/extract.ts';
import { buildSimplePdf } from '../src/lib/pdf.ts';
import { zipStore } from './zip-helper.ts';

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const xml = (root: string, inner: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${root} ${NS}>${inner}</w:${root}>`;
const p = (text: string, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const num = (numId: number, ilvl = 0) => `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;

/** Минимальный пакет DOCX, который открывает и mammoth (для страховки). */
function docx(body: string, extra: Record<string, string> = {}): Buffer {
  return zipStore({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': xml('document', `<w:body>${body}</w:body>`),
    ...extra,
  });
}

const NUMBERING = xml(
  'numbering',
  `<w:abstractNum w:abstractNumId="0">
     <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
     <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2."/></w:lvl>
     <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="russianLower"/><w:lvlText w:val="%3)"/></w:lvl>
   </w:abstractNum>
   <w:abstractNum w:abstractNumId="1">
     <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="Раздел %1."/><w:pStyle w:val="Heading1"/></w:lvl>
   </w:abstractNum>
   <w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#61623;"/></w:lvl></w:abstractNum>
   <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
   <w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>
   <w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
   <w:num w:numId="4"><w:abstractNumId w:val="1"/></w:num>
   <w:num w:numId="5"><w:abstractNumId w:val="2"/></w:num>`,
);
const STYLES = xml(
  'styles',
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:numPr><w:numId w:val="4"/></w:numPr></w:pPr></w:style>
   <w:style w:type="paragraph" w:styleId="MyHeading"><w:basedOn w:val="Heading1"/></w:style>`,
);

test('docx: автонумерация как в Word — уровни, «а)», продолжение и перезапуск, нумерация из стиля', () => {
  const body = [
    p('Общие положения', '<w:pStyle w:val="Heading1"/>'),
    p('Предмет договора', num(1, 0)),
    p('Поставщик поставляет товар', num(1, 1)),
    p('при наличии заявки', num(1, 2)),
    p('после оплаты', num(1, 2)),
    p('Цена', num(2, 0)), // другой numId с тем же abstractNum — нумерация продолжается
    p('Цена составляет 100 сум', num(2, 1)),
    p('Ответственность', '<w:pStyle w:val="MyHeading"/>'), // стиль унаследован от Heading1
    p('Новый список', num(3, 0)), // startOverride — счёт заново
    p('Пункт со значком', num(5, 0)),
  ].join('');
  const text = docxToText(docx(body, { 'word/numbering.xml': NUMBERING, 'word/styles.xml': STYLES }));
  assert.deepEqual(text?.split('\n\n'), [
    'Раздел I. Общие положения',
    '1. Предмет договора',
    '1.1. Поставщик поставляет товар',
    'а) при наличии заявки',
    'б) после оплаты',
    '2. Цена',
    '2.1. Цена составляет 100 сум',
    'Раздел II. Ответственность',
    '1. Новый список',
    '• Пункт со значком',
  ]);
});

test('docx: сноски, колонтитулы и таблицы не теряются', () => {
  const body = [
    `<w:p><w:r><w:t>Неустойка 0,5% в день.</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>`,
    `<w:tbl><w:tr><w:tc>${p('Товар')}</w:tc><w:tc>${p('Цена')}</w:tc></w:tr><w:tr><w:tc>${p('Цемент')}</w:tc><w:tc><w:tbl><w:tr><w:tc>${p('100')}</w:tc><w:tc>${p('сум')}</w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>`,
  ].join('');
  const footnotes = xml(
    'footnotes',
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
     <w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Но не более 10% от цены договора.</w:t></w:r></w:p></w:footnote>`,
  );
  const text = docxToText(
    docx(body, {
      'word/footnotes.xml': footnotes,
      'word/header1.xml': xml('hdr', p('Конфиденциально')),
      'word/header2.xml': xml('hdr', p('Конфиденциально')),
      'word/footer1.xml': xml('ftr', p('Подпись Поставщика ________')),
    }),
  );
  assert.equal(
    text,
    [
      'Конфиденциально',
      'Неустойка 0,5% в день.[1]',
      'Товар | Цена\nЦемент | 100 | сум',
      'Подпись Поставщика ________',
      'Сноски:\n[1] Но не более 10% от цены договора.',
    ].join('\n\n'),
  );
});

test('docx: видимый текст ровно один раз — без скрытого, полей, дублей надписей и старых свойств', () => {
  const body = [
    // Старая нумерация из истории правок (pPrChange) — не нумерация абзаца.
    `<w:p><w:pPr><w:pPrChange w:id="1" w:author="x"><w:pPr>${num(1, 0)}</w:pPr></w:pPrChange></w:pPr><w:r><w:t>Без номера</w:t></w:r></w:p>`,
    `<w:p><w:r><w:t xml:space="preserve">Видно </w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>СКРЫТО</w:t></w:r></w:p>`,
    // Перемещение: источник (moveFrom) не показывается, только новое место.
    `<w:p><w:moveFrom w:id="2" w:author="x"><w:r><w:t>Перенесённый пункт</w:t></w:r></w:moveFrom></w:p>`,
    `<w:p><w:moveTo w:id="3" w:author="x"><w:r><w:t>Перенесённый пункт</w:t></w:r></w:moveTo></w:p>`,
    // Надпись: Choice и Fallback несут один и тот же текст.
    `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent>${p('Надпись на полях')}</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>${p('Надпись на полях')}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`,
    // Поле: код (PAGE) не текст, результат (7) — текст.
    `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> страница</w:t></w:r></w:p>`,
    p('ООО &quot;Альфа&quot; &amp; Ко'),
  ].join('');
  const text = docxToText(docx(body, { 'word/numbering.xml': NUMBERING }));
  assert.deepEqual(text?.split('\n\n'), ['Без номера', 'Видно', 'Перенесённый пункт', 'Надпись на полях', '7 страница', 'ООО "Альфа" & Ко']);
});

test('extractText: DOCX и PDF одного договора дают одни и те же номера пунктов и сноску', async () => {
  const { Document, Packer, Paragraph, TextRun, FootnoteReferenceRun, AlignmentType, LevelFormat } = await import('docx');
  const d = new Document({
    numbering: {
      config: [
        {
          reference: 'c',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START },
            { level: 1, format: LevelFormat.DECIMAL, text: '%1.%2.', alignment: AlignmentType.START },
          ],
        },
      ],
    },
    footnotes: { 1: { children: [new Paragraph('Но не более 10% от цены договора.')] } },
    sections: [
      {
        children: [
          new Paragraph({ text: 'Ответственность сторон', numbering: { reference: 'c', level: 0 } }),
          new Paragraph({ text: 'Поставщик отвечает за качество товара.', numbering: { reference: 'c', level: 1 } }),
          new Paragraph({
            children: [new TextRun('Неустойка 0,5% за каждый день просрочки.'), new FootnoteReferenceRun(1)],
            numbering: { reference: 'c', level: 1 },
          }),
        ],
      },
    ],
  });
  const fromDocx = await extractText(await Packer.toBuffer(d), 'contract.docx');
  const fromPdf = await extractText(
    await buildSimplePdf('Договор', [
      { text: '1. Ответственность сторон' },
      { text: '1.1. Поставщик отвечает за качество товара.' },
      { text: '1.2. Неустойка 0,5% за каждый день просрочки.*' },
      { text: '* Но не более 10% от цены договора.' },
    ]),
    'contract.pdf',
  );
  for (const piece of ['1. Ответственность сторон', '1.1. Поставщик отвечает', '1.2. Неустойка 0,5%', 'Но не более 10% от цены договора.']) {
    assert.ok(fromDocx?.includes(piece), `DOCX: ${piece}\n${fromDocx}`);
    assert.ok(fromPdf?.includes(piece), `PDF: ${piece}\n${fromPdf}`);
  }
});

test('extractText: необычная разметка, которую свой разбор не видит, — страховка прежним текстом (mammoth)', async () => {
  // Часть абзацев записана с другим префиксом пространства имён (так делают
  // некоторые генераторы) — свой разбор их не видит, mammoth видит.
  const other = 'xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const body = `${p('Первый пункт договора.')}<x:p ${other}><x:r><x:t>Второй пункт договора, записанный иначе, с длинным важным текстом.</x:t></x:r></x:p>`;
  const buf = docx(body);
  assert.ok(!docxToText(buf)?.includes('Второй пункт'), 'свой разбор этот абзац не видит');
  const text = await extractText(buf, 'odd.docx');
  assert.ok(text?.includes('Второй пункт договора'), `страховка вернула полный текст: ${text}`);
});

test('docx: непринятые исправления видны обеими версиями, сверху — пометка', () => {
  const ins = (t: string) => `<w:ins w:id="1" w:author="Контрагент" w:date="2026-10-01T00:00:00Z"><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:ins>`;
  const del = (t: string) => `<w:del w:id="2" w:author="Контрагент" w:date="2026-10-01T00:00:00Z"><w:r><w:delText xml:space="preserve">${t}</w:delText></w:r></w:del>`;
  const body = [
    // Замена: было 0,1% → предложено 0,5%.
    `<w:p><w:r><w:t xml:space="preserve">Неустойка </w:t></w:r>${del('0,1%')}${ins('0,5%')}<w:r><w:t xml:space="preserve"> за каждый день.</w:t></w:r></w:p>`,
    // Новый абзац целиком (метка вставки абзаца в rPr — самозакрытая, без текста).
    `<w:p><w:pPr><w:rPr><w:ins w:id="3" w:author="Контрагент"/></w:rPr></w:pPr>${ins('Покупатель вправе отказаться от договора в любой момент.')}</w:p>`,
    // Удалённое ограничение ответственности.
    `<w:p><w:r><w:t xml:space="preserve">Ответственность ограничена</w:t></w:r>${del(' суммой договора')}<w:r><w:t>.</w:t></w:r></w:p>`,
    // Правка только оформления (без текста) — метки нет.
    `<w:p><w:r><w:t>Цена 100 сум.</w:t></w:r><w:ins w:id="4" w:author="x"></w:ins></w:p>`,
  ].join('');
  const text = docxToText(docx(body));
  assert.deepEqual(text?.split('\n\n'), [
    '[В файле есть непринятые исправления (режим правок Word): удалённый текст помечен «[удалено: …]», добавленный — «[добавлено: …]».]',
    'Неустойка [удалено: 0,1%][добавлено: 0,5%] за каждый день.',
    '[добавлено: Покупатель вправе отказаться от договора в любой момент.]',
    'Ответственность ограничена[удалено:  суммой договора].',
    'Цена 100 сум.',
  ]);
});

test('docx: подписи правок — на языке договора; без правок пометки нет', () => {
  const en = docxToText(
    docx(`<w:p><w:r><w:t xml:space="preserve">The penalty is </w:t></w:r><w:del w:id="1" w:author="x"><w:r><w:delText>0.1%</w:delText></w:r></w:del><w:ins w:id="2" w:author="x"><w:r><w:t>0.5%</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> per day of delay under this agreement.</w:t></w:r></w:p>`),
  );
  assert.match(en ?? '', /^\[The file contains unaccepted tracked changes/);
  assert.ok(en?.includes('The penalty is [deleted: 0.1%][inserted: 0.5%] per day'), en ?? '');
  assert.ok(!docxToText(docx(p('Обычный договор без правок.')))?.includes('непринятые'), 'без правок — без пометки');
});

test('docx: испорченная разметка («<a<a<a…» без «>», незакрытые сноски) разбирается быстро', () => {
  // Сжимается до килобайт, а регулярное выражение по всему документу
  // перебирало бы хвост заново с каждого «<» — сервер висел бы для всех.
  const hostile = `<?xml version="1.0"?><w:document ${NS}><w:body>${p('Начало договора.')}${'<a'.repeat(1_000_000)}`;
  const notes = `<w:footnotes ${NS}>${'<w:footnote w:id="1"><w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(50_000)}`;
  const started = Date.now();
  const text = docxToText(
    zipStore({
      'word/document.xml': hostile,
      'word/footnotes.xml': notes,
    }),
  );
  assert.ok(Date.now() - started < 3000, `${Date.now() - started} мс`);
  assert.equal(text, 'Начало договора.');
});
