/** Uploads API — sends the contract file itself so the AI can read its text. */
import { USE_MOCK, httpForm } from './client';
import { delay } from './util';

export interface UploadedFile {
  id: string;
  fileName: string;
  fileSize: string;
}

/** Не больше стольких фото в одном договоре — как на сервере (lib/photos.ts). */
export const MAX_PHOTOS = 20;
/** Один снимок до сжатия — как на сервере. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

export const uploadsApi = {
  async upload(file: File): Promise<UploadedFile> {
    if (USE_MOCK) {
      await delay(400);
      return { id: `up_${Date.now()}`, fileName: file.name, fileSize: `${Math.round(file.size / 1024)} KB` };
    }
    const form = new FormData();
    form.append('file', file);
    return httpForm<UploadedFile>('/uploads', form);
  },

  /** Фото страниц договора по порядку → сервер склеивает их в один PDF-скан
   *  и отдаёт его как обычную загрузку (имя файла — уже с .pdf). */
  async uploadPhotos(photos: File[], name: string): Promise<UploadedFile> {
    if (USE_MOCK) {
      await delay(400);
      return { id: `up_${Date.now()}`, fileName: name, fileSize: `${photos.length} pages` };
    }
    const form = new FormData();
    form.append('name', name);
    for (const photo of photos) form.append('file', photo, photo.name);
    return httpForm<UploadedFile>('/uploads/photos', form);
  },
};
