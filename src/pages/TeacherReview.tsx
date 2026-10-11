import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useIsAdminBadge } from '@/hooks/useIsAdminBadge';
import { ApplicationsTab } from '@/components/teacher-review/ApplicationsTab';
import { TeachersTab } from '@/components/teacher-review/TeachersTab';
import { CHIP } from '@/lib/checker-button-styles';
import { APPLICATIONS_KEY, realTeacherReviewApi, type TeacherReviewApi } from '@/lib/teacher-review-api';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { cn } from '@/lib/utils';

/* /teacher-review: the teachers team's own page (owner, 8 Oct 2026). A
   reviewer approves, rejects and edits teachers without being an admin, and
   sees their phone and email. Open to reviewers and admins; everyone else gets
   a polite "not for you" page. The server checks is_teacher_reviewer() on every
   call, so this guard only decides what is drawn.

   TABS is the one list to extend. In a test build with dummy mode on, the same
   page runs against an in-memory fake with no sign-in
   (src/dummy/TeacherReviewDummy.tsx). */

const DummyTeacherReview = PREVIEW_TOOLS ? lazy(() => import('@/dummy/TeacherReviewDummy')) : null;

export default function TeacherReview() {
  if (DummyTeacherReview && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyTeacherReview />
      </Suspense>
    );
  }
  return <TeacherReviewPage api={realTeacherReviewApi} />;
}

export interface ReviewTabProps {
  api: TeacherReviewApi;
  /** Keeps real and dummy data apart in the query cache. */
  scope: string;
}

export interface ReviewTabDef {
  key: string;
  label: string;
  hint: string;
  Component: (props: ReviewTabProps) => ReactNode;
}

export const TABS: ReviewTabDef[] = [
  { key: 'applications', label: 'Applications', hint: 'Teachers who asked to join: approve, reject or fix their details.', Component: ApplicationsTab },
  { key: 'teachers', label: 'Listed teachers', hint: 'Teachers already on the site: find one and fix their details.', Component: TeachersTab },
];

export function TeacherReviewPage({ api, dummy = false, banner }: { api: TeacherReviewApi; dummy?: boolean; banner?: ReactNode }) {
  usePageMeta('Review teachers | Shikshaq', 'Approve, reject and edit teachers who want to be listed on Shikshaq.');
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const scope = dummy ? 'dummy' : 'live';
  const isAdmin = useIsAdminBadge();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!dummy) {
      if (authLoading) return;
      if (!user) {
        navigate('/auth?redirect=' + encodeURIComponent('/teacher-review'));
        return;
      }
    }
    let cancelled = false;
    api.isReviewer().then((ok) => {
      if (!cancelled) setAllowed(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, navigate, api, dummy]);

  const [params, setParams] = useSearchParams();
  const active = TABS.find((t) => t.key === params.get('tab')) ?? TABS[0];

  const waitingQ = useQuery({
    queryKey: APPLICATIONS_KEY(scope),
    queryFn: () => api.applications(),
    enabled: allowed === true,
    staleTime: 15_000,
  });
  const waiting = (waitingQ.data ?? []).filter((a) => a.status === 'pending').length;

  if ((!dummy && authLoading) || allowed === null) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-5xl">
          {banner}
          <div className="h-40 animate-pulse rounded-2xl bg-muted" role="status" aria-label="Loading the teacher review page" />
        </BentoPanel>
      </BentoStack>
    );
  }

  if (allowed === false) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <BentoPanel fill="card" edge="top" className="mx-auto max-w-lg py-24 text-center">
          <h1 className="text-balance text-xl font-bold text-foreground">This page is for teacher reviewers</h1>
          <p className="mt-2 text-[14px] text-warm-secondary">
            Your account is not on the teachers team. If you should have this, ask an HOD or an admin to add you.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
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
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-foreground">Review teachers</h1>
            <span className="rounded-full bg-success-subtle-bg px-2.5 py-1 text-[12px] font-bold text-success-subtle-text">Teachers team</span>
          </div>
          {isAdmin ? (
            <Link to="/admin" className={cn(CHIP, 'bg-muted text-warm-secondary')}>
              Back to admin
            </Link>
          ) : null}
        </div>

        <div role="tablist" aria-label="Review teachers" className="mb-5 flex max-w-full flex-wrap items-center gap-1 rounded-[20px] bg-muted p-1 sm:inline-flex sm:rounded-full">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              id={`review-tab-${t.key}`}
              aria-selected={active.key === t.key}
              aria-controls="review-panel"
              title={t.hint}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('tab', t.key);
                setParams(next, { replace: true });
              }}
              className={cn(
                'flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                active.key === t.key ? 'bg-card text-foreground' : 'text-warm-secondary hover:text-foreground',
              )}
            >
              {t.label}
              {t.key === 'applications' && waiting > 0 ? (
                <span className="inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-success-subtle-bg px-[5px] text-[11px] font-bold tabular-nums text-success-subtle-text">
                  {waiting}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div role="tabpanel" id="review-panel" aria-labelledby={`review-tab-${active.key}`}>
          <active.Component api={api} scope={scope} />
        </div>
      </BentoPanel>
    </BentoStack>
  );
}
