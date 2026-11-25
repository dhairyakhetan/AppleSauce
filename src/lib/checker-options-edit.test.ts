import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { checkerErrorAdvice } from '@/lib/checker-errors';
import {
  draftOwnerKey,
  draftsFromQuestion,
  isEdited,
  loadDraft,
  planAnswer,
  saveDraft,
  sameDrafts,
  type DraftQuestion,
} from '@/lib/checker-drafts';
import { addOption, removeOption, toEditable, updateOption } from '@/lib/option-editing';
import { createFakeCheckerApi } from '@/dummy/checker-fake-api';
import { DUMMY_PAPER } from '@/dummy/checker-fixtures';

/* Checkers can change the answer options when they press Fix it (owner, 25 Nov 2026: "for checkers as well").
   The options travel only when they really changed; a fix of the words never touches them; drafts kept before this
   existed still load; the server function is a new additive one. */

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

/** The made-up Factorise question: it carries four options and sits at version 3. */
const OPTIONS_Q = 'd00000ff-0000-4000-8000-0000000000ff';

const Q: DraftQuestion = {
  id: 'q1',
  version: 4,
  body: 'Pick the right one.',
  display_number: '3',
  marks: 1,
  options: ['alpha', 'beta', 'gamma'],
};

describe('drafts carry the options', () => {
  it('a question opens with its options as rows, and untouched means not edited', () => {
    const d = draftsFromQuestion(Q);
    expect(d.options?.map((o) => o.text)).toEqual(['alpha', 'beta', 'gamma']);
    expect(isEdited(Q, d)).toBe(false);
    expect(sameDrafts(d, draftsFromQuestion(Q))).toBe(true);
  });

  it('changing, adding or removing an option counts as an edit', () => {
    const d = draftsFromQuestion(Q);
    const rows = d.options!;
    expect(isEdited(Q, { ...d, options: updateOption(rows, rows[1].id, { text: 'beta!' }) })).toBe(true);
    expect(isEdited(Q, { ...d, options: (() => { const added = addOption(rows); return updateOption(added, added[added.length - 1].id, { text: 'delta' }); })() })).toBe(true);
    expect(isEdited(Q, { ...d, options: removeOption(rows, rows[0].id) })).toBe(true);
  });

  it('an empty new row is not an edit (blank options are dropped)', () => {
    const d = draftsFromQuestion(Q);
    const withBlank = addOption(d.options!);
    expect(isEdited(Q, { ...d, options: withBlank })).toBe(false);
    expect(sameDrafts({ ...d, options: withBlank }, d)).toBe(true);
  });

  it('a question with no options and drafts without an options field behave as before', () => {
    const plain: DraftQuestion = { id: 'p', version: 1, body: 'x', display_number: null, marks: null };
    const d = draftsFromQuestion(plain);
    expect(d.options).toEqual([]);
    expect(isEdited(plain, { body: 'x', number: '', marks: '' })).toBe(false);
    expect(sameDrafts({ body: 'x', number: '', marks: '', printedTypo: false, typoNote: '' }, d)).toBe(true);
  });
});

describe('planAnswer sends options only when they changed', () => {
  const key = draftOwnerKey(Q, 1);

  it('words fixed, options untouched: the patch has no options key', () => {
    const d = { ...draftsFromQuestion(Q), body: 'Pick the correct one.' };
    const plan = planAnswer({ question: Q, drafts: d, draftsFor: key, mode: 'fix' }, key);
    expect(plan.kind).toBe('fix');
    if (plan.kind === 'fix') expect('options' in plan.patch).toBe(false);
  });

  it('options changed in fix mode: the whole new list goes, nothing else changes', () => {
    const base = draftsFromQuestion(Q);
    const d = { ...base, options: updateOption(base.options!, base.options![2].id, { text: 'delta' }) };
    const plan = planAnswer({ question: Q, drafts: d, draftsFor: key, mode: 'fix' }, key);
    expect(plan.kind).toBe('fix');
    if (plan.kind === 'fix') {
      expect(plan.patch.options).toEqual(['alpha', 'beta', 'delta']);
      expect(plan.patch.body).toBeNull();
      expect(plan.bodyChanged).toBe(false);
    }
  });

  it('options changed but the checker presses Looks right in check mode: it is still saved as a fix', () => {
    const base = draftsFromQuestion(Q);
    const d = { ...base, options: removeOption(base.options!, base.options![0].id) };
    const plan = planAnswer({ question: Q, drafts: d, draftsFor: key, mode: 'check' }, key);
    expect(plan.kind).toBe('fix');
  });

  it('label-and-text options keep their shape and extra fields', () => {
    const lq: DraftQuestion = { ...Q, options: [{ label: 'A', text: 'one', extra: 7 }, { label: 'B', text: 'two' }] };
    const k = draftOwnerKey(lq, 1);
    const base = draftsFromQuestion(lq);
    const d = { ...base, options: updateOption(base.options!, base.options![0].id, { text: 'uno' }) };
    const plan = planAnswer({ question: lq, drafts: d, draftsFor: k, mode: 'fix' }, k);
    expect(plan.kind === 'fix' && plan.patch.options).toEqual([{ label: 'A', text: 'uno', extra: 7 }, { label: 'B', text: 'two' }]);
  });
});

describe('kept drafts', () => {
  it('options typed are kept and come back', () => {
    const storage = memoryStorage();
    const base = draftsFromQuestion(Q);
    const typed = { ...base, options: updateOption(base.options!, base.options![0].id, { text: 'ALPHA' }) };
    saveDraft('s', Q, typed, storage);
    const back = loadDraft('s', Q, null, storage);
    expect(back?.current).toBe(true);
    expect(back?.drafts.options?.map((o) => o.text)).toEqual(['ALPHA', 'beta', 'gamma']);
  });

  it('a draft kept before options could be edited still loads, with the question\'s own options', () => {
    const storage = memoryStorage();
    storage.setItem('shikshaq.checker.draft.s.q1', JSON.stringify({ v: 4, body: 'Typed earlier', number: '3', marks: '1', printedTypo: false, typoNote: '' }));
    const back = loadDraft('s', Q, null, storage);
    expect(back?.current).toBe(true);
    expect(back?.drafts.body).toBe('Typed earlier');
    expect(back?.drafts.options).toEqual(toEditable(Q.options));
  });

  it('a damaged options field falls back to the question\'s own options', () => {
    const storage = memoryStorage();
    storage.setItem('shikshaq.checker.draft.s.q1', JSON.stringify({ v: 4, body: 'Typed', number: '3', marks: '1', printedTypo: false, typoNote: '', options: [1, null, 'x'] }));
    expect(loadDraft('s', Q, null, storage)?.drafts.options).toEqual(toEditable(Q.options));
  });
});

describe('the fake verdictAndNext saves options like the real two-step', () => {
  it('a fix with options stores them, bumps the version once more, and passes the checker', async () => {
    const api = createFakeCheckerApi();
    const q = { id: OPTIONS_Q, version: 3 };
    const first = q;
    const res = await api.verdictAndNext({
      action: 'fix',
      questionId: first.id,
      paperId: DUMMY_PAPER,
      version: first.version,
      patch: { body: null, display_number: null, marks: null, options: ['new one', 'new two'] },
    });
    expect(res.verdict_ok).toBe(true);
    expect(api.optionSaves).toEqual([{ id: first.id, options: ['new one', 'new two'] }]);
    expect(res.verdict_version).toBe((first.version ?? 1) + 2);
  });

  it('a stale version is refused (40001) and nothing is saved', async () => {
    const api = createFakeCheckerApi();
    const q = { id: OPTIONS_Q, version: 3 };
    await expect(
      api.verdictAndNext({
        action: 'fix',
        questionId: q.id,
        paperId: DUMMY_PAPER,
        version: q.version - 1,
        patch: { options: ['x'] },
      }),
    ).rejects.toMatchObject({ code: '40001' });
    expect(api.optionSaves).toEqual([]);
  });
});

describe('plain-English advice and the server function', () => {
  it('the "not switched on yet" case keeps the typing and does not move on', () => {
    const a = checkerErrorAdvice(new Error('Changing options is not switched on yet. Ask the HOD.'));
    expect(a.moveOn).toBe(false);
    expect(a.message).toContain('not switched on yet');
    expect(a.message).toContain('typing is kept');
  });

  const api = readFileSync('src/lib/checker-api.ts', 'utf8');
  const sql = readFileSync('supabase/migrations/20261125110000_checker_set_options.sql', 'utf8');

  it('verdictAndNext sets the options first, then gives the verdict on the version that came back', () => {
    const i = api.indexOf('export async function verdictAndNext');
    const body = api.slice(i, i + 900);
    expect(body.indexOf('checkerSetOptions(')).toBeGreaterThan(-1);
    expect(body.indexOf('checkerSetOptions(')).toBeLessThan(body.indexOf('verdictAndNextArgs(sent)'));
    expect(body).toContain('sent = { ...input, version }');
  });

  it('a missing database function reads as the plain-English message', () => {
    expect(api).toContain("export const OPTIONS_NOT_SWITCHED_ON = 'Changing options is not switched on yet. Ask the HOD.'");
    expect(api).toContain("e.code === 'PGRST202'");
  });

  it('the migration is one additive function: closed to anon by name, open to signed-in, owner-run, pinned path', () => {
    expect(sql).toContain('create or replace function public.verifier_set_options(');
    expect(sql).toContain('security definer');
    expect(sql).toContain("set search_path to 'public', 'pg_temp'");
    expect(sql).toContain('revoke all on function public.verifier_set_options(uuid, integer, jsonb) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.verifier_set_options(uuid, integer, jsonb) to authenticated;');
    expect(sql).toContain('public.checker_authorize_question(p_question_id)');
    expect(sql).toContain("errcode = '40001'");
    expect(sql).toContain('apply_fix_locked');
    // It must not redefine the verdict functions.
    expect(sql).not.toContain('function public.verifier_verdict_and_next');
    expect(sql).not.toContain('function public.checker_fix_locked');
  });
});
