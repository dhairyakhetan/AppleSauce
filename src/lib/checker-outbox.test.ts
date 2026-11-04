import { describe, expect, it, vi } from 'vitest';
import {
  ADOPT_AFTER_MS,
  createOutbox,
  defaultBackoff,
  isDefiniteRefusal,
  type OutboxEntry,
  type OutboxInput,
  type OutboxStorage,
} from '@/lib/checker-outbox';

function memoryStorage(): OutboxStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const KEY = 'outbox-test';
const pass = (questionId: string, paperId = 'paperA'): OutboxInput => ({ questionId, paperId, kind: 'pass', payload: { version: 1 } });

/** A clock and a timer the test moves by hand. */
function fakeTime() {
  let t = 1_000_000;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let n = 0;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = ++n;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimer: (h: unknown) => {
      const i = timers.findIndex((x) => x.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    async advance(ms: number) {
      t += ms;
      for (const due of timers.filter((x) => x.at <= t)) {
        timers.splice(timers.indexOf(due), 1);
        due.fn();
      }
      await tick();
    },
    pending: () => timers.length,
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const flushMicrotasks = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe('outbox: a verdict is written down first and is not lost', () => {
  it('stores the verdict before anything is sent', () => {
    const storage = memoryStorage();
    let stored = '';
    const send = vi.fn(() => {
      stored = storage.data.get(KEY) ?? '';
      return new Promise<void>(() => undefined);
    });
    const box = createOutbox({ storageKey: KEY, storage, send });
    box.enqueue(pass('q1'));
    expect(send).toHaveBeenCalledTimes(1);
    // by the time the request left, the verdict was already in storage
    expect(JSON.parse(stored)[0].questionId).toBe('q1');
    expect(box.hasQuestion('q1')).toBe(true);
  });

  it('keeps a verdict through a failed send and sends it again (retry)', async () => {
    const storage = memoryStorage();
    const time = fakeTime();
    const send = vi
      .fn<(e: OutboxEntry) => Promise<void>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(undefined);
    const acked = vi.fn();
    const box = createOutbox({ storageKey: KEY, storage, send, onAck: acked, ...time });
    box.enqueue(pass('q1'));
    await flushMicrotasks();

    // failed once: still stored, marked failing, nothing acknowledged
    expect(send).toHaveBeenCalledTimes(1);
    expect(box.state().failing).toBe(true);
    expect(box.state().entries).toHaveLength(1);
    expect(JSON.parse(storage.data.get(KEY)!)).toHaveLength(1);
    expect(acked).not.toHaveBeenCalled();

    // too early: no second send
    await time.advance(defaultBackoff(1) - 1);
    expect(send).toHaveBeenCalledTimes(1);

    // the wait is over: sent again, taken, removed
    await time.advance(2);
    await flushMicrotasks();
    expect(send).toHaveBeenCalledTimes(2);
    expect(acked).toHaveBeenCalledTimes(1);
    expect(box.state().entries).toHaveLength(0);
    expect(JSON.parse(storage.data.get(KEY)!)).toHaveLength(0);
  });

  it('Retry button: retryNow sends a failing verdict without waiting', async () => {
    const storage = memoryStorage();
    const time = fakeTime();
    const send = vi
      .fn<(e: OutboxEntry) => Promise<void>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined);
    const box = createOutbox({ storageKey: KEY, storage, send, ...time });
    box.enqueue(pass('q1'));
    await flushMicrotasks();
    expect(box.state().failing).toBe(true);
    box.retryNow();
    await flushMicrotasks();
    expect(send).toHaveBeenCalledTimes(2);
    expect(box.state().entries).toHaveLength(0);
  });

  it('backs off 1 s, 2 s, 4 s, then 8 s at most', () => {
    expect([1, 2, 3, 4, 5, 9].map(defaultBackoff)).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
  });

  it('a refresh does not lose it: a new outbox reads the stored verdict and sends it', async () => {
    const storage = memoryStorage();
    const time = fakeTime();
    const never = vi.fn(() => Promise.reject(new TypeError('offline')));
    const first = createOutbox({ storageKey: KEY, storage, send: never, ownerId: 'tab1', ...time });
    first.enqueue({ questionId: 'q1', paperId: 'paperA', kind: 'fix', payload: { patch: { body: 'typed words' }, version: 3, printedTypo: false } });
    await flushMicrotasks();
    first.dispose();

    const sent: OutboxEntry[] = [];
    const acked = vi.fn();
    const second = createOutbox({
      storageKey: KEY,
      storage,
      ownerId: 'tab1',
      send: async (e) => void sent.push(e),
      onAck: acked,
      ...time,
    });
    expect(second.hasQuestion('q1')).toBe(true);
    await time.advance(defaultBackoff(1) + 1);
    await flushMicrotasks();
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.patch?.body).toBe('typed words');
    expect(acked).toHaveBeenCalledTimes(1);
  });
});

describe('outbox: a verdict is never sent twice', () => {
  it('refuses a second verdict for the same question (double press, key repeat)', () => {
    const send = vi.fn(() => new Promise<void>(() => undefined));
    const box = createOutbox({ storageKey: KEY, storage: memoryStorage(), send });
    expect(box.enqueue(pass('q1'))).not.toBeNull();
    expect(box.enqueue(pass('q1'))).toBeNull();
    expect(box.enqueue({ ...pass('q1'), kind: 'skip', payload: {} })).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(box.state().entries).toHaveLength(1);
  });

  it('sends one request at a time, even when retryNow and enqueue are called while one is on its way', async () => {
    let release: () => void = () => undefined;
    let inFlight = 0;
    let maxInFlight = 0;
    const send = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => (release = r));
      inFlight--;
    });
    const box = createOutbox({ storageKey: KEY, storage: memoryStorage(), send });
    box.enqueue(pass('q1'));
    box.enqueue(pass('q2'));
    box.retryNow();
    box.retryNow();
    expect(send).toHaveBeenCalledTimes(1);
    release();
    await flushMicrotasks();
    release();
    await flushMicrotasks();
    expect(send).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });

  it('an acknowledged verdict is gone, so it is not sent again', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const box = createOutbox({ storageKey: KEY, storage: memoryStorage(), send });
    box.enqueue(pass('q1'));
    await flushMicrotasks();
    box.retryNow();
    await flushMicrotasks();
    expect(send).toHaveBeenCalledTimes(1);
    // and the question can be answered again afterwards (an undo)
    expect(box.enqueue(pass('q1'))).not.toBeNull();
  });

  it('leaves a young verdict written by another tab alone, and does not resend one that tab finished', async () => {
    const storage = memoryStorage();
    const time = fakeTime();
    const theirs: OutboxEntry = {
      id: 'x1',
      questionId: 'q9',
      paperId: 'paperA',
      kind: 'pass',
      payload: {},
      createdAt: time.now() - 1000,
      attempts: 0,
      nextTryAt: time.now() - 1000,
      lastError: null,
      owner: 'other-tab',
    };
    storage.setItem(KEY, JSON.stringify([theirs]));
    const send = vi.fn().mockResolvedValue(undefined);
    createOutbox({ storageKey: KEY, storage, send, ownerId: 'me', ...time });
    await flushMicrotasks();
    expect(send).not.toHaveBeenCalled();

    // the other tab finishes it and removes it from storage
    storage.setItem(KEY, '[]');
    await time.advance(ADOPT_AFTER_MS + 1);
    await flushMicrotasks();
    expect(send).not.toHaveBeenCalled();
  });

  it('adopts a verdict an abandoned tab left behind', async () => {
    const storage = memoryStorage();
    const time = fakeTime();
    const old: OutboxEntry = {
      id: 'x1',
      questionId: 'q9',
      paperId: 'paperA',
      kind: 'pass',
      payload: {},
      createdAt: time.now() - 2 * ADOPT_AFTER_MS,
      attempts: 0,
      nextTryAt: time.now() - 2 * ADOPT_AFTER_MS,
      lastError: null,
      owner: 'closed-tab',
    };
    storage.setItem(KEY, JSON.stringify([old]));
    const send = vi.fn().mockResolvedValue(undefined);
    createOutbox({ storageKey: KEY, storage, send, ownerId: 'me', ...time });
    await flushMicrotasks();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('outbox: order and refusals', () => {
  it('sends the verdicts of one paper in the order they were made, and a failure holds back only its own paper', async () => {
    const time = fakeTime();
    const order: string[] = [];
    const send = vi.fn(async (e: OutboxEntry) => {
      order.push(e.questionId);
      if (e.questionId === 'a1') throw new TypeError('offline');
    });
    const box = createOutbox({ storageKey: KEY, storage: memoryStorage(), send, ...time });
    box.enqueue(pass('a1', 'paperA'));
    box.enqueue(pass('a2', 'paperA'));
    box.enqueue(pass('b1', 'paperB'));
    await flushMicrotasks();
    // a2 waits behind a1; b1 is on another paper and goes
    expect(order).toEqual(['a1', 'b1']);
    expect(box.hasQuestion('a2')).toBe(true);
    expect(box.hasQuestion('b1')).toBe(false);
  });

  it('a refusal that retrying cannot change is reported once and dropped', async () => {
    const lease = Object.assign(new Error('This question is not currently assigned to you'), { code: '42501' });
    const send = vi.fn().mockRejectedValue(lease);
    const rejected = vi.fn();
    const box = createOutbox({ storageKey: KEY, storage: memoryStorage(), send, onReject: rejected });
    box.enqueue(pass('q1'));
    await flushMicrotasks();
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(box.state().entries).toHaveLength(0);
  });

  it('classifies refusals and retryable errors', () => {
    expect(isDefiniteRefusal(Object.assign(new Error('stale question: you saw version 1'), { code: '40001' }))).toBe(true);
    expect(isDefiniteRefusal(Object.assign(new Error('This question has no words'), { code: '22023' }))).toBe(true);
    expect(isDefiniteRefusal(new TypeError('Failed to fetch'))).toBe(false);
    expect(isDefiniteRefusal({ code: '503', message: 'upstream' })).toBe(false);
    expect(isDefiniteRefusal(Object.assign(new Error('Not authorized'), { code: '42501' }))).toBe(false);
  });

  it('every other 42501 about a question is final, so the screen never waits on it (12 Oct 2026)', () => {
    for (const msg of [
      'This question was sent to the HOD',
      'Question not found',
      'This paper is not eligible for checking',
      'This question is not routed to the paper checker',
      'Some future refusal text',
    ]) {
      expect(isDefiniteRefusal(Object.assign(new Error(msg), { code: '42501' })), msg).toBe(true);
    }
  });

  it('flush waits for what is on its way and says when something is held back', async () => {
    let release: () => void = () => undefined;
    const send = vi.fn(() => new Promise<void>((r) => (release = r)));
    const box = createOutbox({ storageKey: KEY, storage: memoryStorage(), send });
    box.enqueue(pass('q1'));
    const done = box.flush();
    release();
    await expect(done).resolves.toBe(true);

    const failing = createOutbox({ storageKey: KEY + '2', storage: memoryStorage(), send: () => Promise.reject(new TypeError('offline')) });
    failing.enqueue(pass('q2'));
    await expect(failing.flush()).resolves.toBe(false);
  });
});
