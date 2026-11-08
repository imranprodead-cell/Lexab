/**
 * Сравнение двух редакций договора для агента (инструмент compare_versions,
 * решение владельца 2026-10-31). Различия находит КОД, а не модель: пункты
 * выравниваются по наибольшей общей подпоследовательности, соседние «удалён +
 * добавлен» с похожими словами склеиваются в «изменён». Модель потом объясняет,
 * что эти изменения значат, — но сами различия не выдумывает и не теряет.
 */

export type Change =
  | { kind: 'changed'; before: string; after: string }
  | { kind: 'removed'; before: string }
  | { kind: 'added'; after: string };

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Текст → пункты: непустые строки; продолжение без номера и с маленькой буквы
 *  приклеивается к предыдущему (перенос строки внутри пункта из PDF/DOCX). */
export function clausesOf(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = norm(raw);
    if (!line) continue;
    const continues = out.length > 0 && /^[a-zа-яё(«"]/.test(line) && !/[.;:!?»"]$/.test(out[out.length - 1]);
    if (continues) out[out.length - 1] = `${out[out.length - 1]} ${line}`;
    else out.push(line);
  }
  return out;
}

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** Доля общих слов (Жаккар). */
export function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size && !B.size) return 1;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / (A.size + B.size - common);
}

/** Пунктов на сторону, дальше не сравниваем (O(n·m) памяти). */
const MAX_CLAUSES = 1500;

/** Различия между редакциями (по порядку текста). */
export function diffClauses(beforeText: string, afterText: string): { changes: Change[]; truncated: boolean } {
  const a = clausesOf(beforeText);
  const b = clausesOf(afterText);
  const truncated = a.length > MAX_CLAUSES || b.length > MAX_CLAUSES;
  const A = a.slice(0, MAX_CLAUSES);
  const B = b.slice(0, MAX_CLAUSES);
  const n = A.length;
  const m = B.length;
  // LCS по совпадающим пунктам (без учёта пробелов и регистра).
  const key = (s: string) => s.toLowerCase();
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = key(A[i]) === key(B[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const changes: Change[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  // Накопленные «удалено/добавлено» между совпадениями → пары «изменено» по сходству.
  const flush = () => {
    const usedAdded = new Set<number>();
    for (const r of removed) {
      let best = -1;
      let bestSim = 0.35;
      added.forEach((x, k) => {
        if (usedAdded.has(k)) return;
        const sim = similarity(r, x);
        if (sim > bestSim) {
          bestSim = sim;
          best = k;
        }
      });
      if (best >= 0) {
        usedAdded.add(best);
        changes.push({ kind: 'changed', before: r, after: added[best] });
      } else changes.push({ kind: 'removed', before: r });
    }
    added.forEach((x, k) => {
      if (!usedAdded.has(k)) changes.push({ kind: 'added', after: x });
    });
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (key(A[i]) === key(B[j])) {
      flush();
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) removed.push(A[i++]);
    else added.push(B[j++]);
  }
  while (i < n) removed.push(A[i++]);
  while (j < m) added.push(B[j++]);
  flush();
  return { changes, truncated };
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** Различия — текстом для модели. */
export function formatChanges(changes: Change[], limit = 40): string {
  if (!changes.length) return 'NO_DIFFERENCES: the two versions have the same clauses (whitespace and letter case aside).';
  const lines = changes.slice(0, limit).map((c, k) => {
    if (c.kind === 'changed') return `${k + 1}. CHANGED\n   before: «${clip(c.before, 700)}»\n   after:  «${clip(c.after, 700)}»`;
    if (c.kind === 'removed') return `${k + 1}. REMOVED: «${clip(c.before, 700)}»`;
    return `${k + 1}. ADDED: «${clip(c.after, 700)}»`;
  });
  const more = changes.length > limit ? `\n…and ${changes.length - limit} more differences (ask to narrow down).` : '';
  return `${changes.length} difference(s):\n${lines.join('\n')}${more}`;
}
