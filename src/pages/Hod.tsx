import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useIsAdminBadge } from '@/hooks/useIsAdminBadge';
import { useIsCheckerBadge } from '@/hooks/useIsCheckerBadge';
import { nextTabKey } from '@/components/admin/AdminTabs';
import { AssignmentsTab, UNASSIGNED_KEY } from '@/components/hod/AssignmentsTab';
import { AiTrustTab } from '@/components/hod/AiTrustTab';
import { HistoryTab } from '@/components/hod/HistoryTab';
import { HodStageStrip } from '@/components/hod/HodStageStrip';
import { LoadError } from '@/components/hod/HodShared';
import { LiveTab } from '@/components/hod/LiveTab';
import { NeedsYouTab } from '@/components/hod/NeedsYouTab';
import { ReadyTab } from '@/components/hod/ReadyTab';
import { RequestsTab } from '@/components/hod/RequestsTab';
import { SendToAiTab } from '@/components/hod/SendToAiTab';
import { UploadsTab } from '@/components/hod/UploadsTab';
import { VerifiersTab } from '@/components/hod/VerifiersTab';
import { TeacherReviewersTab } from '@/components/hod/TeacherReviewersTab';
import { CHIP } from '@/lib/checker-button-styles';
import { realHodApi, type HodApi } from '@/lib/hod-api';
import { resolveTabKey, tabBadge, tabBadgeLabel, tabBadgeText } from '@/lib/hod-tabs';
import { UNASSIGNED_SHOWN } from '@/lib/hod-desk';
import { sendToAiBadgeLabel } from '@/lib/hod-send-to-ai';
import type { TeacherReviewerAdminApi } from '@/lib/teacher-review-api';
import { realFixRequestsApi, type FixRequestsApi } from '@/lib/fix-requests-api';
import type { PaperAsksApi } from '@/lib/paper-asks-api';
import { requestsCountsKey, waitingCount } from '@/lib/fix-requests';
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
  /** The requests tab; the real one when left out (dummy mode passes a fake). */
  requestsApi?: FixRequestsApi;
  /** The "Waiting for papers" list on Assignments; the real one when left out (dummy mode passes a fake). */
  asksApi?: PaperAsksApi;
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
  { key: 'send-to-ai', label: 'Send to AI', hint: 'Questions waiting for the AI to read them again, with the reason a student or an HOD gave.', Component: SendToAiTab },
  { key: 'ready', label: 'Ready to go live', hint: 'Papers with every question settled. Read one, run the four checks and publish it.', Component: ReadyTab },
  { key: 'uploads', label: 'Uploads', hint: 'Papers students sent in. Approve or reject them.', Component: UploadsTab },
  { key: 'requests', label: 'Requests', hint: 'Problems and changes people have asked for. Say yes or no to what checkers send in, or send your own.', Component: RequestsTab },
  { key: 'live', label: 'Live papers', hint: 'Every paper in the library. Hide, restore or change its details.', Component: LiveTab },
  { key: 'assignments', label: 'Assignments', hint: 'Who holds which paper, and papers nobody holds.', Component: AssignmentsTab },
  { key: 'verifiers', label: 'Checkers', hint: 'How each checker is doing, their details and preferred subjects.', Component: VerifiersTab },
  { key: 'history', label: 'History', hint: 'What HODs, admins and checkers did.', Component: HistoryTab },
  { key: 'ai-trust', label: 'AI trust', hint: 'How many checks it takes before the AI is trusted, and how often people agree with it.', Component: AiTrustTab },
  { key: 'teacher-reviewers', label: 'Reviewers', hint: 'Who is on the teachers team: add or remove people who approve and edit teachers.', Component: TeacherReviewersTab },
];

export function HodPage({
  api,
  dummy = false,
  banner,
  dummyRoles,
  reviewerApi,
  requestsApi,
  asksApi,
}: {
  api: HodApi;
  dummy?: boolean;
  banner?: ReactNode;
  /** Dummy mode has no sign-in, so the roles the page would read are given here. */
  dummyRoles?: { isAdmin: boolean; isChecker: boolean };
  reviewerApi?: TeacherReviewerAdminApi;
  requestsApi?: FixRequestsApi;
  asksApi?: PaperAsksApi;
}) {
  usePageMeta('HOD desk | Shikshaq', 'Settle questions, check papers and put them live, and see how each checker is doing.');
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
  // The requests waiting for the HOD are their own call. If it fails the tab just shows no number.
  const requestsCountQ = useQuery({
    queryKey: requestsCountsKey(scope),
    queryFn: () => (requestsApi ?? realFixRequestsApi).counts(),
    enabled: allowed === true,
    staleTime: 15_000,
    refetchOnMount: true,
  });
  const requestsWaiting = waitingCount(requestsCountQ.data);
  // Papers waiting to be handed out, for the number on Assignments. The same read (and key) as the strip of counts and
  // the list itself, so it costs nothing extra. If it fails the tab just shows no number.
  const freeQ = useQuery({
    queryKey: UNASSIGNED_KEY(scope),
    queryFn: () => api.unassignedPapers(UNASSIGNED_SHOWN + 1),
    enabled: allowed === true,
    staleTime: 10_000,
  });
  const freePapers = freeQ.data?.length ?? 0;
  // Questions waiting for an HOD's yes or no, or for the AI, for the number on Send to AI. If the database file is not
  // pasted yet (or the call fails) the tab just shows no number.
  const aiCountQ = useQuery({
    queryKey: ['hod', scope, 'ai-redo-count'],
    queryFn: () => api.aiRedoCount(),
    enabled: allowed === true,
    staleTime: 15_000,
  });
  const aiWaiting = aiCountQ.data ?? 0;

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
  }, [active.key, allowed, countsQ.data, requestsWaiting, freePapers, aiWaiting]);

  // Eleven tabs do not fit on a phone or a 1366 px laptop. The row still scrolls, but it now says so: a fade and an
  // arrow button at each edge that has tabs beyond it (owner, 26 Nov 2026: the last tabs were hidden with no sign).
  const [edges, setEdges] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  const measureTabs = useCallback(() => {
    const row = tabRowRef.current;
    if (!row) return;
    const next = { left: row.scrollLeft > 2, right: row.scrollLeft + row.clientWidth < row.scrollWidth - 2 };
    setEdges((cur) => (cur.left === next.left && cur.right === next.right ? cur : next));
  }, []);
  useEffect(() => {
    measureTabs();
    const row = tabRowRef.current;
    row?.addEventListener('scroll', measureTabs, { passive: true });
    window.addEventListener('resize', measureTabs);
    return () => {
      row?.removeEventListener('scroll', measureTabs);
      window.removeEventListener('resize', measureTabs);
    };
  }, [measureTabs, allowed, countsQ.data, requestsWaiting, freePapers, aiWaiting, active.key]);
  const scrollTabs = (dir: -1 | 1) => {
    const row = tabRowRef.current;
    if (!row) return;
    row.scrollBy({ left: dir * Math.max(160, row.clientWidth * 0.6), behavior: 'smooth' });
  };

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

        {/* How many papers are at each stage; tapping one opens the list that holds them. */}
        <HodStageStrip api={api} scope={scope} />

        {/* One row, never a wrap: when the tabs are wider than the card the row scrolls, and each edge with tabs beyond
            it shows a fade and an arrow, so the last tabs (AI trust, Reviewers) are never hidden without a sign. */}
        <div className="relative mb-5 w-max max-w-full" data-testid="hod-tab-row">
        <div
          ref={tabRowRef}
          role="tablist"
          aria-label="HOD desk"
          className="relative flex w-max max-w-full items-center gap-1 overflow-x-auto rounded-full bg-muted p-1 scrollbar-hide"
        >
          {TABS.map((t) => {
            // Assignments counts the papers waiting to be handed out (its own read); every other tab keeps its badge as before.
            const badge = t.key === 'assignments' ? freePapers : tabBadge(t.key, countsQ.data, requestsWaiting);
            const shown = t.key === 'send-to-ai' ? aiWaiting : badge;
            return (
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
                'flex h-11 md:h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                active.key === t.key ? 'bg-card text-foreground' : 'text-warm-secondary hover:text-foreground',
              )}
            >
              {t.label}
              {shown > 0 ? (
                <span className="inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-brand px-[5px] text-[11px] font-bold tabular-nums text-foreground">
                  <span aria-hidden>{tabBadgeText(t.key, shown)}</span>
                  <span className="sr-only">{`: ${t.key === 'send-to-ai' ? sendToAiBadgeLabel(aiWaiting) : tabBadgeLabel(t.key, countsQ.data, requestsWaiting, freePapers)}`}</span>
                </span>
              ) : null}
            </button>
            );
          })}
        </div>
          {/* The arrows only scroll the row; the keyboard already moves between tabs with the arrow keys, so they are
              left out of the Tab order and hidden from screen readers. */}
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-y-0 left-0 w-16 rounded-l-full bg-gradient-to-r from-muted to-transparent transition-opacity duration-150',
              edges.left ? 'opacity-100' : 'opacity-0',
            )}
          />
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-y-0 right-0 w-16 rounded-r-full bg-gradient-to-l from-muted to-transparent transition-opacity duration-150',
              edges.right ? 'opacity-100' : 'opacity-0',
            )}
          />
          {edges.left ? (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => scrollTabs(-1)}
              className="absolute left-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-card text-foreground shadow-button transition-transform duration-150 active:scale-press-small md:h-10 md:w-10"
              data-testid="tabs-left"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}
          {edges.right ? (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => scrollTabs(1)}
              className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-card text-foreground shadow-button transition-transform duration-150 active:scale-press-small md:h-10 md:w-10"
              data-testid="tabs-right"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          ) : null}
        </div>
        {countsQ.isError ? (
          <p role="status" className="mt-1 text-[12px] text-warm-meta">
            The numbers on the tabs could not load. The tabs still work.
          </p>
        ) : null}

        <div role="tabpanel" id="hod-panel" aria-labelledby={`hod-tab-${active.key}`}>
          <active.Component api={api} scope={scope} canSwitchTrust={isAdmin} reviewerApi={reviewerApi} requestsApi={requestsApi} asksApi={asksApi} />
        </div>
      </BentoPanel>
    </BentoStack>
  );
}
