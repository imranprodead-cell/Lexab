// @vitest-environment jsdom
/**
 * Ход работы под ответом: добавочные шаги агента (обычных не хватило, поиск
 * продвигается) видны отдельной строкой «Ищу дальше» — человек понимает,
 * почему ответ идёт дольше (решение владельца 14.11).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { ChatStep } from '@/types/domain';
import { WorkSteps } from './WorkSteps';

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

describe('WorkSteps', () => {
  it('«Ищу дальше» стоит между шагами агента, «Обдумываю ответ» — последним', () => {
    const steps: ChatStep[] = [
      { id: 'prompt', status: 'done' },
      { id: 'answer', status: 'active' },
      { id: 'tool-1', status: 'done', data: { tool: 'search_official', queries: ['О повышении размеров заработной платы'] } },
      { id: 'more', status: 'done' },
      { id: 'tool-2', status: 'active', data: { tool: 'read_official', citation: 'lex.uz' } },
    ];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root?.render(
        <I18nProvider>
          <WorkSteps work={{ startedAt: Date.now(), steps }} working />
        </I18nProvider>,
      ),
    );
    const titles = [...host.querySelectorAll('li')].map((li) => li.firstElementChild?.nextElementSibling?.textContent?.trim());
    expect(titles[0]).toBe('Разбираю вопрос');
    expect(titles[1]).toBe('Ищу на официальном сайте lex.uz');
    expect(titles[2]).toBe('Ищу дальше');
    expect(titles[3]).toBe('Читаю официальный сайт');
    expect(titles[4]).toContain('Обдумываю ответ');
  });

  it('памятка по задаче — своя строка с названием задачи', () => {
    const steps: ChatStep[] = [
      { id: 'prompt', status: 'done' },
      { id: 'answer', status: 'active' },
      { id: 'tool-1', status: 'done', data: { tool: 'task_guide', task: 'lease', citation: 'Аренда (имущественный наём)', found: 60 } },
    ];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root?.render(
        <I18nProvider>
          <WorkSteps work={{ startedAt: Date.now(), steps }} working />
        </I18nProvider>,
      ),
    );
    const rows = [...host.querySelectorAll('li')];
    expect(rows[1].firstElementChild?.nextElementSibling?.textContent?.trim()).toBe('Сверяюсь с памяткой по задаче');
    expect(rows[1].textContent).toContain('Аренда (имущественный наём)');
  });
});
