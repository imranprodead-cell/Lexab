import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { docKey, extractArtifacts, isBigTable, parseMarkdownTable, savedSourceId } from './artifacts';
import { asNumber, buildXlsx, colName, toCsv, toTsv } from './xlsx';

const REPLY = `Ниже — проект претензии.

### Проект претензии
\`\`\`
[Бланк покупателя]
Исх. № ____ от «___» ______ 20__ г.

ПРЕТЕНЗИЯ
об уплате неустойки за просрочку поставки
Между [Покупатель] и [Поставщик] заключён договор поставки.
\`\`\`

### Шаг 1. Реестр просрочек
| № | Спецификация | Товар | Сумма | Срок | Факт | Дней |
|---|---|---|---|---|---|---|
| 1 | Спец. № 1 | Товар **А** | 10 000 000 | 05.03.2025 | 20.03.2025 | 15 |
| 2 | Спец. № 2 | Товар Б | 7 000 000 | 15.04.2025 | не поставлен | — |

| a | b |
|---|---|
| 1 | 2 |
`;

const labels = { document: 'Документ', table: 'Таблица' };

describe('extractArtifacts', () => {
  it('находит документ и большую таблицу, маленькую таблицу пропускает', () => {
    const arts = extractArtifacts(REPLY, 'm_abc', labels);
    expect(arts.map((a) => a.kind)).toEqual(['doc', 'table']);
    const doc = arts[0];
    expect(doc.kind === 'doc' && doc.title).toBe('Проект претензии');
    expect(doc.kind === 'doc' && doc.content.startsWith('[Бланк покупателя]')).toBe(true);
    const table = arts[1];
    expect(table.kind === 'table' && table.title).toBe('Шаг 1. Реестр просрочек');
    expect(table.kind === 'table' && table.rows[0][2]).toBe('Товар А'); // жирный снят
  });

  it('ключ зависит от сообщения и содержимого, а не от показа', () => {
    const a = extractArtifacts(REPLY, 'm_abc', labels)[0];
    const b = extractArtifacts(`Другое вступление\n\n${REPLY}`, 'm_abc', labels)[0];
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(extractArtifacts(REPLY, 'm_other', labels)[0].key);
    expect(savedSourceId(a.key).length).toBeLessThanOrEqual(60);
    expect(docKey('m_abc', '  x\n')).toBe(docKey('m_abc', 'x'));
  });

  it('короткий блок кода — не документ', () => {
    expect(extractArtifacts('```\nst. 260\n```', 'm1', labels)).toEqual([]);
  });

  it('разбирает таблицу с экранированной чертой и выравнивает строки', () => {
    const t = parseMarkdownTable('| a | b |\n|:--|--:|\n| x \\| y | 2 | лишнее |\n| только одна |')!;
    expect(t.rows).toEqual([['x | y', '2'], ['только одна', '']]);
    expect(isBigTable(t)).toBe(false);
  });
});

describe('xlsx / csv', () => {
  it('буквы столбцов и числа как в Excel', () => {
    expect([colName(0), colName(25), colName(26), colName(701)]).toEqual(['A', 'Z', 'AA', 'ZZ']);
    expect(asNumber('1 200 000')).toBe(1200000);
    expect(asNumber('0,5')).toBe(0.5);
    expect(asNumber('10 000 000 сум')).toBeNull();
    expect(asNumber('05.03.2025')).toBeNull();
  });

  it('собирает книгу: лист, жирная шапка, числа числами, кириллица и спецсимволы', async () => {
    const blob = await buildXlsx({ title: 'Реестр: просрочки/2025', header: ['№', 'Товар'], rows: [['1', 'Товар <А> & "Б"']] });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('<c r="A2" s="3"><v>1</v></c>'); // целое — с разделителем тысяч
    expect(sheet).toContain('Товар &lt;А&gt; &amp; &quot;Б&quot;');
    expect(sheet).toContain('state="frozen"');
    const wb = await zip.file('xl/workbook.xml')!.async('string');
    expect(wb).toContain('name="Реестр  просрочки 2025"'.replace('  ', ' '));
    for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']) expect(zip.file(f)).not.toBeNull();
  });

  it('CSV с BOM и кавычками; TSV для вставки в таблицу', async () => {
    const data = { title: 't', header: ['a', 'b'], rows: [['x;y', 'line\nbreak']] };
    const bytes = new Uint8Array(await toCsv(data, ';').arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM — Excel узнаёт UTF-8
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('a;b\r\n"x;y";"line\nbreak"');
    expect(toTsv(data)).toBe('a\tb\nx;y\tline break');
  });
});
