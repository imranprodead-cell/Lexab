/** Real authentication API (used when VITE_USE_MOCK_API=false). */
import type { UserProfile } from '@/types/domain';
import { http } from './client';

export interface AuthSession {
  token: string;
  user: UserProfile;
}

export const authApi = {
  login(email: string, password: string): Promise<AuthSession> {
    return http<AuthSession>('/auth/login', { method: 'POST', body: { email, password } });
  },

  register(name: string, email: string, password: string): Promise<AuthSession> {
    return http<AuthSession>('/auth/register', { method: 'POST', body: { name, email, password } });
  },

  logout(): Promise<void> {
    return http<void>('/auth/logout', { method: 'POST' });
  },

  reset(email: string): Promise<void> {
    return http<void>('/auth/reset', { method: 'POST', body: { email } });
  },

  /** Returns a fresh token (old ones are invalidated server-side). */
  changePassword(currentPassword: string, newPassword: string): Promise<AuthSession> {
    return http<AuthSession>('/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
  },

  /** Permanently deletes the account and all its data. `confirm` = account email. */
  deleteAccount(confirm: string): Promise<void> {
    return http<void>('/me', { method: 'DELETE', body: { confirm } });
  },

  /** Ask for a password-reset letter (always succeeds — no account leaking). */
  async requestReset(email: string): Promise<void> {
    await http<void>('/auth/reset', { method: 'POST', body: { email } });
  },

  /** Set a new password using the emailed token; returns a fresh session. */
  async confirmReset(token: string, password: string): Promise<{ token: string; user: UserProfile }> {
    return http<{ token: string; user: UserProfile }>('/auth/reset/confirm', {
      method: 'POST',
      body: { token, password },
    });
  },

  /** Confirm the email address by the token from the letter. */
  async verifyEmail(token: string): Promise<void> {
    await http<void>('/auth/verify', { method: 'POST', body: { token } });
  },

  /** Send the verification letter again (signed-in users). */
  async resendVerify(): Promise<void> {
    await http<void>('/auth/verify/resend', { method: 'POST', body: {} });
  },
};
