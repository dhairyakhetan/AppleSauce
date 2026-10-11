import { describe, expect, it } from 'vitest';

import {
  actionWords,
  actorText,
  canOpenHistory,
  canRevert,
  changedFields,
  revertConfirmText,
  shortId,
  tableWords,
  valueText,
} from './activity-format';
import { debugFactEntries } from './debug-facts';
import { createFakeActivityApi } from '@/dummy/activity-fake-api';

describe('activity wording', () => {
  it('names the new checker actions plainly, and de-underscores unknown ones', () => {
    expect(actionWords('checker_printed_typo')).toBe('Corrected a typo printed on the paper');
    expect(actionWords('version_revert')).toBe('Restored an earlier version');
    expect(actionWords('some_new_step')).toBe('Some new step');
    expect(actionWords('')).toBe('Something happened');
  });

  it('shows an actor as an id or a label, never anything else', () => {
    const person = actorText({ actor_user_id: 'c0ffee00-0000-4000-8000-000000000001', actor_label: null, actor_kind: 'checker' });
    expect(person).toEqual({ kind: 'Checker', who: 'c0ffee00', full: 'c0ffee00-0000-4000-8000-000000000001' });
    const ai = actorText({ actor_user_id: null, actor_label: 'ai:sonnet', actor_kind: 'ai' });
    expect(ai).toMatchObject({ kind: 'Computer', who: 'ai:sonnet' });
  });

  it('opens a history only for question rows', () => {
    expect(canOpenHistory({ table_name: 'audit_questions', question_id: 'x' })).toBe(true);
    expect(canOpenHistory({ table_name: 'bank_questions', question_id: 'x' })).toBe(true);
    expect(canOpenHistory({ table_name: 'audit_papers', question_id: null })).toBe(false);
    expect(canOpenHistory({ table_name: 'audit_questions', question_id: null })).toBe(false);
  });

  it('shortens ids and words tables', () => {
    expect(shortId('abcdef0123456')).toBe('abcdef01');
    expect(shortId(null)).toBe('');
    expect(tableWords('bank_questions')).toBe('Live question');
  });

  it('has no em or en dashes in any copy', () => {
    for (const a of ['checker_pass', 'checker_fix', 'checker_printed_typo', 'check_pass', 'version_update', 'route_back_unverified_page']) {
      expect(actionWords(a)).not.toMatch(/[–—]/);
    }
    expect(revertConfirmText(3, 5)).not.toMatch(/[–—]/);
  });
});

describe('versions', () => {
  it('lists exactly the fields that changed', () => {
    expect(changedFields({ body: 'a', marks: 2 }, { body: 'b', marks: 2 })).toEqual(['body']);
    expect(changedFields({ body: 'a' }, { body: 'a', marks: 1 })).toEqual(['marks']);
    expect(changedFields({ options: ['x'] }, { options: ['x'] })).toEqual([]);
    expect(changedFields(null, null)).toEqual([]);
  });

  it('shows question text verbatim', () => {
    const body = '  Solve: $$\\frac{2x}{3}$$\n(i) keep  spaces ';
    expect(valueText(body)).toBe(body);
    expect(valueText(null)).toBe('(empty)');
    expect(valueText(['a'])).toBe('["a"]');
  });

  it('offers revert on older versions only, never on a deletion', () => {
    expect(canRevert({ is_current: true, op: 'update' })).toBe(false);
    expect(canRevert({ is_current: false, op: 'delete' })).toBe(false);
    expect(canRevert({ is_current: false, op: 'backfill' })).toBe(true);
    expect(revertConfirmText(2, 4)).toContain('version 5');
  });
});

describe('debug facts', () => {
  it('drops empty values and spells out the rest', () => {
    expect(debugFactEntries({ version: 3, flags: ['a', 'b'], none: null, empty: [], verified: false, blank: ' ' })).toEqual([
      ['version', '3'],
      ['flags', 'a, b'],
      ['verified', 'no'],
    ]);
  });
});

describe('fake activity api', () => {
  it('holds no email anywhere in the feed', async () => {
    const api = createFakeActivityApi();
    const rows = await api.feed('all', null);
    expect(JSON.stringify(rows)).not.toMatch(/@/);
    expect((await api.feed('people', null)).every((r) => r.actor_user_id)).toBe(true);
  });

  it('a revert adds a new current version and keeps every old one', async () => {
    const api = createFakeActivityApi();
    const id = 'd1000000-0000-4000-8000-000000000001';
    const before = await api.versionHistory('audit_questions', id);
    const next = await api.revert('audit_questions', id, 3, null);
    const after = await api.versionHistory('audit_questions', id);
    expect(next).toBe(5);
    expect(after.length).toBe(before.length + 1);
    expect(after[0]).toMatchObject({ version: 5, op: 'revert', is_current: true });
    expect(after[0].snapshot.body).toBe(before.find((r) => r.version === 3)!.snapshot.body);
    expect(after.filter((r) => r.is_current).length).toBe(1);
    expect(after.some((r) => 'answer_key' in r.snapshot)).toBe(false);
  });
});
