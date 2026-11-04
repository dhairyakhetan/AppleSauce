import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { Check, Download } from 'lucide-react';
import { nextTabKey } from '@/components/admin/AdminTabs';
import { APPROVED_PAGE, SENT_BACK_PAGE, WAITING_BATCHES, type GamesApi, type HodCounts, type SaveResult } from '@/lib/games/api';
import { setStatus, toCSV, toJSON, type Bank, type BankQuestion, type Batch, type Status } from '@/lib/games/rows';
import { cn } from '@/lib/utils';
import { btn, chip, download, FIELD, offerUndo, plural, when } from './helpers';
import { Empty, Loading, LoadFailed, RowsTable } from './shared';

/* Approve questions: batches sent from Write questions wait here until an HoD approves each question or sends it back
   with a reason the teacher sees. Approved questions go into the question bank the games use.

   Each tab loads only what it shows, newest first, and "Load more" fetches the next part: Waiting a few batches at a
   time (a long batch shows its first 10 questions, then 10 more at a time), Approved and Sent back 20 questions at a
   time. The numbers on the tabs are the totals. Every change is saved at once and can be undone for a few seconds. The
   database checks that the person is an HoD or admin on every call. */

const TABS: { key: Status; label: string }[] = [{ key: 'pending', label: 'Waiting' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Sent back' }];
/** A batch shows this many of its questions at first, and this many more each time. */
export const ROWS_PER_BATCH = 10;

/** How far a tab has loaded: `last` is where the next page starts, `done` when there is no more. */
interface Cursor { started: boolean; loading: boolean; done: boolean; last?: Batch | BankQuestion; error?: string }
const START: Cursor = { started: false, loading: false, done: false };
const FRESH: Record<Status, Cursor> = { pending: START, approved: START, rejected: START };
const EMPTY: Bank = { batches: [], questions: [] };

/** Adds questions (and their batches) the page doesn't have yet; the page's own copy of one it has wins. */
const merge = (b: Bank, more: Bank): Bank => {
  const have = new Set(b.questions.map((q) => q.id));
  const batches = new Set(b.batches.map((x) => x.id));
  return { batches: [...b.batches, ...more.batches.filter((x) => !batches.has(x.id))], questions: [...b.questions, ...more.questions.filter((q) => !have.has(q.id))] };
};
/** Puts these questions back as they were. */
const restore = (b: Bank, qs: BankQuestion[]): Bank => ({ ...b, questions: b.questions.map((q) => qs.find((o) => o.id === q.id) ?? q) });
const newestFirst = (x: BankQuestion, y: BankQuestion) => (y.reviewedAt ?? '').localeCompare(x.reviewedAt ?? '') || y.id.localeCompare(x.id);

/** `onWaiting` puts the number waiting on the Approve link. `canDownload`: admins can download the question bank. */
export function ApproveQuestions({ api, onWaiting, canDownload }: { api: GamesApi; onWaiting: (n: number) => void; canDownload: boolean }) {
  const [bank, setBank] = useState<Bank>(EMPTY); // the page's copy: what each tab has loaded, with changes made here
  const [cursor, setCursor] = useState<Record<Status, Cursor>>(FRESH);
  const [counts, setCounts] = useState<HodCounts | null>(null);
  const [countsError, setCountsError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [tab, setTab] = useState<Status>('pending');
  const [back, setBack] = useState<{ where: string; ids: string[] } | null>(null); // the "why?" box that is open
  const [reason, setReason] = useState('');
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  /** How many questions each batch shows. */
  const [rowsShown, setRowsShown] = useState<Record<string, number>>({});

  const recount = useCallback(() => {
    api.hodCounts().then((c) => { setCounts(c); setCountsError(''); onWaiting(c.waiting); }, (e: Error) => setCountsError(e.message));
  }, [api, onWaiting]);
  useEffect(recount, [recount]);

  /** The next part of a tab (the first when it opens). */
  const loadMore = (t: Status) => {
    const c = cursor[t];
    if (c.loading || c.done) return;
    setCursor((x) => ({ ...x, [t]: { ...x[t], started: true, loading: true, error: undefined } }));
    const page = t === 'pending' ? api.loadWaiting(c.last as Batch | undefined)
      : t === 'approved' ? api.loadApproved(c.last as BankQuestion | undefined) : api.loadSentBack(c.last as BankQuestion | undefined);
    page.then((p) => {
      setBank((b) => merge(b, p));
      const [n, size, last] = t === 'pending' ? [p.batches.length, WAITING_BATCHES, p.batches.at(-1)]
        : [p.questions.length, t === 'approved' ? APPROVED_PAGE : SENT_BACK_PAGE, p.questions.at(-1)];
      setCursor((x) => ({ ...x, [t]: { started: true, loading: false, done: n < size, last: last ?? x[t].last } }));
    }, (e: Error) => setCursor((x) => ({ ...x, [t]: { ...x[t], loading: false, error: e.message } })));
  };
  // the tab that is open loads its first part
  useEffect(() => { if (!cursor[tab].started) loadMore(tab); });

  /** Everything afresh from the database. */
  const refresh = () => {
    setBank(EMPTY);
    setCursor(FRESH);
    setRowsShown({});
    recount();
  };
  /** When a save fails, say so and show what the database really holds. */
  const failed = (e: unknown) => {
    setSaveError(`That change wasn't saved: ${(e as Error).message}`);
    refresh();
  };
  /** The whole question bank as a file, straight from the database. */
  const downloadBank = (csv: boolean) => {
    setDownloading(true);
    api.loadQuestionBank()
      .then((rows) => (csv ? download('approved-questions.csv', toCSV(rows), 'text/csv') : download('approved-questions.json', toJSON(rows), 'application/json')),
        (e: Error) => setSaveError(`Couldn't download the question bank: ${e.message}`))
      .finally(() => setDownloading(false));
  };

  const selectTab = (t: Status) => { setTab(t); setBack(null); };
  // WAI-ARIA tabs: arrows, Home and End move and select
  const onTabKeyDown = (ev: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTabKey(TABS.map((t) => t.key), tab, ev.key) as Status | null;
    if (!next) return;
    ev.preventDefault();
    selectTab(next);
    document.getElementById(`games-tab-${next}`)?.focus();
  };

  /** Rows fade out, then move, and the change is saved; every action can be undone for a few seconds. */
  const act = (ids: string[], status: Status, note = '') => {
    const before = bank;
    const old = before.questions.filter((q) => ids.includes(q.id));
    setBack(null);
    setReason('');
    setSaveError('');
    setLeaving(new Set(ids));
    setTimeout(() => {
      setBank((b) => setStatus(b, ids, status, note, new Date().toISOString()));
      setLeaving(new Set());
    }, 220);
    // after the row has left: questions that stayed sent back (the same question was sent again) come back
    const left = new Promise((done) => setTimeout(done, 240));
    Promise.all([api.saveStatus(ids, status, note), left]).then(([r]) => {
      recount();
      const kept = old.filter((q) => r.skipped.includes(q.id));
      if (!kept.length) return;
      setBank((b) => restore(b, kept));
      setSaveError(`${plural(kept.length, 'question')} stayed sent back: the same question was sent again and is already waiting or approved.`);
    }, failed);
    const did = status === 'approved' ? 'approved' : status === 'rejected' ? 'sent back' : 'moved to waiting';
    offerUndo(`${plural(ids.length, 'question')} ${did}`, () => {
      setBank(before);
      // put each question back as it was (questions sent back keep their own reason), one group after another
      const groups = new Map<string, BankQuestion[]>();
      for (const q of old) groups.set(`${q.status}\u0000${q.note}`, [...(groups.get(`${q.status}\u0000${q.note}`) ?? []), q]);
      [...groups.values()].reduce<Promise<SaveResult | null>>((done, qs) => done.then(() => api.saveStatus(qs.map((q) => q.id), qs[0].status, qs[0].note)), Promise.resolve(null))
        .then(() => recount(), failed);
    });
  };

  const rowClass = (q: BankQuestion) => (leaving.has(q.id) ? 'opacity-0' : '');

  /** The "why are these going back?" box, under a row or a batch. */
  const whyBox = (where: string, ids: string[]) => (back?.where === where ? (
    <form className="mt-2 flex flex-col gap-2 rounded-2xl bg-muted p-3" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) act(ids, 'rejected', reason); }}>
      <label htmlFor={`why-${where}`} className="text-[13px] font-semibold text-foreground">Why {ids.length > 1 ? `are these ${ids.length}` : 'is this'} going back? The teacher will see this.</label>
      <textarea id={`why-${where}`} rows={2} maxLength={500} value={reason} autoFocus onChange={(e) => setReason(e.target.value)}
        className={cn(FIELD, 'resize-y py-2')} placeholder="e.g. The answer should be Rusting, not Rust." />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={chip('danger')} disabled={!reason.trim()}>Send back</button>
        <button type="button" className={chip('card')} onClick={() => setBack(null)}>Cancel</button>
      </div>
    </form>
  ) : null);

  const rowActions = (q: BankQuestion) => {
    if (q.status === 'pending') {
      return back?.where === q.id ? whyBox(q.id, [q.id]) : (
        <div className="flex flex-wrap gap-2 pb-1">
          <button type="button" className={chip('mint')} onClick={() => act([q.id], 'approved')}><Check aria-hidden /> Approve</button>
          <button type="button" className={chip('quiet')} onClick={() => { setBack({ where: q.id, ids: [q.id] }); setReason(''); }}>Send back</button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2 pb-1">
        {q.status === 'rejected' && <p className="rounded-xl bg-brand-subtle px-3 py-2 text-[13px] text-foreground"><b>Sent back:</b> {q.note}</p>}
        <button type="button" className={chip('quiet', 'w-fit')} onClick={() => act([q.id], 'pending')}>Move to waiting</button>
      </div>
    );
  };

  const c = cursor[tab];
  const shown = bank.questions.filter((q) => q.status === tab);
  const total = counts ? { pending: counts.waiting, approved: counts.approved, rejected: counts.sentBack }[tab] : null;
  const byBatch = bank.batches
    .map((b) => ({ b, qs: shown.filter((q) => q.batch === b.id).sort((x, y) => x.id.localeCompare(y.id)) }))
    .filter((x) => x.qs.length)
    .sort((x, y) => y.b.at.localeCompare(x.b.at)); // newest first
  const loadMoreButton = (label: string) => !c.done && c.started && !c.error && (
    <button type="button" className={btn('card', 'w-fit self-center')} disabled={c.loading} onClick={() => loadMore(tab)}>{c.loading ? 'Loading…' : label}</button>
  );
  const showing = total !== null && shown.length > 0 && (
    <p className="text-[13px] text-warm-secondary" role="status">Showing {shown.length} of {plural(total, tab === 'pending' ? 'question waiting' : 'question', tab === 'pending' ? 'questions waiting' : 'questions')}, newest first.</p>
  );

  return (
    <div className="flex flex-col gap-4">
      {saveError && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground" role="alert">{saveError}</p>}
      {countsError && !counts && <LoadFailed what="The numbers of questions" error={countsError} onRetry={recount} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Questions" className="flex max-w-full flex-wrap items-center gap-1 rounded-[20px] bg-muted p-1 sm:w-fit sm:rounded-full">
          {TABS.map((t) => {
            const n = counts ? { pending: counts.waiting, approved: counts.approved, rejected: counts.sentBack }[t.key] : null;
            return (
              <button key={t.key} id={`games-tab-${t.key}`} type="button" role="tab" aria-selected={tab === t.key} aria-controls="games-approve-panel" tabIndex={tab === t.key ? 0 : -1}
                onClick={() => selectTab(t.key)} onKeyDown={onTabKeyDown}
                className={cn('flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                  tab === t.key ? 'bg-card text-foreground' : 'text-warm-secondary hover:text-foreground')}>
                {t.label}
                <span className={cn('inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-[5px] text-[11px] font-bold tabular-nums',
                  t.key === 'pending' && n ? 'bg-brand text-foreground' : 'bg-card text-warm-secondary')}>{n ?? '…'}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className={btn('quiet')} onClick={refresh}>Check for new questions</button>
      </div>

      <div role="tabpanel" id="games-approve-panel" aria-labelledby={`games-tab-${tab}`} className="flex flex-col gap-3">
        {c.error && <LoadFailed what={tab === 'pending' ? 'The waiting questions' : tab === 'approved' ? 'The approved questions' : 'The sent-back questions'} error={c.error} onRetry={() => loadMore(tab)} />}
        {!shown.length && !c.error && (c.loading || !c.started ? <Loading label="Loading the questions" />
          : <Empty>{tab === 'pending' ? 'Nothing is waiting.' : tab === 'approved' ? 'No approved questions yet.' : 'Nothing has been sent back.'}</Empty>)}
        {showing}

        {tab === 'pending' && byBatch.map(({ b, qs }) => {
          const n = rowsShown[b.id] ?? ROWS_PER_BATCH;
          const ids = qs.map((q) => q.id);
          return (
            <section key={b.id} aria-label={`Batch from ${b.by}`} className="animate-fade-slide-up flex flex-col gap-2 rounded-[24px] bg-muted p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-bold text-foreground">{plural(qs.length, 'question')} from {b.by}</h2>
                  {/* the email can't be changed by its owner, as the name can */}
                  <p className="text-[12px] text-warm-meta">{b.email ? `${b.email} · ` : ''}Sent {when(b.at)}</p>
                </div>
                {back?.where !== `batch:${b.id}` && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={btn('mint')} onClick={() => act(ids, 'approved')}><Check aria-hidden /> {qs.length === 1 ? 'Approve it' : `Approve all ${qs.length}`}</button>
                    <button type="button" className={btn('card')} onClick={() => { setBack({ where: `batch:${b.id}`, ids }); setReason(''); }}>{qs.length === 1 ? 'Send it back' : 'Send all back'}</button>
                  </div>
                )}
              </div>
              {whyBox(`batch:${b.id}`, ids)}
              <div className="rounded-2xl bg-card p-3 sm:p-4">
                <RowsTable rows={qs.slice(0, n)} keyOf={(q) => q.id} extra={rowActions} rowClass={rowClass} />
              </div>
              {qs.length > n && (
                <button type="button" className={btn('card', 'w-fit')} onClick={() => setRowsShown((r) => ({ ...r, [b.id]: n + ROWS_PER_BATCH }))}>
                  Show {Math.min(ROWS_PER_BATCH, qs.length - n)} more ({qs.length - n} not shown)
                </button>
              )}
            </section>
          );
        })}
        {tab === 'pending' && loadMoreButton(`Load ${WAITING_BATCHES} more batches`)}

        {tab !== 'pending' && shown.length > 0 && (
          <section className="flex flex-col gap-3 rounded-[24px] bg-muted p-4 sm:p-6">
            {tab === 'approved' && canDownload && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={btn('card')} disabled={downloading} onClick={() => downloadBank(true)}><Download aria-hidden /> Download CSV</button>
                <button type="button" className={btn('card')} disabled={downloading} onClick={() => downloadBank(false)}><Download aria-hidden /> Download JSON</button>
                <span className="text-[13px] text-warm-secondary">Every approved question, not only those shown.</span>
              </div>
            )}
            <div className="rounded-2xl bg-card p-3 sm:p-4">
              <RowsTable rows={[...shown].sort(newestFirst)} keyOf={(q) => q.id} extra={rowActions} rowClass={rowClass} />
            </div>
            {loadMoreButton(`Load ${tab === 'approved' ? APPROVED_PAGE : SENT_BACK_PAGE} more`)}
          </section>
        )}
      </div>
    </div>
  );
}
