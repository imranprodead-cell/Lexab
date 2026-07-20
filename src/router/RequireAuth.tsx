import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/store/useAuthStore';

/** Redirects unauthenticated users to /login, preserving the intended path. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();

  if (!token) {
    // Keep the whole intended location (query-string + hash), not just the path,
    // so sign-in lands exactly where the user was headed.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />;
  }
  return <>{children}</>;
}
