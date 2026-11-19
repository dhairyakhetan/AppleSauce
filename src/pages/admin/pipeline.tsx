import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAuth } from '@/lib/auth-context';
import { useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminStack } from '@/pages/admin/embed';
import { AdminPageIntroPanel } from '@/components/admin/AdminHelp';
import { AdminLoading } from '@/components/admin/AdminState';
import { BentoPanel } from '@/components/layout/PageContainer';
import { useAdminSectionCounts } from '@/pages/admin/useAdminSectionCounts';
import { type FeedRow, type PipelineApi, type PipelineStats, readPipeline } from '@/lib/pipeline-stats';
import { realPipelineApi } from '@/lib/pipeline-api';
import { PipelineRoute } from '@/components/admin/PipelineRoute';
import { PipelineDetailFold, DayBars, StatsPanel, type StatsStatus } from '@/components/admin/PipelineDetail';
import { realPipelineRouteApi, type PipelineRouteApi } from '@/lib/pipeline-route';
import { realPaperRegistryApi } from '@/lib/paper-registry-api';
import type { PaperRegistryApi, ProcessedState } from '@/lib/paper-registry';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';

// The panels moved to components/admin/PipelineDetail.tsx so /hod/pipeline can draw the same ones.
export { DayBars, StatsPanel };
export type { StatsStatus };

const DummyAdminPipeline = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminPipelineDummy')) : null;

/* The pipeline overview: the System tab of /admin (owner 2026-10-02: "how many
   papers, last papers ... graphs stats logs etc in one place"; 2026-10-12:
   "one pipeline overview page ... brought up to speed with this entire new way
   of working", for admin AND HOD).

   The top of the page is the papers route (PipelineRoute): PDFs saved on the
   main computer, read by the AI, pictures waiting, checking by students, needs
   you, ready to go live, live, with the time of the desk's last sync. It comes
   from admin_pipeline_route(), which HODs may call too; HODs get the same route
   on /hod/pipeline (pages/HodPipeline.tsx).

   Under it, folded away, is the admin-only detail: the desk's list of every
   paper (admin_paper_registry*), the library numbers and newest papers
   (admin_pipeline_stats()) and the activity log (admin_activity_feed()). No
   question text reaches this page.

   - Only the admin check gates the page. The header, the intro, the route and
     the paper registry always render; each stats panel has its own skeleton or
     its own error with Try again.
   - The old "Needs attention" strip and "Checking" panel are gone: they counted
     the frozen earlier-library copies too, so they disagreed with the route.
   - Each panel says what it counts, because PDFs, desk papers and library
     papers are three different totals.
   - Words match the library's: Verified = published and checked, Needs review
     = published but not fully checked, Hidden = not published. */

export function AdminPipelinePage({
  api = realPipelineApi,
  registryApi = realPaperRegistryApi,
  routeApi = realPipelineRouteApi,
  dummy = false,
  banner,
}: {
  api?: PipelineApi;
  /** The paper registry (processed / not processed); a fake in dummy mode. */
  registryApi?: PaperRegistryApi;
  /** The papers route at the top of the page; a fake in dummy mode. */
  routeApi?: PipelineRouteApi;
  /** Dummy mode (D75): no sign-in, no real admin check, a fake API. */
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Pipeline | Shikshaq Admin', 'How far each batch of papers has got, from scan to live.');
  const { user, profile } = useAuth();
  const signedInName = dummy ? 'admin@example.com' : profile?.full_name || user?.email || 'Signed-in admin';
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  // The log can fail on its own without blanking the numbers; a failed read is never shown as "no activity".
  const [feedFailed, setFeedFailed] = useState(false);
  const [status, setStatus] = useState<StatsStatus>('loading');
  const [focus, setFocus] = useState<{ states: ProcessedState[]; nonce: number } | null>(null);
  // The paper list and the library numbers are folded away under the route. A stop that filters the list opens the fold.
  const [foldOpen, setFoldOpen] = useState(false);

  const guard = useAdminGuard(dummy ? null : user, {
    onGranted: load,
    redirectOnDenied: !dummy,
  });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const { error: adminGuardError, retry: retryAdminGuard } = guard;
  const sectionCounts = useAdminSectionCounts();

  useEffect(() => {
    if (dummy) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dummy]);

  async function load() {
    setStatus('loading');
    try {
      const { stats: s, feed: f } = await readPipeline(api, 40);
      setStats(s);
      setFeed(f ?? []);
      setFeedFailed(f === null);
      setStatus('ok');
    } catch (e) {
      if (import.meta.env.DEV) console.error('pipeline stats', e);
      setStatus('error');
    }
  }

  const showRegistry = (states: ProcessedState[]) => {
    setFoldOpen(true);
    setFocus({ states, nonce: Date.now() });
  };

  // The list may have been folded a moment ago, so scroll once the fold has opened.
  useEffect(() => {
    if (!focus) return;
    const id = window.requestAnimationFrame(() => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      document.getElementById('paper-registry')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [focus]);

  const nav = buildAdminNav('pipeline', sectionCounts);

  if (checkingAdmin) {
    return (
      <AdminStack>
        <AdminHeader nav={nav} signedInEmail={dummy ? 'admin@example.com' : user?.email ?? signedInName} />
        <BentoPanel fill="card" className="px-[18px] py-[18px] lg:px-[18px] lg:py-[18px]">
          <AdminLoading shape="tiles" rows={4} label="Loading the pipeline" />
        </BentoPanel>
        <AdminAuditNote />
      </AdminStack>
    );
  }

  if (adminGuardError && !dummy) return <AdminGuardErrorState onRetry={retryAdminGuard} />;
  if (!isAdmin) return null;

  return (
    <AdminStack>
      <AdminHeader nav={nav} signedInEmail={dummy ? 'admin@example.com' : user?.email ?? signedInName} />
      <AdminPageIntroPanel page="pipeline" />
      {banner}

      <PipelineRoute api={routeApi} audience="admin" onShowRegistry={showRegistry} />

      <PipelineDetailFold
        audience="admin"
        stats={stats}
        status={status}
        onRetry={() => void load()}
        feed={feed}
        feedFailed={feedFailed}
        registryApi={registryApi}
        focus={focus}
        open={foldOpen}
        onOpenChange={setFoldOpen}
      />

      <AdminAuditNote />
    </AdminStack>
  );
}

export default function AdminPipeline() {
  if (DummyAdminPipeline && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyAdminPipeline />
      </Suspense>
    );
  }
  return <AdminPipelinePage />;
}
