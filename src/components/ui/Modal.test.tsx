// @vitest-environment jsdom
/**
 * Модалка поверх модалки (карточка → «Подтвердите»): клик мимо окна и Esc
 * закрывают только верхнюю. Раньше нажатие «Подтвердить» закрывало нижнюю
 * карточку, и к отпусканию кнопки действие уже не знало, над чем работать —
 * выдача тарифа в админке молча не срабатывала.
 *
 * Нажатие и отпускание кнопки — РАЗНЫЕ act(): в браузере между mousedown и
 * click React успевает перерисоваться, и именно это ломало кнопку. Один
 * act() на всю последовательность баг не воспроизводит.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { Modal } from './Modal';

window.requestAnimationFrame = window.requestAnimationFrame ?? ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let done: string[] = [];

/** Та же схема, что в админке: карточка хранит выбранное, подтверждение его читает. */
function Stacked() {
  const [item, setItem] = useState<string | null>('client@example.com');
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Modal open={Boolean(item)} title="card" onClose={() => setItem(null)}>
        <button type="button" onClick={() => setConfirm(true)}>
          grant
        </button>
      </Modal>
      <Modal
        open={confirm}
        title="confirm"
        onClose={() => setConfirm(false)}
        footer={
          <button
            type="button"
            onClick={() => {
              if (item) done.push(item);
              setConfirm(false);
            }}
          >
            ok
          </button>
        }
      >
        <p>{item}</p>
      </Modal>
    </>
  );
}

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)!;
const openTitles = () => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('aria-label'));

async function press(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

let root: Root;

beforeEach(async () => {
  done = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider>
        <Stacked />
      </I18nProvider>,
    );
  });
  await press(button('grant'));
  expect(openTitles()).toEqual(['card', 'confirm']);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

describe('Modal: окно поверх окна', () => {
  it('кнопка верхнего окна срабатывает, нижнее остаётся открытым', async () => {
    await press(button('ok'));
    expect(done).toEqual(['client@example.com']);
    expect(openTitles()).toEqual(['card']);
  });

  it('клик по фону верхнего окна закрывает только его', async () => {
    const overlays = document.querySelectorAll('[role="presentation"]');
    await press(overlays[overlays.length - 1]);
    expect(openTitles()).toEqual(['card']);
  });

  it('Esc закрывает только верхнее окно, второй Esc — нижнее', async () => {
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(openTitles()).toEqual(['card']);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(openTitles()).toEqual([]);
  });
});
