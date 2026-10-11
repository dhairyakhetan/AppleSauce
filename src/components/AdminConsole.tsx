import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { InfoTip } from '@/components/admin/AdminHelp';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { saveAuthRedirect } from '@/utils/authRedirect';
import { setAuthIntent } from '@/lib/auth-intent';
import { toast as sonnerToast } from 'sonner';
import { SURFACE_TOKENS } from '@/utils/searchFacets';
import type { User } from '@supabase/supabase-js';
import { useAuthLoading } from '@/lib/auth-context';
import { setAdminConfirmed } from '@/lib/admin-confirmed';

/**
 * Shared admin-gate check, used by every /admin/* page instead of each page
 * re-implementing its own `admins` lookup + redirect. Kept separate from
 * AdminConsole (the layout shell) since a couple of callers need the
 * isAdmin/checkingAdmin flags before they've fetched their own data.
 */
// The admin-role lookup must never hang the UI indefinitely — a stalled
// request (bad connection, unreachable Supabase) used to leave every /admin/*
// page stuck on its loading skeleton (or a blank `return null`) forever, with
// no way to tell "unauthorized" apart from "broken". This timeout guarantees
// the check always resolves to granted / denied / error within a bounded time.
const ADMIN_CHECK_TIMEOUT_MS = 12000;

/** What the guard does with the user it was given. A null user while the saved
 *  session is still being restored is NOT signed out yet: wait, or a cold load
 *  of any admin page bounces a signed-in admin to the sign-in page. */
export function adminGuardStep(user: User | null | undefined, authLoading: boolean): 'wait' | 'signed-out' | 'check' {
  if (user) return 'check';
  return authLoading ? 'wait' : 'signed-out';
}

export function useAdminGuard(
  user: User | null | undefined,
  opts?: { onGranted?: () => void; redirectOnDenied?: boolean }
) {
  const navigate = useNavigate();
  const authLoading = useAuthLoading();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setCheckingAdmin(true);
      setError(null);

      const step = adminGuardStep(user, authLoading);
      if (step === 'wait') return;

      if (step === 'signed-out') {
        setAdminConfirmed(null);
        if (!cancelled) {
          setCheckingAdmin(false);
          setIsAdmin(false);
          if (opts?.redirectOnDenied) {
            // Handoff AU-004a: variant H. Nothing about that hero may look
            // promotional — it is a staff redirect, not a signup.
            setAuthIntent({ kind: 'admin' });
            saveAuthRedirect(window.location.pathname);
            navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname)}`);
          }
        }
        return;
      }

      try {
        const timeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), ADMIN_CHECK_TIMEOUT_MS);
        });
        const { data, error: queryError } = await Promise.race([
          supabase.from('admins').select('id').eq('id', user.id).maybeSingle(),
          timeout,
        ]);

        if (cancelled) return;

        if (queryError) {
          // A real error from the query (network, RLS, etc.) is not the same
          // as "checked and you're not an admin" — surface it instead of
          // silently denying/redirecting.
          setIsAdmin(false);
          setAdminConfirmed(null);
          setError("Couldn't verify your access — try again.");
          return;
        }

        if (data?.id === user.id) {
          setIsAdmin(true);
          setAdminConfirmed(user.id);
          opts?.onGranted?.();
        } else {
          setIsAdmin(false);
          setAdminConfirmed(null);
          if (opts?.redirectOnDenied) {
            navigate('/');
          }
        }
      } catch {
        // Includes the timeout above and any thrown/network failure.
        if (!cancelled) {
          setIsAdmin(false);
          setAdminConfirmed(null);
          setError("Couldn't verify your access — try again.");
        }
      } finally {
        if (!cancelled) setCheckingAdmin(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, retryCount, authLoading]);

  const retry = () => setRetryCount((n) => n + 1);

  return { isAdmin, checkingAdmin, error, retry };
}

/**
 * Shared error state for a failed/timed-out admin check — rendered by every
 * /admin/* page in place of an indefinite skeleton or a silent blank page.
 * Deliberately minimal (no rail/toolbar dependency on auth state) so it
 * renders even if the surrounding shell also depends on admin data.
 */
export function AdminGuardErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className={`mx-auto w-full max-w-sm p-8 text-center ${adminPanelStyle}`}>
        <p className="text-[16px] font-semibold text-foreground">Couldn't verify your access</p>
        <p className="mt-2 text-[14px] text-warm-prose">
          We weren't able to confirm your admin permissions. Check your connection and try again.
        </p>
        <button type="button" onClick={onRetry} className={`mt-5 ${adminPrimaryBtnStyle}`}>
          Try again
        </button>
      </div>
    </div>
  );
}

/**
 * Resolves admin user ids (e.g. `reviewed_by`/`approved_by` columns) to
 * display names, so admin consoles can show "Reviewed by X" instead of a
 * raw uuid. Silently returns an empty map on failure — display falls back
 * to "an admin".
 */
export function useReviewerNames(reviewerIds: (string | null | undefined)[]) {
  const [names, setNames] = useState<Record<string, string>>({});
  const key = Array.from(new Set(reviewerIds.filter(Boolean))).sort().join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setNames({});
      return;
    }

    async function run() {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ids);

      if (cancelled || error || !data) return;

      const map: Record<string, string> = {};
      data.forEach((row) => {
        map[row.id] = row.full_name || row.email || 'an admin';
      });
      setNames(map);
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return names;
}

// ---- Shared row / pill / button primitives (used by AdminConsole routes and AdminPapers) ----

export const adminRowStyle =
  'flex flex-wrap items-center gap-3.5 rounded-[18px] bg-warm-card px-5 py-[18px] shadow-[0_0_0_1px_rgba(0,0,0,.06),0_2px_4px_rgba(0,0,0,.04)]';

export const adminRowListStyle = 'grid gap-2.5';

export function AdminTile({
  tint,
  children,
}: {
  tint: { bg: string; text: string };
  children: ReactNode;
}) {
  return (
    <div
      className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] text-[15px] font-bold"
      style={{ background: tint.bg, color: tint.text }}
    >
      {children}
    </div>
  );
}

export type AdminPillTone = 'settled' | 'pending' | 'flagged' | 'destructive';

const PILL_TONE_CLASS: Record<AdminPillTone, string> = {
  settled: 'bg-success-subtle-bg text-success-subtle-text',
  pending: 'bg-warm-muted text-warm-prose',
  flagged: 'bg-brand-subtle text-brand-deep',
  // hsl(var(--destructive)) via the Tailwind `destructive` token, not a raw hex literal
  // (design.md §0.1).
  destructive: 'bg-destructive/10 text-destructive',
};

export function AdminPill({ tone, children }: { tone: AdminPillTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-bold ${PILL_TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/* Handoff 09i AD-001/AD-003 — dialog/panel buttons adopt the same "admin
   action pill" geometry as AdminTable's row actions (h36 r999 12.5px/700),
   just with a min-h-11 (44px) tap target per Rule 4, and the same 4-tone
   palette as AD-004's status pills so a "destructive" button always reads
   as the tinted rose, never solid red. */
const ADMIN_BTN_FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

export const adminPrimaryBtnStyle = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border-0 bg-panel px-5 text-[13px] font-bold text-background transition-transform duration-150 active:scale-[0.97] ${ADMIN_BTN_FOCUS}`;

export const adminSecondaryBtnStyle = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-muted px-5 text-[13px] font-bold text-warm-secondary transition-transform duration-150 active:scale-[0.97] ${ADMIN_BTN_FOCUS}`;

/* Tokens, not raw hex: destructive/10 with text-destructive is 5.9:1 on the
   card fill. */
export const adminDestructiveBtnStyle = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-destructive/10 px-5 text-[13px] font-bold text-destructive transition-transform duration-150 active:scale-[0.97] ${ADMIN_BTN_FOCUS}`;

/**
 * Single toast system for the admin console (see _rules.md #19 and
 * AdminConsole.md "Toast"): a dark pill, bottom-center, with an optional
 * Undo action. Wraps the app's existing `sonner` toast (already used by
 * every admin page and the rest of the app) rather than introducing the
 * separate shadcn use-toast system, which has been removed.
 */
export function adminToast(message: string, opts?: { description?: string; undo?: () => void }) {
  sonnerToast(message, {
    description: opts?.description,
    duration: 4000,
    action: opts?.undo ? { label: 'Undo', onClick: opts.undo } : undefined,
    style: {
      background: SURFACE_TOKENS.ink,
      color: '#fff',
      border: 'none',
      borderRadius: 14,
      padding: '14px 20px',
      fontSize: 14,
      fontWeight: 500,
      boxShadow: '0 12px 32px rgba(0,0,0,.24)',
    },
  });
}

export const adminFieldStyle = 'min-h-[48px] rounded-xl bg-muted';

/**
 * Squircle stat-tile row for admin console headers. Internal tools, so a small
 * single-row summary rather than a hero treatment.
 *
 * THE ONE-NUMBER RULE. A number appears once per screen. The nav badge is the
 * headline count; filter chips carry the per-view counts; a tile is only for a
 * figure NEITHER of those shows (a total, an average, a duration). Before adding
 * a tile, check that a chip or the nav badge does not already say it, and delete
 * any header sentence that repeats it. An unknown value is "?", never 0.
 *
 * Two columns on a phone, one row from `sm` up.
 */
export function AdminStatTiles({ stats }: { stats: { label: string; value: number | string; hint?: string }[] }) {
  const fills = ['bg-card', 'bg-brand-blue-subtle', 'bg-muted', 'bg-mint'];
  const cols = stats.length > 4 && stats.length % 3 === 0 ? 3 : Math.min(stats.length, 4);
  return (
    <div
      className="mb-[18px] grid grid-cols-2 gap-2.5 sm:[grid-template-columns:repeat(var(--stat-cols),minmax(0,1fr))]"
      style={{ '--stat-cols': cols } as CSSProperties}
    >
      {stats.map((st, i) => (
        <div key={st.label} className={`min-w-0 rounded-2xl px-4 py-3.5 ${fills[i % fills.length]}`}>
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[.02em] text-warm-label">
            {st.label}
            {st.hint ? <InfoTip text={st.hint} label={st.label} /> : null}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{st.value}</div>
        </div>
      ))}
    </div>
  );
}

export const adminPanelStyle = 'rounded-bento bg-card';
