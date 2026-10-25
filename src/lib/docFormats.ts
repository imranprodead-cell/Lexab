/**
 * Форматы договора, которые принимает сервер, — ОДИН список на весь сайт
 * (аудит загрузок 2026-10-18: в чате, пакетной проверке и сравнении были свои
 * списки, и .md, который сервер принимает, где-то не давали выбрать, а где-то
 * давали выбрать и тут же отказывали). Зеркало ALLOWED_EXTENSIONS в
 * server/src/extract.ts — тест docFormats.test.ts следит, чтобы они совпадали.
 */
export const DOC_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.md'] as const;

/** Для <input type="file" accept>. */
export const DOC_ACCEPT = DOC_EXTENSIONS.join(',');

/** Потолок одного файла — как MAX_UPLOAD_BYTES на сервере. */
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export function isDocFile(name: string): boolean {
  const lower = name.toLowerCase();
  return DOC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Вложения чата: договоры + таблицы и презентации, о которых можно спросить
 * ИИ (зеркало ATTACHMENT_EXTENSIONS на сервере). На разбор рисков идут только
 * DOC_EXTENSIONS — Excel и PowerPoint договором не являются.
 */
export const ATTACH_EXTENSIONS = [...DOC_EXTENSIONS, '.xlsx', '.pptx', '.csv'] as const;

export const ATTACH_ACCEPT = ATTACH_EXTENSIONS.join(',');

export function isAttachFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ATTACH_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Сколько файлов можно прикрепить к одному сообщению (как на сервере). */
export function maxAttachments(plan: string | null | undefined): number {
  return !plan || plan === 'Free' ? 2 : 5;
}
