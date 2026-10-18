// @vitest-environment jsdom
/**
 * «Весь договор» (аудит загрузок 2026-10-18): раньше режим показывал лишь 0–5
 * пунктов, которые ИИ процитировал под правки. Теперь — полный текст файла с
 * принятыми правками, а когда его нет — честная пометка над пунктами разбора.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { AnalysisResult } from '@/types/domain';
import { DocumentViewer, type FullContractView } from './DocumentViewer';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ANALYSIS: AnalysisResult = {
  id: 'an_full',
  fileName: 'Договор поставки.docx',
  fileSize: '20 KB',
  summary: '',
  riskScore: 40,
  riskLevel: 'Elevated',
  clausesReviewed: 1,
  findings: [],
  redlines: [{ id: 'r1', delText: '0,5%', insText: '0,1%', severity: 'High', status: 'accepted' }],
  // Разбор: ИИ процитировал ОДИН пункт — именно это раньше и было «всем договором».
  document: [
    { type: 'heading', text: '5. Ответственность' },
    { type: 'paragraph', segments: ['Неустойка ', { redlineId: 'r1' }, ' за каждый день просрочки.'] },
  ],
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function show(fullContract: FullContractView | null) {
  act(() =>
    root.render(
      <I18nProvider>
        <DocumentViewer analysis={ANALYSIS} pendingCount={0} canEdit={false} forceClean fullContract={fullContract} />
      </I18nProvider>,
    ),
  );
  return host.textContent ?? '';
}

const ready = (data: Partial<Extract<FullContractView, { status: 'ready' }>['data']>): FullContractView => ({
  status: 'ready',
  data: { text: null, recognizedByAi: false, ocrStatus: null, fromFile: true, unapplied: [], ...data },
});

describe('DocumentViewer — «Весь договор»', () => {
  it('показывает весь текст файла, а не только процитированный пункт', () => {
    const full = '1. Предмет договора\nПоставщик поставляет цемент.\n\n2. Цена\n150 000 000 сум.\n\n5. Ответственность\nНеустойка 0,1% за каждый день просрочки.';
    const text = show(ready({ text: full }));
    expect(text).toContain('1. Предмет договора');
    expect(text).toContain('150 000 000 сум.');
    expect(text).toContain('Неустойка 0,1% за каждый день');
    expect(host.querySelectorAll('[role="note"]').length).toBe(0);
  });

  it('текст скана, распознанный ИИ, — с пометкой; ненайденные правки — отдельным списком', () => {
    const text = show(
      ready({ text: 'Пункт 4.2. Оплата в течение 10 банковских дней.', recognizedByAi: true, unapplied: [{ id: 'r9', delText: '', insText: 'Новый пункт 7.' }] }),
    );
    expect(host.querySelector('[role="note"]')).not.toBeNull();
    expect(text).toContain('Пункт 4.2.');
    expect(text).toContain('Новый пункт 7.');
  });

  it('ручные правки, которые не нашлись в тексте, — в списке «внесите вручную»', () => {
    const text = show(
      ready({
        text: 'Весь договор.',
        unplacedEdits: [
          { was: 'Пункт 9. Старая редакция.', now: 'Пункт 9. Новая редакция.' },
          { was: 'Пункт 10. Убранный пункт.', now: '' },
        ],
      }),
    );
    expect(text).toContain('Пункт 9. Новая редакция.');
    expect(text).toContain('Пункт 10. Убранный пункт.');
  });

  it('полного текста нет — честная пометка, ниже пункты разбора', () => {
    const text = show(ready({ text: null, fromFile: true }));
    expect(host.querySelector('[role="note"]')).not.toBeNull();
    expect(text).toContain('5. Ответственность');
  });

  it('договор, созданный по запросу (без файла): его документ и есть весь договор — без пометки', () => {
    const text = show(ready({ text: null, fromFile: false }));
    expect(host.querySelector('[role="note"]')).toBeNull();
    expect(text).toContain('5. Ответственность');
  });

  it('пока текст грузится — пометка о загрузке, пункты разбора на месте', () => {
    const text = show({ status: 'loading' });
    expect(host.querySelector('[role="note"]')).not.toBeNull();
    expect(text).toContain('5. Ответственность');
  });
});
