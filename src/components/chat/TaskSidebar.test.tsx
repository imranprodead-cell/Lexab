// @vitest-environment jsdom
/**
 * Правая колонка чата (замечание владельца 09.11):
 *  - Progress подписывает шаги агента своими словами, а не восемь раз
 *    «Обдумываю ответ»; «Обдумываю ответ» — последним;
 *  - Sources готового ответа — источники от сервера (акты с lex.uz со ссылкой),
 *    а не нормы первого поиска; нормы первого поиска — только пока ответ пишется.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { ChatMessage, ChatStep } from '@/types/domain';

vi.mock('@/api/chats.api', () => ({
  chatsApi: { getProgress: vi.fn().mockResolvedValue(null), saveProgress: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/api/law.api', () => ({ lawApi: { unit: vi.fn() } }));

const { TaskSidebar } = await import('./TaskSidebar');

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
beforeEach(() => localStorage.setItem('lexai.lang', 'ru'));
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  localStorage.clear();
});

const steps: ChatStep[] = [
  { id: 'prompt', status: 'done' },
  { id: 'search', status: 'done', data: { jurisdiction: 'UZ', found: 8, refs: [{ label: 'п. 9', doc: 'УП-6191-сон 23.03.2021', url: 'https://lex.uz/ru/docs/5340574' }] } },
  { id: 'answer', status: 'done' },
  { id: 'tool-1', status: 'done', data: { tool: 'search_official', queries: ['регистрация автотранспорта'] } },
  { id: 'tool-2', status: 'done', data: { tool: 'read_official', citation: 'О совершенствовании порядка' } },
  { id: 'tool-3', status: 'done', data: { tool: 'get_provision', citation: 'ст. 14 ЗРУ-706' } },
];

function render(messages: ChatMessage[]): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <I18nProvider>
        <TaskSidebar messages={messages} sessionKey={null} onOpenArtifact={() => undefined} />
      </I18nProvider>,
    ),
  );
  return host;
}

function openSources(el: HTMLElement) {
  const tab = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Sources');
  act(() => tab?.click());
}

const question: ChatMessage = { id: 'u1', role: 'user', kind: 'text', text: 'Каким постановлением утверждён порядок регистрации?' };

describe('TaskSidebar', () => {
  it('Progress: шаги агента своими словами, «Обдумываю ответ» один раз и последним', () => {
    const el = render([question, { id: 'a1', role: 'assistant', kind: 'text', text: 'Ответ', work: { startedAt: 1, endedAt: 2, steps } }]);
    const titles = [...el.querySelectorAll('li')].map((li) => li.textContent?.trim()).filter(Boolean);
    expect(titles).toEqual([
      'Разбираю вопрос',
      'Ищу нормы в базе законов',
      'Ищу на официальном сайте lex.uz',
      'Читаю официальный сайт',
      'Открываю статью целиком',
      'Обдумываю ответ',
    ]);
  });

  it('Sources готового ответа — источники сервера (акт с lex.uz со ссылкой), без норм первого поиска', () => {
    const el = render([
      question,
      {
        id: 'a1',
        role: 'assistant',
        kind: 'text',
        text: 'Порядок утверждён ПКМ № 683.',
        work: { startedAt: 1, endedAt: 2, steps },
        refs: [{ label: 'ПКМ № 683 от 31.08.2017', doc: 'О совершенствовании порядка государственной регистрации…', url: 'https://lex.uz/ru/docs/3334128' }],
      },
    ]);
    openSources(el);
    const link = [...el.querySelectorAll('a')].find((a) => a.textContent?.includes('ПКМ № 683 от 31.08.2017'));
    expect(link?.getAttribute('href')).toBe('https://lex.uz/ru/docs/3334128');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(el.textContent).not.toContain('п. 9');
  });

  it('пока ответ пишется — в Sources нормы первого поиска', () => {
    const el = render([question, { id: 'a1', role: 'assistant', kind: 'text', text: '', streaming: true, work: { startedAt: 1, steps: steps.slice(0, 3) } }]);
    openSources(el);
    expect(el.textContent).toContain('п. 9');
  });
});
