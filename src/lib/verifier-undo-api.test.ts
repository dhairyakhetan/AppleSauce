import { describe, expect, it } from 'vitest';

import { createFakeCheckerApi, UNDO_WINDOW_MS } from '@/dummy/checker-fake-api';
import { undoErrorMessage, UNDONE_NOTE } from '@/lib/checker-errors';
import { canSplitAt, isOrOnlyBody, splitOrPlan } from '@/lib/checker-body';
import { shortcutHint, matchCheckerShortcut } from '@/lib/checker-shortcuts';
import { skippedLabel, skippedNote } from '@/lib/verifier-papers';

/* The rewind button, against the fake that copies verifier_undo_last
   (20261008140000), and the OR / skip rules of 20261008150000 and
   20261008160000. The database functions themselves are pinned in
   verifier-undo-migration.test.ts. */

async function start() {
  const api = createFakeCheckerApi();
  const [paper] = await api.myPapers();
  return { api, paper };
}

describe('undo: each kind of answer', () => {
  it('Looks right is undone: the question is back, leased to the caller, and no longer counted', async () => {
    const { api, paper } = await start();
    const q = (await api.nextInPaper(paper.paper_id))!;
    await api.passQuestion(q.id, q.version);
    const [after] = await api.myPapers();
    expect(after.done).toBe(1);
    expect((await api.myStats()).today_count).toBe(1);

    const res = await api.undoLast(paper.paper_id);
    expect(res.undone).toBe('pass');
    expect(res.undone_action).toBe('checker_pass');
    expect(res.question.id).toBe(q.id);
    expect(res.question.body).toBe(q.body);
    const [back] = await api.myPapers();
    expect(back.done).toBe(0);
    expect(back.remaining).toBe(paper.remaining);
    expect((await api.myStats()).today_count).toBe(0);
    // It is the next question again.
    expect((await api.nextInPaper(paper.paper_id))?.id).toBe(q.id);
  });

  it('Fix it is undone with the exact previous words, number and marks', async () => {
    const { api, paper } = await start();
    const q = (await api.nextInPaper(paper.paper_id))!;
    const original = { body: q.body, display_number: q.display_number, marks: q.marks };
    await api.fixQuestion(q.id, { body: `${q.body} (changed)`, display_number: '99', marks: 7 }, { version: q.version });

    const res = await api.undoLast(paper.paper_id);
    expect(res.undone).toBe('fix');
    expect(res.question.body).toBe(original.body);
    expect(res.question.display_number).toBe(original.display_number);
    expect(res.question.marks).toBe(original.marks);
    // A new version holds the old words; history is not rewritten.
    expect(res.question.version).toBeGreaterThan(q.version ?? 1);
    const [back] = await api.myPapers();
    expect(back.done).toBe(0);
  });

  it('Ask the HOD is withdrawn while the HOD has not acted', async () => {
    const { api, paper } = await start();
    const q = (await api.nextInPaper(paper.paper_id))!;
    await api.askForHelp(q.id, 'cannot read it');
    expect((await api.myPapers())[0].with_hod).toBe(1);
    const res = await api.undoLast(paper.paper_id);
    expect(res.undone).toBe('ask_help');
    expect(res.question.id).toBe(q.id);
    const [back] = await api.myPapers();
    expect(back.with_hod).toBe(0);
    expect(back.remaining).toBe(paper.remaining);
  });

  it('Skip is undone: the skip mark is gone and the question is back in its place', async () => {
    const { api, paper } = await start();
    const q = (await api.nextInPaper(paper.paper_id))!;
    await api.skipQuestion(q.id);
    expect((await api.myPapers())[0].skipped).toBe(1);
    expect((await api.nextInPaper(paper.paper_id))?.id).not.toBe(q.id);
    const res = await api.undoLast(paper.paper_id);
    expect(res.undone).toBe('skip');
    expect((await api.myPapers())[0].skipped).toBe(0);
    expect((await api.nextInPaper(paper.paper_id))?.id).toBe(q.id);
  });

  it('walks back through earlier answers one at a time, newest first', async () => {
    const { api, paper } = await start();
    const a = (await api.nextInPaper(paper.paper_id))!;
    await api.passQuestion(a.id, a.version);
    const b = (await api.nextInPaper(paper.paper_id))!;
    await api.skipQuestion(b.id);
    expect((await api.undoLast(paper.paper_id)).question_id).toBe(b.id);
    expect((await api.undoLast(paper.paper_id)).question_id).toBe(a.id);
    await expect(api.undoLast(paper.paper_id)).rejects.toMatchObject({ code: '22023' });
  });
});

describe('undo: refusals', () => {
  it('has nothing to undo before any answer', async () => {
    const { api, paper } = await start();
    await expect(api.undoLast(paper.paper_id)).rejects.toMatchObject({
      code: '22023',
      message: 'There is nothing to undo on this paper.',
    });
  });

  it('refuses after 30 minutes', async () => {
    const { api, paper } = await start();
    let now = 1_000_000;
    api.clock = () => now;
    const q = (await api.nextInPaper(paper.paper_id))!;
    await api.passQuestion(q.id, q.version);
    now += UNDO_WINDOW_MS - 1000;
    // still inside the window
    const ok = await api.undoLast(paper.paper_id);
    expect(ok.question_id).toBe(q.id);
    await api.passQuestion(q.id, ok.question.version);
    now += UNDO_WINDOW_MS + 1000;
    await expect(api.undoLast(paper.paper_id)).rejects.toMatchObject({
      code: '22023',
      message: expect.stringContaining('more than 30 minutes ago'),
    });
  });

  it('refuses when someone else has worked on the question since', async () => {
    const { api, paper } = await start();
    const q = (await api.nextInPaper(paper.paper_id))!;
    await api.passQuestion(q.id, q.version);
    api.someoneElseActed(q.id);
    await expect(api.undoLast(paper.paper_id)).rejects.toMatchObject({
      code: '22023',
      message: expect.stringContaining('Someone else has worked on that question'),
    });
  });

  it('refuses to take back a request for help once the HOD has answered', async () => {
    const { api, paper } = await start();
    const q = (await api.nextInPaper(paper.paper_id))!;
    await api.askForHelp(q.id, 'help');
    api.hodAnswered(q.id);
    await expect(api.undoLast(paper.paper_id)).rejects.toMatchObject({
      code: '22023',
      message: expect.stringContaining('The HOD has already dealt with that question'),
    });
    // The question is still with the HOD.
    expect((await api.myPapers())[0].with_hod).toBe(1);
  });

  it('refuses to undo a split, in plain words', async () => {
    const { api, paper } = await start();
    const q = api.addQuestion({ body: 'First question text. Second question text.', flag_reasons: [] });
    const leased = (await api.nextInPaper(paper.paper_id))!;
    expect(leased).toBeTruthy();
    await api.splitQuestion(q.id, q.body, 22);
    await expect(api.undoLast(paper.paper_id)).rejects.toMatchObject({
      code: '22023',
      message: expect.stringContaining('Splitting a question cannot be undone here'),
    });
  });

  it('refuses when the paper was handed back', async () => {
    const { api, paper } = await start();
    const q = (await api.nextInPaper(paper.paper_id))!;
    await api.passQuestion(q.id, q.version);
    await api.nextQuestion();
    await api.returnPaper('cannot read the subject');
    await expect(api.undoLast(paper.paper_id)).rejects.toMatchObject({ code: '22023' });
  });
});

describe('undo: wording and shortcut', () => {
  it('shows the server sentence for a refusal and a generic line for anything else', () => {
    expect(undoErrorMessage({ code: '22023', message: 'Your last answer was more than 30 minutes ago, so it can no longer be undone.' })).toBe(
      'Your last answer was more than 30 minutes ago, so it can no longer be undone.',
    );
    expect(undoErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Could not undo that/);
    expect(UNDONE_NOTE).toBe('Undone. Here is that question again.');
  });

  it('U is the shortcut, shown in the hint only once there is something to undo', () => {
    expect(matchCheckerShortcut('u', false)).toBe('undo');
    expect(shortcutHint({ canSplit: false, canPass: true })).not.toMatch(/undo/i);
    expect(shortcutHint({ canSplit: false, canPass: true, canUndo: true })).toMatch(/U undo/);
    expect(shortcutHint({ canSplit: false, canPass: true, canUndo: true })).not.toMatch(/[–—]/);
  });
});

describe('skip is always available and waits for later', () => {
  it('Skip works on the last question left, and the paper keeps it', async () => {
    const { api, paper } = await start();
    let q = await api.nextInPaper(paper.paper_id);
    // answer everything but one
    while (q && (await api.myPapers())[0].remaining > 1) {
      // a row with no words cannot be passed; it goes to the HOD
      if (q.body.trim() === '') await api.askForHelp(q.id, 'no words');
      else await api.passQuestion(q.id, q.version);
      q = await api.nextInPaper(paper.paper_id);
    }
    expect((await api.myPapers())[0].remaining).toBe(1);
    await expect(api.skipQuestion(q!.id)).resolves.toBeUndefined();
    const [row] = await api.myPapers();
    expect(row.remaining).toBe(1);
    expect(row.skipped).toBe(1);
    // Nothing is served again straight away; the verifier chooses.
    expect(await api.nextInPaper(paper.paper_id)).toBeNull();
    expect((await api.nextInPaper(paper.paper_id, { includeSkipped: true }))?.id).toBe(q!.id);
  });

  it('words for the card and the done-for-now screen', () => {
    expect(skippedLabel(3)).toBe('3 skipped');
    expect(skippedNote(1)).toBe('You skipped 1 question on this paper. It stays here for later.');
    expect(skippedNote(4)).toBe('You skipped 4 questions on this paper. They stay here for later.');
  });
});

describe('OR between two questions', () => {
  const joined = 'Compare and contrast the two empires.\nOR\nExplain the role of the Satavahana dynasty.';
  const at = (needle: string, after = false) => Array.from(joined.slice(0, joined.indexOf(needle) + (after ? needle.length : 0))).length;

  it('drops an OR that starts the second half, keeping every other character', () => {
    const plan = splitOrPlan(joined, at('OR\n'));
    expect(plan.orSeparator).toBe(true);
    expect(plan.first).toBe('Compare and contrast the two empires.\n');
    expect(plan.second).toBe('Explain the role of the Satavahana dynasty.');
  });

  it('drops an OR that ends the first half', () => {
    const plan = splitOrPlan(joined, at('OR', true));
    expect(plan.orSeparator).toBe(true);
    expect(plan.first).toBe('Compare and contrast the two empires.');
    expect(plan.second).toBe('\nExplain the role of the Satavahana dynasty.');
  });

  it('takes "Or" and "OR," too', () => {
    expect(splitOrPlan('First part? Or, second part', 12).second).toBe('second part');
    expect(splitOrPlan('First part? OR, second part', 12).second).toBe('second part');
    expect(splitOrPlan('First part? Or second part', 12).second).toBe('second part');
  });

  it('never treats a lower case or, or part of a longer word, as a separator', () => {
    expect(splitOrPlan('Name the river or the lake', 15).orSeparator).toBe(false);
    expect(splitOrPlan('Pick one ORANGE fruit', 9).orSeparator).toBe(false);
    expect(splitOrPlan('Say FOR', 4).orSeparator).toBe(false);
  });

  it('a split with no OR is cut exactly as before', () => {
    const plan = splitOrPlan('One. Two.', 5);
    expect(plan).toEqual({ first: 'One. ', second: 'Two.', orSeparator: false });
  });

  it('a split that would leave a part empty is refused', () => {
    expect(canSplitAt('First? OR', 7)).toBe(false);
    expect(canSplitAt(joined, at('OR\n'))).toBe(true);
  });

  it('recognises a row that is only the word OR', () => {
    for (const body of ['OR', ' OR,\n', 'Or', 'OR.']) expect(isOrOnlyBody(body), body).toBe(true);
    for (const body of ['OR the other', 'ORANGE', 'or', '', 'Explain OR']) expect(isOrOnlyBody(body), body).toBe(false);
  });

  it('the fake split leaves the OR out and links the halves as alternatives', async () => {
    const { api, paper } = await start();
    const q = api.addQuestion({ body: joined, display_number: '12', marks: 5 });
    await api.nextInPaper(paper.paper_id);
    const res = await api.splitQuestion(q.id, joined, at('OR\n'));
    const alt = api.alternatives();
    expect(alt[q.id]).toEqual({ group: '12', label: 'main' });
    expect(alt[res!.second_id]).toEqual({ group: '12', label: 'or' });
    const rows = await api.paperQuestions(paper.paper_id);
    const first = rows.find((r) => r.id === q.id)!;
    const second = rows.find((r) => r.id === res!.second_id)!;
    expect(first.body).toBe('Compare and contrast the two empires.\n');
    expect(second.body).toBe('Explain the role of the Satavahana dynasty.');
    expect(second.display_number).toBe('12');
    expect(first.body + second.body).not.toContain('OR');
  });

  it('the fake sets an OR-only row aside and links its neighbours once', async () => {
    const { api, paper } = await start();
    const before = api.addQuestion({ body: 'Question about trade.', ord: 301 });
    const orRow = api.addQuestion({ body: 'OR,', ord: 302 });
    const after = api.addQuestion({ body: 'Question about farming.', ord: 303 });
    await api.markOrSeparator(orRow.id);
    const alt = api.alternatives();
    expect(alt[before.id]).toMatchObject({ label: 'main' });
    expect(alt[after.id]).toMatchObject({ label: 'or' });
    expect(alt[before.id].group).toBe(alt[after.id].group);
    const rows = await api.paperQuestions(paper.paper_id);
    expect(rows.find((r) => r.id === orRow.id)?.state).toBe('set_aside');
    // A real question is not accepted as an OR row.
    await expect(api.markOrSeparator(before.id)).rejects.toMatchObject({ code: '22023' });
  });
});
