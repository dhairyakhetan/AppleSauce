import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...a: unknown[]) => {
      const out = rpc(...a) as Promise<unknown>;
      // timedRpc calls .abortSignal() on the builder; a plain promise stands in for it.
      return Object.assign(out, { abortSignal: () => out });
    },
  },
}));

import { planAnswer } from '@/lib/checker-drafts';
import { canUndoNow, lastStepCannotBeUndone, undoTitle, UNDO_TITLE_STEP } from '@/lib/checker-aftermath';
import { checkerErrorAdvice, listLoadFailure } from '@/lib/checker-errors';
import { askOutcomeMessage } from '@/lib/paper-asks';
import { stageOfCheckerCard } from '@/lib/paper-status';
import { inOverlay } from '@/lib/checker-shortcuts';
import { AUTH_TROUBLE_AFTER, createOutbox, getOutbox, releaseOutboxHooks, resetOutboxRegistry, type OutboxHooks, type OutboxStorage } from '@/lib/checker-outbox';
import { resetPapersExtra, verifierMyPapers, verifierQuestionDiagrams, verifierRecentlyReturned } from '@/lib/checker-api';
import {
  hasNothingToCheck,
  heldBackNote,
  idleNote,
  normalisePapersExtra,
  paperProgressOf,
  partDoneNote,
  returnedNote,
  withPapersExtra,
  normaliseMyPapers,
} from '@/lib/verifier-papers';
import { AskForPapersView } from '@/components/checker/AskForPapers';
import { SaveStatusChip } from '@/components/checker/AdvanceBits';
import { QuestionDiagrams, DIAGRAM_LOAD_FAILED } from '@/components/checker/QuestionDiagrams';
import { WaitingAnswersView } from '@/pages/Checker';

/* The student-checker audit of 26/27 Nov 2026 (CK-01 .. CK-23): one test per behaviour that changed. */

const q = { id: 'q1', body: 'What is 2 + 2?', display_number: '1', marks: 2, version: 3, options: null };
const drafts = (over: Partial<{ body: string; number: string; marks: string; printedTypo: boolean; typoNote: string }> = {}) => ({
  body: q.body,
  number: '1',
  marks: '2',
  printedTypo: false,
  typoNote: '',
  options: [] as never[],
  ...over,
});
const owner = 'q1|3|1';
const plan = (d: ReturnType<typeof drafts>, mode: 'check' | 'fix') =>
  planAnswer({ question: q as never, drafts: d as never, draftsFor: owner, mode }, owner);

describe('CK-05: Fix it opened and nothing changed is a plain pass', () => {
  it('sends pass, not fix, when Fix it was open but nothing was touched', () => {
    expect(plan(drafts(), 'fix').kind).toBe('pass');
  });
  it('still sends a fix when the words, number or marks changed', () => {
    expect(plan(drafts({ body: 'What is 2 + 3?' }), 'fix').kind).toBe('fix');
    expect(plan(drafts({ marks: '3' }), 'fix').kind).toBe('fix');
    expect(plan(drafts({ number: '2' }), 'fix').kind).toBe('fix');
  });
  it('a ticked typo box with no change still goes the fix way, so the typo rule can answer', () => {
    expect(plan(drafts({ printedTypo: true }), 'fix').kind).toBe('fix');
  });
});

describe('CK-08: Undo is off while the last step is one the server cannot undo', () => {
  it('split, OR and send-back switch Undo off; a normal answer after them switches it on again', () => {
    const pass = { questionId: 'a', kind: 'pass' };
    expect(canUndoNow([pass], 0, false)).toBe(true);
    for (const kind of ['split', 'or_separator', 'ask_ai_redo']) {
      expect(canUndoNow([pass, { questionId: 'b', kind }], 5, false)).toBe(false);
      expect(lastStepCannotBeUndone([pass, { questionId: 'b', kind }])).toBe(true);
    }
    expect(canUndoNow([{ questionId: 'b', kind: 'split' }, { questionId: 'c', kind: 'pass' }], 0, false)).toBe(true);
  });
  it('says why', () => {
    expect(undoTitle(false, false, true)).toBe(UNDO_TITLE_STEP);
    expect(UNDO_TITLE_STEP).toContain('cannot be taken back');
  });
});

describe('CK-09: the checking screen shows the same count as the card', () => {
  it('uses the whole paper: 29 of 30, not 0 of 1', () => {
    const p = paperProgressOf({ total: 1, done: 0, remaining: 1, paper_total: 30, paper_passed: 29 });
    expect(p.label).toBe('29 of 30 done');
    expect(p.percent).toBe(97);
  });
  it('falls back to the checker\'s own share when the server sends no whole-paper numbers', () => {
    expect(paperProgressOf({ total: 4, done: 1, remaining: 3 }).label).toBe('1 of 4 done');
  });
});

describe('CK-14: a refusal the server wrote in plain words is shown as it is', () => {
  it('a 22023 sentence is not turned into "try again in a minute"', () => {
    const adv = checkerErrorAdvice({ code: '22023', message: 'Say what is wrong in 500 letters or fewer.' });
    expect(adv.message).toBe('Say what is wrong in 500 letters or fewer.');
    expect(adv.moveOn).toBe(false);
  });
  it('the box and the sheet are limited and clear their message', () => {
    const src = readFileSync('src/components/checker/VerifyScreen.tsx', 'utf8');
    expect(src).toContain('maxLength={HELP_REASON_MAX}');
    expect(src).toContain('const HELP_REASON_MAX = 500;');
    const close = src.slice(src.indexOf('function closeHelp()'), src.indexOf('function retryNext()'));
    expect(close).toContain('setHelpOpen(false)');
    expect(close).toContain('setError(null)');
  });
});

describe('CK-15: a paper that is not yours any more is not "taking longer than it should"', () => {
  it('42501 on a paper says so and offers no useless Try again', () => {
    const f = listLoadFailure({ code: '42501', message: 'This paper is not assigned to you' }, 'paper');
    expect(f.title).toBe('This paper is not on your list any more');
    expect(f.canRetry).toBe(false);
  });
  it('a slow read still says it is slow and can be tried again', () => {
    const f = listLoadFailure(new Error('Failed to fetch'), 'list');
    expect(f.canRetry).toBe(true);
    expect(f.note).toContain('taking longer than it should');
  });
  it('the list says the account cannot check, with no retry', () => {
    expect(listLoadFailure({ code: '42501', message: 'Not authorized' }, 'list').canRetry).toBe(false);
  });
});

describe('CK-01 / CK-13 on the website: waiting questions, days left, returned papers', () => {
  it('a paper with only waiting questions is not "Your part is done" and is not "waiting to go live"', () => {
    const p = { remaining: 0, with_hod: 0, paper_total: 10, paper_passed: 4, held_back: 3 };
    expect(partDoneNote(p)).toBe(heldBackNote(3));
    expect(heldBackNote(3)).toContain('3 questions are waiting');
    expect(heldBackNote(1)).toContain('1 question is waiting');
    expect(stageOfCheckerCard(p)).toBe('not_ready');
    // no waiting questions: the old words and the old stage
    expect(stageOfCheckerCard({ remaining: 0, held_back: 0 })).toBe('waiting');
    expect(partDoneNote({ ...p, held_back: 0 })).toContain('Your part is done');
  });

  it('idleNote speaks only when it is close', () => {
    expect(idleNote(null)).toBeNull();
    expect(idleNote(6)).toBeNull();
    expect(idleNote(2)).toBe('This paper goes back to the pool in 2 days if nothing is done on it.');
    expect(idleNote(1)).toContain('in 1 day ');
    expect(idleNote(0)).toContain('today');
  });

  it('returnedNote names the paper and says why it went back', () => {
    const t = returnedNote({ subject: 'Mathematics', cls: '10', school: 'Sample School', year: '2025' });
    expect(t).toContain('Mathematics, Class 10, Sample School, 2025');
    expect(t).toContain('nothing was done on it for 7 days');
  });

  it('normalisePapersExtra splits the two kinds and withPapersExtra adds the facts to the matching paper only', () => {
    const extra = normalisePapersExtra([
      { paper_id: 'p1', kind: 'open', held_back: 2, idle_days_left: 1 },
      { paper_id: 'p2', kind: 'open', held_back: 0, idle_days_left: null },
      { paper_id: 'p9', kind: 'returned', returned_at: '2026-11-26T10:00:00Z', subject: 'English', cls: '9', school: null, year: null },
      { kind: 'open', held_back: 5 },
    ]);
    expect(extra.returned).toHaveLength(1);
    expect(extra.returned[0].subject).toBe('English');
    const rows = normaliseMyPapers([
      { paper_id: 'p1', remaining: 0 },
      { paper_id: 'p2', remaining: 3 },
      { paper_id: 'p3', remaining: 1 },
    ]);
    const merged = withPapersExtra(rows, extra.held);
    expect(merged[0].held_back).toBe(2);
    expect(merged[0].idle_days_left).toBe(1);
    expect(merged[1].idle_days_left).toBeNull();
    expect(merged[2].held_back).toBe(0);
    // nothing from the server: the rows stay exactly as they were
    expect(withPapersExtra(rows, new Map())).toBe(rows);
  });
});

describe('CK-04: a checker with nothing left to check can ask for more', () => {
  it('hasNothingToCheck is true only when no paper has a question left for them', () => {
    expect(hasNothingToCheck([])).toBe(true);
    expect(hasNothingToCheck([{ remaining: 0 }, { remaining: 0 }])).toBe(true);
    expect(hasNothingToCheck([{ remaining: 0 }, { remaining: 2 }])).toBe(false);
  });
  it('an older database that still answers has_work gets an honest sentence, not "finish it first"', () => {
    expect(askOutcomeMessage('has_work')).toContain('Finish it first');
    const m = askOutcomeMessage('has_work', { papersListed: true });
    expect(m).not.toContain('Finish it first');
    expect(m).toContain('tell your HOD');
  });
  it('the page shows the ask whenever no card has questions left, not only when the list is empty', () => {
    const page = readFileSync('src/pages/Checker.tsx', 'utf8');
    expect(page).toContain('hasNothingToCheck(papers)');
    expect(page).toContain('data-testid="nothing-left"');
  });
});

describe('CK-11: the empty My papers screen', () => {
  it('a brand-new checker is not told "You are all caught up. Thank you for the good work"', () => {
    const html = renderToStaticMarkup(createElement(AskForPapersView, { state: { kind: 'ready' }, onAsk: () => undefined, caughtUp: false }));
    expect(html).not.toContain('all caught up');
    expect(html).toContain('If you are free to check papers, tell your HOD');
    const done = renderToStaticMarkup(createElement(AskForPapersView, { state: { kind: 'ready' }, onAsk: () => undefined }));
    expect(done).toContain('all caught up');
  });
  it('has a Check again button and reads again when the tab comes back to the front', () => {
    const page = readFileSync('src/pages/Checker.tsx', 'utf8');
    expect(page).toContain('testId="check-again"');
    expect(page).toContain('refetchOnWindowFocus: true');
    expect(page).toContain('You have no papers right now');
  });
});

describe('CK-10: the Papers chip moves', () => {
  it('the checking screen marks it out of date after each answer and reads it when a paper runs out or on Undo', () => {
    const src = readFileSync('src/components/checker/VerifyScreen.tsx', 'utf8');
    expect(src).toContain("['checker-my-paper-stats', scope]");
    const acked = src.slice(src.indexOf('function ackedVerdict('), src.indexOf('function rejectedVerdict('));
    expect(acked).toContain("if (decision.kind === 'fetch' || decision.kind === 'end') invalidateStats(true);");
    expect(src.match(/invalidateStats\(true\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it('My papers reads it again when the checker comes back from the checking screen', () => {
    const page = readFileSync('src/pages/Checker.tsx', 'utf8');
    expect(page).toContain('wasVerifying.current && !verifyingNow');
    expect(page).toContain("queryKey: ['checker-my-paper-stats', scope]");
  });
});

describe('CK-03: Skip and Ask the HOD do not throw typed changes away without asking', () => {
  const src = readFileSync('src/components/checker/VerifyScreen.tsx', 'utf8');
  it('both buttons go through the guard, which only asks when Fix it holds unsaved changes', () => {
    expect(src).toContain("onClick={() => guardEdit('skip', doSkip)}");
    expect(src).toContain("onClick={() => guardEdit('help', () => setHelpOpen(true))}");
    const guard = src.slice(src.indexOf('function guardEdit'), src.indexOf('function goBack'));
    expect(guard).toContain("mode === 'fix' && unsavedEdit");
    expect(guard).toContain('run();');
  });
});

describe('CK-06: the offline note and the chip are on the card that waits for the next question', () => {
  it('the incoming bar carries the same notes as the action bar', () => {
    const src = readFileSync('src/components/checker/VerifyScreen.tsx', 'utf8');
    const incoming = src.slice(src.indexOf('const incomingBar'), src.indexOf('/* The question card'));
    expect(incoming).toContain('{saveNotes}');
    const bar = src.slice(src.indexOf('const actionBar'), src.indexOf('const incomingBar'));
    expect(bar).toContain('{saveNotes}');
  });
});

describe('CK-07: a lapsed sign-in is said out loud', () => {
  const noStorage: OutboxStorage = { getItem: () => null, setItem: () => undefined };
  it('after a few bare "Not authorized" refusals the outbox says authTrouble', async () => {
    let t = 1_000_000;
    const timers: { at: number; fn: () => void }[] = [];
    const box = createOutbox({
      storageKey: 'k',
      storage: noStorage,
      send: () => Promise.reject({ code: '42501', message: 'Not authorized' }),
      now: () => t,
      setTimer: (fn, ms) => {
        timers.push({ at: t + ms, fn });
        return timers.length;
      },
      clearTimer: () => undefined,
      backoff: () => 1,
    });
    box.enqueue({ questionId: 'q1', paperId: 'p1', kind: 'pass', payload: { version: 1 } });
    expect(box.state().authTrouble).toBe(false);
    for (let i = 0; i < AUTH_TROUBLE_AFTER + 1; i++) {
      await new Promise((r) => setTimeout(r, 0));
      t += 5;
      for (const due of timers.splice(0)) due.fn();
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(box.state().entries).toHaveLength(1);
    expect(box.state().authTrouble).toBe(true);
    box.dispose();
  });

  it('the chip then says the account cannot check, with a sign-in link', () => {
    const html = renderToStaticMarkup(createElement(SaveStatusChip, { waiting: 1, failing: true, authTrouble: true, onRetry: () => undefined }));
    expect(html).toContain('data-testid="outbox-auth"');
    expect(html).toContain('Sign in again');
    const plain = renderToStaticMarkup(createElement(SaveStatusChip, { waiting: 1, failing: true, onRetry: () => undefined }));
    expect(plain).not.toContain('outbox-auth');
  });
});

describe('CK-02: waiting answers are sent and shown from My papers too', () => {
  beforeEach(() => resetOutboxRegistry());
  const hooks = (name: string): OutboxHooks => ({ api: { name } as never, onAck: vi.fn(), onReject: vi.fn() });

  it('an answer is acked by the page while no checking screen is open, by the screen while one is, and by the page again after it closes', async () => {
    const mk = () => {
      const acked: string[] = [];
      const h: OutboxHooks = {
        api: { verdictAndNext: vi.fn(async () => ({ verdict_ok: true, verdict: 'pass', verdict_version: 2, next: null, next_paper_id: null })) } as never,
        onAck: (e) => void acked.push(e.questionId),
        onReject: vi.fn(),
      };
      return { h, acked };
    };
    const page = mk();
    const screen = mk();
    const settle = () => new Promise((r) => setTimeout(r, 0));
    const box = getOutbox('s', 'u1', page.h, { base: true });
    box.enqueue({ questionId: 'a', paperId: 'p', kind: 'pass', payload: { version: 1 } });
    await settle();
    expect(page.acked).toEqual(['a']);

    // a checking screen opens and claims the box (the page asking again must not take it back)
    getOutbox('s', 'u1', screen.h);
    getOutbox('s', 'u1', page.h, { base: true });
    box.enqueue({ questionId: 'b', paperId: 'p', kind: 'pass', payload: { version: 1 } });
    await settle();
    expect(screen.acked).toEqual(['b']);
    expect(page.acked).toEqual(['a']);

    // it closes: the next ack goes to the page, not to a screen that is gone
    releaseOutboxHooks('s', 'u1', screen.h);
    box.enqueue({ questionId: 'c', paperId: 'p', kind: 'pass', payload: { version: 1 } });
    await settle();
    expect(page.acked).toEqual(['a', 'c']);
    expect(screen.acked).toEqual(['b']);
  });

  it('the page shows waiting answers, a refused one, and starts the outbox', () => {
    const src = readFileSync('src/pages/Checker.tsx', 'utf8');
    expect(src).toContain('{ base: true }');
    expect(src.match(/<WaitingAnswers /g)?.length).toBeGreaterThanOrEqual(3);
    const html = renderToStaticMarkup(
      createElement(WaitingAnswersView, {
        state: { entries: [{} as never, {} as never], failing: false, authTrouble: false },
        onRetry: () => undefined,
      }),
    );
    expect(html).toContain('2 answers are being saved');
    const failing = renderToStaticMarkup(
      createElement(WaitingAnswersView, {
        state: { entries: [{} as never], failing: true, authTrouble: false },
        lost: 'The paper is on hold.',
        onRetry: () => undefined,
      }),
    );
    expect(failing).toContain('Not saved yet, retrying');
    expect(failing).toContain('An answer you gave earlier was not saved. The paper is on hold.');
    expect(renderToStaticMarkup(createElement(WaitingAnswersView, { state: { entries: [], failing: false, authTrouble: false }, onRetry: () => undefined }))).toBe('');
  });
});

describe('CK-12 / CK-23: a reopened question says so while it is open, and going back asks first', () => {
  const src = readFileSync('src/components/checker/VerifyScreen.tsx', 'utf8');
  it('uses a banner, not a 2.5 second notice', () => {
    expect(src).toContain('data-testid="reopened-note"');
    expect(src).toContain('setReopenedId(row.id)');
    expect(src).not.toContain("Question reopened. Change what is wrong, or press Looks right to save it again.', tone: 'ok'");
  });
  it('the back arrow asks first when the question is still reopened', () => {
    expect(src).toContain('onClick={goBack}');
    expect(src.slice(src.indexOf('function goBack'), src.indexOf('// Skip is always'))).toContain('reopenedId === question.id');
  });
});

describe('CK-16: signed in but not a checker', () => {
  it('has a way to sign out and use another account', () => {
    const page = readFileSync('src/pages/Checker.tsx', 'utf8');
    expect(page).toContain('data-testid="checker-sign-out"');
    expect(page).toContain('Sign out and use another account');
  });
});

describe('CK-18: the whole-paper flip reuses the page list', () => {
  it('both flips read the pages through the cache and start from what is cached', () => {
    const src = readFileSync('src/components/checker/VerifyScreen.tsx', 'utf8');
    expect(src.match(/loadPages=\{loadPagesCached\}/g)).toHaveLength(2);
    expect(src.match(/initialPages=\{qc\.getQueryData<PaperPage\[\]>\(pagesCacheKey\(question\.paper_id\)\)\}/g)).toHaveLength(2);
    const flip = readFileSync('src/components/checker/PaperPageFlip.tsx', 'utf8');
    expect(flip).toContain('useState<PaperPage[] | null>(initialPages ?? null)');
  });
});

describe('CK-19: a diagram that did not load is not invisible', () => {
  it('shows a line when the read failed, and nothing when there is simply no diagram', () => {
    const failed = renderToStaticMarkup(createElement(QuestionDiagrams, { items: [], failed: true, onEnlarge: () => undefined }));
    expect(failed).toContain('data-testid="diagram-load-failed"');
    expect(failed).toContain(DIAGRAM_LOAD_FAILED);
    expect(renderToStaticMarkup(createElement(QuestionDiagrams, { items: [], onEnlarge: () => undefined }))).toBe('');
  });
  it('a picture that fails to load is replaced by the same line', () => {
    const src = readFileSync('src/components/checker/QuestionDiagrams.tsx', 'utf8');
    expect(src).toContain('onError={() => setBroken(');
    expect(src).toContain('data-testid="diagram-item-broken"');
  });
  it('the read is tried again, and only "not applied yet" is an empty list', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(verifierQuestionDiagrams('q1')).resolves.toEqual([]);
    rpc.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    await expect(verifierQuestionDiagrams('q1')).rejects.toBeTruthy();
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(verifierQuestionDiagrams('q1')).resolves.toEqual([]);
    const src = readFileSync('src/components/checker/VerifyScreen.tsx', 'utf8');
    expect(src).toContain('retry: 2');
  });
});

describe('CK-20: the first reads have a time limit', () => {
  it('is_paper_checker, verifier_my_papers and verifier_my_profile go through timedRpc', () => {
    const api = readFileSync('src/lib/checker-api.ts', 'utf8');
    expect(api).toContain("timedRpc('is_paper_checker')");
    expect(api).toContain("timedRpc('verifier_my_papers')");
    expect(api).toContain("timedRpc('verifier_my_profile')");
  });
});

describe('CK-21: keys inside a popover or dialog do not answer the question behind it', () => {
  it('inOverlay is true inside a dialog or popover and false elsewhere', () => {
    class FakeEl {
      constructor(private readonly inside: boolean) {}
      closest(sel: string) {
        return this.inside && sel.includes('[role="dialog"]') ? this : null;
      }
    }
    vi.stubGlobal('HTMLElement', FakeEl);
    expect(inOverlay(new FakeEl(true) as never)).toBe(true);
    expect(inOverlay(new FakeEl(false) as never)).toBe(false);
    expect(inOverlay(null)).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('CK-22: passing confirmations clear themselves', () => {
  it('the profile card clears its status line', () => {
    const page = readFileSync('src/pages/Checker.tsx', 'utf8');
    expect(page).toContain('setTimeout(() => setMessage(null), 8000)');
  });
});

describe('verifier_my_papers_extra on the website: safe before the database file is pasted', () => {
  beforeEach(() => {
    rpc.mockReset();
    resetPapersExtra();
  });

  it('merges the extras into the list rows', async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'verifier_my_papers'
          ? { data: [{ paper_id: 'p1', remaining: 0, with_hod: 0, total: 3, done: 3 }], error: null }
          : { data: [{ paper_id: 'p1', kind: 'open', held_back: 4, idle_days_left: 2 }], error: null },
      ),
    );
    const [p] = await verifierMyPapers();
    expect(p.held_back).toBe(4);
    expect(p.idle_days_left).toBe(2);
  });

  it('before the paste (function missing) the list still loads, and the missing function is asked about once', async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'verifier_my_papers'
          ? { data: [{ paper_id: 'p1', remaining: 2 }], error: null }
          : { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.verifier_my_papers_extra' } },
      ),
    );
    const [p] = await verifierMyPapers();
    expect(p.remaining).toBe(2);
    expect(p.held_back).toBe(0);
    expect(p.idle_days_left).toBeNull();
    resetPapersExtraInflightOnly();
    await verifierMyPapers();
    const extraCalls = rpc.mock.calls.filter((c) => c[0] === 'verifier_my_papers_extra');
    expect(extraCalls).toHaveLength(1);
  });

  it('a failing extras read never fails the list', async () => {
    rpc.mockImplementation((fn: string) =>
      fn === 'verifier_my_papers'
        ? Promise.resolve({ data: [{ paper_id: 'p1', remaining: 1 }], error: null })
        : Promise.reject(new Error('Failed to fetch')),
    );
    await expect(verifierMyPapers()).resolves.toHaveLength(1);
  });

  it('recently returned papers come from the same read', async () => {
    rpc.mockImplementation(() =>
      Promise.resolve({
        data: [{ paper_id: 'p9', kind: 'returned', returned_at: '2026-11-26T10:00:00Z', subject: 'English' }],
        error: null,
      }),
    );
    const list = await verifierRecentlyReturned();
    expect(list).toHaveLength(1);
    expect(list[0].subject).toBe('English');
  });
});

/** The extras answer is kept for a few seconds so the list and the note share one read; a test moves past that. */
function resetPapersExtraInflightOnly(): void {
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 10_000);
  vi.useRealTimers();
}

describe('the database file (20261127100000)', () => {
  const sql = readFileSync('supabase/migrations/20261127100000_checker_audit_fixes.sql', 'utf8');
  const code = sql.replace(/--[^\n]*/g, '');

  it('only creates or replaces: nothing is deleted or changed in any data', () => {
    expect(code).not.toMatch(/\bdelete\s+from\b/i);
    expect(code).not.toMatch(/\bdrop\s+(table|function|column)\b/i);
    expect(code).not.toMatch(/\btruncate\b/i);
    expect(code).not.toMatch(/\binsert\s+into\s+public\.(audit_|checker_assignments)/i);
    expect(code).not.toMatch(/\bupdate\s+public\.audit_/i);
    // the only two updates are ones that already existed: verifier_close_finished closing an assignment, and
    // paper_ask_for_more expiring a 3-day-old ask
    expect(code.match(/\bupdate\s+public\.\w+/gi)).toEqual(['update public.checker_assignments', 'update public.paper_asks']);
  });

  it('every function has its search path pinned and is security definer', () => {
    const defs = code.split(/create or replace function/i).slice(1);
    expect(defs).toHaveLength(8);
    for (const d of defs) {
      expect(d).toMatch(/security definer/i);
      expect(d).toMatch(/set search_path/i);
    }
  });

  it('CK-01: a waiting question keeps the assignment open', () => {
    const closer = sql.slice(sql.indexOf('create or replace function public.verifier_close_finished'), sql.indexOf('-- 2 (CK-01, CK-13)'));
    expect(closer).toContain('public.verifier_question_waiting(q)');
    // the two old conditions are still there
    expect(closer).toContain('public.checker_question_servable(q)');
    expect(closer).toContain("q.review_bucket = 'escalated'");
    expect(sql).toContain("'pdf_mismatch' = any");
  });

  it('the new functions are closed to every client role, the extras one is opened to signed-in people only', () => {
    expect(sql).toContain('revoke all on function public.verifier_question_waiting(public.audit_questions) from public, anon, authenticated;');
    expect(sql).toContain('revoke all on function public.verifier_my_papers_extra() from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.verifier_my_papers_extra() to authenticated;');
    expect(sql).not.toMatch(/grant execute on function public\.verifier_question_waiting/i);
  });

  it('the extras function checks the caller', () => {
    const f = sql.slice(sql.indexOf('create or replace function public.verifier_my_papers_extra'));
    expect(f).toContain('public.is_paper_checker()');
    expect(f).toContain("errcode = '42501'");
    expect(f).toContain('v_uid');
  });

  it('CK-04: the ask and the HOD list count only papers with work left', () => {
    const ask = sql.slice(sql.indexOf('create or replace function public.paper_ask_for_more'), sql.indexOf('create or replace function public.hod_paper_asks'));
    expect(ask).toContain('public.verifier_has_work(a.audit_paper_id)');
    const hod = sql.slice(sql.indexOf('create or replace function public.hod_paper_asks'), sql.indexOf('-- 4 (CK-17)'));
    expect(hod).toContain('public.verifier_has_work(c.audit_paper_id)');
    expect(hod).toContain('public.is_hod()');
  });

  it('CK-17: the three counters count a send-back to the computer', () => {
    for (const fn of ['checker_my_stats', 'checker_checked_today_count', 'checker_my_paper_stats']) {
      const start = sql.indexOf(`create or replace function public.${fn}`);
      const body = sql.slice(start, sql.indexOf('$function$;', sql.indexOf('as $function$', start) + 20));
      expect(body, fn).toContain("'checker_ask_ai_redo'");
      expect(body, fn).toContain("'checker_ask_help'");
      expect(body, fn).toContain('public.is_paper_checker()');
    }
  });

  it('the website reads the new function only when it answers (safe before the paste)', () => {
    const api = readFileSync('src/lib/checker-api.ts', 'utf8');
    expect(api).toContain("timedRpc('verifier_my_papers_extra')");
    expect(api).toContain('isNotSwitchedOn(error)');
  });
});
