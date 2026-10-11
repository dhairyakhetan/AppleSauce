import { describe, expect, it } from 'vitest';

import { createFakeCheckerApi } from './checker-fake-api';
import { dummyQuestions, dummyPictureDataUrl, dummyPageDataUrl } from './checker-fixtures';
import { planWholePage, planVerifiedPage } from '@/lib/checker-page';
import { planCheckerPicture } from '@/lib/checker-pictures';
import { assembleQuestionContext } from '@/lib/checker-context';
import { isBlankBody, looksGarbled } from '@/lib/checker-body';
import { englishContext } from '@/lib/checker-english';
import { needsSplit } from '@/lib/checker-kid-reasons';

/* Dummy mode (D75) is only useful if its fixtures really cover the cases
   the checker must handle, and its fake behaves like the server where the
   page depends on it. */

describe('dummy fixtures cover every case', () => {
  const qs = dummyQuestions();
  it('has a trusted picture, a doubtful one, and a whole-question picture', async () => {
    const api = createFakeCheckerApi();
    const plans = await Promise.all(
      qs.map(async (q) => planCheckerPicture(q, assembleQuestionContext(await api.questionContext(q.id), q.id))),
    );
    expect(plans.some((p) => p?.kind === 'own')).toBe(true);
    expect(plans.some((p) => p?.kind === 'whole')).toBe(true);
    expect(plans.some((p) => p === null)).toBe(true);
    for (const p of plans) if (p) expect(dummyPictureDataUrl(p.path)).toMatch(/^data:image\/svg\+xml/);
  });

  it('has a Maths question that falls back to the whole printed page', async () => {
    const api = createFakeCheckerApi();
    const first = await api.nextQuestion();
    expect(first).not.toBeNull();
    const ctx = assembleQuestionContext(await api.questionContext(first!.id), first!.id);
    expect(planCheckerPicture(first!, ctx)).toBeNull();
    const page = planWholePage(first!, false);
    expect(page?.note).toBe('Find question 6 on this page.');
    expect(dummyPageDataUrl(page!.path)).toMatch(/^data:image\/svg\+xml/);
    expect(await api.pictureUrl(page!.path)).toMatch(/^data:image\/svg\+xml/);
  });

  it('has an English passage, scrambled text, a split, a blank row and maths', () => {
    expect(qs.some((q) => englishContext(q.source)?.passage)).toBe(true);
    expect(qs.some((q) => looksGarbled(q.body, q.subject).garbled)).toBe(true);
    expect(qs.some((q) => needsSplit(q.flag_reasons) && !isBlankBody(q.body))).toBe(true);
    expect(qs.some((q) => isBlankBody(q.body))).toBe(true);
    expect(qs.some((q) => q.body.includes('$$'))).toBe(true);
  });

  it('uses no em or en dash in its made-up text', () => {
    for (const q of qs) expect(q.body).not.toMatch(/[–—]/);
  });
});

describe('fake checker api', () => {
  it('serves in order, and pass moves on and counts', async () => {
    const api = createFakeCheckerApi();
    const first = await api.nextQuestion();
    await api.passQuestion(first!.id);
    const second = await api.nextQuestion();
    expect(second!.id).not.toBe(first!.id);
    expect((await api.myStats()).today_count).toBe(1);
  });

  it('refuses to pass a blank question, like the migration does', async () => {
    const api = createFakeCheckerApi();
    const blank = dummyQuestions().find((q) => isBlankBody(q.body))!;
    await expect(api.passQuestion(blank.id)).rejects.toMatchObject({ code: '22023' });
  });

  it('splits by code point and tags the second half', async () => {
    const api = createFakeCheckerApi();
    const q = dummyQuestions().find((x) => needsSplit(x.flag_reasons) && !isBlankBody(x.body))!;
    const at = Array.from(q.body).indexOf('8');
    const res = await api.splitQuestion(q.id, q.body, at);
    expect(res!.second_id).toBeTruthy();
    await expect(api.splitQuestion(q.id, q.body, 0)).rejects.toMatchObject({ code: '40001' });
  });

  it('filters exactly on the saved picks, and remembers All as chosen', async () => {
    const api = createFakeCheckerApi();
    await api.setPreferences(['English'], []);
    expect((await api.nextQuestion())!.subject).toBe('English');
    await api.setPreferences([], []);
    expect(await api.getPreferences()).toMatchObject({ subjects: null, classes: null, chosen: true });
  });

  it('can simulate a lost lease once, and going offline', async () => {
    const api = createFakeCheckerApi();
    const q = (await api.nextQuestion())!;
    api.simulate = 'lease';
    await expect(api.passQuestion(q.id)).rejects.toMatchObject({ code: '42501' });
    await api.passQuestion(q.id);
    api.simulate = 'offline';
    await expect(api.nextQuestion()).rejects.toThrow('Failed to fetch');
  });

  it('every fixture carries a version, like checker_next_question after 20261002090000', () => {
    for (const q of dummyQuestions()) expect(typeof q.version).toBe('number');
  });

  it('refuses a save over a newer version (40001) and accepts the version it saw', async () => {
    const api = createFakeCheckerApi();
    const q = (await api.nextQuestion())!;
    api.simulate = 'stale';
    await expect(api.passQuestion(q.id, q.version)).rejects.toMatchObject({ code: '40001' });
    const fresh = (await api.nextQuestion())!;
    expect(fresh.id).toBe(q.id);
    expect(fresh.version).toBe((q.version ?? 1) + 1);
    await api.passQuestion(fresh.id, fresh.version);
  });

  it('records a printed-typo fix with the version seen, and refuses one that changes no words', async () => {
    const api = createFakeCheckerApi();
    const q = dummyQuestions().find((x) => x.body.includes('compleetly'))!;
    await expect(
      api.fixQuestion(q.id, { body: null }, { version: q.version, printedTypo: true }),
    ).rejects.toMatchObject({ code: '22023' });
    await api.fixQuestion(
      q.id,
      { body: q.body.replace('compleetly', 'completely') },
      { version: q.version, printedTypo: true, typoNote: 'misprint' },
    );
    expect(api.fixes.at(-1)).toMatchObject({ id: q.id, version: 3, printedTypo: true, typoNote: 'misprint' });
  });

  it('refuses a printed-typo fix when the question has no version (migration not applied)', async () => {
    const api = createFakeCheckerApi();
    const q = (await api.nextQuestion())!;
    await expect(api.fixQuestion(q.id, { body: q.body + ' x' }, { version: null, printedTypo: true })).rejects.toThrow(
      /not switched on/,
    );
  });

  it('has a question with a trusted crop AND a verified page, both shown', async () => {
    const api = createFakeCheckerApi();
    const q = dummyQuestions().find((x) => x.body.includes('compleetly'))!;
    const ctx = assembleQuestionContext(await api.questionContext(q.id), q.id);
    expect(planCheckerPicture(q, ctx)?.kind).toBe('own');
    expect(planVerifiedPage(q)?.page).toBe(3);
  });

  it('empties the queue and resets', async () => {
    const api = createFakeCheckerApi();
    api.emptyQueue();
    expect(await api.nextQuestion()).toBeNull();
    api.reset();
    expect(await api.nextQuestion()).not.toBeNull();
  });
});

describe('fake checker api: lanes, lost text, arrivals', () => {
  it('serves a blank question only when the AI left a transcription, and accepts the confirmed words', async () => {
    const api = createFakeCheckerApi();
    const lost = dummyQuestions().find((q) => q.id.startsWith('d0000020'))!;
    expect(isBlankBody(lost.body)).toBe(true);
    const served: string[] = [];
    for (let i = 0; i < 40; i++) {
      const q = await api.nextQuestion();
      if (!q) break;
      served.push(q.id);
      if (q.id === lost.id) break;
      await api.skipQuestion(q.id);
    }
    expect(served).toContain(lost.id);
    const words = 'Confirmed words';
    await api.fixQuestion(lost.id, { body: words }, { version: 2 });
    expect(api.fixes.at(-1)).toMatchObject({ id: lost.id, body: words });
    // the old blank row with no transcription is never served
    const never = dummyQuestions().find((q) => isBlankBody(q.body) && q.id.startsWith('d0000008'))!;
    for (let i = 0; i < 40; i++) {
      const q = await api.nextQuestion();
      if (!q) break;
      expect(q.id).not.toBe(never.id);
      await api.skipQuestion(q.id);
    }
  });

  it('adds a question when one arrives', async () => {
    const api = createFakeCheckerApi();
    api.emptyQueue();
    expect(await api.nextQuestion()).toBeNull();
    api.arrive();
    expect(await api.nextQuestion()).not.toBeNull();
  });
});
