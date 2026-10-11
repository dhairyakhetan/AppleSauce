import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { usePageMeta } from '@/hooks/usePageMeta';
import { cn } from '@/lib/utils';
import { realCheckerApi, type CheckerApi } from '@/lib/checker-api';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { useIsAdminBadge } from '@/hooks/useIsAdminBadge';
import { useIsHodBadge } from '@/hooks/useIsHodBadge';
import { ActionButton } from '@/components/checker/CheckerButtons';
import { CheckerSkeleton, Chip, Modal } from '@/components/checker/CheckerBits';
import { VerifyScreen } from '@/components/checker/VerifyScreen';
import { MathText } from '@/components/papers/math-text';
import { isBlankBody } from '@/lib/checker-body';
import { BOARDS } from '@/lib/hod-api';
import { CHIP, actionToneClass } from '@/lib/checker-button-styles';
import { CHECKER_HELP_PATH, CHECKER_PRACTICE_PATH } from '@/lib/checker-onboarding';
import { GIVEN_BY_HOD, paperLabel } from '@/lib/checker-progress';
import {
  formatGrade,
  gradeSelectValue,
  formatValidUntil,
  normaliseProfile,
  PAPER_LIMIT_NOTE,
  paperCardProgress,
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
  VERIFIER_GRADE_OPTIONS,
  type PaperQuestionState,
} from '@/lib/verifier-papers';

/* My papers: the verifier's home (Kid Mode). Three views, chosen by the URL:

     /checker                       the verifier's papers, with progress
     /checker?paper=<id>            one paper: all of its questions, then Start verifying
     /checker?paper=<id>&verify=1   one question at a time, question left, picture right

   Reachable only by an account an admin or HOD has set up as a verifier. Papers
   are handed out automatically (a whole paper to one verifier, never above their
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
  return <CheckerPage api={realCheckerApi} />;
}

export function CheckerPage({
  api,
  dummy = false,
  banner,
}: {
  api: CheckerApi;
  /** Dummy mode: no sign-in, no realtime, fake API. */
  dummy?: boolean;
  banner?: React.ReactNode;
}) {
  usePageMeta('My papers | Shikshaq', 'Verify one question at a time against the printed paper.');
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const scope = dummy ? 'dummy' : 'live';
  const [params, setParams] = useSearchParams();
  const paperId = params.get('paper');
  const verifying = params.get('verify') === '1';
  const isAdmin = useIsAdminBadge();
  const isHod = useIsHodBadge();
  const [menuOpen, setMenuOpen] = useState(false);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  // True when the access check itself could not be answered (offline, a server
  // error). That is not the same as "not a verifier", and must not say so.
  const [accessFailed, setAccessFailed] = useState(false);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const here = location.pathname + location.search;
  useEffect(() => {
    if (!dummy) {
      if (authLoading) return;
      if (!user) {
        // Come back to the paper or question that was opened, not just the list.
        navigate('/auth?redirect=' + encodeURIComponent(checkerSignInPath(here)));
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
  }, [user, authLoading, navigate, api, dummy, here, accessAttempt]);

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
  });

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
          <h1 className="text-balance text-xl font-bold text-foreground">You are not a verifier yet</h1>
          <p className="mt-2 text-[14px] text-warm-secondary">Ask an admin or an HOD to add your account as a verifier.</p>
        </BentoPanel>
      </BentoStack>
    );
  }

  const open = (id: string) => setParams({ paper: id });
  const verify = (id: string) => setParams({ paper: id, verify: '1' });
  const toList = () => setParams({});

  return (
    <BentoStack className="min-h-screen bg-muted">
      <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-5xl">
        {banner}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-foreground">My papers</h1>
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
            {statsQuery.data ? (
              <span className="rounded-full bg-muted px-3 py-1 text-[13px] font-semibold tabular-nums text-warm-secondary" data-testid="my-counts">
                Today {statsQuery.data.today_count} · Total {statsQuery.data.total_count}
              </span>
            ) : statsQuery.isError ? null : (
              <span className="rounded-full bg-muted px-3 py-1 text-[13px] font-semibold text-warm-meta" data-testid="my-counts">
                Counting...
              </span>
            )}
            <Chip onClick={() => setMenuOpen(true)} tone="brand">
              Menu
            </Chip>
          </div>
        </div>

        {paperId && verifying ? (
          <VerifyScreen
            key={paperId}
            api={api}
            scope={scope}
            dummy={dummy}
            paperId={paperId}
            userId={user?.id}
            userName={profile?.full_name}
            onExit={() => open(paperId)}
            onList={toList}
          />
        ) : paperId ? (
          <PaperOverview api={api} scope={scope} paperId={paperId} onBack={toList} onStart={() => verify(paperId)} />
        ) : (
          <PaperList api={api} scope={scope} onOpen={open} onStart={verify} />
        )}
      </BentoPanel>

      {menuOpen ? (
        <Modal onClose={() => setMenuOpen(false)} labelledBy="checker-menu-title">
          <h2 id="checker-menu-title" className="mb-1 text-[16px] font-bold text-foreground">
            Menu
          </h2>
          <p className="mb-3 text-[13px] text-warm-secondary">Nothing here changes any question.</p>
          <div className="flex flex-col gap-2">
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
    </BentoStack>
  );
}

/* ------------------------------------------------------------------ the list */

function PaperList({
  api,
  scope,
  onOpen,
  onStart,
}: {
  api: CheckerApi;
  scope: string;
  onOpen: (id: string) => void;
  onStart: (id: string) => void;
}) {
  const papersQuery = useQuery({
    queryKey: ['verifier-papers', scope],
    queryFn: api.myPapers,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  if (papersQuery.isLoading) return <CheckerSkeleton />;
  if (papersQuery.isError) {
    return (
      <div role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-destructive">
        Could not load your papers. Check your connection and try again.
        <div className="mt-2">
          <ActionButton tone="muted" onClick={() => void papersQuery.refetch()}>
            Try again
          </ActionButton>
        </div>
      </div>
    );
  }

  const papers = sortPapers(papersQuery.data ?? []);
  return (
    <div className="space-y-5">
      <p className="text-[13px] text-warm-secondary" data-testid="paper-limit-note">
        {PAPER_LIMIT_NOTE}
      </p>
      {papers.length === 0 ? (
        <div className="rounded-2xl bg-muted px-4 py-8 text-center" data-testid="no-papers">
          <p className="text-[16px] font-bold text-foreground">No papers for you yet</p>
          <p className="mx-auto mt-1 max-w-md text-pretty text-[14px] text-warm-secondary">
            Papers are given out automatically to match your grade, your board and the subjects your HOD has set for you. Check back soon, or ask your
            HOD.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="My papers">
          {papers.map((p) => {
            const prog = paperCardProgress(p);
            return (
              <li key={p.paper_id} className="flex flex-col rounded-2xl bg-muted p-4" data-testid="paper-card">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-balance text-[15px] font-bold text-foreground">{paperLabel(p)}</h2>
                  {p.given_by_hod ? (
                    <span className="shrink-0 rounded-full bg-brand-subtle px-2 py-0.5 text-[12px] font-semibold text-foreground">{GIVEN_BY_HOD}</span>
                  ) : null}
                </div>
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[13px] font-semibold tabular-nums text-warm-secondary">
                    <span>{prog.label}</span>
                    <span className="flex gap-3">
                      {p.skipped > 0 ? <span data-testid="skipped-count">{skippedLabel(p.skipped)}</span> : null}
                      {p.with_hod > 0 ? <span>{p.with_hod} with the HOD</span> : null}
                    </span>
                  </div>
                  <div
                    className="h-2.5 w-full overflow-hidden rounded-full bg-card"
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
                        {p.done > 0 ? 'Keep verifying' : 'Start verifying'}
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
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ full_name: '', grade: '', school: '', board: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const cardState = loadGate(profileQuery);
  if (cardState === 'loading') return null;
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
      const raw = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
      setFormError(raw || 'Could not save that. Try again in a moment.');
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
    } catch {
      setMessage('Could not send that. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="my-details-title" className="rounded-2xl bg-muted p-4" data-testid="profile-card">
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
              className="min-h-[44px] rounded-xl bg-card px-3 text-[16px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </label>
          <label className="grid gap-1">
            <span className="font-semibold text-foreground">Grade</span>
            <select
              value={form.grade}
              onChange={(e) => setForm({ ...form, grade: e.target.value })}
              className="min-h-[44px] rounded-xl bg-card px-3 text-[16px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
              className="min-h-[44px] rounded-xl bg-card px-3 text-[16px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </label>
          <label className="grid gap-1">
            <span className="font-semibold text-foreground">Board</span>
            <select
              value={form.board}
              onChange={(e) => setForm({ ...form, board: e.target.value })}
              className="min-h-[44px] rounded-xl bg-card px-3 text-[16px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
            <ActionButton tone="dark" onClick={() => void saveDetails()} disabled={busy}>
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
          <textarea
            id="req-subjects"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="w-full rounded-xl bg-card p-3 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
    <section aria-labelledby="my-details-title" className="rounded-2xl bg-muted p-4" data-testid="profile-card">
      <h2 id="my-details-title" className="text-[15px] font-bold text-foreground">
        My details
      </h2>
      <p role="alert" className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive" data-testid="profile-load-error">
        Could not load your details. They have not been changed. Check your connection and try again.
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
  paperId,
  onBack,
  onStart,
}: {
  api: CheckerApi;
  scope: string;
  paperId: string;
  onBack: () => void;
  onStart: () => void;
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
    <div data-testid="paper-overview">
      <button
        type="button"
        onClick={onBack}
        className="tap-44 mb-3 rounded-full bg-muted px-4 py-2 text-[13px] font-semibold text-warm-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
            Start verifying
          </ActionButton>
        ) : null}
      </div>

      {questionsQuery.isLoading ? (
        <CheckerSkeleton />
      ) : questionsQuery.isError ? (
        <div role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-destructive">
          Could not load this paper. It may not be yours any more.
        </div>
      ) : list.length === 0 ? (
        <p className="rounded-2xl bg-muted px-4 py-6 text-center text-[14px] text-warm-secondary">This paper has no questions to show.</p>
      ) : (
        <ol className="space-y-2" aria-label="Questions in this paper">
          {list.map((q, i) => (
            <li key={q.id} className="rounded-2xl bg-muted p-3" data-testid="paper-question">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] font-semibold">
                <span className="text-foreground">Question {questionLabel(q, i)}</span>
                {q.marks != null ? (
                  <span className="text-warm-secondary">
                    {q.marks} {q.marks === 1 ? 'mark' : 'marks'}
                  </span>
                ) : null}
                {q.page ? <span className="text-warm-secondary">Page {q.page}</span> : null}
                <span className={cn('rounded-full px-2 py-0.5', STATE_STYLE[q.state])}>{QUESTION_STATE_LABEL[q.state]}</span>
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
