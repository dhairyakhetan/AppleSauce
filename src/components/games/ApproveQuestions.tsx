import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, Download } from 'lucide-react';
import { nextTabKey } from '@/components/admin/AdminTabs';
import { APPROVED_PAGE, type GamesApi, type SaveResult } from '@/lib/games/api';
import { counts, setStatus, toCSV, toJSON, type Bank, type BankQuestion, type Status } from '@/lib/games/rows';
import { cn } from '@/lib/utils';
import { btn, chip, download, FIELD, offerUndo, plural, when } from './helpers';
import { Empty, Loading, LoadFailed, RowsTable } from './shared';

/* Approve questions: batches sent from Write questions wait here until an HoD approves each question or sends it back
   with a reason the teacher sees. Approved questions go into the question bank the games use. Waiting and sent-back
   questions load at once; approved ones a page at a time, newest first, as they're needed. Every change is saved at
   once and can be undone for a few seconds. The database checks that the person is an HoD or admin on every call. */

const TABS: { key: Status; label: string }[] = [{ key: 'pending', label: 'Waiting' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Sent back' }];

/** Adds questions (and their batches) the page doesn't have yet. */
const merge = (b: Bank, more: Bank): Bank => {
  const have = new Set(b.questions.map((q) => q.id));
  const batches = new Set(b.batches.map((x) => x.id));
  return { batches: [...b.batches, ...more.batches.filter((x) => !batches.has(x.id))], questions: [...b.questions, ...more.questions.filter((q) => !have.has(q.id))] };
};
/** Puts these questions back as they were. */
const restore = (b: Bank, qs: BankQuestion[]): Bank => ({ ...b, questions: b.questions.map((q) => qs.find((o) => o.id === q.id) ?? q) });

/** `onWaiting` puts the number waiting on the Approve link. */
export function ApproveQuestions({ api, onWaiting }: { api: GamesApi; onWaiting: (n: number) => void }) {
  const [bank, setBank] = useState<Bank | null>(null); // the page's copy: waiting, sent back, and the approved pages loaded
  const [error, setError] = useState('');
  const [approvedTotal, setApprovedTotal] = useState<number | null>(null);
  // approved questions, a page at a time: `last` is the oldest one loaded, `done` when there are no older ones
  const [older, setOlder] = useState<{ started: boolean; loading: boolean; done: boolean; last?: BankQuestion }>({ started: false, loading: false, done: false });
  const [saveError, setSaveError] = useState('');
  const [tab, setTab] = useState<Status>('pending');
  const [back, setBack] = useState<{ where: string; ids: string[] } | null>(null); // the "why?" box that is open
  const [reason, setReason] = useState('');
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  const recountApproved = useCallback(() => { api.approvedCount().then(setApprovedTotal, () => {}); }, [api]);
  /** Loads the waiting and sent-back questions afresh (keeping the old ones on screen until they arrive). */
  const load = useCallback(() => {
    setError('');
    // the approved pages start again once the new list is in
    api.loadForHod().then((b) => { setBank(b); setOlder({ started: false, loading: false, done: false }); onWaiting(counts(b).pending); }, (e: Error) => setError(e.message));
    recountApproved();
  }, [api, recountApproved, onWaiting]);
  useEffect(load, [load]);

  /** The next page of approved questions (the first when the Approved tab opens). */
  const loadOlder = () => {
    setOlder((o) => ({ ...o, started: true, loading: true }));
    api.loadApproved(older.last).then((page) => {
      setBank((b) => b && merge(b, page));
      setOlder({ started: true, loading: false, done: page.questions.length < APPROVED_PAGE, last: page.questions.at(-1) ?? older.last });
    }, (e: Error) => {
      setOlder((o) => ({ ...o, loading: false }));
      setSaveError(`Couldn't load the approved questions: ${e.message}`);
    });
  };
  useEffect(() => { if (tab === 'approved' && bank && !older.started) loadOlder(); });

  /** When a save fails, say so and show what the database really holds. */
  const failed = (e: unknown) => {
    setSaveError(`That change wasn't saved: ${(e as Error).message}`);
    load();
  };
  const refresh = () => { setBank(null); load(); };
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

  if (!bank) {
    return error ? <LoadFailed what="The questions" error={error} onRetry={refresh} /> : <Loading label="Loading the questions" />;
  }

  const c = { ...counts(bank), approved: approvedTotal ?? counts(bank).approved };

  /** The counts that come back with every saved change. */
  const recounted = (r: Pick<SaveResult, 'waiting' | 'approved'>) => { onWaiting(r.waiting); setApprovedTotal(r.approved); };

  /** Rows fade out, then move, and the change is saved; every action can be undone for a few seconds. */
  const act = (ids: string[], status: Status, note = '') => {
    const before = bank;
    const old = before.questions.filter((q) => ids.includes(q.id));
    setBack(null);
    setReason('');
    setSaveError('');
    setLeaving(new Set(ids));
    setTimeout(() => {
      setBank((b) => setStatus(b ?? before, ids, status, note, new Date().toISOString()));
      setLeaving(new Set());
    }, 220);
    // after the row has left: questions that stayed sent back (the same question was sent again) come back
    const left = new Promise((done) => setTimeout(done, 240));
    Promise.all([api.saveStatus(ids, status, note), left]).then(([r]) => {
      recounted(r);
      const kept = old.filter((q) => r.skipped.includes(q.id));
      if (!kept.length) return;
      setBank((b) => b && restore(b, kept));
      setSaveError(`${plural(kept.length, 'question')} stayed sent back: the same question was sent again and is already waiting or approved.`);
    }, failed);
    const did = status === 'approved' ? 'approved' : status === 'rejected' ? 'sent back' : 'moved to waiting';
    offerUndo(`${plural(ids.length, 'question')} ${did}`, () => {
      setBank(before);
      // put each question back as it was (questions sent back keep their own reason), one group after another, so
      // the counts from the last one are the final counts
      const groups = new Map<string, BankQuestion[]>();
      for (const q of old) groups.set(`${q.status}\u0000${q.note}`, [...(groups.get(`${q.status}\u0000${q.note}`) ?? []), q]);
      [...groups.values()].reduce<Promise<SaveResult | null>>((done, qs) => done.then(() => api.saveStatus(qs.map((q) => q.id), qs[0].status, qs[0].note)), Promise.resolve(null))
        .then((r) => r && recounted(r), failed);
    });
  };

  const shown = bank.questions.filter((q) => q.status === tab);
  const rowClass = (q: BankQuestion) => (leaving.has(q.id) ? 'opacity-0' : '');

  /** The "why are these going back?" box, under a row or a batch. */
  const whyBox = (where: string, ids: string[]) => (back?.where === where ? (
    <form className="mt-2 flex flex-col gap-2 rounded-2xl bg-muted p-3" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) act(ids, 'rejected', reason); }}>
      <label htmlFor={`why-${where}`} className="text-[13px] font-semibold text-foreground">Why {ids.length > 1 ? 'are these' : 'is this'} going back? The teacher will see this.</label>
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

  const byBatch = bank.batches
    .map((b) => ({ b, qs: shown.filter((q) => q.batch === b.id) }))
    .filter((x) => x.qs.length)
    .sort((x, y) => y.b.at.localeCompare(x.b.at)); // newest first

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-[14px] text-warm-secondary">Questions the team sends from Write questions wait here. Only approved questions go into the question bank and the games.</p>
      {saveError && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground" role="alert">{saveError}</p>}

      <div role="tablist" aria-label="Questions" className="flex max-w-full flex-wrap items-center gap-1 rounded-[20px] bg-muted p-1 sm:w-fit sm:rounded-full">
        {TABS.map((t) => (
          <button key={t.key} id={`games-tab-${t.key}`} type="button" role="tab" aria-selected={tab === t.key} aria-controls="games-approve-panel" tabIndex={tab === t.key ? 0 : -1}
            onClick={() => selectTab(t.key)} onKeyDown={onTabKeyDown}
            className={cn('flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
              tab === t.key ? 'bg-card text-foreground' : 'text-warm-secondary hover:text-foreground')}>
            {t.label}
            <span className={cn('inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-[5px] text-[11px] font-bold tabular-nums',
              t.key === 'pending' && c.pending > 0 ? 'bg-brand text-foreground' : 'bg-card text-warm-secondary')}>{c[t.key]}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id="games-approve-panel" aria-labelledby={`games-tab-${tab}`} className="flex flex-col gap-3">
        {tab === 'pending' && (byBatch.length ? byBatch.map(({ b, qs }) => (
          <section key={b.id} aria-label={`Batch from ${b.by}`} className="animate-fade-slide-up flex flex-col gap-2 rounded-[24px] bg-muted p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold text-foreground">{plural(qs.length, 'question')} from {b.by}</h2>
                <p className="text-[12px] text-warm-meta">Batch {b.id} · sent {when(b.at)}{b.email && ` · ${b.email}`}</p>
              </div>
              {back?.where !== `batch:${b.id}` && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btn('mint')} onClick={() => act(qs.map((q) => q.id), 'approved')}><Check aria-hidden /> Approve all {qs.length}</button>
                  <button type="button" className={btn('card')} onClick={() => { setBack({ where: `batch:${b.id}`, ids: qs.map((q) => q.id) }); setReason(''); }}>Send all back</button>
                </div>
              )}
            </div>
            {whyBox(`batch:${b.id}`, qs.map((q) => q.id))}
            <div className="rounded-2xl bg-card p-3 sm:p-4">
              <RowsTable rows={qs} keyOf={(q) => q.id} extra={rowActions} rowClass={rowClass} />
            </div>
          </section>
        )) : (
          <Empty>
            <p><b className="text-foreground">Nothing is waiting.</b> Questions the team sends from Write questions appear here.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button type="button" className={btn('dark')} onClick={refresh}>Check for new questions</button>
              <Link className={btn('card')} to="/games">Go to Write questions</Link>
            </div>
          </Empty>
        ))}

        {tab !== 'pending' && (shown.length ? (
          <section className="flex flex-col gap-3 rounded-[24px] bg-muted p-4 sm:p-6">
            {tab === 'approved' && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] text-warm-secondary">This is the question bank: what the games use. Newest first.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btn('card')} disabled={downloading} onClick={() => downloadBank(true)}><Download aria-hidden /> Download CSV</button>
                  <button type="button" className={btn('card')} disabled={downloading} onClick={() => downloadBank(false)}><Download aria-hidden /> Download JSON</button>
                </div>
              </div>
            )}
            <div className="rounded-2xl bg-card p-3 sm:p-4">
              <RowsTable rows={[...shown].sort((x, y) => (x.chapter_id ?? '').localeCompare(y.chapter_id ?? '') || (x.topic_no ?? 0) - (y.topic_no ?? 0) || x.question_no - y.question_no)}
                keyOf={(q) => q.id} extra={rowActions} rowClass={rowClass} />
            </div>
            {tab === 'approved' && !older.done && (
              <button type="button" className={btn('card', 'w-fit')} disabled={older.loading} onClick={loadOlder}>{older.loading ? 'Loading…' : 'Show older approved questions'}</button>
            )}
          </section>
        ) : (
          tab === 'rejected' || older.done ? <Empty>{tab === 'approved' ? 'No approved questions yet.' : 'Nothing has been sent back.'}</Empty>
            : older.loading || !older.started ? <Loading label="Loading the approved questions" />
            : <Empty><button type="button" className={btn('dark')} onClick={loadOlder}>Try again</button></Empty>
        ))}
      </div>
    </div>
  );
}
