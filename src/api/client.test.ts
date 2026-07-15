// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, httpBlob, httpForm, httpSSE, SESSION_EXPIRED_EVENT } from './client';

// A FRESH Response per fetch call — a Response body can only be read once.
const mock401 = () =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ message: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );

function listen(): { count: () => number; last: () => string | undefined; stop: () => void } {
  let n = 0;
  let lastToken: string | undefined;
  const handler = (e: Event) => {
    n++;
    lastToken = (e as CustomEvent<{ token?: string }>).detail?.token;
  };
  window.addEventListener(SESSION_EXPIRED_EVENT, handler);
  return { count: () => n, last: () => lastToken, stop: () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler) };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('401 → session-expired dispatch rules (all four transports)', () => {
  it('http: a 401 from a data endpoint announces the dead session, naming the token it used', async () => {
    localStorage.setItem('lexai.auth', JSON.stringify({ token: 'tok_dead', user: {} }));
    mock401();
    const ears = listen();
    await expect(http('/chats')).rejects.toMatchObject({ status: 401 });
    expect(ears.count()).toBe(1);
    expect(ears.last()).toBe('tok_dead'); // the listener can ignore stale-token races
    ears.stop();
  });

  it('http: a 401 from the login form is just "wrong credentials" — no sign-out', async () => {
    mock401();
    const ears = listen();
    await expect(http('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 401 });
    // Same for a wrong current password on the change-password form.
    await expect(http('/auth/password', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 401 });
    expect(ears.count()).toBe(0);
    ears.stop();
  });

  it('http: a 401 from /auth/refresh IS an expired session', async () => {
    mock401();
    const ears = listen();
    await expect(http('/auth/refresh', { method: 'POST' })).rejects.toMatchObject({ status: 401 });
    expect(ears.count()).toBe(1);
    ears.stop();
  });

  it('http: other client errors do not touch the session', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'nope' }), { status: 403, headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    const ears = listen();
    await expect(http('/documents')).rejects.toMatchObject({ status: 403 });
    expect(ears.count()).toBe(0);
    ears.stop();
  });

  it('httpSSE, httpForm and httpBlob dispatch on 401 too', async () => {
    mock401();
    const ears = listen();
    await expect(httpSSE('/chats/c1/messages', {}, () => undefined)).rejects.toMatchObject({ status: 401 });
    await expect(httpForm('/uploads', new FormData())).rejects.toMatchObject({ status: 401 });
    await expect(httpBlob('/analysis/a1/report')).rejects.toMatchObject({ status: 401 });
    expect(ears.count()).toBe(3);
    ears.stop();
  });
});
