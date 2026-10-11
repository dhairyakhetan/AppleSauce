import { describe, expect, it } from 'vitest';

import {
  actionWords,
  activitySentence,
  activityWho,
  actorIdentity,
  feedActionWords,
  feedActorWords,
  groupActivity,
} from './activity-format';
import type { ActivityRow } from './activity-api';

/* Admin rework, Batch 6: the Activity list says one line per edit, in the
   history labels' words, and the pipeline feed reads the same way. */

const Q1 = 'd1000000-0000-4000-8000-000000000001';
const Q2 = 'd2000000-0000-4000-8000-000000000002';
const A = 'c0ffee00-0000-4000-8000-000000000001';
const B = 'c0ffee00-0000-4000-8000-000000000002';
const T0 = Date.UTC(2026, 9, 2, 10, 0);
const iso = (minutesAgo: number) => new Date(T0 - minutesAgo * 60_000).toISOString();

function r(o: Partial<ActivityRow> & Pick<ActivityRow, 'stream' | 'event_id' | 'action'> & { ago: number }): ActivityRow {
  const { ago, ...rest } = o;
  return {
    at: iso(ago),
    actor_user_id: null,
    actor_label: null,
    actor_kind: 'checker',
    table_name: 'audit_questions',
    row_id: null,
    paper_id: null,
    question_id: null,
    version: null,
    detail: null,
    ...rest,
  };
}

describe('activity sentences', () => {
  it('say who by role and never by name, and reuse the history labels', () => {
    expect(activitySentence({ action: 'checker_pass', actor_kind: 'checker', actor_label: null })).toBe(
      'A student checker said this question matches the page',
    );
    expect(activitySentence({ action: 'check_printed_typo', actor_kind: 'ai', actor_label: 'ai:sonnet' })).toBe(
      'AI check (Sonnet) found a typo printed on the paper',
    );
    expect(activitySentence({ action: 'version_update', actor_kind: 'admin', actor_label: null, question_label: '5(a)' })).toBe(
      'An admin changed question 5(a)',
    );
    expect(activityWho({ actor_kind: 'pipeline', actor_label: 'pipeline' })).toBe('Pipeline (automatic)');
  });

  it('retires the old "Check:" wording', () => {
    for (const a of ['check_pass', 'check_fix', 'check_printed_typo', 'check_escalate', 'check_flag']) {
      expect(actionWords(a)).not.toMatch(/^Check:/);
      expect(activitySentence({ action: a, actor_kind: 'ai', actor_label: 'haiku' })).not.toMatch(/Check:/);
    }
  });

  it('marks a row that was taken back', () => {
    expect(activitySentence({ action: 'checker_pass', actor_kind: 'checker', actor_label: null, undone: true })).toBe(
      'A student checker said this question matches the page (undone)',
    );
    expect(activitySentence({ action: 'checker_pass', actor_kind: 'checker', actor_label: null, undone: false })).not.toContain('undone');
  });

  it('never prints a raw code for an action it does not know', () => {
    const line = activitySentence({ action: 'brand_new_step', actor_kind: 'admin', actor_label: null });
    expect(line).toBe('An admin made a change (brand new step)');
    expect(line).not.toContain('_');
  });

  it('labels the HOD grant and revoke the audit trail records', () => {
    expect(actionWords('grant_hod')).toBe('Made someone an HOD');
    expect(actionWords('revoke_hod')).toBe('Removed someone as an HOD');
  });
});

describe('collapsing one edit that three logs recorded', () => {
  const rows: ActivityRow[] = [
    r({ ago: 2, stream: 'log', event_id: '1', action: 'checker_printed_typo', actor_user_id: A, question_id: Q1 }),
    r({ ago: 2, stream: 'version', event_id: '2', action: 'version_update', actor_user_id: A, question_id: Q1 }),
    r({ ago: 3, stream: 'check', event_id: '3', action: 'check_printed_typo', actor_user_id: A, question_id: Q1 }),
    r({ ago: 9, stream: 'log', event_id: '4', action: 'checker_pass', actor_user_id: B, question_id: Q2 }),
  ];

  it('makes one line of the same question and the same person within two minutes, checker action first', () => {
    const groups = groupActivity(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].head.event_id).toBe('1');
    expect(groups[0].also.map((x) => x.event_id).sort()).toEqual(['2', '3']);
    expect(groups[1].also).toEqual([]);
  });

  it('keeps rows apart when they are more than two minutes from each other', () => {
    const far = [rows[0], r({ ago: 12, stream: 'log', event_id: '9', action: 'checker_fix', actor_user_id: A, question_id: Q1 })];
    expect(groupActivity(far)).toHaveLength(2);
  });

  it('never joins two different people on the same question, or a row with no question', () => {
    const mixed = [
      r({ ago: 2, stream: 'log', event_id: '1', action: 'checker_pass', actor_user_id: A, question_id: Q1 }),
      r({ ago: 2, stream: 'version', event_id: '2', action: 'version_update', actor_user_id: B, question_id: Q1 }),
      r({ ago: 2, stream: 'log', event_id: '3', action: 'reclassify', actor_kind: 'pipeline', actor_label: 'pipeline' }),
      r({ ago: 2, stream: 'log', event_id: '4', action: 'reclassify', actor_kind: 'pipeline', actor_label: 'pipeline' }),
    ];
    expect(groupActivity(mixed)).toHaveLength(4);
  });

  it('treats ai:sonnet and sonnet as one actor, and prefers the check over the version as the headline', () => {
    const ai = [
      r({ ago: 40, stream: 'version', event_id: 'v', action: 'version_update', actor_label: 'ai:sonnet', actor_kind: 'ai', question_id: Q1 }),
      r({ ago: 41, stream: 'check', event_id: 'c', action: 'check_fix', actor_label: 'sonnet', actor_kind: 'ai', question_id: Q1 }),
    ];
    expect(actorIdentity(ai[0])).toBe(actorIdentity(ai[1]));
    const g = groupActivity(ai);
    expect(g).toHaveLength(1);
    expect(g[0].head.event_id).toBe('c');
  });

  it('groups again after an older page is appended, so a group can straddle two pages', () => {
    const page1 = [rows[0]];
    const page2 = [rows[1], rows[2]];
    expect(groupActivity([...page1, ...page2])).toHaveLength(1);
  });

  it('is a no-op for an empty list', () => {
    expect(groupActivity([])).toEqual([]);
  });
});

describe('the pipeline feed in words', () => {
  it('has a lookup of known actors with a safe fallback to the humanised label', () => {
    expect(feedActorWords('ai:sonnet', 'ai')).toBe('AI check (Sonnet)');
    expect(feedActorWords('haiku_pdf', 'ai')).toBe('AI check (Haiku)');
    expect(feedActorWords('pipeline', 'pipeline')).toBe('Pipeline (automatic)');
    expect(feedActorWords('checker', 'checker')).toBe('A student checker');
    expect(feedActorWords(null, 'admin')).toBe('An admin');
    expect(feedActorWords('nightly_sync', null)).toBe('nightly sync');
    expect(feedActorWords('c0ffee00-0000-4000-8000-000000000001', 'checker')).toBe('A student checker');
    expect(feedActorWords(null, null)).toBe('pipeline');
  });

  it('has a lookup of known actions with a safe fallback to the humanised code', () => {
    expect(feedActionWords('ai_fix')).toBe('Fixed this question');
    expect(feedActionWords('paper_loaded')).toBe('Loaded the paper for checking');
    expect(feedActionWords('some_new_step')).toBe('Some new step');
    expect(feedActionWords('ai_fix')).not.toContain('_');
  });
});
