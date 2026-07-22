/** Озвучка ответа ассистента: сервер синтезирует MP3 (Gemini-TTS, фолбэки на
 *  сервере). Текст уходит в POST /tts, обратно приходит бинарный audio/mpeg. */
import { USE_MOCK, httpBlob } from './client';

/** Полсекунды тишины в WAV — «озвучка» демо-режима без сети. */
function silentWav(): Blob {
  const rate = 8000;
  const samples = rate / 2;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples * 2, true);
  return new Blob([buf], { type: 'audio/wav' });
}

export const ttsApi = {
  // Предохранительная обрезка: серверный лимит запроса — 30 000 символов (400
  // при превышении), а озвучивается всё равно только начало (лимит Cloud TTS).
  synthesize: (text: string, signal?: AbortSignal): Promise<Blob> => {
    if (USE_MOCK) return Promise.resolve(silentWav());
    return httpBlob('/tts', { method: 'POST', body: { text: text.slice(0, 20_000) }, signal });
  },
};
