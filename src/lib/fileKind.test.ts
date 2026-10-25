import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { relativeTime } from '@/i18n/dates';
import { fileIconType, fileKind, fileTypeLabel } from './fileKind';

describe('RecentFiles helpers', () => {
  it('picks the icon colour by file extension', () => {
    expect(fileKind('Договор поставки.PDF')).toBe('pdf');
    expect(fileKind('MSA_Acme.docx')).toBe('word');
    expect(fileKind('Сроки.xlsx')).toBe('sheet');
    expect(fileKind('Позиция.pptx')).toBe('slides');
    expect(fileKind('notes.txt')).toBe('text');
    // Сохранённый из чата документ — без расширения: значок документа.
    expect(fileKind('Проект претензии')).toBe('word');
  });

  it('icon and type label follow the file type', () => {
    expect(
      ['Договор.docx', 'старый.DOC', 'Сроки.xlsx', 'Позиция.pptx', 'Скан.pdf', 'data.csv', 'notes.txt', 'README.md', 'Проект претензии'].map(fileIconType),
    ).toEqual(['docx', 'docx', 'xlsx', 'pptx', 'pdf', 'csv', 'txt', 'txt', 'txt']);
    expect(fileTypeLabel('Договор.docx')).toBe('Word (.docx)');
    expect(fileTypeLabel('старый.DOC')).toBe('Word (.doc)');
    expect(fileTypeLabel('Сроки.xlsx')).toBe('Excel (.xlsx)');
    expect(fileTypeLabel('Позиция.pptx')).toBe('PowerPoint (.pptx)');
    expect(fileTypeLabel('Скан.pdf')).toBe('PDF');
    expect(fileTypeLabel('data.csv')).toBe('CSV');
    expect(fileTypeLabel('Проект претензии')).toBe('');
  });

  it('formats relative time in the interface language', () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(relativeTime(ago(20_000), 'ru', 'только что', now)).toBe('только что');
    expect(relativeTime(ago(10 * 60_000), 'ru', '', now)).toBe('10 мин. назад');
    expect(relativeTime(ago(10 * 60_000), 'en', '', now)).toMatch(/^10\s?m(in)? ago$/); // en-GB: «10 min ago»
    expect(relativeTime(ago(26 * 3_600_000), 'ru', '', now)).toBe('вчера');
    expect(relativeTime(ago(3 * 86_400_000), 'ru', '', now)).toBe('3 дн. назад');
    expect(relativeTime('not a date', 'ru', '', now)).toBe('');
  });

  it('every icon type has its Microsoft file in public/filetypes at every size', () => {
    for (const size of [20, 24, 32, 48]) {
      for (const type of ['docx', 'xlsx', 'pptx', 'pdf', 'csv', 'txt']) {
        const file = path.resolve(__dirname, `../../public/filetypes/${size}/${type}.svg`);
        expect(fs.readFileSync(file, 'utf8').startsWith('<svg'), file).toBe(true);
      }
    }
  });
});
