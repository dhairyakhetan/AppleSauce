import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  ACTION_LABELS,
  ACTOR_KINDS,
  CHECKER_KIND_LABELS,
  FIELD_LABELS,
  REVIEW_BUCKET_LABELS,
  VERDICT_LABELS,
  actorLabel,
  checkLine,
  cleanPersonName,
  confidenceWords,
  historyLine,
  modelName,
  relativeWords,
  shownChanges,
  valueWords,
  wordDiff,
  type HistoryEventInput,
} from './history-labels';
import { createFakeApprovalApi, FIXTURE_NOW, FIXTURE_PAPER_ID } from '@/dummy/approval-fake-api';

/* Owner, 2026-10-02: "I don't want coded text." Every code the database can
   emit has words, and no finished history line carries a code. */

/** Every action code written by the migrations in supabase/migrations
 *  (grep "audit_review_log" / admin_activity_feed / content_checks), plus
 *  the approval flow's own from QUEUE_20261002's contract. */
const DB_ACTIONS = [
  // audit_review_log, existing migrations
  'admin_add_checker',
  'admin_draft_edit',
  'admin_edit',
  'admin_english_rescue_publish',
  'admin_english_rescue_unpublish',
  'admin_grant_checker',
  'admin_hide',
  'admin_reapply_paper_to_live',
  'admin_remove_checker',
  'admin_resolve_escalation',
  'admin_restore',
  'admin_revoke_checker',
  'admin_verify_paper',
  'ai_flagged',
  'ai_verdict',
  'checker_ask_help',
  'checker_fix',
  'checker_pass',
  'checker_printed_typo',
  'checker_skip',
  'checker_split',
  'live_apply',
  'live_changes',
  'live_copy',
  'published',
  'reclassify',
  'route_back_unverified_page',
  // admin_activity_feed streams (check_* from content_checks, version_* from content_versions)
  'check_pass',
  'check_fix',
  'check_printed_typo',
  'check_escalate',
  'check_flag',
  'version_insert',
  'version_update',
  'version_revert',
  'version_delete',
  'ai_fix',
  'ai_pass',
  'ai_escalate',
  // the approval contract
  'admin_approve',
  'admin_reject',
  'admin_unpublish',
  'admin_revert',
  // log_action_catalog, all three migrations that fill it:
  // 20260930090000_admin_hardening, 20261002090000_checker_versions_and_activity,
  // 20261003100000_admin_paper_approval
  'admin_add', 'admin_delete', 'admin_merge', 'admin_pass', 'admin_reopen', 'admin_reorder',
  'admin_set_aside', 'admin_split', 'admin_undo', 'auto_fix', 'auto_return', 'autofill_metadata',
  'correct_pdf_match', 'created', 'discard_mark', 'flag_fix', 'gap_audit_pass', 'gap_audit_renderer_note',
  'gap_flag', 'live_clear', 'live_match_loop_resolve', 'load', 'locate_page', 'marks_from_picture',
  'pdf_mismatch_flag', 'picture_check_hide', 'publish', 'queued_for_approval', 'restore', 'revert_header',
  'search_no_match_broad_resolve',
  // history_events(): uncatalogued actions arrive as 'other'
  'other',
  // the admin audit trail (admin_audit_log), written from the Verifiers page
  'grant_checker', 'revoke_checker', 'grant_hod', 'revoke_hod',
];

const CHECKER_KINDS = ['haiku', 'haiku_paddle', 'haiku_pdf', 'sonnet', 'student', 'admin'];
const VERDICTS = ['pass', 'fix', 'printed_typo', 'escalate', 'flag'];
const REVIEW_BUCKETS = ['kid', 'admin', 'data', 'renderer', 'none', 'escalated'];
const FIELDS = [
  'body',
  'display_number',
  'marks',
  'options',
  'instructions',
  'review_bucket',
  'status',
  'question_passed',
  'paper_passed',
  'is_red',
  'is_published',
  'needs_review',
  'general_instructions',
  'allowed_time_minutes',
  'incomplete_note',
  'school',
  'year',
  'exam',
  // history_readable_fields() in 20261003100000_admin_paper_approval.sql
  'section_label', 'chapter', 'alternative_label', 'alternative_group', 'suggested_time_minutes',
  'subject', 'cls', 'class', 'board', 'exam_type', 'title',
];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SNAKE_CODE = /\b[a-z]+_[a-z_]+\b/;

function assertFriendly(line: string) {
  expect(line, line).not.toMatch(UUID);
  expect(line, line).not.toContain('{');
  expect(line, line).not.toContain('}');
  expect(line, line).not.toMatch(SNAKE_CODE);
  expect(line, line).not.toMatch(/\bai:/i);
  expect(line, line).not.toMatch(/[–—]/);
  expect(line, line).not.toContain('undefined');
  expect(line, line).not.toContain('null');
}

describe('history labels cover every code', () => {
  it('has a label for every action code the database emits', () => {
    const missing = DB_ACTIONS.filter((a) => !ACTION_LABELS[a]);
    expect(missing).toEqual([]);
  });

  it('has a label for every action in any log_action_catalog insert in the repo', () => {
    const dir = 'supabase/migrations';
    const found = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
      const sql = readFileSync(join(dir, f), 'utf8');
      const re = /insert into public\.log_action_catalog[\s\S]*?;/gi;
      for (const block of sql.match(re) ?? []) {
        for (const m of block.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'[a-z]+'/g)) found.add(m[1]);
      }
    }
    expect(found.size).toBeGreaterThan(10);
    expect([...found].filter((a) => !ACTION_LABELS[a])).toEqual([]);
  });

  it('has a label for every checker kind, verdict, review pile and field', () => {
    expect(CHECKER_KINDS.filter((k) => !CHECKER_KIND_LABELS[k])).toEqual([]);
    expect(VERDICTS.filter((k) => !VERDICT_LABELS[k])).toEqual([]);
    expect(REVIEW_BUCKETS.filter((k) => !REVIEW_BUCKET_LABELS[k])).toEqual([]);
    expect(FIELDS.filter((k) => !FIELD_LABELS[k])).toEqual([]);
  });

  it('names the AI model from any spelling', () => {
    expect(modelName('ai:haiku+haiku')).toBe('Haiku');
    expect(modelName('haiku_paddle')).toBe('Haiku');
    expect(modelName('claude-sonnet-4-5')).toBe('Sonnet');
    expect(modelName('sonnet')).toBe('Sonnet');
    expect(modelName('mystery')).toBeNull();
  });

  it('says who did it in words', () => {
    expect(actorLabel({ actor_kind: 'admin', actor_name: 'Priya Sharma' })).toBe('Priya Sharma');
    expect(actorLabel({ actor_kind: 'admin', actor_name: 'priya.sharma@example.com' })).toBe('Priya Sharma');
    expect(actorLabel({ actor_kind: 'admin', actor_name: '3f2a9c1e-0000-4000-8000-000000000001' })).toBe('An admin');
    expect(actorLabel({ actor_kind: 'admin' })).toBe('An admin');
    expect(actorLabel({ actor_kind: 'checker', actor_name: 'Rahul' })).toBe('Rahul (student checker)');
    expect(actorLabel({ actor_kind: 'ai', actor_name: 'ai:haiku+haiku' })).toBe('AI check (Haiku)');
    expect(actorLabel({ actor_kind: 'ai', model: 'sonnet' })).toBe('AI check (Sonnet)');
    expect(actorLabel({ actor_kind: 'system' })).toBe('Pipeline (automatic)');
    expect(cleanPersonName('ai:sonnet')).toBeNull();
    // the server's own fallbacks (history_actor / history_person_name)
    expect(actorLabel({ actor_kind: 'student', actor_name: 'A student checker' })).toBe('A student checker');
    expect(actorLabel({ actor_kind: 'admin', actor_name: 'An admin' })).toBe('An admin');
    expect(actorLabel({ actor_kind: 'ai', actor_name: 'AI check (Haiku)' })).toBe('AI check (Haiku)');
    expect(actorLabel({ checker_kind: 'haiku', actor_name: 'AI check (Haiku)' })).toBe('AI check (Haiku)');
  });

  it('writes the owner\'s own examples', () => {
    const now = new Date('2026-10-05T10:00:00');
    const edit = historyLine(
      {
        at: new Date('2026-10-02T16:12:00').toISOString(),
        actor_kind: 'admin',
        actor_name: 'Priya Sharma',
        action: 'admin_edit',
        changes: [{ field: 'body', before: 'a', after: 'b' }],
      },
      now,
    );
    expect(edit.line).toBe('Priya Sharma changed the question text - 2 Oct, 4:12 pm');

    const ai = historyLine(
      { at: new Date('2026-10-02T13:05:00').toISOString(), actor_kind: 'ai', model: 'sonnet', action: 'ai_verdict', verdict: 'pass', confidence: 0.92 },
      now,
    );
    expect(ai.line).toBe('AI check (Sonnet) passed this question, confidence 92% - 2 Oct, 1:05 pm');

    const approve = historyLine(
      { at: new Date('2026-10-03T10:00:00').toISOString(), actor_kind: 'admin', actor_name: 'Kabir', action: 'admin_approve' },
      now,
    );
    expect(approve.line).toBe('Kabir approved the paper for launch - 3 Oct, 10:00 am');

    expect(
      historyLine({ at: now.toISOString(), actor_kind: 'student', actor_name: 'Rahul', action: 'checker_pass' }, now).what,
    ).toBe('said this question matches the page');
    expect(
      historyLine({ at: now.toISOString(), actor_kind: 'admin', actor_name: 'A', action: 'admin_edit', changes: [{ field: 'display_number', before: '1', after: '2' }] }, now).what,
    ).toBe('changed the question number');
  });

  it('never lets a raw code, id, brace or ai: prefix into a line, for any action and actor', () => {
    const now = new Date('2026-10-05T10:00:00Z');
    const nasty: Partial<HistoryEventInput>[] = [
      { actor_name: '3f2a9c1e-0000-4000-8000-000000000001' },
      { actor_name: 'ai:haiku+haiku', model: 'ai:haiku+haiku' },
      { actor_name: 'someone@example.com' },
      { actor_name: null, model: 'haiku_pdf' },
      { actor_name: 'Priya Sharma', question_label: '4(b)' },
    ];
    const changeSets = [
      [],
      [{ field: 'body', before: 'x', after: 'y' }],
      [{ field: 'display_number', before: '1', after: '2' }, { field: 'marks', before: 2, after: 3 }],
      [{ field: 'unpassed_ids', before: ['3f2a9c1e-0000-4000-8000-000000000001'], after: [] }],
      [{ field: 'review_bucket', before: 'kid', after: 'escalated' }],
    ];
    const actions = [...DB_ACTIONS, ...Object.keys(ACTION_LABELS), 'brand_new_code', ''];
    for (const action of actions) {
      for (const kind of [...ACTOR_KINDS, 'checker', 'system', 'weird_kind']) {
        for (const n of nasty) {
          for (const changes of changeSets) {
            const verdicts = kind === 'ai' ? [...VERDICTS, 'odd_verdict', null] : [null];
            for (const verdict of verdicts) {
              const { line } = historyLine(
                { at: '2026-10-02T10:42:00Z', action, actor_kind: kind, changes, verdict, confidence: 0.8, to_version: 2, ...n },
                now,
              );
              assertFriendly(line);
            }
          }
        }
      }
    }
  });

  it('words the HOD grant and revoke, and gives a relative time for the hover title', () => {
    const now = new Date('2026-10-05T10:00:00Z');
    expect(historyLine({ at: now.toISOString(), actor_kind: 'admin', actor_name: 'Priya Sharma', action: 'grant_hod' }, now).what).toBe('made someone an HOD');
    expect(historyLine({ at: now.toISOString(), actor_kind: 'admin', actor_name: 'Priya Sharma', action: 'revoke_hod' }, now).what).toBe(
      'removed someone as an HOD',
    );
    expect(relativeWords('2026-10-05T09:55:00Z', now)).toBe('5 minutes ago');
    expect(relativeWords('not a date', now)).toBe('');
    expect(historyLine({ at: now.toISOString(), actor_kind: 'student', actor_name: 'Rahul', action: 'checker_pass', undone: true }, now).what).toBe(
      'said this question matches the page (undone)',
    );
  });

  it('writes a check line for every checker kind and verdict', () => {
    for (const k of CHECKER_KINDS) {
      for (const v of VERDICTS) {
        const line = checkLine({ checker_kind: k, model: k, verdict: v, confidence: 0.9, at: '2026-10-02T10:00:00Z', actor_name: 'Meera Iyer' });
        assertFriendly(line);
      }
    }
  });

  it('drops notes that look like codes, and pipeline notes', () => {
    const now = new Date();
    expect(historyLine({ at: now.toISOString(), action: 'live_apply', actor_kind: 'pipeline', note: 'skipped: live_bank_question_id x' }).note).toBeNull();
    expect(historyLine({ at: now.toISOString(), action: 'admin_edit', actor_kind: 'admin', note: '{"a":1}' }).note).toBeNull();
    expect(historyLine({ at: now.toISOString(), action: 'admin_edit', actor_kind: 'admin', note: 'The scan misread 7 as 1' }).note).toBe(
      'The scan misread 7 as 1',
    );
  });
});

describe('values and diffs read as words', () => {
  it('describes values without json', () => {
    expect(valueWords('marks', 3)).toBe('3 marks');
    expect(valueWords('marks', 1)).toBe('1 mark');
    expect(valueWords('review_bucket', 'kid')).toBe('student checkers');
    expect(valueWords('options', [{ label: 'a', text: 'watt' }, 'joule'])).toBe('(a) watt\njoule');
    expect(valueWords('x', { a: 1 })).toBe('a different value');
    expect(valueWords('is_published', true)).toBe('yes');
    expect(valueWords('body', null)).toBe('nothing');
    expect(confidenceWords(92)).toBe(', confidence 92%');
  });

  it('diffs words, keeping the text verbatim', () => {
    const parts = wordDiff('find the kinetc energy', 'find the kinetic energy');
    expect(parts).toEqual([
      { kind: 'same', text: 'find the ' },
      { kind: 'removed', text: 'kinetc' },
      { kind: 'added', text: 'kinetic' },
      { kind: 'same', text: ' energy' },
    ]);
    const joined = (k: 'removed' | 'added') => parts.filter((p) => p.kind !== k).map((p) => p.text).join('');
    expect(joined('added')).toBe('find the kinetc energy');
    expect(joined('removed')).toBe('find the kinetic energy');
  });

  it('never draws id-valued fields as before/after', () => {
    expect(
      shownChanges([
        { field: 'parent_id', before: 'x', after: 'y' },
        { field: 'unpassed_ids', before: [], after: [] },
        { field: 'body', before: 'a', after: 'b' },
      ]).map((c) => c.field),
    ).toEqual(['body']);
  });
});

describe('the fixtures read like people', () => {
  it('every paper history and version line in the dummy data is friendly', async () => {
    const api = createFakeApprovalApi(0);
    const queue = await api.queue();
    expect(queue.length).toBeGreaterThan(0);
    for (const row of queue) {
      const events = await api.paperHistory(row.audit_paper_id);
      for (const e of events) assertFriendly(historyLine(e, FIXTURE_NOW).line);
    }
    const review = await api.review(FIXTURE_PAPER_ID);
    for (const r of review.rows.filter((x) => x.kind === 'question')) {
      const h = await api.questionHistory(r.id);
      for (const v of h.versions) {
        assertFriendly(historyLine({ at: v.created_at, actor_kind: v.actor_kind, actor_name: v.actor_name, action: v.action ?? 'version_update' }, FIXTURE_NOW).line);
      }
      for (const c of h.checks) assertFriendly(checkLine(c, FIXTURE_NOW));
    }
  });
});

describe('copy has no em or en dashes', () => {
  it('in the approval pages, components and labels', () => {
    const files = [
      'src/lib/history-labels.ts',
      'src/lib/admin-approval.ts',
      'src/lib/admin-approval-shape.ts',
      'src/pages/admin/paper-approvals.tsx',
      'src/pages/admin/paper-approval.tsx',
      'src/components/papers/held-question-card.tsx',
      ...readdirSync('src/components/admin/approval').map((f) => join('src/components/admin/approval', f)),
    ];
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/[–—]/);
    }
  });
});
