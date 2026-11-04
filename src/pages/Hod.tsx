import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useIsAdminBadge } from '@/hooks/useIsAdminBadge';
import { useIsCheckerBadge } from '@/hooks/useIsCheckerBadge';
import { nextTabKey } from '@/components/admin/AdminTabs';
import { AssignmentsTab } from '@/components/hod/AssignmentsTab';
import { AiTrustTab } from '@/components/hod/AiTrustTab';
import { HistoryTab } from '@/components/hod/HistoryTab';
import { LoadError } from '@/components/hod/HodShared';
import { LiveTab } from '@/components/hod/LiveTab';
import { NeedsYouTab } from '@/components/hod/NeedsYouTab';
import { ReadyTab } from '@/components/hod/ReadyTab';
import { UploadsTab } from '@/components/hod/UploadsTab';
import { VerifiersTab } from '@/components/hod/VerifiersTab';
import { TeacherReviewersTab } from '@/components/hod/TeacherReviewersTab';
import { CHIP } from '@/lib/checker-button-styles';
import { realHodApi, type HodApi } from '@/lib/hod-api';
import { resolveTabKey, tabBadge, tabBadgeLabel } from '@/lib/hod-tabs';
import type { TeacherReviewerAdminApi } from '@/lib/teacher-review-api';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { cn } from '@/lib/utils';

/* /hod: the Head of Department desk (owner, 7 Oct 2026; go-live side 12 Oct
   2026). Separate from the checker's own screen. It follows a paper down the
   route: Needs you (questions only an HOD can settle), Ready to go live (the
   preview flow and the four checks), Student uploads, Live papers; then who holds
   which paper, how each verifier is doing, the history, and how far the AI has
   earned trust. Open to HODs and admins; everyone else gets a polite "not for
   you" page. The server checks is_hod() on every call, so this guard only
   decides what is drawn.

   TABS is the one list to extend: add an entry and its component and it
   shows up in the tab row, the URL (?tab=) and the keyboard order. The order
   and the old names that still work (?tab=escalated) are in src/lib/hod-tabs.ts.
   A paper opened inside a tab is ?paper=<id>.

   In a test build with dummy mode on, the same page runs against an
   in-memory fake with no sign-in (src/dummy/HodDummy.tsx). */

const DummyHod = PREVIEW_TOOLS ? lazy(() => import('@/dummy/HodDummy')) : null;

export default function Hod() {
  if (DummyHod && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyHod />
      </Suspense>
    );
  }
  return <HodPage api={realHodApi} />;
}

export interface HodTabProps {
  api: HodApi;
  /** Keeps real and dummy data apart in the query cache. */
  scope: string;
  /** Admins only: the AI trust switch. */
  canSwitchTrust: boolean;
  /** The teacher reviewers tab; the real one when left out (dummy mode passes a fake). */
  reviewerApi?: TeacherReviewerAdminApi;
}

export interface HodTabDef {
  key: string;
  label: string;
  /** What the tab is for, shown as its tooltip. */
  hint: string;
  Component: (props: HodTabProps) => ReactNode;
}

export const TABS: HodTabDef[] = [
  { key: 'needs-you', label: 'Needs you', hint: 'Questions only you can settle: pass, fix, send back to students or set aside.', Component: NeedsYouTab },
  { key: 'ready', label: 'Ready to go live', hint: 'Papers with every question settled. Read one, run the four checks and publish it.', Component: ReadyTab },
  { key: 'uploads', label: 'Uploads', hint: 'Papers students sent in. Approve or reject them.', Component: UploadsTab },
  { key: 'live', label: 'Live papers', hint: 'Every paper in the library. Hide, restore or change its details.', Component: LiveTab },
  { key: 'assignments', label: 'Assignments', hint: 'Who holds which paper, and papers nobody holds.', Component: AssignmentsTab },
  { key: 'verifiers', label: 'Verifiers', hint: 'How each verifier is doing, their details and preferred subjects.', Component: VerifiersTab },
  { key: 'history', label: 'History', hint: 'What HODs, admins and verifiers did.', Component: HistoryTab },
  { key: 'ai-trust', label: 'AI trust', hint: 'How many checks it takes before the AI is trusted, and how often people agree with it.', Component: AiTrustTab },
  { key: 'teacher-reviewers', label: 'Reviewers', hint: 'Who is on the teachers team: add or remove people who approve and edit teachers.', Component: TeacherReviewersTab },
];

export function HodPage({
  api,
  dummy = false,
  banner,
  dummyRoles,
  reviewerApi,
}: {
  api: HodApi;
  dummy?: boolean;
  banner?: ReactNode;
  /** Dummy mode has no sign-in, so the roles the page would read are given here. */
  dummyRoles?: { isAdmin: boolean; isChecker: boolean };
  reviewerApi?: TeacherReviewerAdminApi;
}) {
  usePageMeta('HOD desk | Shikshaq', 'Settle questions, check papers and put them live, and see how each verifier is doing.');
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const scope = dummy ? 'dummy' : 'live';
  const adminBadge = useIsAdminBadge();
  const checkerBadge = useIsCheckerBadge();
  const isAdmin = dummy ? Boolean(dummyRoles?.isAdmin) : adminBadge;
  const isChecker = dummy ? Boolean(dummyRoles?.isChecker) : checkerBadge;

  const [allowed, setAllowed] = useState<boolean | null>(null);
  /** The is_hod() call itself failed: say so, rather than telling an HOD their account is not one. */
  const [checkFailed, setCheckFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!dummy) {
      if (authLoading) return;
      if (!user) {
        navigate('/auth?redirect=' + encodeURIComponent('/hod'));
        return;
      }
    }
    let cancelled = false;
    setCheckFailed(false);
    api
      .isHod()
      .then((ok) => {
        if (!cancelled) setAllowed(ok);
      })
      .catch(() => {
        if (!cancelled) setCheckFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, navigate, api, dummy, attempt]);

  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const active = TABS.find((t) => t.key === resolveTabKey(requested)) ?? TABS[0];
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selectTab = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    // A paper opened in one tab does not follow you to the next.
    next.delete('paper');
    setParams(next, { replace: true });
  };
  // WAI-ARIA tabs: only the selected tab is a Tab stop; arrows, Home and End move and select.
  const onTabKeyDown = (ev: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTabKey(TABS.map((t) => t.key), active.key, ev.key);
    if (!next) return;
    ev.preventDefault();
    selectTab(next);
    tabRefs.current[next]?.focus();
  };
  // The numbers on the tab badges come from one cheap call, kept fresh while the desk is open.
  const countsQ = useQuery({
    queryKey: ['hod', scope, 'counts'],
    queryFn: () => api.deskCounts(),
    enabled: allowed === true,
    staleTime: 15_000,
    refetchOnMount: true,
  });

  // On a narrow screen the tabs scroll as one row. If the selected tab is cut off, bring it
  // into view (horizontally only, so the page does not jump). It re-runs when the badge
  // counts arrive, because they widen the row. A tab already in view is left where it is.
  const tabRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const row = tabRowRef.current;
    const el = tabRefs.current[active.key];
    if (!row || !el) return;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    const view = row.clientWidth;
    if (left >= row.scrollLeft && right <= row.scrollLeft + view) return;
    const target = left - (view - el.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, Math.min(target, row.scrollWidth - view)), behavior: 'auto' });
  }, [active.key, allowed, countsQ.data]);

  if (checkFailed && allowed === null) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-lg py-16">
          {banner}
          <LoadError what="Your access to the HOD desk" onRetry={() => setAttempt((n) => n + 1)} />
        </BentoPanel>
      </BentoStack>
    );
  }

  if ((!dummy && authLoading) || allowed === null) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-5xl px-4 sm:px-5">
          {banner}
          <div className="h-40 animate-pulse rounded-2xl bg-muted" role="status" aria-label="Loading the HOD desk" />
        </BentoPanel>
      </BentoStack>
    );
  }

  if (allowed === false) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <BentoPanel fill="card" edge="top" className="mx-auto max-w-lg py-24 text-center">
          <h1 className="text-balance text-xl font-bold text-foreground">This page is for HODs</h1>
          <p className="mt-2 text-[14px] text-warm-secondary">
            Your account is not set up as a Head of Department. If you should have this, ask an admin to add you.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {isChecker ? (
              <Link to="/checker" className={cn(CHIP, 'bg-brand text-foreground')}>
                Go to My papers
              </Link>
            ) : null}
            <Link to="/" className={cn(CHIP, 'bg-muted text-warm-secondary')}>
              Back to the site
            </Link>
          </div>
        </BentoPanel>
      </BentoStack>
    );
  }

  return (
    <BentoStack className="min-h-screen bg-muted">
      <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-5xl px-4 sm:px-5">
        {banner}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-foreground">HOD desk</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/hod/pipeline" className={cn(CHIP, 'bg-muted text-warm-secondary')}>
              Pipeline
            </Link>
            {isAdmin ? (
              <Link to="/admin" className={cn(CHIP, 'bg-muted text-warm-secondary')}>
                Back to admin
              </Link>
            ) : null}
            {isChecker ? (
              <Link to="/checker" className={cn(CHIP, 'bg-muted text-warm-secondary')}>
                My papers
              </Link>
            ) : null}
          </div>
        </div>

        {/* One row, never a wrap: when the tabs are wider than the card the row scrolls. */}
        <div
          ref={tabRowRef}
          role="tablist"
          aria-label="HOD desk"
          className="relative mb-5 flex w-max max-w-full items-center gap-1 overflow-x-auto rounded-full bg-muted p-1 scrollbar-hide"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[t.key] = el;
              }}
              type="button"
              role="tab"
              id={`hod-tab-${t.key}`}
              aria-selected={active.key === t.key}
              aria-controls="hod-panel"
              tabIndex={active.key === t.key ? 0 : -1}
              title={t.hint}
              onClick={() => selectTab(t.key)}
              onKeyDown={onTabKeyDown}
              className={cn(
                'flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                active.key === t.key ? 'bg-card text-foreground' : 'text-warm-secondary hover:text-foreground',
              )}
            >
              {t.label}
              {tabBadge(t.key, countsQ.data) > 0 ? (
                <span className="inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-brand px-[5px] text-[11px] font-bold tabular-nums text-foreground">
                  <span aria-hidden>{tabBadge(t.key, countsQ.data)}</span>
                  <span className="sr-only">{`: ${tabBadgeLabel(t.key, countsQ.data)}`}</span>
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {countsQ.isError ? (
          <p role="status" className="mt-1 text-[12px] text-warm-meta">
            The numbers on the tabs could not load. The tabs still work.
          </p>
        ) : null}

        <div role="tabpanel" id="hod-panel" aria-labelledby={`hod-tab-${active.key}`}>
          <active.Component api={api} scope={scope} canSwitchTrust={isAdmin} reviewerApi={reviewerApi} />
        </div>
      </BentoPanel>
    </BentoStack>
  );
}
