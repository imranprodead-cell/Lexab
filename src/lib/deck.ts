/**
 * Презентация по делу (/slides): ИИ отвечает колодой в строгом Markdown
 * (см. server/src/lib/chatModes.ts), а здесь она разбирается в слайды для
 * карточки в чате и для файла .pptx (deckPptx.ts).
 *
 *   # Заголовок колоды
 *   Подзаголовок
 *
 *   ## Заголовок слайда
 *   - пункт
 *   > заметка докладчика
 */

export interface DeckSlide {
  title: string;
  bullets: string[];
  notes?: string;
}

export interface Deck {
  title: string;
  subtitle?: string;
  slides: DeckSlide[];
}

/** Сообщение пользователя — команда /slides (с текстом после неё или без). */
export const isSlidesCommand = (text: string | undefined): boolean => /^\s*\/slides(?=\s|$)/i.test(text ?? '');

/** Убрать инлайн-разметку: **жирный**, `код`, [ссылка](url) → чистый текст для слайда. */
function plain(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Разобрать ответ ИИ в колоду. null — если это не колода (например, ИИ
 * попросил описать дело), тогда в чате остаётся обычный текст ответа.
 */
export function parseDeck(markdown: string): Deck | null {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let title = '';
  const subtitle: string[] = [];
  const slides: DeckSlide[] = [];
  let current: DeckSlide | null = null;
  const notes: string[] = [];

  const closeSlide = () => {
    if (current) {
      if (notes.length) current.notes = notes.join(' ');
      if (current.title || current.bullets.length) slides.push(current);
    }
    notes.length = 0;
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^```/.test(line) || /^-{3,}$/.test(line)) continue;
    let m: RegExpExecArray | null;
    if ((m = /^#\s+(.+)$/.exec(line)) && !title && !current && !slides.length) {
      title = plain(m[1]);
    } else if ((m = /^#{2,3}\s+(.+)$/.exec(line))) {
      closeSlide();
      // «Слайд 3: Риски» / «Slide 3 — Risks» → «Риски».
      const t = plain(m[1]).replace(/^(слайд|slide|folie)\s*\d+\s*[:.—–-]\s*/i, '');
      current = { title: t, bullets: [] };
    } else if ((m = /^>\s*(.+)$/.exec(line))) {
      if (current) notes.push(plain(m[1]).replace(/^(заметка( докладчика)?|speaker notes?|notes?)\s*[:—–-]\s*/i, ''));
    } else if (current) {
      const bullet = plain(line.replace(/^([-*•]|\d+[.)])\s+/, ''));
      if (bullet) current.bullets.push(bullet);
    } else if (title) {
      subtitle.push(plain(line));
    }
  }
  closeSlide();

  if (slides.length < 2) return null;
  return {
    title: title || slides[0].title,
    subtitle: subtitle.join(' ') || undefined,
    slides,
  };
}

/** Имя файла: «Lexab — <заголовок>.pptx» без символов, запрещённых в ОС. */
export function deckFileName(deck: Deck): string {
  const safe = deck.title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `Lexab — ${safe || 'presentation'}.pptx`;
}
