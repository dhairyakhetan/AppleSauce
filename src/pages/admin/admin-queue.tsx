import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, Image as ImageIcon } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAdminGuard, AdminGuardErrorState, adminToast } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminPanelHeader, AdminStatusPill } from '@/pages/admin/AdminTable';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { useRefreshAdminCounts } from '@/pages/admin/useAdminSectionCounts';
import { AdminPageIntro } from '@/components/admin/AdminHelp';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { AdminPillButton, adminPillClass } from '@/components/admin/AdminPillButton';
import { AdminTabs, type AdminTabItem } from '@/components/admin/AdminTabs';
import { PaperPageFlip } from '@/components/checker/PaperPageFlip';
import { ReviewQuestionCard } from '@/components/admin/approval/ReviewQuestionCard';
import { MathText } from '@/components/papers/math-text';
import { cn } from '@/lib/utils';
import { memoizeAsync } from '@/lib/memoize-async';
import { displaySchool } from '@/lib/school-display';
import { kidSentence } from '@/lib/checker-kid-reasons';
import { realAdminQueueApi, type AdminQueueApi, type QueuePaper, type QueueQuestion } from '@/lib/admin-queue';
import type { EscalationRow } from '@/lib/checker-api';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';

const DummyAdminQueue = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminQueueDummy')) : null;

/* /admin/admin-queue: the questions the checking could not settle. Papers
   first (counts only, so the page opens at once), a paper's questions on
   demand, each with the picture of the page it came from and the reason it
   was flagged in words. Pass, Edit and Set aside are the same controls the
   paper review page uses, so every decision is versioned and logged.

   One number, once: the two tab badges carry the counts, so there are no stat
   tiles or header sentence repeating them. A failed read says so with Try
   again; it is never shown as "nothing is waiting". */

type Tab = 'waiting' | 'help';

export const QUEUE_UNAVAILABLE_WORDS =
  'The list of waiting questions is not available on this server yet. Try again later.';

function PagePicture({ q, api, auditPaperId }: { q: QueueQuestion; api: AdminQueueApi; auditPaperId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'missing'>('idle');
  const path = q.snippet_path ?? q.page_path;
  // No page matched this question (or its picture is gone): show the whole
  // paper as a page-flip instead of asking for a judgement from the words alone.
  const wholePaper = (
    <div className="mb-2">
      <PaperPageFlip paperId={auditPaperId} loadPages={api.paperPages} pictureUrl={api.pictureUrl} questionPage={q.page} />
    </div>
  );
  if (!path || state === 'missing') return wholePaper;
  async function show() {
    setState('loading');
    const u = await api.pictureUrl(path as string);
    if (u) {
      setUrl(u);
      setState('idle');
    } else setState('missing');
  }
  return (
    <div className="mb-2">
      {url ? (
        <img
          src={url}
          alt={q.page ? `Page ${q.page} of the printed paper, where this question is` : 'The printed question'}
          className="max-h-[420px] w-full rounded-xl bg-card object-contain"
        />
      ) : (
        <button
          type="button"
          onClick={() => void show()}
          disabled={state === 'loading'}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-card px-3.5 text-[13px] font-bold text-foreground transition-colors duration-150 hover:bg-warm-hairline disabled:opacity-60"
        >
          <ImageIcon className="h-4 w-4" aria-hidden />
          {state === 'loading' ? 'Loading the picture...' : q.page ? `Show page ${q.page} as printed` : 'Show the printed question'}
        </button>
      )}
    </div>
  );
}

function PaperQuestions({ auditPaperId, api, onChanged }: { auditPaperId: string; api: AdminQueueApi; onChanged: () => void }) {
  const qc = useQueryClient();
  const key = ['admin', 'queue', 'questions', auditPaperId];
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: key, queryFn: () => api.questions(auditPaperId), staleTime: 30_000 });
  // Many questions of one paper can show the whole paper. Read its pages, and
  // sign each picture link, once for all of them.
  const pagesApi = useMemo<AdminQueueApi>(
    () => ({ ...api, paperPages: memoizeAsync(api.paperPages), pictureUrl: memoizeAsync(api.pictureUrl, (u) => u !== null) }),
    [api],
  );
  if (isLoading) return <AdminLoading shape="cards" rows={2} label="Loading questions" className="px-1 py-2" />;
  if (isError) return <AdminError what="these questions" onRetry={() => void refetch()} className="my-2" />;
  if (!data?.length) return <p className="py-3 text-[14px] text-warm-secondary">Nothing is waiting on this paper any more.</p>;
  return (
    <div className="space-y-3">
      {data.map((q) => (
        <div key={q.row.id}>
          <PagePicture q={q} api={pagesApi} auditPaperId={auditPaperId} />
          <ul>
            <ReviewQuestionCard
              row={q.row}
              label={q.row.display_number ?? q.row.number_path}
              depth={0}
              api={api}
              canResolve
              onSaved={() => {
                void qc.invalidateQueries({ queryKey: key });
                onChanged();
              }}
            />
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ---- Waiting for an admin ------------------------------------------------ */

export type WaitingState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; papers: QueuePaper[] };

/** Pure: what the waiting tab should show, from the query. Error and
 *  unavailable are different from empty, and neither ever reads as "nothing waiting". */
export function waitingState(q: { isLoading: boolean; isError: boolean; data: QueuePaper[] | null | undefined }): WaitingState {
  if (q.isLoading) return { kind: 'loading' };
  if (q.isError) return { kind: 'error' };
  if (q.data === null) return { kind: 'unavailable' };
  return { kind: 'ready', papers: q.data ?? [] };
}

export function WaitingListView({
  state,
  open,
  onToggle,
  onRetry,
  renderQuestions,
}: {
  state: WaitingState;
  open: string | null;
  onToggle: (auditPaperId: string) => void;
  onRetry: () => void;
  renderQuestions: (auditPaperId: string) => ReactNode;
}) {
  if (state.kind === 'loading') return <AdminLoading shape="rows" rows={5} label="Loading the queue" />;
  if (state.kind === 'error') return <AdminError what="the queue" onRetry={onRetry} />;
  if (state.kind === 'unavailable') {
    return (
      <p className="rounded-[18px] bg-muted px-4 py-4 text-[14px] leading-[1.5] text-warm-secondary" role="status">
        {QUEUE_UNAVAILABLE_WORDS}
      </p>
    );
  }
  if (state.papers.length === 0) {
    return <AdminEmpty title="Nothing is waiting for an admin." hint="Questions the checking cannot settle appear here, a paper at a time." />;
  }
  return (
    <ul className="space-y-2">
      {state.papers.map((p) => {
        const isOpen = open === p.audit_paper_id;
        const panelId = `queue-paper-${p.audit_paper_id}`;
        return (
          <li key={p.audit_paper_id} className="rounded-[18px] bg-muted">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={isOpen ? panelId : undefined}
              onClick={() => onToggle(p.audit_paper_id)}
              className="flex w-full min-h-14 flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-[10rem] flex-1">
                <span className="block text-[15px] font-bold text-foreground" title={p.title}>
                  {p.title}
                </span>
                <span className="block text-[13px] text-warm-secondary">{p.school ? displaySchool(p.school) : 'School not recorded'}</span>
              </span>
              <span className="flex items-center gap-2">
                <AdminStatusPill status={p.is_live ? 'live' : 'paused'} label={p.is_live ? 'Live' : 'Not live yet'} />
                <span className="rounded-full bg-brand px-2.5 py-1 text-[12px] font-bold tabular-nums text-foreground">{p.waiting} waiting</span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-warm-secondary transition-transform duration-150', isOpen && 'rotate-180')} aria-hidden />
              </span>
            </button>
            {isOpen ? (
              <div id={panelId} className="px-3 pb-3">
                {renderQuestions(p.audit_paper_id)}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/* ---- Asked for help ------------------------------------------------------ */

export type AcceptStep = 'idle' | 'confirm' | 'busy' | 'failed';

export const ACCEPT_FAILED_WORDS = 'Nothing changed. Try again.';

/** Which button should take keyboard focus after the card moves from one step
 *  to another. The button that was pressed disappears, so without this focus
 *  falls to the top of the page. Null when focus should stay where it is. */
export function focusAfterStep(from: AcceptStep, to: AcceptStep): 'confirm' | 'accept' | null {
  if (from === 'idle' && to === 'confirm') return 'confirm';
  if (from === 'confirm' && to === 'idle') return 'accept';
  return null;
}

/** Where an admin opens the paper to decide this question: the review page, scrolled to it. */
export const helpPaperHref = (e: Pick<EscalationRow, 'paper_id' | 'question_id'>): string =>
  `/admin/paper-approvals/${encodeURIComponent(e.paper_id)}#q-${e.question_id}`;

/** The one write on this tab, run only after the second step. Same call as before. */
export async function acceptAsIs(api: Pick<AdminQueueApi, 'resolveHelp'>, questionId: string): Promise<'ok' | 'failed'> {
  try {
    await api.resolveHelp(questionId);
    return 'ok';
  } catch {
    return 'failed';
  }
}

export function HelpCardView({
  e,
  step,
  onAsk,
  onCancel,
  onConfirm,
}: {
  e: EscalationRow;
  step: AcceptStep;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const reasons = e.flag_reasons.map(kidSentence).join(' ');
  const meta = [e.school ? displaySchool(e.school) : 'School not recorded', e.subject, e.cls ? `Class ${e.cls}` : null]
    .filter(Boolean)
    .join(', ');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const prevStep = useRef<AcceptStep>(step);
  useEffect(() => {
    const target = focusAfterStep(prevStep.current, step);
    prevStep.current = step;
    if (target === 'confirm') confirmRef.current?.focus();
    else if (target === 'accept') acceptRef.current?.focus();
  }, [step]);
  return (
    <li className="rounded-[18px] bg-muted p-4" data-testid="help-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[15px] font-bold text-foreground">
          Question <span className="tabular-nums">{e.display_number ?? 'with no number'}</span>
        </p>
        <p className="min-w-0 text-[13px] text-warm-secondary">{meta}</p>
      </div>
      {e.body ? (
        <div className="mt-2 rounded-xl bg-card px-3 py-2.5" data-testid="help-question-body">
          <MathText text={e.body} className="text-[14px] leading-[1.55] text-foreground" />
        </div>
      ) : (
        <p className="mt-2 rounded-xl bg-card px-3 py-2.5 text-[13px] text-warm-secondary">This question has no text. Open the paper to see it.</p>
      )}
      <p className="mt-2 text-[13px] leading-[1.5] text-warm-secondary">
        <span className="font-bold text-foreground">Why they asked: </span>
        {reasons || 'No reason was recorded.'}
      </p>

      {step === 'confirm' || step === 'busy' ? (
        <div className="mt-3 rounded-xl bg-card px-3 py-3" role="group" aria-label="Confirm accepting this question">
          <p className="text-[14px] text-foreground">Accept this question exactly as it is? It counts as passed and leaves this list.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <AdminPillButton ref={confirmRef} variant="primary" size="sm" busy={step === 'busy'} onClick={onConfirm}>
              {step === 'busy' ? 'Accepting...' : 'Yes, accept it'}
            </AdminPillButton>
            <AdminPillButton variant="secondary" size="sm" disabled={step === 'busy'} onClick={onCancel}>
              Cancel
            </AdminPillButton>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link to={helpPaperHref(e)} className={adminPillClass('secondary', 'sm')}>
            Open the paper
          </Link>
          <AdminPillButton ref={acceptRef} variant="secondary" size="sm" onClick={onAsk}>
            Accept as-is
          </AdminPillButton>
        </div>
      )}
      {step === 'failed' ? (
        <p role="alert" className="mt-2 text-[13px] font-semibold text-destructive">
          {ACCEPT_FAILED_WORDS}
        </p>
      ) : null}
    </li>
  );
}

function HelpCard({ e, api, onResolved }: { e: EscalationRow; api: AdminQueueApi; onResolved: () => void }) {
  const [step, setStep] = useState<AcceptStep>('idle');
  async function confirm() {
    setStep('busy');
    const result = await acceptAsIs(api, e.question_id);
    if (result === 'ok') {
      adminToast('Marked resolved');
      onResolved();
    } else {
      setStep('failed');
    }
  }
  return <HelpCardView e={e} step={step} onAsk={() => setStep('confirm')} onCancel={() => setStep('idle')} onConfirm={() => void confirm()} />;
}

export function AdminQueuePage({
  api = realAdminQueueApi,
  dummy = false,
  banner,
}: {
  api?: AdminQueueApi;
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Admin queue | Shikshaq Admin', 'Questions waiting for an admin decision.');
  const { user, profile } = useAuth();
  const signedIn = dummy ? 'admin@example.com' : user?.email ?? profile?.full_name ?? 'Signed-in admin';
  const guard = useAdminGuard(dummy ? null : user, { redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const qc = useQueryClient();
  const refreshNavCounts = useRefreshAdminCounts();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('view') === 'help' ? 'help' : 'waiting';
  const [open, setOpen] = useState<string | null>(null);

  const papersQ = useQuery({ queryKey: ['admin', 'queue', 'papers', dummy], queryFn: () => api.papers(), enabled: isAdmin, staleTime: 30_000 });
  const helpQ = useQuery({ queryKey: ['admin', 'queue', 'help', dummy], queryFn: () => api.helpRequests(), enabled: isAdmin, staleTime: 30_000 });

  const papers = papersQ.data ?? [];
  const total = papers.reduce((a, p) => a + p.waiting, 0);
  const help = helpQ.data ?? [];
  const nav = buildAdminNav('admin-queue', papersQ.data ? { adminQueue: total } : {});
  const refreshCounts = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'queue', 'papers'] });
    refreshNavCounts();
  };
  function setTab(next: string) {
    const p = new URLSearchParams(params);
    if (next === 'help') p.set('view', 'help');
    else p.delete('view');
    setParams(p, { replace: true });
  }

  if (checkingAdmin) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={signedIn} />
        <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
          <div className="px-[18px]">
            <AdminLoading shape="rows" rows={4} label="Loading the queue" />
          </div>
        </BentoPanel>
      </BentoStack>
    );
  }
  if (!dummy && guard.error) return <AdminGuardErrorState onRetry={guard.retry} />;
  if (!isAdmin) return null;

  // A count is shown only when it was read. A failed or missing read is "?", never 0.
  const tabs: AdminTabItem[] = [
    { key: 'waiting', label: 'Waiting for an admin', count: papersQ.isError ? null : papersQ.data ? total : undefined },
    { key: 'help', label: 'Asked for help', count: helpQ.isError ? null : helpQ.data ? help.length : undefined },
  ];

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={signedIn} />
      {banner}

      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <div className="mb-3 px-[18px]">
          <AdminPageIntro page="admin-queue" />
        </div>
        <AdminPanelHeader title="Admin queue" />
        <div className="px-[18px]">
          <AdminTabs tabs={tabs} value={tab} onChange={setTab} label="Admin queue view">
            {tab === 'waiting' ? (
              <WaitingListView
                state={waitingState(papersQ)}
                open={open}
                onToggle={(id) => setOpen(open === id ? null : id)}
                onRetry={() => void papersQ.refetch()}
                renderQuestions={(id) => <PaperQuestions auditPaperId={id} api={api} onChanged={refreshCounts} />}
              />
            ) : helpQ.isLoading ? (
              <AdminLoading shape="cards" rows={2} label="Loading the requests" />
            ) : helpQ.isError ? (
              <AdminError what="the questions sent for help" onRetry={() => void helpQ.refetch()} />
            ) : help.length === 0 ? (
              <AdminEmpty title="No checker has asked for help right now." hint="When a verifier cannot decide a question, it appears here." />
            ) : (
              <ul className="space-y-3">
                {help.map((e) => (
                  <HelpCard
                    key={e.question_id}
                    e={e}
                    api={api}
                    onResolved={() => {
                      void qc.invalidateQueries({ queryKey: ['admin', 'queue', 'help'] });
                      refreshNavCounts();
                    }}
                  />
                ))}
              </ul>
            )}
          </AdminTabs>
        </div>
      </BentoPanel>

      <AdminAuditNote />
    </BentoStack>
  );
}

export default function AdminQueue() {
  if (DummyAdminQueue && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyAdminQueue />
      </Suspense>
    );
  }
  return <AdminQueuePage />;
}
