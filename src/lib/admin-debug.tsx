import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useIsAdminBadge } from '@/hooks/useIsAdminBadge';

/**
 * Owner request, 2026-09-28: "add a debug mode in admin: if somebody is an
 * admin they can toggle a debug mode on, and it shows teacher id and
 * question paper id and question id and audit id, everything on the UI."
 *
 * GATE. The toggle is visible only to admins, and — this is the part that
 * actually matters — the mode can never read as "on" for a non-admin even if
 * a stale `true` is sitting in their localStorage (e.g. an account that was
 * later stripped of admin, or shared browser profile). `on` below is always
 * `isAdmin && storedFlag`, never the stored flag alone. This mirrors the
 * existing chrome-only `useIsAdminBadge()` check (not `useAdminGuard`, which
 * is the real authorization gate for /admin/* pages) — reused here rather
 * than duplicated, per its own header comment: "NOT an authorisation check,
 * only decides whether [something] is drawn," which is exactly this case.
 *
 * SCOPE. One global toggle (not per-page): once on, `<DebugId>` chips can
 * appear anywhere in the app — the checker, admin paper review/edit, the
 * Team dashboard, public paper pages, teacher cards — wherever a component
 * already has an id in its own props/data. This never widens a query or
 * fetches a new column; it only chooses whether to render an id the
 * component already received.
 *
 * PERSISTENCE. Per browser, localStorage, wrapped in try/catch (private
 * mode / blocked storage silently falls back to "off" and stays toggleable
 * in-session via React state).
 */

const STORAGE_KEY = 'shikshaq:admin-debug-mode';

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStored(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the in-memory toggle still works for
    // the rest of this tab's session.
  }
}

interface AdminDebugContextValue {
  /** True only when the signed-in account is an admin AND the flag is on. */
  on: boolean;
  /** Whether the toggle itself should be shown at all (admin only). */
  canToggle: boolean;
  toggle: () => void;
}

/* Exported only so the dummy-mode wrappers (src/dummy/, compiled out of the
   live bundle) can preview the chips without an admin sign-in. Real pages
   read it through the hooks below; nothing else may provide it. */
export const AdminDebugContext = createContext<AdminDebugContextValue>({
  on: false,
  canToggle: false,
  toggle: () => {},
});

export function AdminDebugProvider({ children }: { children: ReactNode }) {
  const isAdmin = useIsAdminBadge();
  const [stored, setStored] = useState(false);

  // Read localStorage once the component mounts (SSR/prerender safe: never
  // reads `window` during render).
  useEffect(() => {
    setStored(readStored());
  }, []);

  const toggle = useCallback(() => {
    setStored((prev) => {
      const next = !prev;
      writeStored(next);
      return next;
    });
  }, []);

  // Non-admins can never see the pill or any chip, no matter what is stored.
  const on = isAdmin && stored;

  // If admin status is ever lost mid-session (e.g. token refresh reveals a
  // revoked admin), stop reading the stored flag as "on" immediately rather
  // than waiting for a reload — `on` above already guards render, this just
  // keeps the stored value from lingering as true forever for that account.
  useEffect(() => {
    if (!isAdmin && stored) {
      // Leave the stored value alone (it is this browser's own setting and
      // may become an admin again), just don't act on it.
    }
  }, [isAdmin, stored]);

  const value = useMemo<AdminDebugContextValue>(
    () => ({ on, canToggle: isAdmin, toggle }),
    [on, isAdmin, toggle],
  );

  return <AdminDebugContext.Provider value={value}>{children}</AdminDebugContext.Provider>;
}

/** Whether id chips should render right now. Always `false` for a
 *  non-admin, even if the provider has not mounted yet or storage is
 *  unavailable. */
export function useAdminDebugOn(): boolean {
  return useContext(AdminDebugContext).on;
}

export function useAdminDebugToggle(): { on: boolean; canToggle: boolean; toggle: () => void } {
  return useContext(AdminDebugContext);
}
