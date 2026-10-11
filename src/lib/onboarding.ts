// Device-local first-visit onboarding flag. Same localStorage-helper pattern
// as `recently-visited.ts` — no account linkage, fails silently if storage
// is unavailable (private browsing, quota) rather than blocking the page.
const STORAGE_KEY = 'shikshaq_onboarding_seen';

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // If storage is unavailable, don't nag on every load — treat as seen.
    return true;
  }
}

export function markOnboardingSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // localStorage unavailable — nothing to persist, dismiss still works.
  }
}
