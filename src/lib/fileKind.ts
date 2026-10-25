export type FileKind = 'word' | 'pdf' | 'sheet' | 'slides' | 'text';

/** Расширение без точки, строчными («docx»); '' — расширения нет. */
export function fileExt(name: string): string {
  return /\.([a-z0-9]{1,5})$/i.exec(name.trim())?.[1]?.toLowerCase() ?? '';
}

/** Тип файла по расширению — от него цвет и буква значка. Без расширения
 *  (сохранённый из чата документ) — документ Word: так он и скачивается. */
export function fileKind(name: string): FileKind {
  const ext = fileExt(name);
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'sheet';
  if (ext === 'pptx' || ext === 'ppt') return 'slides';
  if (ext === 'txt' || ext === 'md') return 'text';
  return 'word';
}

/** Какой значок Microsoft показать: docx / xlsx / pptx / pdf / csv / txt.
 *  Без расширения (сохранённый из чата документ) — простой текстовый документ:
 *  это не файл Word, хотя и скачивается в Word. */
export type FileIconType = 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'csv' | 'txt';

export function fileIconType(name: string): FileIconType {
  const ext = fileExt(name);
  if (!ext) return 'txt';
  switch (fileKind(name)) {
    case 'pdf':
      return 'pdf';
    case 'sheet':
      return ext === 'csv' ? 'csv' : 'xlsx';
    case 'slides':
      return 'pptx';
    case 'text':
      return 'txt';
    default:
      return 'docx';
  }
}

/** Подпись типа под именем: «Word (.docx)», «PDF», «Excel (.xlsx)». */
export function fileTypeLabel(name: string): string {
  const ext = fileExt(name);
  if (!ext) return '';
  switch (fileKind(name)) {
    case 'pdf':
      return 'PDF';
    case 'sheet':
      return ext === 'csv' ? 'CSV' : `Excel (.${ext})`;
    case 'slides':
      return `PowerPoint (.${ext})`;
    case 'text':
      return ext.toUpperCase();
    default:
      return `Word (.${ext})`;
  }
}
