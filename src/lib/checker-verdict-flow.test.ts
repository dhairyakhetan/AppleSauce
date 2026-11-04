import { describe, expect, it, vi } from 'vitest';
import { createOutbox, sendVerdict, type OutboxEntry, type OutboxInput, type OutboxStorage } from '@/lib/checker-outbox';
import {
  decideAck,
  isConfirmedNotSaved,
  markNotSaved,
  mayHaveLanded,
  nextForScreen,
  verdictWasSaved,
  type AckContext,
} from '@/lib/checker-advance';
import { isPaperChange } from '@/lib/checker-card-motion';
import type { VerdictAndNext } from '@/lib/checker-verdict-next';

/* One call saves the verdict AND brings the next question (12 Oct 2026). The
   outbox keeps its safety rules; these tests pin what is new: the answer reaches
   the screen, a late answer never moves the person, a replay is "already saved"
   only after a read confirms it, and nothing is ever sent twice. */

const KEY = 'verdict-flow-test';

function memoryStorage(): OutboxStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const pass = (questionId: string, paperId = 'paperA'): OutboxInput => ({ questionId, paperId, kind: 'pass', payload: { version: 1 } });
const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const nextRow = { id: 'q2', paper_id: 'paperA', body: '2. Find x.', version: 1, context: [] };
const result = (next: unknown = nextRow, nextPaper: string | null = 'paperA') =>
  ({ verdict_ok: true, verdict: 'pass', verdict_version: 1, next, next_paper_id: next ? nextPaper : null }) as unknown as VerdictAndNext;

const apiMock = () => ({
  verdictAndNext: vi.fn().mockResolvedValue(result()),
  paperQuestions: vi.fn().mockResolvedValue([]),
  nextInPaper: vi.fn().mockResolvedValue(null),
  questionContext: vi.fn().mockResolvedValue([]),
});
const entry = (kind: OutboxEntry['kind'], payload: OutboxEntry['payload']) => ({ questionId: 'q', paperId: 'paperA', kind, payload });

describe('sendVerdict: one call, not two', () => {
  it('sends each kind through verifier_verdict_and_next with what the checker saw', async () => {
    const a = apiMock();
    await sendVerdict(a as never, entry('pass', { version: 4, includeSkipped: false }));
    expect(a.verdictAndNext).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'pass', questionId: 'q', paperId: 'paperA', version: 4, includeSkipped: false }),
    );
    await sendVerdict(a as never, entry('fix', { patch: { body: null, marks: 2 }, version: 4, printedTypo: true, typoNote: 'teh' }));
    expect(a.verdictAndNext).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'fix', patch: { body: null, marks: 2 }, version: 4, printedTypo: true, typoNote: 'teh' }),
    );
    await sendVerdict(a as never, entry('skip', {}));
    expect(a.verdictAndNext).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'skip' }));
    await sendVerdict(a as never, entry('ask_help', { reason: 'blurry' }));
    expect(a.verdictAndNext).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'ask_help', reason: 'blurry' }));
  });

  it('returns the next question exactly as the server sent it, with no further read', async () => {
    const a = apiMock();
    const res = await sendVerdict(a as never, entry('pass', { version: 1 }));
    expect(res.next).toBe(nextRow);
    expect(a.nextInPaper).not.toHaveBeenCalled();
    expect(a.questionContext).not.toHaveBeenCalled();
    expect(a.paperQuestions).not.toHaveBeenCalled();
  });

  it('a refused verdict throws its own error and serves nothing', async () => {
    const a = apiMock();
    const refusal = Object.assign(new Error('Unknown verdict'), { code: '22023' });
    a.verdictAndNext.mockRejectedValue(refusal);
    await expect(sendVerdict(a as never, entry('pass', { version: 1 }))).rejects.toBe(refusal);
    expect(a.paperQuestions).not.toHaveBeenCalled();
    expect(a.nextInPaper).not.toHaveBeenCalled();
  });

  it('a network failure is thrown as it is, with no confirming read', async () => {
    const a = apiMock();
    a.verdictAndNext.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(sendVerdict(a as never, entry('fix', { patch: { body: 'x' }, version: 1 }))).rejects.toThrow('Failed to fetch');
    expect(a.paperQuestions).not.toHaveBeenCalled();
  });
});

describe('a stale replay is "already saved" only when a read confirms it', () => {
  const stale = () => Object.assign(new Error('stale question: you saw version 3, it is now at version 4'), { code: '40001' });
  const fixEntry = entry('fix', { patch: { body: 'fixed words' }, version: 3 });
  const row = (over: object) => ({ id: 'q', state: 'done', version: 4, body: 'fixed words', display_number: '1', marks: 2, ...over });

  it('confirmed: done, at a newer version, holding the fixed words -> saved, next read the plain way', async () => {
    const a = apiMock();
    a.verdictAndNext.mockRejectedValue(stale());
    a.paperQuestions.mockResolvedValue([row({})]);
    a.nextInPaper.mockResolvedValue(nextRow);
    a.questionContext.mockResolvedValue([{ id: 'ctx' }]);
    const res = await sendVerdict(a as never, fixEntry);
    expect(a.paperQuestions).toHaveBeenCalledWith('paperA');
    expect(res.verdict_ok).toBe(true);
    expect(res.verdict_version).toBe(4);
    expect(res.next?.id).toBe('q2');
    expect(res.next?.context).toEqual([{ id: 'ctx' }]);
    expect(res.next_paper_id).toBe('paperA');
  });

  it('confirmed at the end of the paper: next is null', async () => {
    const a = apiMock();
    a.verdictAndNext.mockRejectedValue(stale());
    a.paperQuestions.mockResolvedValue([row({})]);
    const res = await sendVerdict(a as never, fixEntry);
    expect(res.next).toBeNull();
    expect(res.next_paper_id).toBeNull();
  });

  it('someone else changed it (other words): the stale refusal is surfaced and marked not saved', async () => {
    const a = apiMock();
    const err = stale();
    a.verdictAndNext.mockRejectedValue(err);
    a.paperQuestions.mockResolvedValue([row({ body: 'their words' })]);
    await expect(sendVerdict(a as never, fixEntry)).rejects.toBe(err);
    expect(isConfirmedNotSaved(err)).toBe(true);
    expect(a.nextInPaper).not.toHaveBeenCalled();
  });

  it('the question is still waiting (to_verify): surfaced', async () => {
    const a = apiMock();
    a.verdictAndNext.mockRejectedValue(stale());
    a.paperQuestions.mockResolvedValue([row({ state: 'to_verify', version: 3 })]);
    await expect(sendVerdict(a as never, fixEntry)).rejects.toThrow('stale question');
  });

  it('the read itself fails: the original refusal is surfaced, not marked', async () => {
    const a = apiMock();
    const err = stale();
    a.verdictAndNext.mockRejectedValue(err);
    a.paperQuestions.mockRejectedValue(new TypeError('offline'));
    await expect(sendVerdict(a as never, fixEntry)).rejects.toBe(err);
    expect(isConfirmedNotSaved(err)).toBe(false);
  });

  it('a skip can never be confirmed from a read', async () => {
    const a = apiMock();
    const err = Object.assign(new Error('This question is not currently assigned to you'), { code: '42501' });
    a.verdictAndNext.mockRejectedValue(err);
    a.paperQuestions.mockResolvedValue([row({ state: 'to_verify' })]);
    await expect(sendVerdict(a as never, entry('skip', {}))).rejects.toBe(err);
    expect(isConfirmedNotSaved(err)).toBe(false);
  });

  it('verdictWasSaved: pass, fix, ask_help, skip', () => {
    expect(verdictWasSaved({ kind: 'pass', payload: { version: 2 } }, row({ version: 2 }) as never)).toBe(true);
    expect(verdictWasSaved({ kind: 'pass', payload: { version: 2 } }, row({ version: 3 }) as never)).toBe(false);
    expect(verdictWasSaved({ kind: 'pass', payload: { version: 2 } }, row({ version: 2, state: 'with_hod' }) as never)).toBe(false);
    expect(verdictWasSaved({ kind: 'pass', payload: {} }, row({}) as never)).toBe(false);
    expect(verdictWasSaved({ kind: 'fix', payload: { version: 3, patch: { marks: 2 } } }, row({}) as never)).toBe(true);
    expect(verdictWasSaved({ kind: 'fix', payload: { version: 3, patch: { marks: 5 } } }, row({}) as never)).toBe(false);
    expect(verdictWasSaved({ kind: 'fix', payload: { version: 4, patch: { body: 'fixed words' } } }, row({}) as never)).toBe(false);
    expect(verdictWasSaved({ kind: 'ask_help', payload: {} }, row({ state: 'with_hod' }) as never)).toBe(true);
    expect(verdictWasSaved({ kind: 'ask_help', payload: {} }, row({}) as never)).toBe(false);
    expect(verdictWasSaved({ kind: 'skip', payload: {} }, row({}) as never)).toBe(false);
    expect(verdictWasSaved({ kind: 'pass', payload: { version: 1 } }, undefined)).toBe(false);
  });

  it('mayHaveLanded: stale and not-assigned only', () => {
    expect(mayHaveLanded(stale())).toBe(true);
    expect(mayHaveLanded(new Error('This question is not currently assigned to you'))).toBe(true);
    expect(mayHaveLanded(new TypeError('Failed to fetch'))).toBe(false);
    expect(mayHaveLanded(Object.assign(new Error('Unknown verdict'), { code: '22023' }))).toBe(false);
  });

  it('markNotSaved leaves a frozen error alone', () => {
    const frozen = Object.freeze(new Error('x'));
    expect(markNotSaved(frozen)).toBe(frozen);
    expect(isConfirmedNotSaved(frozen)).toBe(false);
  });
});

describe('the outbox hands the server answer to the screen and never double-submits', () => {
  it('success: onAck gets the entry and the answer, once', async () => {
    const send = vi.fn().mockResolvedValue(result());
    const acked = vi.fn();
    const box = createOutbox({ storageKey: KEY, storage: memoryStorage(), send, onAck: acked });
    box.enqueue(pass('q1'));
    await flushMicrotasks();
    expect(acked).toHaveBeenCalledTimes(1);
    expect(acked.mock.calls[0][0].questionId).toBe('q1');
    expect(acked.mock.calls[0][1]).toEqual(result());
    expect(box.state().entries).toHaveLength(0);
  });

  it('offline then Retry: one verdict stored, two identical sends, one ack that carries the next question', async () => {
    const storage = memoryStorage();
    const verdictAndNext = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(result());
    const a = { verdictAndNext, paperQuestions: vi.fn(), nextInPaper: vi.fn(), questionContext: vi.fn() };
    const acked = vi.fn();
    const box = createOutbox({
      storageKey: KEY,
      storage,
      send: (e) => sendVerdict(a as never, e),
      onAck: acked,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    box.enqueue(pass('q1'));
    await flushMicrotasks();

    // failed: kept on this device, the calm chip state, nothing acknowledged, no other request made
    expect(box.state().failing).toBe(true);
    expect(JSON.parse(storage.data.get(KEY)!)).toHaveLength(1);
    expect(acked).not.toHaveBeenCalled();
    expect(a.nextInPaper).not.toHaveBeenCalled();
    // pressing again on the same question while it waits is refused
    expect(box.enqueue(pass('q1'))).toBeNull();

    box.retryNow();
    await flushMicrotasks();
    expect(verdictAndNext).toHaveBeenCalledTimes(2);
    expect(verdictAndNext.mock.calls[1][0]).toEqual(verdictAndNext.mock.calls[0][0]);
    expect(acked).toHaveBeenCalledTimes(1);
    expect(acked.mock.calls[0][1]).toEqual(result());
    expect(box.state().entries).toHaveLength(0);

    box.retryNow();
    await flushMicrotasks();
    expect(verdictAndNext).toHaveBeenCalledTimes(2);
  });

  it('a refused verdict is dropped once and reported, never retried, never acknowledged', async () => {
    const refusal = Object.assign(new Error('This question is not currently assigned to you'), { code: '42501' });
    const send = vi.fn().mockRejectedValue(refusal);
    const rejected = vi.fn();
    const acked = vi.fn();
    const box = createOutbox({ storageKey: KEY, storage: memoryStorage(), send, onAck: acked, onReject: rejected, setTimer: () => 0, clearTimer: () => undefined });
    box.enqueue(pass('q1'));
    await flushMicrotasks();
    box.retryNow();
    await flushMicrotasks();
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(rejected.mock.calls[0][1]).toBe(refusal);
    expect(acked).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(box.state().entries).toHaveLength(0);
  });
});

describe('decideAck: what the screen does with the answer', () => {
  const base = (over: Partial<AckContext> = {}): AckContext => ({
    entry: { questionId: 'q1', paperId: 'paperA' },
    result: result(),
    screenPaperId: 'paperA',
    openQuestionId: null,
    answeredIds: new Set(['q1']),
    otherPendingHere: 0,
    ...over,
  });

  it('sequence: verdict then next shows the next question with its context', () => {
    const d = decideAck(base());
    expect(d.kind).toBe('show');
    if (d.kind === 'show') {
      expect(d.next.id).toBe('q2');
      expect(d.next.body).toBe('2. Find x.');
    }
  });

  it('next = null at the end of the paper: the paper-done screen', () => {
    expect(decideAck(base({ result: result(null) }))).toEqual({ kind: 'end' });
  });

  it('next = null while more verdicts of the paper are still on their way: wait for the last one', () => {
    expect(decideAck(base({ result: result(null), otherPendingHere: 1 }))).toEqual({ kind: 'ignore' });
  });

  it('a late retry never yanks the person off the question they are on', () => {
    expect(decideAck(base({ openQuestionId: 'q9' }))).toEqual({ kind: 'ignore' });
    expect(decideAck(base({ openQuestionId: 'q9', result: result(null) }))).toEqual({ kind: 'ignore' });
  });

  it('an answer for another paper is ignored', () => {
    expect(decideAck(base({ screenPaperId: 'paperB' }))).toEqual({ kind: 'ignore' });
  });

  it('a next that already has a verdict waiting is ignored (that verdict brings its own)', () => {
    expect(decideAck(base({ answeredIds: new Set(['q1', 'q2']) }))).toEqual({ kind: 'ignore' });
  });

  it('no answer at all (an old entry) falls back to asking the old way', () => {
    expect(decideAck(base({ result: null }))).toEqual({ kind: 'fetch' });
    expect(decideAck(base({ result: undefined }))).toEqual({ kind: 'fetch' });
  });

  it('paper change: the strip reads the paper from next_paper_id', () => {
    const row = { ...nextRow, paper_id: '' };
    const res = result(row, 'paperB');
    const next = nextForScreen(res)!;
    expect(next.paper_id).toBe('paperB');
    expect(isPaperChange('paperA', next.paper_id)).toBe(true);
    // the same paper: no strip
    expect(isPaperChange('paperA', nextForScreen(result())!.paper_id)).toBe(false);
  });

  it('the words and context are passed through untouched', () => {
    const body = '3. Prove   that  x² ≥ 0.  ';
    const row = { ...nextRow, body, context: [{ id: 'c1' }] };
    const next = nextForScreen(result(row))!;
    expect(next.body).toBe(body);
    expect(next.context).toEqual([{ id: 'c1' }]);
    expect(nextForScreen(result(null))).toBeNull();
  });
});
