import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAdminGuard, AdminGuardErrorState, adminToast } from '@/components/AdminConsole';
import { AdminPillButton, adminPillClass } from '@/components/admin/AdminPillButton';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminStatusPill } from '@/pages/admin/AdminTable';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { AdminDialog } from '@/components/admin/AdminDialog';
import { AdminError } from '@/components/admin/AdminState';
import { MathText } from '@/components/papers/math-text';
import { useRefreshAdminCounts } from '@/pages/admin/useAdminSectionCounts';
import { cn } from '@/lib/utils';
import { displaySchool } from '@/lib/school-display';
import { realApprovalApi } from '@/lib/admin-approval';
import {
  approveCopy,
  isRecordOnly,
  lookupNextWaiting,
  openQuestionsAdvice,
  approveClosedReason,
  type NextPaperLookup,
  resolveMode,
  reviewCounts,
  writeErrorWords,
  type ApprovalApi,
  type ApprovalQueueRow,
  type PaperReview,
  type ReviewPaper,
  type ReviewRow,
} from '@/lib/admin-approval-shape';
import { ReviewQuestionCard } from '@/components/admin/approval/ReviewQuestionCard';
import { PaperHistoryPanel } from '@/components/admin/approval/HistoryPanel';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';

const DummyPaperApproval = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminPaperApprovalDummy')) : null;

/* /admin/paper-approvals/:auditPaperId: one paper, read the way a visitor
   will see it, before an admin approves it for launch.

   - Every question is drawn as on /past-papers/:id (question text verbatim).
   - Edit on a question saves a NEW version (admin_edit_question). On a paper
     that is already live the site changes at once; Versions can put any
     earlier text back.
   - Approve is refused while any question is open; the button says why.
   - History, on the right (below on a phone), says who did what and when, in
     sentences. Owner, 2026-10-02: "That this user edited this. And that user
     edited this." */

export type Action = 'approve' | 'reject' | 'unpublish' | 'restore';

interface ActionCopy {
  title: string;
  body: string;
  button: string;
  busy: string;
  noteLabel: string;
  needsNote: boolean;
  toast: string;
}

/** The words for each decision. Approve and send back depend on whether the
 *  paper is already on the site: approving then only records the yes, and
 *  sending back does not take it down (admin_approve_paper, admin_reject_paper). */
export function actionCopy(action: Action, paper: Pick<ReviewPaper, 'kind' | 'live_bank_paper_id'>): ActionCopy {
  const recordOnly = isRecordOnly(paper);
  switch (action) {
    case 'approve': {
      const c = approveCopy(recordOnly ? 'retro' : 'new');
      return { ...c, noteLabel: 'Note (optional, shown in the history)', needsNote: false };
    }
    case 'reject':
      return {
        title: 'Send this paper back?',
        body: recordOnly
          ? 'The paper is marked as sent back in the history. Nothing on the site changes, so it stays up until you take it off. Say what needs to change so the next person knows.'
          : 'The paper is not approved and stays off the site. Say what needs to change so the next person knows.',
        button: 'Send back',
        busy: 'Sending back...',
        noteLabel: 'What needs to change',
        needsNote: true,
        toast: recordOnly ? 'Paper sent back. It stays on the site until you take it off.' : 'Paper sent back. It stays off the site.',
      };
    case 'unpublish':
      return {
        title: 'Take this paper off the site?',
        body: 'Visitors stop seeing it at once. Nothing is deleted, and it can be put back.',
        button: 'Take it off the site',
        busy: 'Taking it off...',
        noteLabel: 'Why',
        needsNote: true,
        toast: 'Paper taken off the site.',
      };
    case 'restore':
      return {
        title: 'Put this paper back on the site?',
        body: 'Visitors can read it again at once, with the questions as they are now. Set-aside questions still show as placeholder cards.',
        button: 'Put it back',
        busy: 'Putting it back...',
        noteLabel: '',
        needsNote: false,
        toast: 'Paper is back on the site.',
      };
  }
}

function depthMap(rows: ReviewRow[]): Map<string, number> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, number>();
  for (const r of rows) {
    let d = 0;
    let p = r.parent_id;
    const seen = new Set<string>();
    while (p && byId.has(p) && !seen.has(p) && d < 4) {
      seen.add(p);
      d++;
      p = byId.get(p)?.parent_id ?? null;
    }
    out.set(r.id, d);
  }
  return out;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div className={cn('rounded-2xl px-4 py-3', tone === 'warn' && value > 0 ? 'bg-brand-subtle' : 'bg-muted')}>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-warm-label">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', tone === 'warn' && value > 0 ? 'text-brand-deep' : 'text-foreground')}>
        {value}
      </p>
    </div>
  );
}

export function AdminPaperApprovalPage({
  auditPaperId,
  api = realApprovalApi,
  dummy = false,
  banner,
  now,
}: {
  auditPaperId: string;
  api?: ApprovalApi;
  dummy?: boolean;
  banner?: ReactNode;
  /** Fixed clock for fixtures, so "2 Oct" never turns into "2 Oct 2026". */
  now?: Date;
}) {
  const { user, profile } = useAuth();
  const signedIn = dummy ? 'admin@example.com' : user?.email ?? profile?.full_name ?? 'Signed-in admin';
  const [review, setReview] = useState<PaperReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // After an approve or send-back: what happened and which paper to open next.
  const [done, setDone] = useState<{ words: string; next: NextPaperLookup<ApprovalQueueRow> } | null>(null);
  const refreshCounts = useRefreshAdminCounts();

  usePageMeta(
    review ? `${review.paper.title} | Paper approval | Shikshaq Admin` : 'Paper approval | Shikshaq Admin',
    'Read, edit and approve a checked paper for launch.',
  );

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setLoadError(false);
      try {
        setReview(await api.review(auditPaperId));
      } catch (e) {
        if (import.meta.env.DEV) console.error('paper approval', e);
        // A quiet refresh that fails keeps the paper on screen.
        if (!quiet) setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [api, auditPaperId],
  );

  const guard = useAdminGuard(dummy ? null : user, { redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;

  useEffect(() => {
    setDone(null);
  }, [auditPaperId]);

  useEffect(() => {
    if (isAdmin) void load();
    else if (!checkingAdmin) setLoading(false);
  }, [isAdmin, checkingAdmin, load]);

  /* A link like #q-<id> (the Solve button on Ready to go live) points at a card
     that only exists after the paper loads, so the browser cannot scroll there
     itself. Do it once the rows are drawn. */
  const { hash } = useLocation();
  const loadedForHash = Boolean(review) && !loading;
  useEffect(() => {
    if (!loadedForHash || !hash.startsWith('#q-')) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ block: 'center' });
  }, [loadedForHash, hash]);

  const rows = useMemo(() => review?.rows ?? [], [review]);
  const depths = useMemo(() => depthMap(rows), [rows]);
  const counts = useMemo(() => reviewCounts(rows), [rows]);
  const firstOpen = rows.find((r) => r.kind === 'question' && r.state === 'open');

  const nav = buildAdminNav('ready');

  function ask(next: Action) {
    setAction(next);
    setNote('');
    setActionError(null);
  }

  function afterWrite() {
    setHistoryKey((k) => k + 1);
    void load(true);
    refreshCounts();
  }

  /** The oldest other paper that is ready, so a run of approvals needs no trip back to the list. */
  function findNext(): Promise<NextPaperLookup<ApprovalQueueRow>> {
    return lookupNextWaiting(() => api.queue(), auditPaperId);
  }

  async function runAction() {
    if (!review || !action) return;
    const copy = actionCopy(action, review.paper);
    if (copy.needsNote && !note.trim()) {
      setActionError('Write a short note first, so the history says why.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      if (action === 'approve') {
        await api.approve(review.paper.audit_paper_id, note.trim());
        adminToast(copy.toast);
        setDone({ words: copy.toast, next: await findNext() });
      } else if (action === 'reject') {
        await api.reject(review.paper.audit_paper_id, note.trim());
        adminToast(copy.toast);
        setDone({ words: copy.toast, next: await findNext() });
      } else if (action === 'unpublish' && review.paper.live_bank_paper_id) {
        await api.unpublish(review.paper.live_bank_paper_id, note.trim());
        adminToast(copy.toast);
      } else if (action === 'restore' && review.paper.live_bank_paper_id) {
        await api.restorePaper(review.paper.live_bank_paper_id);
        adminToast(copy.toast);
      }
      setAction(null);
      setNote('');
      afterWrite();
    } catch (e) {
      setActionError(writeErrorWords(e, 'That did not go through. Nothing was changed. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (checkingAdmin || loading) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={signedIn} />
        {banner}
        <BentoPanel fill="card" className="px-[18px] py-[18px]">
          <div className="animate-pulse space-y-3" role="status" aria-label="Loading the paper">
            <div className="h-7 w-2/3 rounded-xl bg-muted" />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-20 rounded-2xl bg-muted" />
              ))}
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 rounded-[18px] bg-muted" />
            ))}
          </div>
        </BentoPanel>
      </BentoStack>
    );
  }
  if (!dummy && guard.error) return <AdminGuardErrorState onRetry={guard.retry} />;
  if (!isAdmin) return null;

  if (loadError || !review) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={signedIn} />
        {banner}
        <BentoPanel fill="card" className="px-[18px] py-[18px]">
          <AdminError what="this paper" onRetry={() => void load()} />
          <Link to="/admin/paper-approvals" className={cn(adminPillClass('quiet'), 'mt-3')}>
            Back to Ready to go live
          </Link>
        </BentoPanel>
      </BentoStack>
    );
  }

  const { paper } = review;
  const open = review.open_count || counts.open;
  const isLive = Boolean(paper.live_bank_paper_id) && paper.is_published;
  const approved = paper.approval === 'approved';
  const wasLive = Boolean(paper.live_bank_paper_id) && !paper.is_published && (approved || paper.kind === 'retro');
  const rejected = paper.approval === 'rejected';
  const copy = action ? actionCopy(action, paper) : null;
  const mode = resolveMode(paper.approval);
  const meta = [paper.school ? displaySchool(paper.school) : null, paper.exam, paper.year].filter(Boolean).join(' · ');

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={signedIn} />
      {banner}

      {done ? (
        <BentoPanel fill="card" className="px-[18px] py-[14px] lg:px-[18px] lg:py-[14px]">
          <div role="status" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2" data-testid="after-decision">
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-foreground">{done.words}</p>
              <p className="text-[13px] text-warm-secondary">
                {done.next === 'unknown' ? (
                  'We could not check for the next paper. Go back to the list to see what is waiting.'
                ) : done.next ? (
                  <>
                    Next waiting paper:{' '}
                    <Link
                      to={`/admin/paper-approvals/${encodeURIComponent(done.next.audit_paper_id)}`}
                      className="font-bold text-brand-blue hover:text-brand-blue-deep"
                    >
                      {done.next.title}
                    </Link>
                  </>
                ) : (
                  'No other paper is ready to approve.'
                )}
              </p>
            </div>
            <Link to="/admin/paper-approvals" className={adminPillClass('secondary', 'sm')}>
              Back to the list
            </Link>
          </div>
        </BentoPanel>
      ) : null}

      <BentoPanel fill="card" className="px-[18px] py-[18px] lg:px-[18px] lg:py-[18px]">
        <Link
          to="/admin/paper-approvals"
          className="inline-flex min-h-10 items-center gap-1.5 text-[13px] font-semibold text-brand-blue hover:text-brand-blue-deep"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Ready to go live
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-balance text-[22px] font-extrabold leading-tight tracking-[-0.03em] text-foreground">{paper.title}</h1>
            {meta ? <p className="mt-0.5 text-[14px] text-warm-secondary">{meta}</p> : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {paper.kind === 'retro' ? (
              open > 0 ? <AdminStatusPill status="pending" label={`Live, ${open} open`} /> : <AdminStatusPill status="live" label="Already live" />
            ) : null}
            {approved ? <AdminStatusPill status="live" label="Approved" /> : null}
            {rejected ? <AdminStatusPill status="hidden" label="Sent back" /> : null}
            {wasLive ? <AdminStatusPill status="paused" label="Off the site" /> : null}
            {!approved && !rejected ? <AdminStatusPill status="pending" label="Waiting for approval" /> : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Questions" value={counts.total} />
          <Stat label="Passed" value={counts.passed} />
          <Stat label="Open" value={open} tone="warn" />
          <Stat label="Set aside" value={counts.set_aside} />
        </div>

        {open > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-brand-subtle px-4 py-3 text-[14px] text-brand-deep" role="status">
            <span className="font-semibold">
              {open === 1 ? '1 question is still open.' : `${open} questions are still open.`}{' '}
              {openQuestionsAdvice(mode)}
            </span>
            {firstOpen ? (
              <a href={`#q-${firstOpen.id}`} className="inline-flex min-h-10 items-center font-bold underline underline-offset-2">
                Go to the first one
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <AdminPillButton
            variant="primary"
            disabled={open > 0 || approved || rejected}
            onClick={() => ask('approve')}
            className="disabled:cursor-not-allowed disabled:opacity-50"
            title={approveClosedReason({ open, approved, rejected })}
          >
            {approved ? 'Approved' : isRecordOnly(paper) ? 'Approve (already live)' : 'Approve for launch'}
          </AdminPillButton>
          {!approved ? (
            <AdminPillButton variant="secondary" onClick={() => ask('reject')} disabled={rejected}>
              {rejected ? 'Sent back' : 'Send back'}
            </AdminPillButton>
          ) : null}
          {wasLive ? (
            <AdminPillButton variant="secondary" onClick={() => ask('restore')}>
              Put back on the site
            </AdminPillButton>
          ) : null}
          <a href="#paper-history" className={adminPillClass('secondary', 'md', 'lg:hidden')}>
            History
          </a>
          {isLive ? (
            <AdminPillButton variant="destructive" onClick={() => ask('unpublish')}>
              Take off the site
            </AdminPillButton>
          ) : null}
        </div>
        {rejected ? (
          <p className="mt-2 text-[13px] text-warm-secondary" data-testid="sent-back-note">
            Sent back. Approval is closed for this paper.
          </p>
        ) : null}
      </BentoPanel>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_400px]">
        <BentoPanel fill="card" className="px-[18px] py-[18px] lg:px-[18px] lg:py-[18px]">
          <h2 className="mb-1 text-[19px] font-extrabold tracking-[-0.03em] text-foreground">The paper, as visitors will see it</h2>
          <p className="mb-3 text-[13px] text-warm-secondary">
            Edit fixes a reading mistake and saves a new version. Versions shows every earlier one.
          </p>
          {isLive ? (
            <p role="note" className="mb-3 rounded-2xl bg-brand-subtle px-4 py-3 text-[14px] font-semibold text-brand-deep">
              This paper is live. Saving an edit to a question that is on the site changes it for visitors at once. Each save is a
              version, and Versions can put the earlier text back.
            </p>
          ) : null}
          {paper.general_instructions ? (
            <MathText text={paper.general_instructions} className="mb-3 text-[14px] leading-[1.55] text-warm-prose" />
          ) : null}
          <ol className="flex flex-col gap-2.5">
            {rows.map((r) => {
              if (r.kind === 'section_break') {
                return (
                  <li key={r.id} className="pt-2 text-[13px] font-extrabold uppercase tracking-[.06em] text-warm-label">
                    {r.body || 'Section'}
                  </li>
                );
              }
              if (r.kind !== 'question') {
                return (
                  <li key={r.id}>
                    <MathText text={r.body} className="text-[13px] italic leading-[1.5] text-warm-secondary" />
                  </li>
                );
              }
              return (
                <ReviewQuestionCard
                  key={r.id}
                  row={r}
                  label={r.display_number ?? r.number_path}
                  depth={depths.get(r.id) ?? 0}
                  api={api}
                  onSaved={afterWrite}
                  canResolve={mode !== 'none'}
                  passOnly={mode === 'pass-only'}
                  now={now}
                />
              );
            })}
          </ol>
        </BentoPanel>

        <BentoPanel fill="card" id="paper-history" className="px-[18px] py-[18px] lg:px-[18px] lg:py-[18px]">
          <div className="lg:sticky lg:top-4">
            <h2 className="text-[19px] font-extrabold tracking-[-0.03em] text-foreground">History</h2>
            <p className="mb-2 text-[13px] text-warm-secondary">Who did what to this paper, newest first.</p>
            <PaperHistoryPanel api={api} auditPaperId={paper.audit_paper_id} reloadKey={historyKey} now={now} />
          </div>
        </BentoPanel>
      </div>

      <AdminAuditNote />

      <AdminDialog
        open={action !== null && copy !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setAction(null);
        }}
        title={copy?.title ?? ''}
        size="sm"
        footer={
          copy ? (
            <>
              <AdminPillButton variant="secondary" onClick={() => setAction(null)} disabled={busy}>
                Cancel
              </AdminPillButton>
              <AdminPillButton
                variant={action === 'unpublish' ? 'destructive' : 'primary'}
                busy={busy}
                onClick={() => void runAction()}
              >
                {busy ? copy.busy : copy.button}
              </AdminPillButton>
            </>
          ) : null
        }
      >
        {copy ? (
          <>
            <p className="text-[14px] text-warm-secondary">{copy.body}</p>
            {copy.noteLabel ? (
              <label className="mt-3 flex flex-col gap-1 text-[12px] font-semibold text-warm-secondary">
                {copy.noteLabel}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className="rounded-xl bg-muted px-3 py-2 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </label>
            ) : null}
            {actionError ? (
              <p role="alert" className="mt-2 text-[13px] text-destructive">
                {actionError}
              </p>
            ) : null}
          </>
        ) : null}
      </AdminDialog>
    </BentoStack>
  );
}

export default function AdminPaperApproval() {
  const { auditPaperId = '' } = useParams<{ auditPaperId: string }>();
  if (DummyPaperApproval && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyPaperApproval auditPaperId={auditPaperId} />
      </Suspense>
    );
  }
  return <AdminPaperApprovalPage auditPaperId={auditPaperId} />;
}
