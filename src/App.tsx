import { LOCALITY_PAGE_PATHS } from "./content/locality-paths.generated";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from "react-router-dom";
import { installRoutePrefetch } from "@/lib/route-prefetch";
import { lazy, Suspense, type ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-context";
import { AdminDebugProvider } from "@/lib/admin-debug";
import { PreviewRoleToggle } from "@/components/PreviewRoleToggle";
import { IntentProvider } from "@/lib/intent-context";
import { IntentDebugPanel } from "@/components/IntentDebugPanel";
import { LikesProvider } from "@/lib/likes-context";
import { UpvotesProvider } from "@/lib/upvotes-context";
import { StudiesWithProvider } from "@/lib/studies-with-context";
import { ScrollManager } from "@/components/ScrollManager";
import { DelayedFallback } from "@/components/DelayedFallback";
import { CanonicalTag } from "@/components/CanonicalTag";
import { AppShell } from "@/components/layout/AppShell";
import { PageLoader } from "@/components/layout/PageLoader";
/* Chatbot (642 lines), ProductTour (504 lines) and the one-time
   PapersLiveAnnouncement banner are none of them needed for first paint —
   all three are floating/overlay widgets mounted once at the app root
   regardless of route, not primary page content, so a few ms of delay after
   the real page paints is invisible. Lazy rather than eager cuts ~1150
   lines of component code (plus whatever each one pulls in) out of the
   critical main chunk every visitor downloads before Index can render. */
const Chatbot = lazy(() => import("@/components/Chatbot").then((m) => ({ default: m.Chatbot })));
const ProductTourHost = lazy(() => import("@/components/ProductTour").then((m) => ({ default: m.ProductTourHost })));
const PapersLiveAnnouncement = lazy(() => import("@/components/papers/papers-live-announcement"));
/* Index stays EAGER: it is the landing route, so code-splitting it would only
   add a round trip before first paint. Everything else is lazy - an /impeccable
   audit flagged a 474KB main chunk with 10 pages bundled in eagerly. */
import Index from "./pages/Index";
import { ErrorBoundary } from '@/components/ErrorBoundary';
/* SchoolPage (618 lines) had no comment claiming a reason to be eager like
   Index's above it, and /school/:slug is a secondary route nobody lands on
   as often as Home — no reason for every visitor to pay for it upfront.
   Sandbox is a dev-only tool (its own route below is gated on
   import.meta.env.DEV) that should never have been in a shipped bundle's
   eager path in the first place. */
const Sandbox = lazy(() => import("@/pages/Sandbox"));
const SchoolPage = lazy(() => import("@/pages/SchoolPage"));
const Browse = lazy(() => import("./pages/Browse"));
const Auth = lazy(() => import("./pages/Auth"));
const TeacherProfile = lazy(() => import("./pages/TeacherProfile"));
const Help = lazy(() => import("./pages/Help"));
const FAQ = lazy(() => import("./pages/FAQ"));
const Join = lazy(() => import("./pages/Join"));
const SubmitPaper = lazy(() => import("./pages/SubmitPaper"));
const BankPaper = lazy(() => import("./pages/BankPaper"));
const JoinApply = lazy(() => import("./pages/JoinApply"));
const PastPapers = lazy(() => import("./pages/PastPapers"));
const PaperResults = lazy(() => import("./pages/PaperResults"));
const PaperReader = lazy(() => import("./pages/PaperReader"));
const About = lazy(() => import("./pages/About"));
const Contact = lazy(() => import("./pages/Contact"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const SubjectsPage = lazy(() => import("./pages/SubjectsPage"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogPost = lazy(() => import("./pages/BlogPost"));
const SchoolsPage = lazy(() => import("./pages/SchoolsPage"));

// Lazy load heavy components for better performance on mobile
const SubjectPage = lazy(() => import("./pages/SubjectPage"));
const LocalityPage = lazy(() => import("./pages/LocalityPage"));
const WhatsAppRedirect = lazy(() => import("./pages/WhatsAppRedirect"));
const BoardPage = lazy(() => import("./pages/BoardPage"));
const RecommendTeacher = lazy(() => import("./pages/RecommendTeacher"));
const AdminOverview = lazy(() => import("./pages/admin/index"));
const AdminApprovals = lazy(() => import("./pages/admin/approvals"));
const AdminTeachersPage = lazy(() => import("./pages/admin/teachers"));
const AdminPapersPage = lazy(() => import("./pages/admin/papers"));
const AdminReviews = lazy(() => import("./pages/admin/reviews"));
const AdminFeedbackPage = lazy(() => import("./pages/admin/feedback"));
const AdminCheckersPage = lazy(() => import("./pages/admin/checkers"));
const AdminAuditLog = lazy(() => import("./pages/admin/audit"));
const AdminPipelinePage = lazy(() => import("./pages/admin/pipeline"));
const AdminLibrary = lazy(() => import("./pages/admin/library"));
const AdminQueue = lazy(() => import("./pages/admin/admin-queue"));
const AdminTeamPage = lazy(() => import("./pages/admin/team"));
const AdminPaperEdit = lazy(() => import("./pages/admin/paper-edit"));
const AdminActivityPage = lazy(() => import("./pages/admin/activity"));
const AdminPaperApprovals = lazy(() => import("./pages/admin/paper-approvals"));
const AdminPaperApproval = lazy(() => import("./pages/admin/paper-approval"));
const AdminCheckerLog = lazy(() => import("./pages/admin/checker-log"));
const AdminCheckerLogPerson = lazy(() => import("./pages/admin/checker-log-person"));
/* Paper checker (Kid Mode) -- W1. A route only paper checkers/admins can
   open (see is_paper_checker(), checked client-side inside the page
   itself); lazy like every other secondary route. */
const Checker = lazy(() => import("./pages/Checker"));
/* Checker onboarding: the optional practice round and the help page. Neither
   needs a sign-in (nothing secret, nothing saved); /checker keeps its guard. */
const CheckerPractice = lazy(() => import("./pages/CheckerPractice"));
const CheckerHelp = lazy(() => import("./pages/CheckerHelp"));
/* The Head of Department view: escalations, team, assignments, AI trust. */
const Hod = lazy(() => import("./pages/Hod"));
/* Teacher review (teachers team): approve, reject and edit teachers without admin. */
const TeacherReview = lazy(() => import("./pages/TeacherReview"));
/* LikedTeachers / MyTeachers are NOT lazy-imported here any more. Their two
   routes redirect into /account (see the O-05 note below) and neither
   component was rendered, but the `lazy()` calls still made Vite emit a chunk
   for each — two dead bundles shipped for code nothing can reach. The page
   files themselves stay, unrouted, for the same reason the dashboards do. */
const SelectRole = lazy(() => import("./pages/SelectRole"));
const TeacherTermsAgreement = lazy(() => import("./pages/TeacherTermsAgreement"));
const TeacherDashboard = lazy(() => import("./pages/TeacherDashboard"));
const SignUpSuccess = lazy(() => import("./pages/SignUpSuccess"));
const Account = lazy(() => import("./pages/Account"));


// Optimize QueryClient for mobile devices
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reduce refetch intervals for better mobile performance
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      retry: 1, // Reduce retries on mobile
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    },
  },
});

/* Which reader a paper opens in. The question-bank papers carry the bank's
   6-hex ids, the database's carry UUIDs, so this discriminates on the id shape
   alone — no fetch, no lookup table, and nothing to keep in sync. */
const PaperRoute = () => {
  const { id } = useParams<{ id: string }>();
  /* Only a real UUID goes to PaperReader. Anything else (a mistyped or
     truncated link) used to reach it and fire a query Postgres rejected with
     22P02, which the page then reported as "unable to load, refresh" -- the
     wrong message for a link that can never work. BankPaper already shows a
     proper "could not find that paper" with ways forward. */
  const isUuid = !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  return isUuid ? <PaperReader /> : <BankPaper />;
};

// Component to redirect old /teacher/:slug routes to new /tuition-teachers/:slug
const TeacherRedirect = () => {
  const { slug } = useParams<{ slug: string }>();
  return <Navigate to={`/tuition-teachers/${slug}`} replace />;
};

// /admin/paper-review/:paperId became /admin/library/:paperId.
const LegacyPaperReviewRedirect = () => {
  const { paperId } = useParams<{ paperId: string }>();
  return <Navigate to={`/admin/library/${paperId ?? ''}`} replace />;
};

// Handoff M-014: "no route-level fade, slide or crossfade anywhere" — the
// crossfade this used to play on every route change (`route-fade`, now
// removed from index.css) is exactly what that rule prohibits. The
// pathname key is kept: it still remounts page-level state on navigation,
// which is a separate concern from the animation that used to ride along
// with it.
//
// This div used to carry `pb-20 lg:pb-0` — a second, global instance of
// exactly the double-reservation commit 71a27d4 ("Halve the dead space
// above the footer") diagnosed and removed from Index/About/Contact/
// NotFound's own <main> tags: AppShell's BottomNavSpacer already reserves
// the real 84px the floating nav needs, as a sibling of whatever this
// wraps, so any padding here is pure dead space stacked on top of it. That
// fix only checked the four pages it happened to test; every other route
// (confirmed live on /join, gap = 164px = 84px spacer + this 80px) still
// had it via this wrapper. Removed outright, not just at `lg`, since
// BottomNavSpacer already handles every breakpoint that needs clearance.
const RouteTransition = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  return <div key={location.pathname}>{children}</div>;
};

/* Warms a route's chunk when the pointer reaches a link to it — see
   lib/route-prefetch.ts for why and for the connection-aware opt-out. */
const RoutePrefetch = () => {
  useEffect(() => installRoutePrefetch(), []);
  return null;
};

const App = () => (
  /* Two boundaries, not one, because they fail differently.
     The outer one catches a provider blowing up during boot -- auth, the query
     client, the intent store -- where there is no working app left to salvage
     and a reload is genuinely the only move.
     The inner one, around <Routes>, catches a single page throwing while the
     providers are healthy. That is the common case, and keeping the chrome
     alive means the reader still has navigation instead of a blank screen. */
  <ErrorBoundary context="root">
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <AdminDebugProvider>
        <LikesProvider>
          <UpvotesProvider>
            <StudiesWithProvider>
          {/* Opt into the v7 behaviours now rather than at the upgrade. Both
              warnings fired on every page load; startTransition also stops
              route changes blocking paint on slow renders. */}
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            {/* The intent index. Inside the Router because it resolves once per
                route entry and holds still for that view; below Auth and Likes
                because it reads both. It renders nothing and changes nothing on
                its own — surfaces opt in by calling useIntent(). */}
            <IntentProvider>
            {/* Sonner's Toaster reads useLocation() (O-010's route-aware bottom
                offset), so it must render inside the Router, not above it. */}
            <Sonner />
            {/* Test deployment only. Compiled out of the live bundle entirely
                (VITE_PREVIEW_TOOLS unset -> tree-shaken), not merely hidden. */}
            <PreviewRoleToggle />
            {/* Same build-time gate, same reason: the intent panel names the
                signals behind an adaptation, which is a development tool and
                has no business in a visitor's bundle. */}
            <IntentDebugPanel />
            {/* Skip link. The href stayed #main-content, but only Index.tsx ever
                set that id — so on every route except the home page this, the
                first control a keyboard or screen-reader user meets, pointed at
                an element that does not exist and moved focus nowhere. A broken
                skip link is worse than none: it looks like the affordance is
                there and quietly is not.

                Fixed by targeting the page's <main> at click time rather than by
                adding the id to twenty-five files and relying on the next page
                to remember it. The href is kept so the control still reads and
                behaves as a link, and Index's id still satisfies it directly. */}
            <a
              href="#main-content"
              onClick={(e) => {
                const target =
                  document.getElementById('main-content') ?? document.querySelector('main');
                if (!target) return; // let the href do whatever it can
                e.preventDefault();
                /* <main> is not focusable by default; -1 makes it programmatically
                   focusable without adding it to the tab order. */
                if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
                (target as HTMLElement).focus({ preventScroll: true });
                target.scrollIntoView({ block: 'start' });
              }}
              className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:ring-2 focus:ring-ring"
            >
              Skip to content
            </a>
            <ScrollManager />
            <CanonicalTag />
            <RoutePrefetch />
            {/* fallback={null}, not PageLoader: these three are floating
                overlays layered on top of whatever page already painted, not
                page content of their own — there is nothing to show a
                skeleton FOR while their chunk loads. */}
            <Suspense fallback={null}>
              <Chatbot />
              {/* The single onboarding: opens itself on a first visit and on
                  every Shikshaq-logo tap. Mounted once, here, because the logo
                  trigger is a window event and a second copy would answer the
                  same tap. */}
              <ProductTourHost />
              {/* Shown once, and only to a visitor who has already been through the
                  tour, so a first visit is never two announcements deep. */}
              <PapersLiveAnnouncement />
            </Suspense>
            <AppShell>
            <RouteTransition>
            {/* One Suspense boundary around the whole route table. The routes
                that were eager until now are lazy, and each would otherwise
                need its own wrapper; the per-route boundaries below still work
                and are left alone.
                The ~28 identical inner `<Suspense fallback={<PageLoader />}>`
                wraps this comment used to describe as "leftover and
                harmless-but-redundant" are gone now, not just left in place —
                they cost nothing to keep but were also one more place to
                update every time a route's fallback changed, and grep found
                zero remaining callers relying on a route having its OWN
                boundary rather than this shared one. */}
            <ErrorBoundary context="route">
            <Suspense fallback={<DelayedFallback delayMs={150}><PageLoader /></DelayedFallback>}>
            <Routes>
              {/* Dev-only design sandbox for the admin shell, which is otherwise
                  unreachable without an admin login. Renders mock props only —
                  no Supabase access, not the real console, and NOT a way past
                  the admin gate. The guard is a build-time constant, so this
                  route does not exist in a production bundle. */}
              {import.meta.env.DEV && <Route path="/__sandbox" element={<Sandbox />} />}
              <Route path="/" element={<Index />} />
              <Route path="/all-tuition-teachers-in-kolkata" element={<Browse />} />
              <Route path="/browse" element={<Navigate to="/all-tuition-teachers-in-kolkata" replace />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/tuition-teachers/:slug" element={<TeacherProfile />} />
              <Route path="/tuition-teachers/:slug/whatsapp-click" element={<WhatsAppRedirect />} />
              <Route path="/teacher/:slug" element={<TeacherRedirect />} />
              {/* pages.md §11 O-05: "/liked-teachers" and "/my-teachers" become deep
                  links into the unified /account screen rather than 301s — the
                  more conservative, reversible choice per the spec's own framing
                  ("do not pick for the owner"); a permanent redirect is the other
                  option the spec leaves open if the owner wants that instead. */}
              <Route path="/liked-teachers" element={<Navigate to="/account?tab=saved" replace />} />
              <Route path="/my-teachers" element={<Navigate to="/account?tab=contacted" replace />} />
              <Route path="/account" element={<Account />} />
              <Route path="/more" element={<Help />} />
              <Route path="/help" element={<Navigate to="/more" replace />} />
              <Route path="/faq" element={<FAQ />} />
              <Route path="/join" element={<Join />} />
              <Route path="/submit-a-paper" element={<SubmitPaper />} />
              <Route path="/join/apply" element={<JoinApply />} />
              <Route path="/past-papers" element={<PastPapers />} />
              <Route path="/past-papers/results" element={<PaperResults />} />
              {/* One address space for every paper. The question-bank papers
                  are papers like any other and live at /past-papers/:id too —
                  they just read as questions instead of an embedded scan. The
                  bank's ids are 6 hex characters and the database's are UUIDs,
                  so the route can pick a reader without fetching anything. */}
              <Route path="/past-papers/:id" element={<PaperRoute />} />
              {/* S16. a-to-z.md marks this the one route that is `new` — the
                  by-school rows on /past-papers previously went nowhere. */}
              <Route path="/school/:slug" element={<SchoolPage />} />
              {/* TopBar's "Subjects" and "Schools" nav links used to fall back to
                  BROWSE_PATH/PAST_PAPERS_PATH with `match: () => false` because
                  neither index existed. These are their real destinations. */}
              <Route path="/subjects" element={<SubjectsPage />} />
              <Route path="/schools" element={<SchoolsPage />} />
              {/* Reading. One index and one article route: every article is
                  generated from the question bank's own chapter statistics
                  (src/content/blog.ts), so there is no per-article route to
                  add when the bank grows. */}
              <Route path="/blog" element={<Blog />} />
              <Route path="/blog/:slug" element={<BlogPost />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/privacy-policy" element={<PrivacyPolicy />} />
              <Route path="/terms-of-service" element={<TermsOfService />} />
              <Route path="/recommend-teacher" element={<RecommendTeacher />} />
              <Route path="/admin" element={<AdminOverview />} />
              <Route path="/admin/approvals" element={<AdminApprovals />} />
              <Route path="/admin/teachers" element={<AdminTeachersPage />} />
              <Route path="/admin/papers" element={<AdminPapersPage />} />
              <Route path="/admin/reviews" element={<AdminReviews />} />
              <Route path="/admin/feedback" element={<AdminFeedbackPage />} />
              <Route path="/admin/checkers" element={<AdminCheckersPage />} />
              <Route path="/admin/audit" element={<AdminAuditLog />} />
              <Route path="/admin/pipeline" element={<AdminPipelinePage />} />
              <Route path="/admin/library" element={<AdminLibrary />} />
              <Route path="/admin/library/:paperId" element={<AdminPaperEdit />} />
              <Route path="/admin/admin-queue" element={<AdminQueue />} />
              {/* The old Paper review page and its edit page moved to Library. */}
              <Route path="/admin/paper-review" element={<Navigate to="/admin/library" replace />} />
              <Route path="/admin/paper-review/:paperId" element={<LegacyPaperReviewRedirect />} />
              <Route path="/admin/team" element={<AdminTeamPage />} />
              <Route path="/admin/activity" element={<AdminActivityPage />} />
              <Route path="/admin/paper-approvals" element={<AdminPaperApprovals />} />
              <Route path="/admin/paper-approvals/:auditPaperId" element={<AdminPaperApproval />} />
              <Route path="/admin/checker-log" element={<AdminCheckerLog />} />
              <Route path="/admin/checker-log/:actorKey" element={<AdminCheckerLogPerson />} />
              <Route path="/checker" element={<Checker />} />
              <Route path="/checker/practice" element={<CheckerPractice />} />
              <Route path="/checker/help" element={<CheckerHelp />} />
              <Route path="/hod" element={<Hod />} />
              <Route path="/teacher-review" element={<TeacherReview />} />
              {/* Legacy admin URLs redirect into the console (pages.md §15). */}
              <Route path="/admin/applications" element={<Navigate to="/admin/approvals" replace />} />
              <Route path="/admin/recommendations" element={<Navigate to="/admin/reviews" replace />} />
              <Route path="/admin/comments" element={<Navigate to="/admin/reviews" replace />} />
              <Route path="/admin/upvotes" element={<Navigate to="/admin/reviews" replace />} />
              <Route path="/select-role" element={<SelectRole />} />
              <Route path="/teacher-terms-agreement" element={<TeacherTermsAgreement />} />
              <Route path="/signup-success" element={<SignUpSuccess />} />
              {/* StudentDashboard.tsx / GuardianDashboard.tsx are folded into
                  /account (pages.md §11) — these two routes now redirect there
                  instead of rendering the old pages directly. The files are
                  kept, unrouted, in case anything still imports a piece of them. */}
              <Route path="/dashboard/student" element={<Navigate to="/account?tab=saved" replace />} />
              <Route path="/dashboard/guardian" element={<Navigate to="/account?tab=contacted" replace />} />
              <Route path="/dashboard/teacher" element={<TeacherDashboard />} />
              <Route path="/teacher-dashboard" element={<Navigate to="/dashboard/teacher" replace />} />
              {/* Subject-specific pages */}
              <Route path="/maths-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/english-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/science-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/commercial-studies-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/physics-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/chemistry-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/biology-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/computer-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/hindi-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/history-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/geography-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/economics-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/accounts-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/business-studies-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/commerce-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/psychology-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/sociology-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/political-science-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/environmental-science-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/bengali-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/drawing-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/sat-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/act-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/cat-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/nmat-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/gmat-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/ca-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/cfa-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/clat-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              <Route path="/social-studies-tuition-teachers-in-kolkata" element={<SubjectPage />} />
              {/* Board-specific pages */}
              <Route path="/cbse-ncert-tuition-teachers-in-kolkata" element={<BoardPage />} />
              <Route path="/icse-tuition-teachers-in-kolkata" element={<BoardPage />} />
              <Route path="/igcse-tuition-teachers-in-kolkata" element={<BoardPage />} />
              <Route path="/international-board-tuition-teachers-in-kolkata" element={<BoardPage />} />
              <Route path="/state-board-tuition-teachers-in-kolkata" element={<BoardPage />} />
              {/* Locality x subject pages: one route per (subject, area) with 5+
                  real teachers, from the list scripts/generate-locality-pages.ts
                  writes at build time. Anything not in that list falls through
                  to NotFound like any other unknown URL. */}
              {LOCALITY_PAGE_PATHS.map((path) => (
                <Route key={path} path={path} element={<LocalityPage />} />
              ))}
              <Route path="/404" element={<NotFound />} />
              {/* Render in place rather than Navigate to /404: redirecting
                  rewrote the address bar and destroyed the URL that actually
                  failed, so a broken link could not be reported or shared, and
                  the diagnostic below logged the useless string "/404". /404
                  stays as an explicit alias. */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            </ErrorBoundary>
            </RouteTransition>
            </AppShell>
            </IntentProvider>
          </BrowserRouter>
            </StudiesWithProvider>
          </UpvotesProvider>
        </LikesProvider>
        </AdminDebugProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
