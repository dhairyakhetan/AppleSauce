import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { adminPrimaryBtnStyle, adminSecondaryBtnStyle, adminToast } from '@/components/AdminConsole';
import { BentoPanel } from '@/components/layout/PageContainer';
import { AdminError, AdminLoading } from '@/components/admin/AdminState';
import { AdminStatusPill } from '@/pages/admin/AdminTable';
import { displaySchool } from '@/lib/school-display';
import { cn } from '@/lib/utils';
import { createLatestGuard } from '@/lib/latest-guard';
import {
  canUpdate,
  confirmWords,
  doneWords,
  realLiveUpdateApi,
  solveHref,
  updateErrorWords,
  type LiveUpdateApi,
  type LivePendingRow,
  type OpenQuestion,
} from '@/lib/admin-live-update';

/* Live papers whose reviewed changes have not reached the site yet, each with
   an "Update live paper" button (Ready to go live page). The button asks first,
   in plain words, and says how many questions it will touch. A paper with a
   question still open cannot be pushed; the row says so instead. */

function counts(r: LivePendingRow): string {
  const parts = [
    `${r.updated} ${r.updated === 1 ? 'question' : 'questions'} updated`,
    `${r.added} added`,
    `${r.hidden} hidden`,
  ];
  return parts.join(', ');
}

export function UpdateLivePapersView({
  rows,
  state,
  confirmingId = null,
  busyId = null,
  errorFor = null,
  expandedId = null,
  openList = null,
  onToggleOpen = () => {},
  onAsk,
  onCancel,
  onConfirm,
  onRetry,
  bare = false,
}: {
  /** Draw without its own panel and heading, for use inside a tab. */
  bare?: boolean;
  rows: LivePendingRow[] | null;
  state: 'idle' | 'loading' | 'error';
  confirmingId?: string | null;
  busyId?: string | null;
  errorFor?: { id: string; message: string } | null;
  /** The paper whose open questions are listed, and that list ('loading', 'error' or the rows). */
  expandedId?: string | null;
  openList?: OpenQuestion[] | 'loading' | 'error' | null;
  onToggleOpen?: (id: string) => void;
  onAsk: (id: string) => void;
  onCancel: () => void;
  onConfirm: (id: string) => void;
  onRetry: () => void;
}) {
  const pad = bare ? undefined : 'px-[18px]';
  const content = (
    <>
      <div className={pad}>
        {bare ? null : <h2 className="text-[19px] font-extrabold tracking-[-0.03em] text-foreground">Live papers with changes waiting</h2>}
        <p className="mb-3 text-[13px] text-warm-secondary">
          These papers are already on the site, and their reviewed changes are not. Updating a live paper copies the
          reviewed text, new questions and hidden questions to the site.
        </p>
      </div>

      {state === 'error' ? (
        <div className={pad}>
          <AdminError what="the list of live papers" onRetry={onRetry} />
        </div>
      ) : rows === null ? (
        <div className={pad}>
          <AdminLoading shape="rows" rows={2} label="Loading live papers with changes" />
        </div>
      ) : rows.length === 0 ? (
        <p className={cn('py-4 text-[14px] text-warm-meta', pad)}>No live paper has changes waiting.</p>
      ) : (
        <ul className={cn('space-y-2', pad)}>
          {rows.map((r) => {
            const open = r.open;
            const asking = confirmingId === r.audit_paper_id;
            const busy = busyId === r.audit_paper_id;
            return (
              <li key={r.audit_paper_id} className="rounded-2xl bg-muted px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-foreground">{r.title}</p>
                    <p className="text-[13px] text-warm-secondary">
                      {r.school ? displaySchool(r.school) : 'School not recorded'}
                      {', '}
                      <span className="tabular-nums">{counts(r)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {open ? (
                      <button
                        type="button"
                        onClick={() => onToggleOpen(r.audit_paper_id)}
                        aria-expanded={expandedId === r.audit_paper_id}
                        aria-controls={`open-q-${r.audit_paper_id}`}
                        aria-label={`${expandedId === r.audit_paper_id ? 'Hide' : 'Show'} the ${open} open ${open === 1 ? 'question' : 'questions'}`}
                        className="tap-44 inline-flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <AdminStatusPill status="paused" label={`${open} open`} />
                        <ChevronDown
                          className={cn('ml-1 h-4 w-4 text-warm-secondary transition-transform duration-150', expandedId === r.audit_paper_id && 'rotate-180')}
                          aria-hidden
                        />
                      </button>
                    ) : (
                      <AdminStatusPill status="pending" label="Ready" />
                    )}
                    {asking ? null : (
                      <button
                        type="button"
                        disabled={!canUpdate(r) || busy}
                        onClick={() => onAsk(r.audit_paper_id)}
                        aria-label={`Update live paper: ${r.title}`}
                        title={canUpdate(r) ? undefined : 'Pass or set aside every question first.'}
                        className={cn(adminPrimaryBtnStyle, 'disabled:cursor-not-allowed disabled:opacity-50')}
                      >
                        Update live paper
                      </button>
                    )}
                  </div>
                </div>
                {!canUpdate(r) ? (
                  <p className="mt-2 text-[13px] text-warm-secondary">
                    {open === 1 ? '1 question is' : `${open} questions are`} still open. Pass or set aside each one first.
                  </p>
                ) : null}
                {expandedId === r.audit_paper_id ? (
                  <div id={`open-q-${r.audit_paper_id}`} className="mt-3 rounded-xl bg-card px-4 py-3" data-testid="open-questions">
                    {openList === 'loading' || openList === null ? (
                      <p role="status" className="text-[13px] text-warm-meta">Loading the open questions...</p>
                    ) : openList === 'error' ? (
                      <div role="alert">
                        <p className="text-[13px] text-foreground">The list did not load. Check your internet and try again.</p>
                        <button type="button" onClick={() => onToggleOpen(r.audit_paper_id)} className="tap-44 text-sm font-semibold text-brand-blue">
                          Close
                        </button>
                      </div>
                    ) : openList.length === 0 ? (
                      <p className="text-[13px] text-warm-secondary">Nothing is open any more. Refresh the page to update the button.</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {openList.map((q) => (
                          <li key={q.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                            <div className="min-w-0 flex-1 basis-56">
                              <p className="text-[14px] font-semibold text-foreground">
                                Question <span className="tabular-nums">{q.label}</span>
                                <span className="ml-2 text-[12px] font-semibold text-warm-label">Waits in: {q.where}</span>
                              </p>
                              <ul className="mt-1 space-y-0.5 text-[13px] text-warm-secondary">
                                {q.reasons.slice(0, 3).map((w) => (
                                  <li key={w}>{w}</li>
                                ))}
                              </ul>
                            </div>
                            <Link
                              to={solveHref(r.audit_paper_id, q.id)}
                              aria-label={`Solve question ${q.label}`}
                              className={cn(adminSecondaryBtnStyle, 'shrink-0')}
                            >
                              Solve
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
                {asking ? (
                  <div className="mt-3 rounded-xl bg-card px-4 py-3">
                    <p className="text-[14px] text-foreground">{confirmWords(r)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onConfirm(r.audit_paper_id)}
                        aria-label={busy ? `Updating ${r.title}` : `Yes, update the live paper: ${r.title}`}
                        disabled={busy}
                        className={cn(adminPrimaryBtnStyle, 'disabled:opacity-60')}
                      >
                        {busy ? 'Updating...' : 'Yes, update the live paper'}
                      </button>
                      <button type="button" onClick={onCancel} disabled={busy} className={adminSecondaryBtnStyle}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
                {errorFor && errorFor.id === r.audit_paper_id ? (
                  <p role="alert" className="mt-2 text-[13px] text-destructive">
                    {errorFor.message}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
  if (bare) return <div data-testid="update-live-papers">{content}</div>;
  return (
    <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]" data-testid="update-live-papers">
      {content}
    </BentoPanel>
  );
}

export function UpdateLivePapers({
  api = realLiveUpdateApi,
  onChanged,
  onLoaded,
  bare,
}: {
  api?: LiveUpdateApi;
  onChanged?: () => void;
  /** Called with the number of papers each time the list is read. */
  onLoaded?: (count: number) => void;
  bare?: boolean;
}) {
  const [rows, setRows] = useState<LivePendingRow[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('loading');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorFor, setErrorFor] = useState<{ id: string; message: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openList, setOpenList] = useState<OpenQuestion[] | 'loading' | 'error' | null>(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  // Only the newest expand may write the list, so a slow answer for paper A
  // cannot land under paper B.
  const openGuard = useRef(createLatestGuard());

  function toggleOpen(id: string) {
    if (expandedId === id) {
      openGuard.current.cancel();
      setExpandedId(null);
      return;
    }
    const token = openGuard.current.next();
    setExpandedId(id);
    setOpenList('loading');
    api
      .openQuestions(id)
      .then((list) => {
        if (openGuard.current.isCurrent(token)) setOpenList(list);
      })
      .catch((e) => {
        if (import.meta.env.DEV) console.error('live paper open questions', e);
        if (openGuard.current.isCurrent(token)) setOpenList('error');
      });
  }

  const load = useCallback(async () => {
    setState('loading');
    try {
      const list = await api.pending();
      setRows(list);
      setState('idle');
      onLoadedRef.current?.(list.length);
    } catch (e) {
      if (import.meta.env.DEV) console.error('live papers pending', e);
      setState('error');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirm(id: string) {
    setBusyId(id);
    setErrorFor(null);
    try {
      const done = await api.update(id);
      adminToast(doneWords(done));
      setConfirmingId(null);
      await load();
      onChanged?.();
    } catch (e) {
      setErrorFor({ id, message: updateErrorWords(e) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <UpdateLivePapersView
      rows={rows}
      state={state}
      confirmingId={confirmingId}
      busyId={busyId}
      errorFor={errorFor}
      expandedId={expandedId}
      openList={openList}
      onToggleOpen={toggleOpen}
      onAsk={(id) => {
        setErrorFor(null);
        setConfirmingId(id);
      }}
      onCancel={() => setConfirmingId(null)}
      onConfirm={(id) => void confirm(id)}
      onRetry={() => void load()}
      bare={bare}
    />
  );
}
