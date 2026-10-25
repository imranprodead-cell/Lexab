import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { deckFileName, isSlidesCommand, parseDeck } from './deck';
import { buildDeckPptx } from './deckPptx';

const SAMPLE = `# Дело: взыскание долга с ООО «Альфа»
Презентация для встречи с клиентом

## Суть дела
- Поставка на **1,2 млн** сум не оплачена
- Просрочка — 94 дня
> Начните с цифр.

## Слайд 2: Правовая позиция
1. ст. 333 ГК РУз — неустойка
2. [п. 7.2 договора](https://x) — претензионный порядок

## Следующие шаги
* Направить претензию
`;

describe('parseDeck', () => {
  it('разбирает заголовок, подзаголовок, слайды, пункты и заметки', () => {
    const deck = parseDeck(SAMPLE);
    expect(deck).not.toBeNull();
    expect(deck!.title).toBe('Дело: взыскание долга с ООО «Альфа»');
    expect(deck!.subtitle).toBe('Презентация для встречи с клиентом');
    expect(deck!.slides.map((s) => s.title)).toEqual(['Суть дела', 'Правовая позиция', 'Следующие шаги']);
    expect(deck!.slides[0].bullets).toEqual(['Поставка на 1,2 млн сум не оплачена', 'Просрочка — 94 дня']);
    expect(deck!.slides[0].notes).toBe('Начните с цифр.');
    // Нумерация и ссылки убраны, текст сохранён.
    expect(deck!.slides[1].bullets).toEqual(['ст. 333 ГК РУз — неустойка', 'п. 7.2 договора — претензионный порядок']);
  });

  it('не считает колодой обычный ответ (ИИ попросил описать дело)', () => {
    expect(parseDeck('Опишите, пожалуйста, ситуацию или приложите договор.')).toBeNull();
    expect(parseDeck('# Заголовок\n## Один слайд\n- пункт')).toBeNull(); // меньше двух слайдов
  });

  it('без «# заголовка» берёт название первого слайда', () => {
    const deck = parseDeck('## Обзор\n- a\n## Риски\n- b');
    expect(deck!.title).toBe('Обзор');
  });

  it('узнаёт команду /slides только в начале сообщения', () => {
    expect(isSlidesCommand('/slides')).toBe(true);
    expect(isSlidesCommand('/Slides для совета директоров')).toBe(true);
    expect(isSlidesCommand('сделай /slides')).toBe(false);
    expect(isSlidesCommand('/slidesx')).toBe(false);
  });

  it('имя файла без запрещённых символов', () => {
    expect(deckFileName({ title: 'Иск: A/B "тест"?', slides: [] })).toBe('Lexab — Иск A B тест.pptx');
  });
});

describe('buildDeckPptx', () => {
  it('собирает настоящий .pptx: титульный слайд + слайд на каждый раздел, с заметками', async () => {
    const deck = parseDeck(SAMPLE)!;
    const blob = await buildDeckPptx(deck, { madeWith: 'Подготовлено в Lexab', date: '24.10.2026' });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides).toHaveLength(1 + deck.slides.length);
    const slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(slide2).toContain('Суть дела');
    expect(slide2).toContain('Просрочка — 94 дня');
    const notes = Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f));
    const allNotes = (await Promise.all(notes.map((f) => zip.file(f)!.async('string')))).join('');
    expect(allNotes).toContain('Начните с цифр.');
  });
});
