import { describe, expect, it, vi } from 'vitest';

import { createFakeCheckerApi } from './checker-fake-api';
import { DUMMY_PAPER } from './checker-fixtures';

/* The fake's verdictAndNext / passAndNext must behave like verifier_verdict_and_next:
   the verdict first (with its refusals), then the next question of the paper with
   its context, and nothing served when the verdict is refused. */

describe('fake verdictAndNext', () => {
  it('pass then next in one call gives the same question the two-call path gives', async () => {
    const one = createFakeCheckerApi();
    const first = (await one.nextInPaper(DUMMY_PAPER))!;
    const res = await one.passAndNext(first.id, first.version, DUMMY_PAPER);

    const two = createFakeCheckerApi();
    const f2 = (await two.nextInPaper(DUMMY_PAPER))!;
    await two.passQuestion(f2.id, f2.version);
    const expected = (await two.nextInPaper(DUMMY_PAPER))!;

    expect(res.verdict_ok).toBe(true);
    expect(res.verdict_version).toBe(first.version);
    expect(res.next?.id).toBe(expected.id);
    expect(res.next?.id).not.toBe(first.id);
    expect(res.next?.body).toBe(expected.body);
    expect(res.next_paper_id).toBe(DUMMY_PAPER);
    expect(res.next?.context).toEqual(await two.questionContext(expected.id));
  });

  it('fix, skip and ask_help each hand over a different next question', async () => {
    for (const action of ['fix', 'skip', 'ask_help'] as const) {
      const api = createFakeCheckerApi();
      const first = (await api.nextInPaper(DUMMY_PAPER))!;
      const res = await api.verdictAndNext({
        action,
        questionId: first.id,
        paperId: DUMMY_PAPER,
        version: first.version,
        patch: action === 'fix' ? { body: `${first.body} ` } : undefined,
        reason: 'cut off',
      });
      expect(res.verdict).toBe(action);
      expect(res.next?.id).not.toBe(first.id);
    }
  });

  it('a fix reports the version it ended on', async () => {
    const api = createFakeCheckerApi();
    const first = (await api.nextInPaper(DUMMY_PAPER))!;
    const res = await api.verdictAndNext({ action: 'fix', questionId: first.id, paperId: DUMMY_PAPER, version: first.version, patch: { body: `${first.body}.` } });
    expect(res.verdict_version).toBe((first.version ?? 1) + 1);
  });

  it('a refused verdict throws and serves nothing', async () => {
    const api = createFakeCheckerApi();
    const first = (await api.nextInPaper(DUMMY_PAPER))!;
    api.simulate = 'lease';
    await expect(api.passAndNext(first.id, first.version, DUMMY_PAPER)).rejects.toMatchObject({ code: '42501' });
    // nothing was passed: the same question is still the next one
    expect((await api.nextInPaper(DUMMY_PAPER))?.id).toBe(first.id);

    await expect(api.passAndNext(first.id, (first.version ?? 1) + 5, DUMMY_PAPER)).rejects.toMatchObject({ code: '40001' });
    expect((await api.nextInPaper(DUMMY_PAPER))?.id).toBe(first.id);
  });

  it('a printed-typo fix without a version is refused before anything happens', async () => {
    const api = createFakeCheckerApi();
    const first = (await api.nextInPaper(DUMMY_PAPER))!;
    await expect(
      api.verdictAndNext({ action: 'fix', questionId: first.id, paperId: DUMMY_PAPER, printedTypo: true, patch: { body: 'x' } }),
    ).rejects.toThrow();
    expect((await api.nextInPaper(DUMMY_PAPER))?.id).toBe(first.id);
  });

  it('returns next null when the paper has nothing left', async () => {
    const api = createFakeCheckerApi();
    // a blank row cannot be passed (22023), so the checker sends it to the HOD, as on the real screen
    const answer = (q: { id: string; version?: number | null; body: string }) =>
      q.body.trim() === ''
        ? api.verdictAndNext({ action: 'ask_help', questionId: q.id, paperId: DUMMY_PAPER, reason: 'blank' })
        : api.passAndNext(q.id, q.version, DUMMY_PAPER);
    let res = await answer((await api.nextInPaper(DUMMY_PAPER))!);
    for (let i = 0; i < 50 && res.next; i++) res = await answer(res.next);
    expect(res.next).toBeNull();
    expect(res.next_paper_id).toBeNull();
  });
});

describe('fake verdictAndNext under the slow-network setting', () => {
  it('pays the 1.5 s delay once, like one round trip, not once per inner step', async () => {
    vi.useFakeTimers();
    try {
      const api = createFakeCheckerApi();
      const first = (await api.nextInPaper(DUMMY_PAPER))!;
      api.simulate = 'slow';
      let done = false;
      const call = api.passAndNext(first.id, first.version, DUMMY_PAPER).then((r) => {
        done = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(1499);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      const res = await call;
      expect(done).toBe(true);
      expect(res.next?.id).not.toBe(first.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offline: the whole call fails and the question is untouched', async () => {
    const api = createFakeCheckerApi();
    const first = (await api.nextInPaper(DUMMY_PAPER))!;
    api.simulate = 'offline';
    await expect(api.passAndNext(first.id, first.version, DUMMY_PAPER)).rejects.toThrow('Failed to fetch');
    api.simulate = 'none';
    expect((await api.nextInPaper(DUMMY_PAPER))?.id).toBe(first.id);
  });
});
