import { isSafeRedirect } from '@/lib/safe-redirect';

const REDIRECT_KEY = 'auth_redirect_path';
const TTL_MS = 5 * 60 * 1000; // 5 minutes

/* Was a local `startsWith('/') && !startsWith('//')`, which a backslash walks
   straight through -- see src/lib/safe-redirect.ts. Checked on the way in AND
   on the way out, because localStorage is writable by anything running on the
   origin and a value that was safe when stored is not automatically safe when
   read back. */
const isValid = isSafeRedirect;

export function saveAuthRedirect(path: string) {
  if (!isValid(path)) return;
  try {
    localStorage.setItem(REDIRECT_KEY, JSON.stringify({ path, ts: Date.now() }));
  } catch { /* storage full or blocked */ }
}

export function getAuthRedirect(): string | null {
  try {
    const raw = localStorage.getItem(REDIRECT_KEY);
    if (!raw) return null;
    const { path, ts } = JSON.parse(raw);
    if (Date.now() - ts > TTL_MS) {
      localStorage.removeItem(REDIRECT_KEY);
      return null;
    }
    return isValid(path) ? path : null;
  } catch {
    return null;
  }
}

export function clearAuthRedirect() {
  try { localStorage.removeItem(REDIRECT_KEY); } catch { /* ok */ }
}
