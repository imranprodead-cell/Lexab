// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStreamingText } from './useStreamingText';
import { useUIStore } from '@/store/useUIStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEXT = 'Договор содержит три ключевых риска.';

function Probe({ onceKey, out }: { onceKey?: string; out: { visible: string } }) {
  const { visible } = useStreamingText(TEXT, 2, 16, onceKey);
  out.visible = visible;
  return null;
}

function mount(onceKey?: string) {
  const host = document.createElement('div');
  const root: Root = createRoot(host);
  const out = { visible: '' };
  act(() => root.render(<Probe onceKey={onceKey} out={out} />));
  return { root, out };
}

describe('useStreamingText onceKey', () => {
  it('animates from zero on the first mount with a key', () => {
    const { root, out } = mount('key-first');
    expect(out.visible.length).toBeLessThan(TEXT.length); // typewriter starts, not full text
    act(() => root.unmount());
  });

  it('shows the full text instantly on a repeat mount with the same key', () => {
    const first = mount('key-repeat');
    act(() => first.root.unmount()); // user leaves mid-animation
    const second = mount('key-repeat');
    expect(second.out.visible).toBe(TEXT); // no replay on reopen
    act(() => second.root.unmount());
  });

  it('still animates for a different key', () => {
    const first = mount('key-a');
    act(() => first.root.unmount());
    const other = mount('key-b');
    expect(other.out.visible.length).toBeLessThan(TEXT.length);
    act(() => other.root.unmount());
  });

  it('persists seen keys to localStorage (no replay after a page reload)', () => {
    const { root } = mount('key-persist');
    act(() => root.unmount());
    const stored = JSON.parse(localStorage.getItem('lexab.seenAnim') ?? '[]') as string[];
    expect(stored).toContain('key-persist');
  });

  it('renders instantly when reduce-motion is on', () => {
    act(() => useUIStore.setState({ reduceMotion: true }));
    const { root, out } = mount('key-motion');
    expect(out.visible).toBe(TEXT);
    act(() => {
      useUIStore.setState({ reduceMotion: false });
      root.unmount();
    });
  });
});
