import { useEffect, useState } from 'react';
import { documentsApi } from '@/api';
import type { DocPreview } from '@/types/domain';

/*
 * Превью документов для карточек «Недавние файлы» и Vault → Documents
 * (ui-test 2026-11-15, по образцу галереи Claude).
 *  - договоры — с сервера (GET /documents/previews), кэш на вкладку по
 *    id + времени изменения: изменился документ — превью загрузится заново;
 *  - сохранённые из чата — из их же текста (Markdown) прямо здесь.
 */

const PREVIEW_CHARS = 600;
const TITLE_CHARS = 140;

const cache = new Map<string, DocPreview | null>();
const keyOf = (id: string, updatedAt: string) => `${id}@${updatedAt}`;

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Строка Markdown без разметки: заголовок, список, жирный, ссылки, таблица. */
function plainLine(line: string): { text: string; heading: boolean } {
  const heading = /^\s{0,3}#{1,6}\s/.test(line);
  const s = line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1');
  // Строка таблицы: ячейки через два пробела (после сжатия пробелов).
  if (/^\s*\|/.test(s)) return { text: s.split('|').map(squash).filter(Boolean).join('  '), heading };
  return { text: squash(s), heading };
}

/** Сохранённый из чата документ (Markdown) → превью: заголовок + абзацы. */
export function previewFromMarkdown(md: string): DocPreview {
  const lines: { text: string; heading: boolean }[] = [];
  for (const raw of md.slice(0, PREVIEW_CHARS * 4).split('\n')) {
    if (/^\s*(\|?\s*:?-{3,}:?\s*)+\|?\s*$/.test(raw) || /^\s*([-*_]\s*){3,}$/.test(raw)) continue; // разделители
    const l = plainLine(raw);
    if (l.text) lines.push(l);
  }
  if (!lines.length) return { text: '' };
  const title = lines[0].heading ? clip(lines[0].text, TITLE_CHARS) : undefined;
  const out: string[] = [];
  let left = PREVIEW_CHARS;
  for (const l of title ? lines.slice(1) : lines) {
    if (left <= 0) break;
    const line = clip(l.text, left);
    out.push(line);
    left -= line.length + 1;
  }
  return { ...(title ? { title } : {}), text: out.join('\n') };
}

/**
 * Превью для набора договоров: Map id → превью; undefined — ещё грузится,
 * null — текста нет (карточка рисует условные строки). Один запрос на набор.
 */
export function useDocPreviews(docs: { id: string; updatedAt: string }[]): Map<string, DocPreview | null | undefined> {
  const sig = docs.map((d) => keyOf(d.id, d.updatedAt)).join(',');
  const [, bump] = useState(0);

  useEffect(() => {
    const missing = docs.filter((d) => !cache.has(keyOf(d.id, d.updatedAt)));
    if (!missing.length) return;
    const ctrl = new AbortController();
    // Через Promise: даже синхронный сбой вызова не роняет страницу —
    // превью лишь украшение, карточки без него работают.
    Promise.resolve()
      .then(() =>
        documentsApi.previews(
          missing.map((d) => d.id),
          ctrl.signal,
        ),
      )
      .then((res) => {
        for (const d of missing) cache.set(keyOf(d.id, d.updatedAt), res[d.id] ?? null);
        bump((n) => n + 1);
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        // Сбой — карточки без текста (условные строки), страница работает.
        for (const d of missing) cache.set(keyOf(d.id, d.updatedAt), null);
        bump((n) => n + 1);
      });
    return () => ctrl.abort();
    // sig описывает docs целиком (id + время изменения)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const m = new Map<string, DocPreview | null | undefined>();
  for (const d of docs) {
    const k = keyOf(d.id, d.updatedAt);
    m.set(d.id, cache.has(k) ? cache.get(k) : undefined);
  }
  return m;
}
