import { useEffect, useState } from 'react';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { PREVIEW_TOOLS, type PreviewRole } from '@/lib/preview-tools';
import { DUMMY_PAGES, setDummyMode } from '@/lib/dummy-mode';

/* The role toggle, test deployment only.

   Both deployments build from the same branch, so this file is in the live
   source tree too. It is compiled out of the live bundle rather than merely
   hidden: PREVIEW_TOOLS folds to a literal false at build time and everything
   below it is tree-shaken away. Verified by grepping dist for this component's
   name after a build without the flag.

   Signed-out, student and teacher are real sessions against real accounts, so
   what you see is what RLS actually returns, not a mock. Admin is deliberately
   absent: its credentials would have to ship in the bundle in plain text, and
   admin reaches 147 teachers' applications, emails and phone numbers. Sign in
   normally for that.

   The two preview accounts are powerless on purpose, because their passwords
   are public by construction: neither is an admin, and the teacher has no
   Shikshaqmine listing to damage. */

const ACCOUNTS: Record<
  Exclude<PreviewRole, 'signed-out'>,
  { email: string; password: string }
> = {
  student: {
    email: import.meta.env.VITE_PREVIEW_STUDENT_EMAIL ?? '',
    password: import.meta.env.VITE_PREVIEW_STUDENT_PASSWORD ?? '',
  },
  teacher: {
    email: import.meta.env.VITE_PREVIEW_TEACHER_EMAIL ?? '',
    password: import.meta.env.VITE_PREVIEW_TEACHER_PASSWORD ?? '',
  },
};

const ROLES: PreviewRole[] = ['signed-out', 'student', 'teacher'];
const LABEL: Record<PreviewRole, string> = {
  'signed-out': 'Signed out',
  student: 'Student',
  teacher: 'Teacher',
};

export function PreviewRoleToggle() {
  const { user, profile } = useAuth();
  const [busy, setBusy] = useState<PreviewRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  /* What the toggle reflects is the session, not what was last clicked: a
     refresh, a real sign-in or an expiry must all show the truth. */
  const current: PreviewRole = !user
    ? 'signed-out'
    : profile?.role === 'teacher'
      ? 'teacher'
      : profile?.role === 'student'
        ? 'student'
        : 'signed-out';

  useEffect(() => { setError(null); }, [user]);

  if (!PREVIEW_TOOLS) return null;

  const become = async (role: PreviewRole) => {
    setBusy(role);
    setError(null);
    try {
      await supabase.auth.signOut();
      if (role !== 'signed-out') {
        const account = ACCOUNTS[role as 'student' | 'teacher'];
        if (!account.email || !account.password) {
          setError(`No credentials configured for ${role}`);
          return;
        }
        const { error: signInError } = await supabase.auth.signInWithPassword(account);
        if (signInError) { setError(signInError.message); return; }
      }
      /* A hard reload rather than letting React settle: half this app reads
         the session once on mount, and a preview that shows a stale dashboard
         is worse than no preview. */
      window.location.reload();
    } finally {
      setBusy(null);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show the preview role toggle"
        className="fixed bottom-20 left-3 z-40 flex h-9 items-center rounded-full bg-fuchsia-600 px-3 text-[11px] font-bold uppercase tracking-wide text-white shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white lg:bottom-3"
      >
        Preview
      </button>
    );
  }

  return (
    <div
      /* bottom-20, not bottom-3: at that offset this panel sat directly over
         BottomNav's Home icon (both fixed to the same bottom-3 left-3
         corner on mobile, where BottomNav is not lg:hidden), and z-90 put it
         above the app's own Sheet/Dialog system too (z-50) — an open sheet's
         own action bar could render underneath a debug tool instead of the
         other way round, confirmed live: the account page's "Save profile"
         button sat partly hidden behind this bar. z-40 keeps it under any
         real modal; bottom-20 clears BottomNav's ~72px footprint before
         lg:bottom-3 takes over once BottomNav is lg:hidden anyway. */
      className="fixed bottom-20 left-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-[14px] bg-fuchsia-950/95 p-2 text-white shadow-lg ring-1 ring-fuchsia-400/40 backdrop-blur lg:bottom-3"
      role="region"
      aria-label="Preview role toggle, test deployment only"
    >
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-fuchsia-200">
          Test build, not live
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Hide the preview role toggle"
          className="ml-auto rounded px-1 text-[13px] leading-none text-fuchsia-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          &times;
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {ROLES.map((role) => {
          const active = current === role;
          return (
            <button
              key={role}
              type="button"
              disabled={busy !== null}
              aria-pressed={active}
              onClick={() => become(role)}
              className={`min-h-9 rounded-full px-3 text-[12px] font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                active
                  ? 'bg-white text-fuchsia-950'
                  : 'bg-fuchsia-800/70 text-fuchsia-100 hover:bg-fuchsia-700'
              }`}
            >
              {busy === role ? '…' : LABEL[role]}
            </button>
          );
        })}
      </div>

      {/* D75: dummy mode, a page against an in-memory fake API with no
          sign-in (src/lib/dummy-mode.ts). Same build-time gate as the rest
          of this component. */}
      <div className="mt-1.5 flex flex-wrap gap-1 border-t border-fuchsia-400/30 pt-1.5">
        {DUMMY_PAGES.map((p) => (
          <button
            key={p.path}
            type="button"
            onClick={() => {
              setDummyMode(true);
              window.location.assign(`${p.path}?dummy=1`);
            }}
            className="min-h-9 rounded-full bg-fuchsia-800/70 px-3 text-[12px] font-bold text-fuchsia-100 transition-colors hover:bg-fuchsia-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-1.5 max-w-[240px] px-1 text-[11px] leading-[1.4] text-fuchsia-200">
          {error}
        </p>
      )}
    </div>
  );
}
