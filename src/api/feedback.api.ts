/** Feedback API — product feedback sent from the settings menu. */
import { USE_MOCK, http } from './client';
import { delay } from './util';

export type FeedbackCategory = 'general' | 'bug' | 'legal' | 'quality' | 'feature' | 'billing';

export interface FeedbackAttachment {
  name: string;
  /** Image MIME type (image/png, image/jpeg, …). */
  type: string;
  /** Raw file bytes, base64-encoded (no data: prefix). */
  data: string;
}

export const feedbackApi = {
  async send(
    message: string,
    opts: { page?: string; category?: FeedbackCategory; attachments?: FeedbackAttachment[] } = {},
  ): Promise<void> {
    if (USE_MOCK) {
      await delay(120);
      return;
    }
    await http<void>('/feedback', {
      method: 'POST',
      body: { message, page: opts.page, category: opts.category, attachments: opts.attachments },
    });
  },
};
