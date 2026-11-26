import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Copy, Download } from 'lucide-react';
import { nextTabKey } from '@/components/admin/AdminTabs';
import { APPROVED_PAGE, type GamesApi, type SaveResult } from '@/lib/games/api';
import { counts, setStatus, toCSV, toJSON, type Bank, type BankQuestion, type Batch, type Status } from '@/lib/games/rows';
import { cn } from '@/lib/utils';
import { btn, chip, copyText, download, FIELD, offerUndo, plural, useLatch, when } from './helpers';
import { Empty, Loading, LoadFailed, Morph, RowsTable } from './shared';
import { asText, doubts } from '@/lib/games/format';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

/* Approve questions: batches sent from Write questions wait here until an HoD approves each question or sends it back
   with a reason the teacher sees. Approved questions go into the question bank the games use. Waiting questions show
   by batch. Approved and sent-back ones show one row per chapter, the most recently changed first, 10 at a time; a row
   opens to its questions, and (admins, approved) to a download of that chapter. Waiting and sent-back questions load at
   once; approved ones a page at a time, newest first, as they're needed. Every change is saved at
   once and can be undone for a few seconds. The database checks that the person is an HoD or admin on every call. */

const TABS: { key: Status; label: string }[] = [{ key: 'pending', label: 'Waiting' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Sent back' }];

/**
 * Questions whose "Please check" notes the HoD cleared (the cross): hidden until the page is opened again. Kept in this
 * page's memory only, never saved, so the notes come back on the next visit.
 */
const cleared = new Set<string>();

/** The flagged questions' box for one batch: looking at them, writing why they go back, or what was done. */
interface Review {
  batch: string;
  /** Asking first (Approve all on a flagged batch), the flagged questions, why they go back, or what was done. */
  phase: 'ask' | 'list' | 'why' | 'done';
  /** When it asked: how many were flagged, of how many waiting (kept, so the words don't change as it closes). */
  n: number; total: number;
  sent: string[]; cleared: string[]; undoSend?: () => void;
}

/** Adds questions (and their batches) the page doesn't have yet. */
const merge = (b: Bank, more: Bank): Bank => {
  const have = new Set(b.questions.map((q) => q.id));
  const batches = new Set(b.batches.map((x) => x.id));
  return { batches: [...b.batches, ...more.batches.filter((x) => !batches.has(x.id))], questions: [...b.questions, ...more.questions.filter((q) => !have.has(q.id))] };
};
/** Puts these questions back as they were. */
const restore = (b: Bank, qs: BankQuestion[]): Bank => ({ ...b, questions: b.questions.map((q) => qs.find((o) => o.id === q.id) ?? q) });

/** `onWaiting` puts the number waiting on the Approve link. `canDownload`: admins can download a chapter's approved questions. */
export function ApproveQuestions({ api, onWaiting, canDownload }: { api: GamesApi; onWaiting: (n: number) => void; canDownload: boolean }) {
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
  const [, setNotesTick] = useState(0);
  /** "Approve all" on a batch with flagged questions asks first, and the same box goes on to show them: one box whose
   * steps change in place (`Morph`), so nothing closes and opens again in between. */
  const [review, setReview] = useState<Review | null>(null);
  const shownReview = useLatch(review);
  const [reviewWhy, setReviewWhy] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

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
  /** One chapter's approved questions as a file, straight from the database (so it has all of them, not only the
   * pages loaded here). */
  const downloadChapter = (chapterId: string, csv: boolean) => {
    setDownloading(true);
    api.loadQuestionBank()
      .then((all) => {
        const rows = all.filter((q) => q.chapter_id === chapterId);
        return csv ? download(`${chapterId}-approved.csv`, toCSV(rows), 'text/csv') : download(`${chapterId}-approved.json`, toJSON(rows), 'application/json');
      }, (e: Error) => setSaveError(`Couldn't download the chapter: ${e.message}`))
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
  /** `toast`: offer Undo in a toast (not when the flagged box offers its own). */
  const act = (ids: string[], status: Status, note = '', toast = true) => {
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
    const undo = () => {
      setBank(before);
      // put each question back as it was (questions sent back keep their own reason), one group after another, so
      // the counts from the last one are the final counts
      const groups = new Map<string, BankQuestion[]>();
      for (const q of old) groups.set(`${q.status}\u0000${q.note}`, [...(groups.get(`${q.status}\u0000${q.note}`) ?? []), q]);
      [...groups.values()].reduce<Promise<SaveResult | null>>((done, qs) => done.then(() => api.saveStatus(qs.map((q) => q.id), qs[0].status, qs[0].note)), Promise.resolve(null))
        .then((r) => r && recounted(r), failed);
    };
    if (toast) offerUndo(`${plural(ids.length, 'question')} ${did}`, undo);
    return undo;
  };

  /** A question's "Please check" notes, unless the HoD cleared them; `qs` its batch, for notes that compare questions. */
  const notesOf = (q: BankQuestion, qs: BankQuestion[]) => (cleared.has(q.id) ? [] : doubts(q, qs));
  const clearNotes = (ids: string[], on = true) => { for (const id of ids) { if (on) cleared.add(id); else cleared.delete(id); } setNotesTick((n) => n + 1); };
  const waitingIn = (batch: string) => bank.questions.filter((q) => q.batch === batch && q.status === 'pending');
  const flaggedIn = (batch: string) => { const qs = waitingIn(batch); return qs.filter((q) => notesOf(q, qs).length); };
  /** "Approve all": straight away, unless some of the batch is flagged. */
  const approveAll = (batch: string) => {
    const flagged = flaggedIn(batch).length;
    if (flagged) { setReviewWhy(''); setReview({ batch, phase: 'ask', n: flagged, total: waitingIn(batch).length, sent: [], cleared: [] }); }
    else act(waitingIn(batch).map((q) => q.id), 'approved');
  };
  const copyBatch = async (batch: string, qs: BankQuestion[]) => {
    if (!(await copyText(asText(qs)))) { setSaveError("Couldn't copy the batch. Select the questions and copy them instead."); return; }
    setCopied(batch);
    window.setTimeout(() => setCopied((c) => (c === batch ? null : c)), 1800);
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
      {saveError && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground" role="alert">{saveError}</p>}

      <div role="tablist" aria-label="Questions" className="flex max-w-full flex-wrap items-center gap-1 rounded-[20px] bg-muted p-1 sm:w-fit sm:rounded-full">
        {TABS.map((t) => (
          <button key={t.key} id={`games-tab-${t.key}`} type="button" role="tab" aria-selected={tab === t.key} aria-controls="games-approve-panel" tabIndex={tab === t.key ? 0 : -1}
            onClick={() => selectTab(t.key)} onKeyDown={onTabKeyDown}
            className={cn('flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
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
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-bold text-foreground">{plural(qs.length, 'question')} from {b.by}</h2>
                  <button type="button" className={chip('card')} onClick={() => void copyBatch(b.id, qs)} aria-live="polite">
                    {copied === b.id ? <><Check aria-hidden /> Copied</> : <><Copy aria-hidden /> Copy batch</>}
                  </button>
                </div>
                {/* the email can't be changed by its owner, as the name can */}
                <p className="text-[12px] text-warm-meta">{b.email ? `${b.email} · ` : ''}Sent {when(b.at)}</p>
              </div>
              {back?.where !== `batch:${b.id}` && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btn('mint')} onClick={() => approveAll(b.id)}><Check aria-hidden /> Approve all {qs.length}</button>
                  <button type="button" className={btn('card')} onClick={() => { setBack({ where: `batch:${b.id}`, ids: qs.map((q) => q.id) }); setReason(''); }}>Send all back</button>
                </div>
              )}
            </div>
            {whyBox(`batch:${b.id}`, qs.map((q) => q.id))}
            <div className="rounded-2xl bg-card p-3 sm:p-4">
              <RowsTable rows={qs} keyOf={(q) => q.id} extra={rowActions} rowClass={rowClass} doubts={(q) => notesOf(q, qs)} onClearDoubts={(q) => clearNotes([q.id])} />
            </div>
          </section>
        )) : (
          <Empty>
            <p>Nothing is waiting.</p>
            <button type="button" className={btn('dark', 'mt-3')} onClick={refresh}>Check for new questions</button>
          </Empty>
        ))}

        {tab !== 'pending' && (shown.length ? (
          <section className="flex flex-col gap-3 rounded-[24px] bg-muted p-4 sm:p-6">
            <ChapterList key={tab} questions={shown} batches={bank.batches} rowActions={rowActions} rowClass={rowClass}
              download={tab === 'approved' && canDownload ? { busy: downloading, run: downloadChapter } : undefined} />
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
      <Dialog open={!!review} onOpenChange={(o) => { if (!o) setReview(null); }}>
        {shownReview && (() => {
          const rv = shownReview;
          const batch = bank.batches.find((x) => x.id === rv.batch);
          const all = waitingIn(rv.batch);
          const flagged = flaggedIn(rv.batch).filter((q) => !rv.sent.includes(q.id));
          const phase = rv.phase === 'list' && !flagged.length && (rv.sent.length || rv.cleared.length) ? 'done' : rv.phase;
          const rest = all.filter((q) => !rv.sent.includes(q.id));
          const close = () => setReview(null);
          const go = (more: Partial<Review>) => setReview((r) => r && { ...r, ...more });
          const undo = () => {
            clearNotes(rv.cleared, false);
            rv.undoSend?.();
            go({ phase: 'list', sent: [], cleared: [], undoSend: undefined });
          };
          const them = rv.n === 1 ? 'it' : 'them';
          return (
            <DialogContent className={cn('max-h-[90vh] overflow-y-auto rounded-2xl bg-card transition-[max-width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
              phase === 'list' ? 'max-w-3xl' : 'max-w-md')}>
              <Morph step={phase}>
                {phase === 'ask' ? (
                  <div className="flex flex-col gap-3">
                    <DialogTitle className="pr-8">{rv.n === 1 ? 'There is 1 flagged question' : `There are ${rv.n} flagged questions`} in this batch</DialogTitle>
                    <DialogDescription>
                      The page wasn't sure about something in {them} ("Please check"). Look at {them} first, or approve all {rv.total} as they are.
                    </DialogDescription>
                    <div className="flex flex-col gap-2 sm:flex-row-reverse">
                      <button type="button" className={btn('brand', 'w-full sm:w-auto')} onClick={() => go({ phase: 'list' })}>View {them}</button>
                      <button type="button" className={btn('card', 'w-full sm:w-auto')} onClick={() => { act(all.map((q) => q.id), 'approved'); close(); }}>Approve all anyway</button>
                      <button type="button" className={btn('quiet', 'w-full sm:w-auto sm:mr-auto')} onClick={close}>Cancel</button>
                    </div>
                  </div>
                ) : phase === 'done' ? (
                  <div className="flex flex-col gap-3">
                    <DialogTitle className="pr-8">Flagged questions done</DialogTitle>
                    <DialogDescription asChild>
                      <div className="flex flex-col gap-1 text-[15px] text-foreground">
                        {rv.sent.length > 0 && <p><b>{plural(rv.sent.length, 'question')}</b> sent back</p>}
                        {rv.cleared.length > 0 && <p><b>{plural(rv.cleared.length, 'question')}</b> cleared</p>}
                      </div>
                    </DialogDescription>
                    <div className="flex flex-wrap gap-2">
                      {rest.length > 0
                        ? <button type="button" className={btn('mint')} onClick={() => { act(rest.map((q) => q.id), 'approved'); close(); }}><Check aria-hidden /> Approve all {rest.length}</button>
                        : <button type="button" className={btn('dark')} onClick={close}>Done</button>}
                      <button type="button" className={btn('card')} onClick={undo}>Undo</button>
                    </div>
                  </div>
                ) : phase === 'why' ? (
                  <form className="flex flex-col gap-2" onSubmit={(e) => {
                    e.preventDefault();
                    if (!reviewWhy.trim()) return;
                    const ids = flagged.map((q) => q.id);
                    const undoSend = act(ids, 'rejected', reviewWhy, false);
                    go({ phase: 'done', sent: ids, undoSend });
                    setReviewWhy('');
                  }}>
                    <DialogTitle className="pr-8">Send {plural(flagged.length, 'question')} back</DialogTitle>
                    <DialogDescription>They go back to {batch?.by ?? 'the teacher'} together, with one reason.</DialogDescription>
                    <label htmlFor="review-why" className="text-[13px] font-semibold text-foreground">Why are {flagged.length === 1 ? 'it' : 'they'} going back? The teacher will see this.</label>
                    <textarea id="review-why" rows={3} maxLength={500} value={reviewWhy} autoFocus onChange={(e) => setReviewWhy(e.target.value)}
                      className={cn(FIELD, 'resize-y py-2')} placeholder="e.g. The answers don't fit the gap in the Fill sentences." />
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className={btn('danger')} disabled={!reviewWhy.trim()}>Send {flagged.length} back</button>
                      <button type="button" className={btn('card')} onClick={() => go({ phase: 'list' })}>Back</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-col gap-3">
                    <DialogTitle className="pr-8">{plural(flagged.length, 'flagged question')}</DialogTitle>
                    <DialogDescription>
                      From {batch?.by ?? 'this'}'s batch of {all.length}. Clear a note when the question is fine (it comes back when the page is opened again), or send them back.
                    </DialogDescription>
                    <div className="max-h-[min(55vh,520px)] overflow-y-auto overscroll-contain rounded-2xl bg-muted p-3 sm:p-4">
                      <RowsTable rows={flagged} keyOf={(q) => q.id} doubts={(q) => notesOf(q, all)}
                        onClearDoubts={(q) => { clearNotes([q.id]); setReview((r) => r && { ...r, cleared: [...r.cleared, q.id] }); }} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btn('card')} onClick={() => { const ids = flagged.map((q) => q.id); clearNotes(ids); go({ phase: 'done', cleared: [...rv.cleared, ...ids] }); }}>Clear all</button>
                      <button type="button" className={btn('danger')} onClick={() => { setReviewWhy(''); go({ phase: 'why' }); }}>Send all back</button>
                    </div>
                  </div>
                )}
              </Morph>
            </DialogContent>
          );
        })()}
      </Dialog>
    </div>
  );
}

/** How many chapters the Approved and Sent back tabs show before "Show more chapters". */
const CHAPTERS_SHOWN = 10;

/**
 * Approved or sent-back questions, one row per chapter (board, class, subject and chapter), the chapter changed most
 * recently first. A row opens to its questions, and, for approved questions, to a download of that chapter.
 */
function ChapterList({ questions, batches, rowActions, rowClass, download: dl }: {
  questions: BankQuestion[];
  batches: Batch[];
  rowActions: (q: BankQuestion) => ReactNode;
  rowClass: (q: BankQuestion) => string;
  download?: { busy: boolean; run: (chapterId: string, csv: boolean) => void };
}) {
  const [open, setOpen] = useState<string | null>(null); // one chapter open at a time
  const [limit, setLimit] = useState(CHAPTERS_SHOWN);
  const sentAt = new Map(batches.map((b) => [b.id, b.at]));
  const groups = new Map<string, BankQuestion[]>();
  for (const q of questions) {
    const k = q.chapter_id ?? [q.board, q.class, q.subject, q.chapter_no, q.chapter].join('|');
    groups.set(k, [...(groups.get(k) ?? []), q]);
  }
  // most recent first: when a question in it was last approved or sent back (or else sent)
  const latest = (qs: BankQuestion[]) => qs.reduce((m, q) => { const t = q.reviewedAt ?? sentAt.get(q.batch) ?? ''; return t > m ? t : m; }, '');
  const list = [...groups].map(([k, qs]) => ({ k, qs, at: latest(qs) })).sort((x, y) => y.at.localeCompare(x.at));
  const toggle = (k: string) => setOpen((o) => (o === k ? null : k));

  return (
    <>
      <ul className="flex flex-col gap-2">
        {list.slice(0, limit).map(({ k, qs, at }) => {
          const q0 = qs[0];
          const isOpen = open === k;
          const title = [q0.chapter_no !== null && `Chapter ${q0.chapter_no}`, q0.chapter].filter(Boolean).join(': ') || 'No chapter';
          const meta = [q0.board, q0.class && `Class ${q0.class}`, q0.subject].filter(Boolean).join(' · ');
          return (
            <li key={k} className="rounded-2xl bg-card">
              <button type="button" aria-expanded={isOpen} onClick={() => toggle(k)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:p-4">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[12px] text-warm-meta">{meta}</span>
                  <b className="text-[15px] text-foreground">{title}</b>
                </span>
                <span className="text-[13px] text-warm-secondary">{plural(qs.length, 'question')}{at ? ` · ${when(at)}` : ''}</span>
                <ChevronDown className={cn('size-4 shrink-0 text-warm-secondary transition-transform duration-200', isOpen && 'rotate-180')} aria-hidden />
              </button>
              {isOpen && (
                <div className="flex flex-col gap-3 border-t border-border px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
                  {dl && q0.chapter_id && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btn('card')} disabled={dl.busy} onClick={() => dl.run(q0.chapter_id!, true)}><Download aria-hidden /> Download this chapter (CSV)</button>
                      <button type="button" className={btn('card')} disabled={dl.busy} onClick={() => dl.run(q0.chapter_id!, false)}><Download aria-hidden /> JSON</button>
                    </div>
                  )}
                  <RowsTable rows={[...qs].sort((x, y) => (x.topic_no ?? 0) - (y.topic_no ?? 0) || x.question_no - y.question_no)} keyOf={(q) => q.id} extra={rowActions} rowClass={rowClass} oneChapter />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {list.length > limit && (
        <button type="button" className={btn('card', 'w-fit')} onClick={() => setLimit((n) => n + CHAPTERS_SHOWN)}>
          Show more chapters ({list.length - limit} more)
        </button>
      )}
    </>
  );
}
