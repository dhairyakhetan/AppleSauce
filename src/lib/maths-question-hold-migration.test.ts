import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20260930230000_maths_question_level_hold.sql cannot run in CI (no database),
   so its load-bearing lines are pinned here: the hold set in one place, the
   Maths-only rule, English and the rest still wholly held, the free-preview
   cut taken after the hold, answer_key absent, and the grants re-asserted. */

const raw = readFileSync('supabase/migrations/20260930230000_maths_question_level_hold.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const HOLD = [
  'figure_missing',
  'snippet_unaligned',
  'possible_duplicate',
  'page_furniture',
  'short_body',
  'unbalanced_math_delim',
  'ocr_junk',
];

describe('maths question-level hold migration', () => {
  it('keeps the hold set in one immutable function, exactly the seven content-risk flags', () => {
    expect(sql).toContain('create or replace function public.question_hold_flags()');
    expect(sql).toMatch(/returns text\[\]\s+language sql\s+immutable/);
    const body = sql.match(/array\[([^\]]*)\]/)?.[1] ?? '';
    const flags = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(flags).toEqual(HOLD);
    for (const soft of ['missing_marks', 'chapter_unresolved', 'display_number_missing', 'hidden_on_site']) {
      expect(sql).not.toContain(`'${soft}'`);
    }
  });

  it('closes the hold function to every role by name', () => {
    expect(sql).toContain('revoke all on function public.question_hold_flags() from public, anon, authenticated;');
    expect(sql).not.toMatch(/grant\s+execute[^;]*question_hold_flags/i);
  });

  it('holds Maths per question and every other subject per paper', () => {
    expect(sql).toContain("when p.subject = 'Mathematics' then");
    expect(sql).toContain("coalesce(d.status, '') = 'passed'");
    expect(sql).toContain('public.question_hold_flags()');
    expect(sql).toContain('else not p.needs_review');
    expect(sql).toContain('and p.is_published');
  });

  it('reads the most recent desk copy of the question only', () => {
    expect(sql).toContain('a.live_bank_question_id = q.id');
    expect(sql).toContain("and a.kind = 'question'");
    expect(sql).toContain('order by a.updated_at desc');
    expect(sql).toContain('limit 1');
  });

  it('applies the two-question free preview after the hold filter', () => {
    expect(sql).toContain('order by q.ord');
    expect(sql).toContain('limit case when v_uid is null then 2 else null end;');
    expect(sql.indexOf('question_hold_flags()')).toBeLessThan(sql.indexOf('limit case when v_uid'));
  });

  it('never returns answer_key and keeps the definer settings', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.bank_paper_questions'));
    expect(fn).not.toMatch(/answer_key/);
    expect(fn).toContain('security definer');
    expect(fn).toContain("set search_path to 'public', 'extensions'");
  });

  it('re-asserts grants: revoke from public, anon, authenticated, then grant both browser roles', () => {
    expect(sql).toContain(
      'revoke all on function public.bank_paper_questions(text) from public, anon, authenticated;',
    );
    expect(sql).toContain(
      'grant execute on function public.bank_paper_questions(text) to anon, authenticated;',
    );
  });

  it('adds the supporting index without CONCURRENTLY (not allowed in a migration transaction)', () => {
    expect(sql).toContain('create index if not exists audit_questions_live_q_updated_idx');
    expect(sql).toContain('(live_bank_question_id, updated_at desc)');
    expect(sql).not.toMatch(/concurrently/i);
  });

  it('contains no em or en dashes', () => {
    expect(raw).not.toMatch(/[–—]/);
  });
});

describe('maths unhold data script', () => {
  const script = readFileSync('scripts/maths-unhold-papers.sql', 'utf8');
  const code = script.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('targets only published Mathematics papers that are held, and logs an undoable revision', () => {
    expect(code).toContain("subject = 'Mathematics'");
    expect(code).toContain('and is_published');
    expect(code).toContain('and needs_review');
    expect(code).toContain("'bank_papers', t.id, 'admin_edit', 'needs_review'");
    expect(code).toContain("'true'::jsonb, 'false'::jsonb");
    expect(code).toContain("'system:owner-approved-2026-09-30', 'system'");
    expect(code).toContain('set needs_review = false');
    expect(script).not.toMatch(/[–—]/);
  });
});
