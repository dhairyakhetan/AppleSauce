import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Menu as MenuIcon } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { usePageMeta } from '@/hooks/usePageMeta';
import { cn } from '@/lib/utils';
import { isSlowError, SLOW_ACTION_WORDS, SLOW_WORDS } from '@/lib/checker-timeout';
import { realCheckerApi, type CheckerApi } from '@/lib/checker-api';
import { useCheckerOutbox } from '@/components/checker/useCheckerOutbox';
import { SaveStatusChip } from '@/components/checker/AdvanceBits';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { useIsAdminBadge } from '@/hooks/useIsAdminBadge';
import { useIsHodBadge } from '@/hooks/useIsHodBadge';
import { ActionButton } from '@/components/checker/CheckerButtons';
import { CheckerSkeleton, Chip, Modal } from '@/components/checker/CheckerBits';
import { VerifyScreen } from '@/components/checker/VerifyScreen';
import { ReportProblemDialog, type ReportView } from '@/components/requests/ReportProblemDialog';
import { realFixRequestsApi, type FixRequestsApi } from '@/lib/fix-requests-api';
import { realPaperAsksApi, type PaperAsksApi } from '@/lib/paper-asks-api';
import { AskForPapers } from '@/components/checker/AskForPapers';
import { screenPath } from '@/lib/fix-requests';
import { MathText } from '@/components/papers/math-text';
import { isBlankBody } from '@/lib/checker-body';
import { BOARDS } from '@/lib/hod-api';
import { CHIP, actionToneClass } from '@/lib/checker-button-styles';
import { CHECKER_HELP_PATH, CHECKER_PRACTICE_PATH } from '@/lib/checker-onboarding';
import { GIVEN_BY_HOD, paperLabel } from '@/lib/checker-progress';
import { PaperStatusPill } from '@/components/PaperStatus';
import { checkerCardLine, stageOfCheckerCard } from '@/lib/paper-status';
import { checkerErrorAdvice, listLoadFailure, requestSubjectsErrorMessage } from '@/lib/checker-errors';
import {
  formatGrade,
  gradeSelectValue,
  formatValidUntil,
  hasNothingToCheck,
  idleNote,
  returnedNote,
  normaliseProfile,
  PAPER_LIMIT_NOTE,
  paperCardProgress,
  partDoneNote,
  checkerSignInPath,
  parseSubjectList,
  loadGate,
  profileNotice,
  profileStatus,
  QUESTION_STATE_LABEL,
  questionLabel,
  skippedLabel,
  sortPapers,
  stateSummary,
  subjectsHint,
  VERIFIER_GRADE_OPTIONS,
  withoutReopen,
  type PaperQuestionState,
} from '@/lib/verifier-papers';
import { BAR_WELL } from '@/lib/chart-styles';
import type { OutboxState } from '@/lib/checker-outbox';

/* My papers: the verifier's home (Kid Mode). Three views, chosen by the URL:

     /checker                       the verifier's papers, with progress
     /checker?paper=<id>            one paper: all of its questions, then Start checking
     /checker?paper=<id>&verify=1   one question at a time, question left, picture right
     /checker?paper=<id>&verify=1&reopen=<question>   the same, opened on a Done question being edited

   Reachable only by an account an admin or HOD has set up as a verifier. Papers
   are handed out when an HOD presses Auto assign all (a whole paper to one verifier, never above their
   grade); a verifier does not pick subjects or classes, an HOD does.

   In a test build (VITE_PREVIEW_TOOLS) with dummy mode on, the same page runs
   against an in-memory fake, with no sign-in and no Supabase. `DummyChecker` is
   null in every other build, so the fake is compiled out of the live bundle. */

const DummyChecker = PREVIEW_TOOLS ? lazy(() => import('@/dummy/CheckerDummy')) : null;

export default function Checker() {
  if (DummyChecker && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyChecker />
      </Suspense>
    );
  }
  return <CheckerPage api={realCheckerApi} requestsApi={realFixRequestsApi} />;
}

export function CheckerPage({
  api,
  requestsApi = realFixRequestsApi,
  asksApi = realPaperAsksApi,
  dummy = false,
  banner,
}: {
  api: CheckerApi;
  /** Report a problem and My requests; the fake in dummy mode. */
  requestsApi?: FixRequestsApi;
  /** The Ask my HOD for more papers button; the fake in dummy mode. */
  asksApi?: PaperAsksApi;
  /** Dummy mode: no sign-in, no realtime, fake API. */
  dummy?: boolean;
  banner?: React.ReactNode;
}) {
  usePageMeta('My papers | Shikshaq', 'Check one question at a time against the printed paper.');
  const { user, profile, loading: authLoading, signOut } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const scope = dummy ? 'dummy' : 'live';
  const [params, setParams] = useSearchParams();
  const paperId = params.get('paper');
  const verifying = params.get('verify') === '1';
  const isAdmin = useIsAdminBadge();
  const isHod = useIsHodBadge();
  const [menuOpen, setMenuOpen] = useState(false);
  // "Report a problem": which view of its dialog is open, or null when it is closed.
  const [reportView, setReportView] = useState<ReportView | null>(null);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  // True when the access check itself could not be answered (offline, a server
  // error). That is not the same as "not a verifier", and must not say so.
  const [accessFailed, setAccessFailed] = useState(false);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const here = location.pathname + location.search;
  // Read only when sending a signed-out visitor to sign in. It is not a dependency: opening a paper or
  // going back to the list changes the URL, and must not ask the server "is this a verifier?" again
  // (a dropped connection there replaced the whole page with "We could not check your access").
  const hereRef = useRef(here);
  hereRef.current = here;
  // The same for the user: a token refresh or a tab coming back to the front hands over a new `user`
  // object for the same person, which must not repeat the check either.
  const signedIn = Boolean(user);
  useEffect(() => {
    if (!dummy) {
      if (authLoading) return;
      if (!signedIn) {
        // Come back to the paper or question that was opened, not just the list.
        navigate('/auth?redirect=' + encodeURIComponent(checkerSignInPath(hereRef.current)));
        return;
      }
    }
    let cancelled = false;
    api
      .isPaperChecker()
      .then((ok) => {
        if (!cancelled) setAllowed(ok);
      })
      .catch(() => {
        if (!cancelled) setAccessFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, authLoading, navigate, api, dummy, accessAttempt]);

  function retryAccess() {
    setAccessFailed(false);
    setAllowed(null);
    setAccessAttempt((n) => n + 1);
  }

  const statsQuery = useQuery({
    queryKey: ['checker-my-stats', scope],
    queryFn: api.myStats,
    enabled: allowed === true,
    staleTime: 30 * 1000,
    // The app default is refetchOnMount: false: coming back to /checker (from Practice round or the
    // help page) showed the counts from before the answers given since, for up to ten minutes. The
    // answers' own refresh only reaches a query that is mounted at the time.
    refetchOnMount: 'always',
  });

  // Papers finished, next to the questions count. Null (shown as nothing) until the database function is pasted.
  const paperStatsQuery = useQuery({
    queryKey: ['checker-my-paper-stats', scope],
    queryFn: api.myPaperStats,
    enabled: allowed === true,
    staleTime: 30 * 1000,
    refetchOnMount: 'always',
  });

  // Back on My papers after checking: the Papers chip is read again (it is only marked out of date after each answer, because
  // reading it is slow). Audit CK-10, 27 Nov 2026: it stayed as it was until the page was reloaded.
  const wasVerifying = useRef(false);
  const verifyingNow = Boolean(paperId && verifying);
  useEffect(() => {
    if (wasVerifying.current && !verifyingNow) {
      void qc.invalidateQueries({ queryKey: ['checker-my-paper-stats', scope] });
      void qc.invalidateQueries({ queryKey: ['checker-my-stats', scope] });
    }
    wasVerifying.current = verifyingNow;
  }, [verifyingNow, qc, scope]);

  if (accessFailed) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <BentoPanel fill="card" edge="top" className="mx-auto max-w-lg py-24 text-center">
          {banner}
          <h1 className="text-balance text-xl font-bold text-foreground">We could not check your access</h1>
          <p role="alert" className="mt-2 text-[14px] text-warm-secondary">
            This is probably your connection. Nothing has changed on your account. Check it and try again.
          </p>
          <div className="mt-4 flex justify-center">
            <ActionButton tone="dark" onClick={retryAccess}>
              Try again
            </ActionButton>
          </div>
        </BentoPanel>
      </BentoStack>
    );
  }

  if ((!dummy && authLoading) || allowed === null) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-5xl">
          {banner}
          <CheckerSkeleton />
        </BentoPanel>
      </BentoStack>
    );
  }

  if (allowed === false) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <BentoPanel fill="card" edge="top" className="mx-auto max-w-lg py-24 text-center">
          <h1 className="text-balance text-xl font-bold text-foreground">You are not a checker yet</h1>
          <p className="mt-2 text-[14px] text-warm-secondary">
            Ask an admin or an HOD to add your account as a checker.
            {user?.email ? ` You are signed in as ${user.email}.` : ''} If that is the wrong account, sign out and sign in with the right one.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Link to="/past-papers" className="tap-44 inline-flex items-center rounded-full bg-muted px-5 text-[15px] font-bold text-foreground">
              Browse past papers
            </Link>
            {!dummy && signOut ? (
              <button
                type="button"
                data-testid="checker-sign-out"
                onClick={() => void signOut().then(() => navigate('/auth?redirect=' + encodeURIComponent('/checker')))}
                className="tap-44 inline-flex items-center rounded-full bg-brand px-5 text-[15px] font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                Sign out and use another account
              </button>
            ) : null}
          </div>
        </BentoPanel>
      </BentoStack>
    );
  }

  const open = (id: string) => setParams({ paper: id });
  const verify = (id: string) => setParams({ paper: id, verify: '1' });
  // "Edit" on a Done question: the verify screen opens on that question, reopened.
  const editDone = (id: string, questionId: string) => setParams({ paper: id, verify: '1', reopen: questionId });
  const toList = () => setParams({});

  // The verify screen is one bento grid that fits the viewport (owner, 12 Oct
  // 2026): the page itself never scrolls there, so it gets its own shell, with
  // the page's small controls moved into the screen's top tile.
  const verifyView = Boolean(paperId && verifying);

  const countsText = statsQuery.data ? `${paperStatsQuery.data ? 'Questions: ' : ''}Today ${statsQuery.data.today_count} · Total ${statsQuery.data.total_count}` : 'Counting...';
  const paperCounts = paperStatsQuery.data;
  const counts = statsQuery.isError && !statsQuery.data ? null : (
    <>
      <span
        className={cn('rounded-full bg-muted px-3 py-1 text-[13px] font-semibold', statsQuery.data ? 'tabular-nums text-warm-secondary' : 'text-warm-meta')}
        data-testid="my-counts"
      >
        {countsText}
      </span>
      {paperCounts ? (
        <span
          className="rounded-full bg-muted px-3 py-1 text-[13px] font-semibold tabular-nums text-warm-secondary"
          data-testid="my-paper-counts"
          title="Papers you have finished: you gave your answers and nothing is left on them for students"
        >
          Papers: Today {paperCounts.papers_today} · Total {paperCounts.papers_total}
        </span>
      ) : null}
    </>
  );

  // The verify screen's top tile holds one Menu button and nothing else (owner, 12 Oct 2026:
  // "too crammed"): the way back to my papers, the desks and the day's counts are inside it.
  const menuButton = verifyView ? (
    <button
      type="button"
      onClick={() => setMenuOpen(true)}
      aria-label="Menu"
      data-testid="verify-menu-button"
      className={cn(CHIP, 'gap-2 bg-brand-subtle text-foreground [@media(max-width:639px)]:h-11 [@media(max-width:639px)]:w-11 [@media(max-width:639px)]:justify-center [@media(max-width:639px)]:px-0')}
    >
      <MenuIcon className="h-[18px] w-[18px]" aria-hidden="true" />
      <span className="[@media(max-width:639px)]:sr-only">Menu</span>
    </button>
  ) : null;

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      {isAdmin ? (
        <Link to="/admin" className={cn(CHIP, 'bg-muted text-warm-secondary')}>
          Back to admin
        </Link>
      ) : null}
      {isHod ? (
        <Link to="/hod" className={cn(CHIP, 'bg-muted text-warm-secondary')}>
          HOD desk
        </Link>
      ) : null}
      {counts}
      <Chip onClick={() => setReportView('form')} tone="muted">
        Report a problem
      </Chip>
      <Chip onClick={() => setMenuOpen(true)} tone="brand">
        Menu
      </Chip>
    </div>
  );

  return (
    <BentoStack className={cn('min-h-screen bg-muted', verifyView && 'h-[100dvh] min-h-0 overflow-hidden')}>
      {verifyView ? (
        <BentoPanel
          fill="muted"
          className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col p-2.5 lg:p-3"
        >
          {banner}
          <h1 className="sr-only">My papers</h1>
          <VerifyScreen
            key={paperId}
            api={api}
            scope={scope}
            dummy={dummy}
            paperId={paperId!}
            reopenQuestionId={params.get('reopen') ?? undefined}
            onReopenTaken={() => setParams((p) => withoutReopen(p), { replace: true })}
            suspended={menuOpen || reportView !== null}
            userId={user?.id}
            userName={profile?.full_name}
            onExit={() => open(paperId!)}
            onList={toList}
            toolbar={menuButton}
          />
        </BentoPanel>
      ) : (
        <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-5xl">
          {banner}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-lg font-bold text-foreground">My papers</h1>
            {header}
          </div>

          {paperId ? (
            <PaperOverview api={api} scope={scope} userId={user?.id} paperId={paperId} onBack={toList} onStart={() => verify(paperId)} onEdit={(qid) => editDone(paperId, qid)} />
          ) : (
            <PaperList
              api={api}
              asksApi={asksApi}
              scope={scope}
              userId={user?.id}
              hasChecked={(statsQuery.data?.total_count ?? 0) > 0 || (paperCounts?.papers_total ?? 0) > 0}
              onOpen={open}
              onStart={verify}
            />
          )}
        </BentoPanel>
      )}

      {menuOpen ? (
        <Modal onClose={() => setMenuOpen(false)} labelledBy="checker-menu-title">
          <h2 id="checker-menu-title" className="mb-1 text-[16px] font-bold text-foreground">
            Menu
          </h2>
          <p className="mb-3 text-[13px] text-warm-secondary">Nothing here changes any question.</p>
          <div className="flex flex-col gap-2">
            {verifyView ? (
              <>
                {counts}
                <button
                  type="button"
                  data-testid="back-to-my-papers"
                  onClick={() => {
                    setMenuOpen(false);
                    toList();
                  }}
                  className={actionToneClass('muted')}
                >
                  Back to my papers
                </button>
              </>
            ) : null}
            {isAdmin ? (
              <Link to="/admin" className={actionToneClass('muted') + ' text-center'}>
                Back to admin
              </Link>
            ) : null}
            {isHod ? (
              <Link to="/hod" className={actionToneClass('muted') + ' text-center'}>
                HOD desk
              </Link>
            ) : null}
            <ActionButton
              tone="muted"
              onClick={() => {
                setMenuOpen(false);
                setReportView('form');
              }}
            >
              Report a problem
            </ActionButton>
            <ActionButton
              tone="muted"
              onClick={() => {
                setMenuOpen(false);
                setReportView('mine');
              }}
            >
              My requests
            </ActionButton>
            <Link to={CHECKER_PRACTICE_PATH} className={actionToneClass('brand') + ' text-center'}>
              Practice round
            </Link>
            <Link to={CHECKER_HELP_PATH} className={actionToneClass('muted') + ' text-center'}>
              Rules and shortcuts
            </Link>
            <ActionButton tone="muted" onClick={() => setMenuOpen(false)}>
              Close
            </ActionButton>
          </div>
        </Modal>
      ) : null}

      {reportView ? (
        <ReportProblemDialog
          api={requestsApi}
          scope={scope}
          page={screenPath(location)}
          asHod={isHod || isAdmin}
          initialView={reportView}
          onClose={() => setReportView(null)}
        />
      ) : null}
    </BentoStack>
  );
}

/* ------------------------------------------------------------------ the list */

/** Answers kept on this device that have not reached the server yet, and answers the server refused while no checking
 *  screen was open. Rendering it also makes sure the outbox exists, so the waiting answers are sent from My papers too
 *  (audit CK-02, 27 Nov 2026: they used to go out only from a checking screen). */
function WaitingAnswers({ api, scope, userId }: { api: CheckerApi; scope: string; userId?: string }) {
  const qc = useQueryClient();
  const [lost, setLost] = useState<string | null>(null);
  const { box, state } = useCheckerOutbox(
    api,
    scope,
    userId,
    {
      onAck: () => {
        void qc.invalidateQueries({ queryKey: ['checker-my-stats', scope] });
        void qc.invalidateQueries({ queryKey: ['checker-my-paper-stats', scope] });
        void qc.invalidateQueries({ queryKey: ['verifier-papers', scope] });
        void qc.invalidateQueries({ queryKey: ['verifier-paper-questions', scope] });
      },
      onReject: (_entry, err) => setLost(checkerErrorAdvice(err).message),
    },
    { base: true },
  );
  return <WaitingAnswersView state={state} lost={lost} onRetry={box.retryNow} onHideLost={() => setLost(null)} />;
}

export function WaitingAnswersView({
  state,
  lost,
  onRetry,
  onHideLost,
}: {
  state: Pick<OutboxState, 'entries' | 'failing' | 'authTrouble'>;
  lost?: string | null;
  onRetry: () => void;
  onHideLost?: () => void;
}) {
  const waiting = state.entries.length;
  return (
    <>
      {waiting > 0 && !state.failing ? (
        <p role="status" data-testid="answers-waiting" className="rounded-2xl bg-brand-subtle px-4 py-2.5 text-[14px] font-semibold text-foreground">
          {waiting === 1 ? '1 answer is being saved.' : `${waiting} answers are being saved.`} They are kept on this device until the server has them.
        </p>
      ) : null}
      <SaveStatusChip waiting={waiting} failing={state.failing} authTrouble={state.authTrouble} onRetry={onRetry} />
      {lost ? (
        <div role="alert" data-testid="answers-lost" className="flex flex-wrap items-center gap-2 rounded-2xl bg-destructive/10 px-4 py-2.5 text-[14px] text-destructive">
          <span className="min-w-0 flex-1">An answer you gave earlier was not saved. {lost}</span>
          {onHideLost ? (
            <button type="button" onClick={onHideLost} className="tap-44 rounded-full bg-card px-4 py-1.5 text-[13px] font-semibold text-foreground">
              Hide this
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** Papers the 7-day rule took back are announced once, then hidden for good by the person (kept in this browser). */
const HIDDEN_RETURNED_KEY = 'shikshaq.checker.returned-hidden';
function hiddenReturned(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_RETURNED_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function hideReturned(key: string): void {
  try {
    window.localStorage.setItem(HIDDEN_RETURNED_KEY, JSON.stringify([...hiddenReturned(), key].slice(-50)));
  } catch {
    /* private window: the note simply comes back next time */
  }
}

function PaperList({
  api,
  asksApi,
  scope,
  userId,
  hasChecked,
  onOpen,
  onStart,
}: {
  api: CheckerApi;
  asksApi: PaperAsksApi;
  scope: string;
  userId?: string;
  /** This checker has checked something before (the counters say so). */
  hasChecked: boolean;
  onOpen: (id: string) => void;
  onStart: (id: string) => void;
}) {
  const papersQuery = useQuery({
    queryKey: ['verifier-papers', scope],
    queryFn: api.myPapers,
    staleTime: 0,
    refetchOnMount: 'always',
    // After an HOD presses Auto assign all, coming back to this tab shows the new papers (audit CK-11, 27 Nov 2026).
    refetchOnWindowFocus: true,
  });
  const returnedQuery = useQuery({
    queryKey: ['verifier-returned', scope],
    queryFn: () => (api.recentlyReturned ? api.recentlyReturned() : Promise.resolve([])),
    staleTime: 60 * 1000,
    retry: false,
  });
  const [, setHiddenTick] = useState(0);
  const hidden = hiddenReturned();
  const returned = (returnedQuery.data ?? []).filter((r) => !hidden.includes(`${r.paper_id}|${r.returned_at ?? ''}`));

  // loadGate, not isLoading: a phone with no signal pauses the read (isLoading stays false), and "No papers yet" must not show.
  if (loadGate(papersQuery) === 'loading') return <CheckerSkeleton />;
  if (papersQuery.isError) {
    const failure = listLoadFailure(papersQuery.error, 'list');
    return (
      <div className="space-y-3">
        <WaitingAnswers api={api} scope={scope} userId={userId} />
        <div role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-destructive" data-testid="papers-load-error">
          <p className="font-semibold">{failure.title}</p>
          <p>{failure.note}</p>
          {failure.canRetry ? (
            <div className="mt-2">
              <ActionButton tone="muted" onClick={() => void papersQuery.refetch()}>
                Try again
              </ActionButton>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const papers = sortPapers(papersQuery.data ?? []);
  const nothingToCheck = papers.length > 0 && hasNothingToCheck(papers);
  return (
    <div className="space-y-5">
      <WaitingAnswers api={api} scope={scope} userId={userId} />
      {returned.map((r) => (
        <div
          key={`${r.paper_id}|${r.returned_at ?? ''}`}
          role="status"
          data-testid="returned-note"
          className="flex flex-wrap items-center gap-2 rounded-2xl bg-brand-subtle px-4 py-2.5 text-[14px] font-semibold text-foreground"
        >
          <span className="min-w-0 flex-1">{returnedNote(r)}</span>
          <button
            type="button"
            onClick={() => {
              hideReturned(`${r.paper_id}|${r.returned_at ?? ''}`);
              setHiddenTick((n) => n + 1);
            }}
            className="tap-44 rounded-full bg-card px-4 py-1.5 text-[13px] font-semibold text-foreground"
          >
            Hide this
          </button>
        </div>
      ))}
      <p className="text-[13px] text-warm-secondary" data-testid="paper-limit-note">
        {PAPER_LIMIT_NOTE}
      </p>
      {papers.length === 0 ? (
        <div className="rounded-2xl bg-muted px-4 py-8 text-center" data-testid="no-papers">
          <p className="text-[16px] font-bold text-foreground">{hasChecked ? 'No papers left for you right now' : 'You have no papers right now'}</p>
          <p className="mx-auto mt-1 max-w-md text-pretty text-[14px] text-warm-secondary">
            Your HOD gives papers out to match your grade, your board and the subjects your HOD has set for you. Check back soon, or ask your
            HOD.
          </p>
          <AskForPapers api={asksApi} scope={scope} caughtUp={hasChecked} />
          <div className="mt-3 flex justify-center">
            <ActionButton tone="muted" onClick={() => void papersQuery.refetch()} disabled={papersQuery.isFetching} testId="check-again">
              {papersQuery.isFetching ? 'Looking...' : 'Check again'}
            </ActionButton>
          </div>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="My papers">
          {papers.map((p) => {
            const prog = paperCardProgress(p);
            return (
              <li key={p.paper_id} className="flex flex-col rounded-2xl bg-muted shadow-card p-4" data-testid="paper-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-balance text-[15px] font-bold text-foreground">{paperLabel(p)}</h2>
                    <PaperStatusPill stage={stageOfCheckerCard(p)} className="mt-1.5" />
                  </div>
                  {p.given_by_hod ? (
                    <span className="shrink-0 rounded-full bg-brand-subtle px-2 py-0.5 text-[12px] font-semibold text-foreground">{GIVEN_BY_HOD}</span>
                  ) : null}
                </div>
                <p className="mt-2 text-[13px] text-foreground" data-testid="card-status-line">
                  {partDoneNote(p) ?? checkerCardLine(p)}
                </p>
                {idleNote(p.idle_days_left) ? (
                  <p className="mt-1 text-[12px] font-semibold text-warm-secondary" data-testid="idle-note">
                    {idleNote(p.idle_days_left)}
                  </p>
                ) : null}
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[13px] font-semibold tabular-nums text-warm-secondary">
                    <span>{prog.label}</span>
                    <span className="flex gap-3">
                      {p.skipped > 0 ? <span data-testid="skipped-count">{skippedLabel(p.skipped)}</span> : null}
                      {p.with_hod > 0 ? <span>{p.with_hod} with the HOD</span> : null}
                    </span>
                  </div>
                  <div
                    className={cn('h-2.5 w-full overflow-hidden rounded-full bg-card', BAR_WELL)}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={prog.percent}
                    aria-label={prog.label}
                  >
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${prog.percent}%` }} />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {prog.finished ? (
                    <ActionButton tone="muted" onClick={() => onOpen(p.paper_id)}>
                      See questions
                    </ActionButton>
                  ) : (
                    <>
                      <ActionButton tone="mint" onClick={() => onStart(p.paper_id)}>
                        {p.done > 0 ? 'Keep checking' : 'Start checking'}
                      </ActionButton>
                      <ActionButton tone="muted" onClick={() => onOpen(p.paper_id)}>
                        See questions
                      </ActionButton>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {nothingToCheck ? (
        <div className="rounded-2xl bg-muted px-4 py-6 text-center" data-testid="nothing-left">
          <p className="text-[16px] font-bold text-foreground">Nothing left for you to check</p>
          <p className="mx-auto mt-1 max-w-md text-pretty text-[14px] text-warm-secondary">
            Everything on your list is done or waiting for your HOD. If you are free, tell your HOD.
          </p>
          <AskForPapers api={asksApi} scope={scope} caughtUp={hasChecked} papersListed />
        </div>
      ) : null}
      <ProfileCard api={api} scope={scope} />
    </div>
  );
}

/* --------------------------------------------------------------- the profile */

function ProfileCard({ api, scope }: { api: CheckerApi; scope: string }) {
  const profileQuery = useQuery({
    queryKey: ['verifier-profile', scope],
    queryFn: api.myProfile,
    staleTime: 60 * 1000,
  });
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // "Details saved." and "Sent. Your HOD will see your request." are a passing confirmation, not a permanent line (audit CK-22).
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 8000);
    return () => clearTimeout(t);
  }, [message]);
  // Which subjects have papers, so the box can say what is worth typing. Read only when the box is open,
  // and an empty answer (function not applied yet, or the read failed) just leaves the hint out.
  const subjectsQuery = useQuery({
    queryKey: ['verifier-subjects-with-papers'],
    queryFn: api.subjectsWithPapers,
    staleTime: 10 * 60 * 1000,
    enabled: asking,
  });
  const subjectsLine = subjectsHint(subjectsQuery.data);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ full_name: '', grade: '', school: '', board: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const cardState = loadGate(profileQuery);
  if (cardState === 'loading') return <div role="status" aria-label="Loading your details" className="h-16 animate-pulse rounded-2xl bg-muted" />;
  // Saving is a full overwrite, so a form opened from a failed read would blank
  // the verifier's real details. Show no form until the read has worked.
  if (cardState === 'error') return <ProfileLoadError onRetry={() => void profileQuery.refetch()} />;
  const p = profileQuery.data ?? normaliseProfile(null);
  const status = profileStatus(p);
  const notice = profileNotice(status);

  function startEditing() {
    setForm({
      full_name: p?.full_name ?? '',
      grade: gradeSelectValue(p?.grade ?? null),
      school: p?.school ?? '',
      board: p?.board ?? '',
    });
    setFormError(null);
    setMessage(null);
    setEditing(true);
  }

  async function saveDetails() {
    setBusy(true);
    setFormError(null);
    try {
      await api.setMyProfile({
        full_name: form.full_name.trim() || null,
        grade: form.grade ? Number(form.grade) : null,
        school: form.school.trim() || null,
        board: form.board || null,
      });
      setEditing(false);
      setMessage('Details saved.');
      void profileQuery.refetch();
    } catch (err) {
      // Only the server's own plain sentences (errcode 22023, like "Name is
      // too long") are shown as they are; a network failure says "Failed to
      // fetch", which is not for a student.
      const e = err as { code?: unknown; message?: unknown } | null;
      const plain = e && e.code === '22023' && typeof e.message === 'string' ? e.message.trim() : '';
      setFormError(plain || (isSlowError(err) ? SLOW_ACTION_WORDS : 'That did not save this time. Try again in a minute.'));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const list = parseSubjectList(text);
    if (list.length === 0) {
      setMessage('Type at least one subject.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.requestSubjects(list);
      setMessage('Sent. Your HOD will see your request.');
      setAsking(false);
      setText('');
      void profileQuery.refetch();
    } catch (err) {
      setMessage(requestSubjectsErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="my-details-title" className="rounded-2xl bg-muted shadow-card p-4" data-testid="profile-card">
      <h2 id="my-details-title" className="text-[15px] font-bold text-foreground">
        My details
      </h2>
      <p className="text-[12px] text-warm-meta">You can fill these in. Your HOD can change them too.</p>
      {notice && !editing ? (
        <p role="status" className="mt-2 rounded-xl bg-brand-subtle px-3 py-2 text-[13px] font-semibold text-foreground">
          {notice}
        </p>
      ) : null}
      {editing ? (
        <form
          className="mt-3 grid gap-3 text-[13px] sm:grid-cols-2"
          data-testid="my-details-form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveDetails();
          }}
        >
          <label className="grid gap-1">
            <span className="font-semibold text-foreground">Your name</span>
            <input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              autoComplete="name"
              className="min-h-[44px] rounded-xl bg-card px-3 text-[16px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
          <label className="grid gap-1">
            <span className="font-semibold text-foreground">Grade</span>
            <select
              value={form.grade}
              onChange={(e) => setForm({ ...form, grade: e.target.value })}
              className="min-h-[44px] rounded-xl bg-card px-3 text-[16px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {VERIFIER_GRADE_OPTIONS.map((o) => (
                <option key={o.value ?? ''} value={o.value ?? ''}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="font-semibold text-foreground">School</span>
            <input
              value={form.school}
              onChange={(e) => setForm({ ...form, school: e.target.value })}
              className="min-h-[44px] rounded-xl bg-card px-3 text-[16px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
          <label className="grid gap-1">
            <span className="font-semibold text-foreground">Board</span>
            <select
              value={form.board}
              onChange={(e) => setForm({ ...form, board: e.target.value })}
              className="min-h-[44px] rounded-xl bg-card px-3 text-[16px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <option value="">Not given</option>
              {(form.board && !BOARDS.includes(form.board) ? [form.board, ...BOARDS] : BOARDS).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[12px] text-warm-meta sm:col-span-2">
            With a grade, you only get papers for your class or below. The valid-until date and preferred subjects are set by your HOD.
          </p>
          {formError ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive sm:col-span-2" data-testid="my-details-error">
              {formError}
            </p>
          ) : null}
          <div className="flex gap-2 sm:col-span-2">
            {/* A submit button, so Enter in any box saves (the form's onSubmit does the saving). */}
            <ActionButton tone="dark" type="submit" onClick={() => undefined} disabled={busy}>
              {busy ? 'Saving...' : 'Save my details'}
            </ActionButton>
            <ActionButton tone="muted" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </ActionButton>
          </div>
        </form>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
            <Fact label="Grade" value={formatGrade(p?.grade ?? null)} />
            <Fact label="School" value={p?.school ?? 'Not set'} />
            <Fact label="Board" value={p?.board ?? 'Not set'} />
            <Fact label="Valid until" value={formatValidUntil(p?.valid_until ?? null)} />
          </dl>
          <div className="mt-3">
            <ActionButton tone={status === 'missing' ? 'dark' : 'muted'} onClick={startEditing}>
              {status === 'missing' ? 'Fill in my details' : 'Edit my details'}
            </ActionButton>
          </div>
        </>
      )}
      <div className="mt-3 text-[13px]">
        <p className="font-semibold text-foreground">Preferred subjects</p>
        <p className="text-warm-secondary">{p && p.preferred_subjects.length > 0 ? p.preferred_subjects.join(', ') : 'None set by your HOD yet.'}</p>
        {p && p.requested_subjects.length > 0 ? (
          <p className="mt-1 text-warm-secondary">Waiting for your HOD: {p.requested_subjects.join(', ')}</p>
        ) : null}
      </div>
      {asking ? (
        <div className="mt-3">
          <label htmlFor="req-subjects" className="mb-1 block text-[13px] font-semibold text-foreground">
            Which subjects would you like? Separate them with commas.
          </label>
          {subjectsLine ? (
            <p id="req-subjects-hint" className="mb-1 text-[12px] text-warm-meta" data-testid="subjects-hint">
              {subjectsLine}
            </p>
          ) : null}
          <textarea
            id="req-subjects"
            aria-describedby={subjectsLine ? 'req-subjects-hint' : undefined}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="w-full rounded-xl bg-card p-3 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
          <div className="mt-2 flex gap-2">
            <ActionButton tone="dark" onClick={() => void send()} disabled={busy}>
              {busy ? 'Sending...' : 'Send to my HOD'}
            </ActionButton>
            <ActionButton tone="muted" onClick={() => setAsking(false)} disabled={busy}>
              Cancel
            </ActionButton>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <ActionButton tone="muted" onClick={() => setAsking(true)}>
            Ask your HOD for subjects
          </ActionButton>
        </div>
      )}
      {message ? (
        <p role="status" className="mt-2 text-[13px] font-semibold text-warm-secondary">
          {message}
        </p>
      ) : null}
    </section>
  );
}

export function ProfileLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <section aria-labelledby="my-details-title" className="rounded-2xl bg-muted shadow-card p-4" data-testid="profile-card">
      <h2 id="my-details-title" className="text-[15px] font-bold text-foreground">
        My details
      </h2>
      <p role="alert" className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive" data-testid="profile-load-error">
        Could not load your details. They have not been changed. {SLOW_WORDS}
      </p>
      <div className="mt-3">
        <ActionButton tone="muted" onClick={onRetry}>
          Try again
        </ActionButton>
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] font-semibold uppercase tracking-[.04em] text-warm-meta">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------- one paper */

const STATE_STYLE: Record<PaperQuestionState, string> = {
  to_verify: 'bg-brand-subtle text-foreground',
  done: 'bg-mint text-foreground',
  with_hod: 'bg-muted text-warm-secondary',
  set_aside: 'bg-muted text-warm-secondary',
  not_for_verifiers: 'bg-muted text-warm-secondary',
};

function PaperOverview({
  api,
  scope,
  userId,
  paperId,
  onBack,
  onStart,
  onEdit,
}: {
  api: CheckerApi;
  scope: string;
  userId?: string;
  paperId: string;
  onBack: () => void;
  onStart: () => void;
  /** Reopen a question that is marked Done so it can be edited again. */
  onEdit: (questionId: string) => void;
}) {
  // The app default is refetchOnMount: false, which showed the counts and the
  // states from before the verifier's last session. Always ask again.
  const papersQuery = useQuery({ queryKey: ['verifier-papers', scope], queryFn: api.myPapers, staleTime: 0, refetchOnMount: 'always' });
  const questionsQuery = useQuery({
    queryKey: ['verifier-paper-questions', scope, paperId],
    queryFn: () => api.paperQuestions(paperId),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const paper = papersQuery.data?.find((p) => p.paper_id === paperId) ?? null;
  const list = questionsQuery.data ?? [];
  const todo = list.filter((q) => q.state === 'to_verify').length;

  return (
    <div data-testid="paper-overview" className="space-y-3">
      <WaitingAnswers api={api} scope={scope} userId={userId} />
      <button
        type="button"
        onClick={onBack}
        className="tap-44 mb-3 rounded-full bg-muted px-4 py-2 text-[13px] font-semibold text-warm-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        Back to my papers
      </button>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-balance text-[17px] font-bold text-foreground">{paper ? paperLabel(paper) : 'This paper'}</h2>
          {list.length > 0 ? <p className="text-[13px] text-warm-secondary">{stateSummary(list)}</p> : null}
        </div>
        {todo > 0 ? (
          <ActionButton tone="mint" onClick={onStart}>
            Start checking
          </ActionButton>
        ) : null}
      </div>

      {loadGate(questionsQuery) === 'loading' ? (
        <CheckerSkeleton />
      ) : questionsQuery.isError ? (
        <div role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-destructive" data-testid="paper-load-error">
          {(() => {
            const failure = listLoadFailure(questionsQuery.error, 'paper');
            return (
              <>
                <p className="font-semibold">{failure.title}</p>
                <p>{failure.note}</p>
                {failure.canRetry ? (
                  <button type="button" className="tap-44 mt-2 rounded-full bg-card px-4 py-1.5 text-[13px] font-semibold text-foreground" onClick={() => void questionsQuery.refetch()}>
                    Try again
                  </button>
                ) : (
                  <button type="button" className="tap-44 mt-2 rounded-full bg-card px-4 py-1.5 text-[13px] font-semibold text-foreground" onClick={onBack}>
                    Back to my papers
                  </button>
                )}
              </>
            );
          })()}
        </div>
      ) : list.length === 0 ? (
        <p className="rounded-2xl bg-muted px-4 py-6 text-center text-[14px] text-warm-secondary">This paper has no questions to show.</p>
      ) : (
        <ol className="space-y-2" aria-label="Questions in this paper">
          {list.map((q, i) => (
            <li key={q.id} className="rounded-2xl bg-muted shadow-card p-3" data-testid="paper-question">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] font-semibold">
                <span className="text-foreground">Question {questionLabel(q, i)}</span>
                {q.marks != null ? (
                  <span className="text-warm-secondary">
                    {q.marks} {q.marks === 1 ? 'mark' : 'marks'}
                  </span>
                ) : null}
                {q.page ? <span className="text-warm-secondary">Page {q.page}</span> : null}
                <span className={cn('rounded-full px-2 py-0.5', STATE_STYLE[q.state])}>{QUESTION_STATE_LABEL[q.state]}</span>
                {q.state === 'done' ? (
                  <button
                    type="button"
                    onClick={() => onEdit(q.id)}
                    data-testid="edit-done-question"
                    aria-label={`Edit question ${questionLabel(q, i)}`}
                    className="tap-44 ml-auto rounded-full bg-card px-3 py-1 text-[12px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    Edit
                  </button>
                ) : null}
              </div>
              {/* The words exactly as stored, never cleaned; maths drawn the
                  same way as on the verifying screen. */}
              {isBlankBody(q.body) ? (
                <p className="text-[14px] italic text-warm-secondary">No words were read for this question. You will compare it with the page.</p>
              ) : (
                <div className="line-clamp-3 break-words">
                  <MathText text={q.body ?? ''} className="text-[14px] text-foreground" />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
