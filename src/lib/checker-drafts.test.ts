import { describe, expect, it } from 'vitest';
import {
  clearDraft,
  draftOwnerKey,
  draftsFromQuestion,
  isEdited,
  loadDraft,
  planAnswer,
  saveDraft,
  type DraftQuestion,
  type Drafts,
} from './checker-drafts';

const Q = (over: Partial<DraftQuestion> & { id: string }): DraftQuestion => ({
  version: 1,
  body: 'Find x.',
  display_number: null,
  marks: null,
  ...over,
});

const bag = Q({
  id: 'q-bag',
  body: '7. A bag holds 4 red and 6 blue marbles. One is drawn at random. (i) What is the chance it is red? [1]',
  display_number: '7',
  marks: 2,
});

function plan(q: DraftQuestion, d: Drafts, mode: 'check' | 'fix' = 'fix', fetched = 1) {
  const owner = draftOwnerKey(q, fetched);
  return planAnswer({ question: q, drafts: d, draftsFor: owner, mode }, owner);
}

/** A minimal Storage that behaves like sessionStorage. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  } as Storage;
}

describe('a marks-only or number-only fix never touches the words', () => {
  it('marks only: the body is not sent, so "7. A bag ..." keeps its printed number', () => {
    const d = { ...draftsFromQuestion(bag), marks: '3' };
    const p = plan(bag, d);
    expect(p.kind).toBe('fix');
    if (p.kind !== 'fix') return;
    expect(p.patch.body).toBeNull();
    expect(p.patch.marks).toBe(3);
    expect(p.patch.display_number).toBe('7');
    expect(p.bodyChanged).toBe(false);
    expect(p.strippedPrefix).toBeNull();
  });

  it('number only: the body is not sent', () => {
    const d = { ...draftsFromQuestion(bag), number: '8' };
    const p = plan(bag, d);
    if (p.kind !== 'fix') throw new Error('expected a fix');
    expect(p.patch.body).toBeNull();
    expect(p.patch.display_number).toBe('8');
  });

  it('a body with no number in it is left alone too', () => {
    const q = Q({ id: 'q-plain', body: 'Factorise completely: $3x^2 - 12$ ', marks: 2 });
    const p = plan(q, { ...draftsFromQuestion(q), marks: '3' });
    if (p.kind !== 'fix') throw new Error('expected a fix');
    expect(p.patch.body).toBeNull();
  });

  it('opening Fix it and saving without changing anything sends no words', () => {
    const p = plan(bag, draftsFromQuestion(bag), 'fix');
    if (p.kind !== 'fix') throw new Error('expected a fix');
    expect(p.patch.body).toBeNull();
  });

  it('words the checker really edited still lose only the repeated leading number', () => {
    const d = { ...draftsFromQuestion(bag), body: bag.body!.replace('red', 'green') };
    const p = plan(bag, d);
    if (p.kind !== 'fix') throw new Error('expected a fix');
    expect(p.strippedPrefix).toBe('7. ');
    expect(p.patch.body).toBe(bag.body!.replace('red', 'green').slice(3));
    expect(p.bodyChanged).toBe(true);
  });

  it('an edit that is undone by hand sends no words', () => {
    const d = { ...draftsFromQuestion(bag), body: bag.body + 'x' };
    const back = { ...d, body: bag.body! };
    const p = plan(bag, back);
    if (p.kind !== 'fix') throw new Error('expected a fix');
    expect(p.patch.body).toBeNull();
  });

  it('a lost-text question sends the confirmed reading', () => {
    const q = Q({ id: 'q-lost', body: '', display_number: '6' });
    const p = plan(q, draftsFromQuestion(q, '(a) State one difference. [2]'));
    if (p.kind !== 'fix') throw new Error('expected a fix');
    expect(p.patch.body).toBe('(a) State one difference. [2]');
  });

  it('the typo flag only counts on the Fix it screen', () => {
    const d = { ...draftsFromQuestion(bag), body: bag.body + ' x', printedTypo: true };
    expect((plan(bag, d, 'fix') as { printedTypo: boolean }).printedTypo).toBe(true);
    expect((plan(bag, d, 'check') as { printedTypo: boolean }).printedTypo).toBe(false);
  });

  it('empty marks are sent as null, a number as a number', () => {
    const q = Q({ id: 'q-m', marks: 2 });
    expect((plan(q, { ...draftsFromQuestion(q), marks: '' }) as { patch: { marks: number | null } }).patch.marks).toBeNull();
    expect((plan(q, { ...draftsFromQuestion(q), marks: '0.5' }) as { patch: { marks: number | null } }).patch.marks).toBe(0.5);
  });
});

describe('Enter on question after question answers THAT question (the stale-keys bug)', () => {
  const q1 = Q({ id: 'q1', body: 'Find the value of $k$.', display_number: '6', marks: 3 });
  const q2 = Q({ id: 'q2', body: '', display_number: '6' });
  const q3 = Q({ id: 'q3', body: '(a) State one difference between a Commercial Bank and the Central Bank.', display_number: '(a)', marks: 2 });

  it('unedited questions in a row are each passed, never saved as a fix', () => {
    let fetched = 10;
    for (const q of [q1, q3, bag]) {
      fetched += 1;
      const p = plan(q, draftsFromQuestion(q), 'check', fetched);
      expect(p.kind).toBe('pass');
    }
  });

  it('drafts left over from the question before are refused, not sent with the new id', () => {
    const owner1 = draftOwnerKey(q1, 1);
    const owner2 = draftOwnerKey(q3, 2);
    const stale = draftsFromQuestion(q1);
    const p = planAnswer({ question: q3, drafts: stale, draftsFor: owner1, mode: 'check' }, owner2);
    expect(p).toEqual({ kind: 'refuse', why: 'wrong-question' });
  });

  it('the same question fetched again (after a split) has its own owner key', () => {
    expect(draftOwnerKey(q1, 1)).not.toBe(draftOwnerKey(q1, 2));
    expect(draftOwnerKey(null, 5)).toBe('');
  });

  it('what the boxes hold is always the question in front of the checker', () => {
    for (const q of [q1, q2, q3, bag]) {
      const d = draftsFromQuestion(q);
      expect(d.body).toBe(q.body ?? '');
      expect(d.number).toBe(q.display_number ?? '');
      expect(isEdited(q, d)).toBe(false);
    }
  });
});

describe('draft autosave', () => {
  it('keeps what was typed and gives it back for the same version', () => {
    const s = fakeStorage();
    const d = { ...draftsFromQuestion(bag), body: 'Typed fix', marks: '4', printedTypo: true, typoNote: 'teh' };
    saveDraft('live', bag, d, s);
    const back = loadDraft('live', bag, null, s);
    expect(back).not.toBeNull();
    expect(back!.current).toBe(true);
    expect(back!.drafts).toEqual(d);
  });

  it('marks a draft as old when the question moved on since', () => {
    const s = fakeStorage();
    saveDraft('live', bag, { ...draftsFromQuestion(bag), body: 'Typed fix' }, s);
    const back = loadDraft('live', { ...bag, version: 2 }, null, s);
    expect(back!.current).toBe(false);
    expect(back!.drafts.body).toBe('Typed fix');
  });

  it('gives back nothing when nothing was changed from how the question opens', () => {
    const s = fakeStorage();
    saveDraft('live', bag, draftsFromQuestion(bag), s);
    expect(loadDraft('live', bag, null, s)).toBeNull();
  });

  it('is per question and per scope, and can be cleared', () => {
    const s = fakeStorage();
    const other = Q({ id: 'other' });
    saveDraft('live', bag, { ...draftsFromQuestion(bag), body: 'A' }, s);
    saveDraft('live', other, { ...draftsFromQuestion(other), body: 'B' }, s);
    expect(loadDraft('live', other, null, s)!.drafts.body).toBe('B');
    expect(loadDraft('dummy', bag, null, s)).toBeNull();
    clearDraft('live', bag.id, s);
    expect(loadDraft('live', bag, null, s)).toBeNull();
    expect(loadDraft('live', other, null, s)).not.toBeNull();
  });

  it('never throws when storage is missing, broken or holds rubbish', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(() => saveDraft('live', bag, draftsFromQuestion(bag), broken)).not.toThrow();
    expect(() => clearDraft('live', bag.id, broken)).not.toThrow();
    expect(loadDraft('live', bag, null, broken)).toBeNull();
    expect(loadDraft('live', bag, null, null)).toBeNull();
    const s = fakeStorage();
    s.setItem('shikshaq.checker.draft.live.q-bag', '{not json');
    expect(loadDraft('live', bag, null, s)).toBeNull();
    s.setItem('shikshaq.checker.draft.live.q-bag', '{"body": 5}');
    expect(loadDraft('live', bag, null, s)).toBeNull();
  });
});
