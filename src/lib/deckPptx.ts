/**
 * Файл .pptx из колоды (/slides). Библиотека pptxgenjs (~0.5 МБ) грузится
 * только по клику «Скачать» — первую загрузку сайта не утяжеляет.
 * Оформление Lexab: тёмный титульный слайд, белые слайды с заголовком и
 * золотой чертой, номер страницы и заметки докладчика.
 */
import type { Deck } from './deck';

const INK = '232120';
const DIM = '6F6B65';
const MUTED = 'A3A09A';
const GOLD = 'B08D57';
const PAPER = 'FFFFFF';
const FONT = 'Arial'; // есть везде и с кириллицей/арабицей

export interface DeckPptxOptions {
  /** Подпись внизу титульного слайда, например «Подготовлено в Lexab». */
  madeWith: string;
  /** Дата для титульного слайда (уже отформатированная). */
  date: string;
  /** Арабский интерфейс: текст справа налево. */
  rtl?: boolean;
}

export async function buildDeckPptx(deck: Deck, opts: DeckPptxOptions): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 дюйма, 16:9
  pptx.author = 'Lexab';
  pptx.company = 'Lexab';
  pptx.title = deck.title;
  if (opts.rtl) pptx.rtlMode = true;
  const align = opts.rtl ? 'right' : 'left';
  const total = deck.slides.length;

  // ── Титульный слайд ──────────────────────────────────────────────────────
  const cover = pptx.addSlide();
  cover.background = { color: INK };
  cover.addText('LEXAB', {
    x: 0.8, y: 0.6, w: 6, h: 0.4,
    fontFace: FONT, margin: 0, fontSize: 12, bold: true, color: GOLD, charSpacing: 6, align,
  });
  cover.addShape('rect', { x: 0.8, y: 2.55, w: 0.9, h: 0.06, fill: { color: GOLD }, line: { color: GOLD } });
  cover.addText(deck.title, {
    x: 0.8, y: 2.8, w: 11.7, h: 1.8,
    fontFace: FONT, margin: 0, fontSize: 38, bold: true, color: PAPER, valign: 'top', fit: 'shrink', align,
  });
  if (deck.subtitle) {
    cover.addText(deck.subtitle, {
      x: 0.8, y: 4.65, w: 11.7, h: 1.0,
      fontFace: FONT, margin: 0, fontSize: 18, color: 'D9D6D0', valign: 'top', fit: 'shrink', align,
    });
  }
  cover.addText(`${opts.madeWith} · ${opts.date}`, {
    x: 0.8, y: 6.7, w: 11.7, h: 0.4,
    fontFace: FONT, margin: 0, fontSize: 11, color: MUTED, align,
  });

  // ── Слайды содержания ────────────────────────────────────────────────────
  deck.slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: PAPER };
    slide.addText(s.title, {
      x: 0.7, y: 0.45, w: 11.9, h: 0.9,
      fontFace: FONT, margin: 0, fontSize: 28, bold: true, color: INK, valign: 'bottom', fit: 'shrink', align,
    });
    slide.addShape('rect', {
      x: opts.rtl ? 11.7 : 0.7, y: 1.45, w: 0.9, h: 0.05, fill: { color: GOLD }, line: { color: GOLD },
    });
    if (s.bullets.length) {
      slide.addText(
        s.bullets.map((b) => ({
          text: b,
          options: { bullet: { indent: 18 }, paraSpaceAfter: 10, breakLine: true },
        })),
        {
          // Маркер «висит» левее текста на ~0.22″ — сдвигаем блок, чтобы точки
          // стояли на одной линии с заголовком.
          x: opts.rtl ? 0.7 : 0.92, y: 1.8, w: 11.68, h: 4.9,
          fontFace: FONT, margin: 0, fontSize: 20, color: INK, valign: 'top', fit: 'shrink', lineSpacingMultiple: 1.1, align,
        },
      );
    }
    slide.addText(`Lexab · ${deck.title}`, {
      x: 0.7, y: 6.95, w: 9.5, h: 0.35,
      fontFace: FONT, margin: 0, fontSize: 10, color: MUTED, align,
    });
    slide.addText(`${i + 1} / ${total}`, {
      x: 10.6, y: 6.95, w: 2.0, h: 0.35,
      fontFace: FONT, margin: 0, fontSize: 10, color: DIM, align: opts.rtl ? 'left' : 'right',
    });
    if (s.notes) slide.addNotes(s.notes);
  });

  return (await pptx.write({ outputType: 'blob' })) as Blob;
}
