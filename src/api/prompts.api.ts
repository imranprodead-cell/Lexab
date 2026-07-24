/** Prompt improver — the ✦ button in the composer rewrites the user's draft
 *  into a clear, well-structured request (server-side model, see /prompts). */
import { USE_MOCK, http } from './client';
import { delay } from './util';

export const promptsApi = {
  /** Returns the improved prompt text (same language as the draft). */
  async improve(text: string, signal?: AbortSignal): Promise<string> {
    if (USE_MOCK) {
      await delay(600);
      return `Ответь как юрист, по пунктам и со ссылками на нормы: ${text}`;
    }
    const res = await http<{ text: string }>('/prompts/improve', { method: 'POST', body: { text }, signal });
    return res.text;
  },
};
