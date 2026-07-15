// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_EXPIRED_EVENT } from '@/api/client';
import { shouldRefreshToken, useAuthStore } from './useAuthStore';

/** Build an unsigned JWT-shaped token with the given iat/exp (seconds). */
function fakeJwt(iat: number, exp: number): string {
  const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'u1', iat, exp })}.sig`;
}

const DAY = 24 * 3600;
const now = Math.floor(Date.now() / 1000);

const PROFILE = { name: 'T', initials: 'T', firm: 'F', jurisdiction: 'GB', email: 't@test.local' };

describe('shouldRefreshToken — silent renewal window', () => {
  it('a fresh token is left alone', () => {
    expect(shouldRefreshToken(fakeJwt(now, now + 30 * DAY))).toBe(false);
  });

  it('past half the lifetime → renew', () => {
    expect(shouldRefreshToken(fakeJwt(now - 16 * DAY, now + 14 * DAY))).toBe(true);
  });

  it('an already-expired token still asks the server (it answers 401 → clean sign-out)', () => {
    expect(shouldRefreshToken(fakeJwt(now - 40 * DAY, now - 10 * DAY))).toBe(true);
  });

  it('opaque/mock tokens are never refreshed', () => {
    expect(shouldRefreshToken('mock_12345')).toBe(false);
  });
});

describe('session-expired event — forced sign-out with an honest notice', () => {
  const TOKEN = fakeJwt(now, now + DAY);

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('lexai.auth', JSON.stringify({ token: TOKEN, user: PROFILE }));
    useAuthStore.setState({ user: PROFILE, token: TOKEN, sessionExpired: false });
  });

  it('drops the session (storage included) and raises the login-screen notice flag', () => {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    const s = useAuthStore.getState();
    expect(s.token).toBeNull();
    expect(s.user).toBeNull();
    expect(s.sessionExpired).toBe(true);
    expect(localStorage.getItem('lexai.auth')).toBeNull();
  });

  it('is a no-op when already signed out (no notice on the plain login screen)', () => {
    useAuthStore.setState({ user: null, token: null, sessionExpired: false });
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    expect(useAuthStore.getState().sessionExpired).toBe(false);
  });

  it('ignores a 401 raced by an OLD token after the session was already replaced', () => {
    // E.g. a background poll that was in flight during a password change: its
    // 401 names the previous token and must not kill the fresh session.
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { token: 'previous_token' } }));
    const s = useAuthStore.getState();
    expect(s.token).toBe(TOKEN);
    expect(s.sessionExpired).toBe(false);
  });

  it('honours the event when it names the CURRENT token', () => {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { token: TOKEN } }));
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().sessionExpired).toBe(true);
  });

  it('a successful sign-in clears the notice', () => {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    expect(useAuthStore.getState().sessionExpired).toBe(true);
    useAuthStore.getState().adoptSession(fakeJwt(now, now + DAY), PROFILE);
    expect(useAuthStore.getState().sessionExpired).toBe(false);
  });
});

describe('cross-tab sync via the storage event', () => {
  const TOKEN = fakeJwt(now, now + DAY);

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: PROFILE, token: TOKEN, sessionExpired: false });
  });

  it('a sign-out in another tab signs this one out QUIETLY (no "expired" notice)', () => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'lexai.auth', newValue: null }));
    const s = useAuthStore.getState();
    expect(s.token).toBeNull();
    expect(s.sessionExpired).toBe(false); // deliberate logout ≠ expired session
  });

  it('a new session from another tab is adopted', () => {
    const fresh = fakeJwt(now + 10, now + DAY);
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'lexai.auth', newValue: JSON.stringify({ token: fresh, user: PROFILE }) }),
    );
    expect(useAuthStore.getState().token).toBe(fresh);
  });

  it('unrelated keys and corrupt values are ignored', () => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'lexai.lang', newValue: 'en' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'lexai.auth', newValue: '{broken json' }));
    expect(useAuthStore.getState().token).toBe(TOKEN);
  });
});
