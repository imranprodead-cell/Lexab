// @vitest-environment jsdom
/** Подпись формата на карточке файла — по имени, а не всегда «DOCX» (аудит загрузок 2026-10-18). */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fileKind } from '@/lib/format';
import { UserFileBubble } from './UserFileBubble';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

function meta(name: string, size: string): string {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<UserFileBubble name={name} size={size} />));
  return host.textContent ?? '';
}

describe('UserFileBubble', () => {
  it('формат — по расширению файла', () => {
    expect(fileKind('Договор поставки.pdf')).toBe('PDF');
    expect(fileKind('nda.DOCX')).toBe('DOCX');
    expect(fileKind('старый.doc')).toBe('DOC');
    expect(fileKind('условия.txt')).toBe('TXT');
    expect(fileKind('без расширения')).toBe('');
  });

  it('PDF подписан как PDF, фото договора — как PDF-скан с числом фото', () => {
    expect(meta('Договор.pdf', '1.2 MB')).toContain('PDF · 1.2 MB');
    expect(meta('Фото договора 17.10.2026 18-42-05.pdf', 'Фото: 3')).toContain('PDF · Фото: 3');
    expect(meta('Договор.pdf', '1.2 MB')).not.toContain('DOCX');
  });
});
