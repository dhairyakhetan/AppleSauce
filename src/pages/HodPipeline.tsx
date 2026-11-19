import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { usePageMeta } from '@/hooks/usePageMeta';
import { PipelineRoute } from '@/components/admin/PipelineRoute';
import { PipelineDetailFold, type StatsStatus } from '@/components/admin/PipelineDetail';
import { LoadError } from '@/components/hod/HodShared';
import { isHod } from '@/lib/hod-api';
import { realPipelineRouteApi, type PipelineRouteApi } from '@/lib/pipeline-route';
import { hodPipelineStatsApi } from '@/lib/pipeline-api';
import { hodPaperRegistryApi } from '@/lib/paper-registry-api';
import type { PipelineApi, PipelineStats } from '@/lib/pipeline-stats';
import type { PaperRegistryApi, ProcessedState } from '@/lib/paper-registry';
import { CHIP } from '@/lib/checker-button-styles';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { cn } from '@/lib/utils';

const DummyHodPipeline = PREVIEW_TOOLS ? lazy(() => import('@/dummy/HodPipelineDummy')) : null;

/* /hod/pipeline: the pipeline overview for HODs (owner, 12 October 2026: "one
   pipeline overview page ... for admin AND HOD", then "HODs may see the whole
   Admin pipeline page").

   It is the same page the Admin System tab shows: the papers route
   (admin_pipeline_route(), which lets HODs and admins in and refuses everyone
   else with a 42501), then the folded detail: the desk's list of every paper,
   the library numbers, the newest papers and the trends. The detail comes from
   the hod_* twins of the admin reads (hod_registry_summary, hod_registry,
   hod_pipeline_stats; migration 20261012600000), each of which checks is_hod()
   inside. The guard below is the polite version of that refusal.

   What an HOD does not get: the Activity panel. admin_activity_feed() returns
   account ids and free text, so it stays admin-only and the panel is not drawn.
   A paper in the lists links to nothing in /admin; every link on the route goes
   to a tab of the HOD desk, which an HOD can open.

   The HOD desk header links here (one Link in Hod.tsx). In a test build with
   dummy mode on it runs against the in-memory fakes (src/dummy/HodPipelineDummy.tsx). */

export default function HodPipeline() {
  if (DummyHodPipeline && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyHodPipeline />
      </Suspense>
    );
  }
  return <HodPipelinePage />;
}

export function HodPipelinePage({
  routeApi = realPipelineRouteApi,
  statsApi = hodPipelineStatsApi,
  registryApi = hodPaperRegistryApi,
  dummy = false,
  banner,
  checkAccess = isHod,
}: {
  routeApi?: PipelineRouteApi;
  /** The library numbers (hod_pipeline_stats); a fake in dummy mode. */
  statsApi?: Pick<PipelineApi, 'stats'>;
  /** The paper list (hod_registry*); a fake in dummy mode. */
  registryApi?: PaperRegistryApi;
  /** Dummy mode (D75): no sign-in, no real HOD check, a fake API. */
  dummy?: boolean;
  banner?: ReactNode;
  /** The is_hod() call; tests and dummy mode hand in their own. */
  checkAccess?: () => Promise<boolean>;
}) {
  usePageMeta('Pipeline | HOD desk | Shikshaq', 'Every paper on its way from a PDF saved on the main computer to live.');
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(dummy ? true : null);
  /** The is_hod() call itself failed: say so, rather than telling an HOD their account is not one. */
  const [checkFailed, setCheckFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [statsStatus, setStatsStatus] = useState<StatsStatus>('loading');
  const [statsAttempt, setStatsAttempt] = useState(0);
  const [focus, setFocus] = useState<{ states: ProcessedState[]; nonce: number } | null>(null);
  const [foldOpen, setFoldOpen] = useState(false);

  useEffect(() => {
    if (dummy) return;
    if (authLoading) return;
    if (!user) {
      navigate('/auth?redirect=' + encodeURIComponent('/hod/pipeline'));
      return;
    }
    let cancelled = false;
    setCheckFailed(false);
    checkAccess()
      .then((ok) => {
        if (!cancelled) setAllowed(ok);
      })
      .catch(() => {
        if (!cancelled) setCheckFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, navigate, dummy, checkAccess, attempt]);

  // The library numbers load once access is known. A failed read shows its own Try again, never a 0.
  useEffect(() => {
    if (allowed !== true) return;
    let cancelled = false;
    setStatsStatus('loading');
    statsApi
      .stats()
      .then((s) => {
        if (cancelled) return;
        setStats(s);
        setStatsStatus('ok');
      })
      .catch(() => {
        if (!cancelled) setStatsStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, statsApi, statsAttempt]);

  // A stop that filters the list opens the fold, then scrolls to the list.
  useEffect(() => {
    if (!focus) return;
    const id = window.requestAnimationFrame(() => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      document.getElementById('paper-registry')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [focus]);

  const showRegistry = (states: ProcessedState[]) => {
    setFoldOpen(true);
    setFocus({ states, nonce: Date.now() });
  };

  if (checkFailed && allowed === null) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-lg py-16">
          {banner}
          <LoadError what="Your access to the pipeline" onRetry={() => setAttempt((n) => n + 1)} />
        </BentoPanel>
      </BentoStack>
    );
  }

  if ((!dummy && authLoading) || allowed === null) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-5xl">
          {banner}
          <div className="h-40 animate-pulse rounded-2xl bg-muted" role="status" aria-label="Loading the pipeline" />
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
      <BentoStack className="mx-auto w-full max-w-6xl bg-transparent">
        <BentoPanel fill="card" edge="top" className="px-5 py-5 lg:px-8 lg:py-8">
          {banner}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-lg font-bold text-foreground">Pipeline</h1>
            <Link to="/hod" className={cn(CHIP, 'bg-muted text-warm-secondary')}>
              Back to the HOD desk
            </Link>
          </div>
          <p className="mt-2 max-w-3xl text-pretty text-[14px] leading-[1.5] text-warm-secondary">
            Every paper on its way from a PDF saved on the main computer to live. A stage with an arrow opens its tab on the HOD desk.
          </p>
        </BentoPanel>
        <PipelineRoute api={routeApi} audience="hod" onShowRegistry={showRegistry} />
        <PipelineDetailFold
          audience="hod"
          stats={stats}
          status={statsStatus}
          onRetry={() => setStatsAttempt((n) => n + 1)}
          registryApi={registryApi}
          focus={focus}
          open={foldOpen}
          onOpenChange={setFoldOpen}
        />
      </BentoStack>
    </BentoStack>
  );
}
