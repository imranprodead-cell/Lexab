/**
 * Фото договора с телефона → один PDF-«скан».
 *
 * Клиент снимает договор постранично (JPG/PNG/WebP, на iPhone — HEIC). Дальше
 * эти снимки идут ровно той дорожкой, что и отсканированный PDF: платные
 * тарифы читают его визуально (llm.ts), карточка, просмотр и отчёт работают без
 * доработок. Поэтому здесь фото только приводятся к виду «страница договора»:
 *
 *  - поворот по EXIF: телефон часто хранит кадр «боком» с пометкой о повороте,
 *    а PDF эту пометку не понимает — без поворота страница легла бы на бок;
 *  - уменьшение до PAGE_LONG_EDGE: снимок с телефона весит 3–10 МБ, а для
 *    чтения текста хватает ~2000 px — так 20 страниц укладываются в лимит
 *    запроса к модели (32 МБ вместе с base64);
 *  - перекодирование в JPEG выбрасывает метаданные снимка (GPS-координаты,
 *    модель телефона) — в хранилище они попадать не должны.
 *
 * Тип каждого снимка определяется по СОДЕРЖИМОМУ (magic bytes), не по имени:
 * переименованный исполняемый файл фото не станет.
 */
import { Worker } from 'node:worker_threads';
import { PDFDocument } from 'pdf-lib';
import type sharpFn from 'sharp';
import { badRequest, HttpError } from './errors.ts';

/** sharp — нативный модуль: грузим при первой загрузке фото, а не при старте
 *  сервера. Если на хостинге его бинарник не подтянется, сломаются только фото,
 *  а не весь API. */
type Sharp = typeof sharpFn;
let sharpModule: Promise<Sharp> | null = null;
const loadSharp = (): Promise<Sharp> => (sharpModule ??= import('sharp').then((m) => m.default as Sharp));

export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
/** Страниц в одном договоре по фото (решение владельца 2026-10-17). */
export const MAX_PHOTOS = 20;
/** Один снимок до сжатия: современный телефон даёт 3–10 МБ, PNG-скриншот больше. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
/** Итоговый PDF: в base64 он растёт на треть и должен пройти лимит модели в 32 МБ. */
export const MAX_PHOTO_PDF_BYTES = 22 * 1024 * 1024;

/** Длинная сторона страницы после сжатия — с запасом для мелкого шрифта. */
const PAGE_LONG_EDGE = 2000;
const JPEG_QUALITY = 80;
/** Ширина страницы в PDF — как у A4 (595 pt); высота по пропорциям снимка. */
const PAGE_WIDTH_PT = 595;
/** Потолок пикселей на входе: 120 Мп с запасом покрывают 108-Мп камеры, а
 *  «бомба» в 30000×30000 отклоняется до распаковки в память. */
const MAX_INPUT_PIXELS = 120_000_000;

type PhotoKind = 'jpeg' | 'png' | 'webp' | 'heic';

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** Формат снимка по первым байтам; null — это не фото, которое мы принимаем. */
export function detectPhotoKind(b: Buffer): PhotoKind | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b.toString('latin1', 4, 8) === 'ftyp' && HEIF_BRANDS.has(b.toString('latin1', 8, 12))) return 'heic';
  return null;
}

export function isPhotoFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && PHOTO_EXTENSIONS.includes(name.slice(dot).toLowerCase());
}

interface RawImage {
  width: number;
  height: number;
  data: Buffer;
}

/** Один поток расшифровки HEIC на загрузку: создаётся при первом HEIC-снимке,
 *  закрывается в finally у вызывающего. */
class HeicDecoder {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, { resolve: (r: RawImage) => void; reject: (e: Error) => void }>();

  decode(buffer: Buffer): Promise<RawImage> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./heicWorker.ts', import.meta.url));
      this.worker.on('message', (m: { id: number; width?: number; height?: number; data?: ArrayBuffer; error?: string }) => {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error || !m.data) p.reject(new Error(m.error ?? 'HEIC decode failed'));
        else p.resolve({ width: m.width ?? 0, height: m.height ?? 0, data: Buffer.from(m.data) });
      });
      this.worker.on('error', (err) => this.failAll(err));
      this.worker.on('exit', () => this.failAll(new Error('HEIC worker exited')));
    }
    const id = this.nextId++;
    // Копия: буфер уходит в поток без копирования и в главном потоке «пустеет».
    const copy = new Uint8Array(buffer).buffer;
    return new Promise<RawImage>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker?.postMessage({ id, buffer: copy }, [copy]);
    });
  }

  private failAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  async close(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }
}

/** Снимок → JPEG-страница: повёрнута по EXIF, уменьшена, без метаданных. */
async function toPageJpeg(photo: Buffer, kind: PhotoKind, heic: HeicDecoder): Promise<Buffer> {
  const sharp = await loadSharp();
  let input: ReturnType<Sharp>;
  if (kind === 'heic') {
    // sharp из коробки HEIC (HEVC) не читает — пиксели даёт libheif в потоке.
    // Поворот кадра libheif уже применил сам.
    const raw = await heic.decode(photo);
    if (raw.width * raw.height > MAX_INPUT_PIXELS) throw new Error('image too large');
    input = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } });
  } else {
    input = sharp(photo, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
  }
  return input
    .resize({ width: PAGE_LONG_EDGE, height: PAGE_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }) // прозрачный PNG → белый лист, а не чёрный
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/**
 * Склеить снимки в PDF по порядку. Бросает 400 с понятным текстом, если
 * какой-то снимок не открывается, и 413, если итог не пройдёт в модель.
 */
export async function photosToPdf(photos: { name: string; buffer: Buffer }[]): Promise<Buffer> {
  if (!photos.length) throw badRequest('Не выбрано ни одного фото. / No photos selected.');
  const doc = await PDFDocument.create();
  doc.setProducer('Lexab');
  doc.setCreator('Lexab');
  const heic = new HeicDecoder();
  try {
    // По одному снимку: пиковая память — одна страница, а не двадцать.
    for (const [i, photo] of photos.entries()) {
      const kind = detectPhotoKind(photo.buffer);
      if (!kind) {
        throw badRequest(
          `Файл «${photo.name}» не похож на фото (JPG, PNG, WebP, HEIC). / “${photo.name}” is not a JPG, PNG, WebP or HEIC photo.`,
        );
      }
      let page: Buffer;
      try {
        page = await toPageJpeg(photo.buffer, kind, heic);
      } catch {
        throw badRequest(
          `Не удалось открыть фото ${i + 1} («${photo.name}») — возможно, файл повреждён. / Photo ${i + 1} (“${photo.name}”) could not be opened.`,
        );
      }
      const img = await doc.embedJpg(page);
      const height = (img.height * PAGE_WIDTH_PT) / img.width;
      doc.addPage([PAGE_WIDTH_PT, height]).drawImage(img, { x: 0, y: 0, width: PAGE_WIDTH_PT, height });
    }
  } finally {
    await heic.close();
  }
  const pdf = Buffer.from(await doc.save());
  if (pdf.length > MAX_PHOTO_PDF_BYTES) {
    throw new HttpError(413, 'Фото слишком тяжёлые даже после сжатия — разделите договор на части. / The photos are too large even after compression.');
  }
  return pdf;
}
