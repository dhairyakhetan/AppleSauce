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
import { ESCALATIONS_KEY, EscalationsTab } from '@/components/hod/EscalationsTab';
import { HistoryTab } from '@/components/hod/HistoryTab';
import { LoadError } from '@/components/hod/HodShared';
import { VerifiersTab } from '@/components/hod/VerifiersTab';
import { TeacherReviewersTab } from '@/components/hod/TeacherReviewersTab';
import { CHIP } from '@/lib/checker-button-styles';
import { realHodApi, type HodApi } from '@/lib/hod-api';
import type { TeacherReviewerAdminApi } from '@/lib/teacher-review-api';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { cn } from '@/lib/utils';

/* /hod: the Head of Department view (owner, 7 Oct 2026). Separate from the
   checker's own screen: it shows what checkers sent up, how each checker is
   doing, who holds which paper, and how far the AI has earned trust. Open to
   HODs and admins; everyone else gets a polite "not for you" page. The server
   checks is_hod() on every call, so this guard only decides what is drawn.

   TABS is the one list to extend: add an entry and its component and it
   shows up in the tab row, the URL (?tab=) and the keyboard order.

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
  { key: 'escalated', label: 'Escalated to me', hint: 'Questions verifiers could not settle and sent to you.', Component: EscalationsTab },
  { key: 'assignments', label: 'Assignments', hint: 'Who holds which paper, and papers nobody holds.', Component: AssignmentsTab },
  { key: 'verifiers', label: 'Verifiers', hint: 'How each verifier is doing, their details and preferred subjects.', Component: VerifiersTab },
  { key: 'history', label: 'History', hint: 'What HODs, admins and verifiers did.', Component: HistoryTab },
  { key: 'ai-trust', label: 'AI trust', hint: 'How often people agree with the AI, level by level.', Component: AiTrustTab },
  { key: 'teacher-reviewers', label: 'Teacher reviewers', hint: 'Who is on the teachers team: add or remove people who approve and edit teachers.', Component: TeacherReviewersTab },
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
  usePageMeta('HOD desk | Shikshaq', 'What verifiers sent up, how each verifier is doing and who holds which paper.');
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
  const active = TABS.find((t) => t.key === requested) ?? TABS[0];
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selectTab = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
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

  const escalationsQ = useQuery({
    queryKey: ESCALATIONS_KEY(scope),
    queryFn: () => api.escalations(),
    enabled: allowed === true,
    staleTime: 15_000,
    refetchOnMount: true,
  });
  const waiting = escalationsQ.data?.length ?? 0;

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
        <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-5xl">
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
      <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-5xl">
        {banner}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-foreground">HOD desk</h1>
          <div className="flex flex-wrap items-center gap-2">
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

        <div role="tablist" aria-label="HOD desk" className="mb-5 flex max-w-full flex-wrap items-center gap-1 rounded-[20px] bg-muted p-1 sm:inline-flex sm:rounded-full">
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
                'flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                active.key === t.key ? 'bg-card text-foreground' : 'text-warm-secondary hover:text-foreground',
              )}
            >
              {t.label}
              {t.key === 'escalated' && waiting > 0 ? (
                <span className="inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-brand px-[5px] text-[11px] font-bold tabular-nums text-foreground">
                  {waiting}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div role="tabpanel" id="hod-panel" aria-labelledby={`hod-tab-${active.key}`}>
          <active.Component api={api} scope={scope} canSwitchTrust={isAdmin} reviewerApi={reviewerApi} />
        </div>
      </BentoPanel>
    </BentoStack>
  );
}
