// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from './download';

// jsdom не реализует createObjectURL/revokeObjectURL — заводим их сами.
URL.createObjectURL = vi.fn();
URL.revokeObjectURL = vi.fn();
const createSpy = vi.mocked(URL.createObjectURL);
const revokeSpy = vi.mocked(URL.revokeObjectURL);

describe('downloadBlob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createSpy.mockReturnValue('blob:test-url');
    revokeSpy.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    createSpy.mockReset();
    revokeSpy.mockReset();
  });

  it('кликает по anchor с именем файла и НЕ отзывает URL синхронно (иначе мобильный Safari обрывает загрузку)', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadBlob(new Blob(['test']), 'report.pdf');

    expect(createSpy).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    // Критично: revoke НЕ должен случиться сразу после click().
    expect(revokeSpy).not.toHaveBeenCalled();
    // Anchor убран из DOM сразу (утечки нет), а URL живёт до таймера.
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('отзывает URL через 60 секунд — ровно тот же url', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadBlob(new Blob(['test']), 'report.pdf');

    vi.advanceTimersByTime(59_000);
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:test-url');
  });

  it('проставляет href и download на anchor', () => {
    let captured: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      captured = this;
    });
    downloadBlob(new Blob(['x']), 'Договор_поставки.docx');
    expect(captured!.getAttribute('href')).toBe('blob:test-url');
    expect(captured!.getAttribute('download')).toBe('Договор_поставки.docx');
  });
});
