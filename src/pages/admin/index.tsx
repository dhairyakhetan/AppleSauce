import { lazy, Suspense, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminAuditFooter, AdminTabBar, AdminTopRow, CountsRetry, buildAdminNav, TAB_PILL, tabPillTone } from '@/pages/admin/shell';
import { AdminEmbedProvider } from '@/pages/admin/embed';
import { SECTION_BODY } from '@/pages/admin/sections';
import { resolveSection, resolveTab, sectionBadge, tabSearch, tabSummary } from '@/pages/admin/home-logic';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { AdminPageIntro } from '@/components/admin/AdminHelp';
import { nextTabKey } from '@/components/admin/AdminTabs';
import { AdminLoading } from '@/components/admin/AdminState';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { adminHref, ADMIN_TABS, type AdminTabKey } from '@/lib/admin-hints';
import { adminPrefetchProps } from '@/lib/admin-prefetch';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { cn } from '@/lib/utils';
import { useAdminCountsState, type AdminCountsState } from '@/pages/admin/useAdminSectionCounts';

const DummyAdminHome = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminOverviewDummy')) : null;

/* /admin: the Admin page, laid out like the HOD desk (/hod).

   One title row, one row of four pill tabs, and the tab's content under it:

     People    verifiers, HODs, teacher reviewers, how far the verifiers got
     Teachers  applications, reviews, listed teachers
     Logs      question changes, checker activity, admin actions
     System    the pipeline page, visitor feedback

   The tab is in the address as ?tab= (arrow keys, Home and End move between
   tabs, as on the HOD desk). A tab with more than one part shows them as a
   second row of links, in the address as ?section=. Under that sit the part's
   one sentence and its Help, and then the part itself: the old admin page of that
   name, unchanged, drawn inside the tab (see embed.tsx).

   Papers are not here. Getting a paper checked and live is the HOD desk's job,
   and admins open it too; the "HOD desk" chip carries what is waiting there.
   Every old address (/admin/teachers, /admin/audit, /admin/library and the
   rest) still works: see legacy-routes.tsx.

   The counts are the shared ones (useAdminCountsState, one call to
   admin_nav_counts), so a tab, a section and the sentence under the tabs can
   never disagree. A count that could not be read is "?" and is never treated as
   0. */

export function AdminHomePage({
  dummy = false,
  banner,
  counts: countsProp,
}: {
  dummy?: boolean;
  banner?: ReactNode;
  /** Override the shared counts (tests). Omit to read them live. */
  counts?: AdminCountsState;
}) {
  usePageMeta('Admin | Shikshaq', 'People, teachers, logs and the system, for the people who run Shikshaq.');
  const { user, profile } = useAuth();
  const signedIn = dummy ? 'admin@example.com' : user?.email ?? profile?.full_name ?? 'Signed-in admin';
  const guard = useAdminGuard(dummy ? null : user, { redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const live = useAdminCountsState();
  const counts = countsProp ?? live;

  const [params, setParams] = useSearchParams();
  const tab = resolveTab(params.get('tab'));
  const section = resolveSection(tab, params.get('section'));
  const tabRefs = useRef<Partial<Record<AdminTabKey, HTMLButtonElement | null>>>({});
  const nav = buildAdminNav(tab.key);

  const selectTab = (key: AdminTabKey) => {
    // Only the tab is kept: a filter from the tab being left means nothing on the next.
    setParams(new URLSearchParams(tabSearch(key)), { replace: true });
  };
  const onTabKeyDown = (ev: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTabKey(ADMIN_TABS.map((t) => t.key), tab.key, ev.key);
    if (!next) return;
    ev.preventDefault();
    selectTab(next as AdminTabKey);
    tabRefs.current[next as AdminTabKey]?.focus();
  };

  if (checkingAdmin) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-6xl px-4 py-[14px] sm:px-6 sm:py-[18px] lg:px-6 lg:py-[18px]">
          <AdminTopRow signedInEmail={signedIn} counts={counts} />
          <AdminLoading shape="rows" rows={4} label="Checking your access" className="mt-4" />
        </BentoPanel>
      </BentoStack>
    );
  }
  if (!dummy && guard.error) return <AdminGuardErrorState onRetry={guard.retry} />;
  if (!isAdmin) return null;

  const Body = SECTION_BODY[section.key];
  const countsBroken = counts.status === 'error' || counts.status === 'partial';

  return (
    <BentoStack className="min-h-screen bg-muted">
      <BentoStack className="mx-auto w-full max-w-6xl bg-transparent">
        <BentoPanel fill="card" edge="top" className="px-4 py-[14px] sm:px-6 sm:py-[18px] lg:px-6 lg:py-[18px]">
          <AdminTopRow signedInEmail={signedIn} counts={counts} asHeading />

          <div className="mt-3 sm:mt-4">
            <AdminTabBar
              items={nav}
              activeKey={tab.key}
              counts={counts}
              onSelect={selectTab}
              onKeyDown={onTabKeyDown}
              registerTab={(key, el) => {
                tabRefs.current[key] = el;
              }}
            />
          </div>

          <p className="mt-3 max-w-3xl text-pretty text-[14px] leading-[1.5] text-warm-secondary">{tabSummary(tab, counts)}</p>
          {countsBroken ? <CountsRetry onRetry={counts.refetch} /> : null}

          {tab.sections.length > 1 ? (
            <nav aria-label={`${tab.label} parts`} className="mt-3">
              <ul className="flex flex-wrap items-center gap-1.5">
                {tab.sections.map((s) => {
                  const on = s.key === section.key;
                  const badge = sectionBadge(s.key, counts);
                  const to = adminHref(tab.key, s.key);
                  return (
                    <li key={s.key}>
                      <Link
                        to={to}
                        replace
                        aria-current={on ? 'page' : undefined}
                        {...adminPrefetchProps(to)}
                        className={cn(
                          TAB_PILL,
                          'border border-transparent',
                          on ? 'border-foreground bg-card text-foreground' : cn('bg-muted', tabPillTone(false)),
                        )}
                      >
                        {s.label}
                        {badge ? (
                          <span
                            className={cn(
                              'inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-[5px] text-[11px] font-bold tabular-nums',
                              badge.kind === 'unknown' ? 'bg-card text-warm-secondary' : 'bg-brand text-foreground',
                            )}
                            {...(badge.kind === 'unknown' ? { title: 'Count unavailable' } : {})}
                          >
                            {badge.kind === 'unknown' ? (
                              <>
                                <span aria-hidden>?</span>
                                <span className="sr-only">count unavailable</span>
                              </>
                            ) : (
                              <>
                                {badge.n}
                                <span className="sr-only"> waiting</span>
                              </>
                            )}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : null}

          <AdminPageIntro page={section.page} className="mt-3" />
        </BentoPanel>

        {banner}

        <div role="tabpanel" id="admin-panel" aria-labelledby={`admin-tab-${tab.key}`}>
          <AdminEmbedProvider>
            {/* Keyed by the section, so one section's filters and open dialogs never leak into the next. */}
            <ErrorBoundary context="route" key={section.key}>
              <Suspense
                fallback={
                  <BentoPanel fill="card" className="px-[18px] py-[18px] lg:px-[18px] lg:py-[18px]">
                    <AdminLoading shape="table" rows={6} label={`Loading ${section.label}`} />
                  </BentoPanel>
                }
              >
                <Body />
              </Suspense>
            </ErrorBoundary>
          </AdminEmbedProvider>
        </div>

        {/* The admin actions section is the audit log, so it would only link to itself. */}
        {section.key === 'admin-actions' ? null : <AdminAuditFooter />}
      </BentoStack>
    </BentoStack>
  );
}

export default function AdminHome() {
  if (DummyAdminHome && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyAdminHome />
      </Suspense>
    );
  }
  return <AdminHomePage />;
}
