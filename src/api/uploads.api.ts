/** Uploads API — sends the contract file itself so the AI can read its text. */
import { USE_MOCK, httpForm } from './client';
import { delay } from './util';

export interface UploadedFile {
  id: string;
  fileName: string;
  fileSize: string;
}

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
};
