import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Owner, 19 Nov 2026: "if it is with a checker it should be able to raise with hod and send to ai, even if it live maths
   paper". A checker's request on a live Maths copy used to vanish: the HOD desk skipped those papers completely. The
   migration cannot run in CI (no database), so the rules that matter are pinned here, in the file's own words. */

const sql = readFileSync('supabase/migrations/20261119400000_hod_live_copy_requests.sql', 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

function body(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const end = sql.indexOf('$function$;', sql.indexOf('as $function$', start) + 14);
  return sql.slice(start, end);
}

const FIVE = [
  'hod_needs_you_papers()',
  'hod_needs_you_questions(uuid)',
  'hod_desk_counts()',
  'hod_set_question_state(uuid, text, text)',
  'hod_ai_redo_decide(uuid, boolean, text)',
];

describe('20261119400000_hod_live_copy_requests.sql', () => {
  it('replaces exactly the five functions, and every one still checks for an HOD', () => {
    for (const name of ['hod_needs_you_papers', 'hod_needs_you_questions', 'hod_desk_counts', 'hod_set_question_state', 'hod_ai_redo_decide']) {
      const b = body(name);
      expect(b, name).toMatch(/not public\.is_hod\(\)/);
      expect(b, name).toContain("'42501'");
    }
    expect((sql.match(/create or replace function/g) ?? []).length).toBe(5);
  });

  it('closes every one to visitors the day it is written, and opens it to signed-in people', () => {
    for (const f of FIVE) {
      // Every regex special character is escaped, backslash included.
      const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${esc} from public, anon, authenticated`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${esc} to authenticated`));
    }
  });

  it('no longer refuses a live Maths copy when passing, leaving out, or saying yes or no to the AI', () => {
    for (const name of ['hod_needs_you_papers', 'hod_needs_you_questions', 'hod_desk_counts', 'hod_set_question_state', 'hod_ai_redo_decide']) {
      expect(body(name), name).not.toContain('is frozen and is not part of the HOD desk');
    }
    expect(body('hod_set_question_state')).not.toContain('live_copy');
    expect(body('hod_ai_redo_decide')).not.toContain('live_copy');
    expect(body('hod_needs_you_questions')).not.toMatch(/raise exception[^;]*live Maths copy/);
  });

  it('shows a live Maths copy only for the questions a checker sent up, never the computer-flagged ones', () => {
    expect(body('hod_needs_you_papers')).toContain("(p2.source <> 'live_copy' or q.review_bucket = 'escalated')");
    expect(body('hod_needs_you_questions')).toContain("(v_source <> 'live_copy' or q.review_bucket = 'escalated')");
    expect(body('hod_desk_counts')).toContain("(ap.source <> 'live_copy' or q.review_bucket = 'escalated')");
  });

  it('counts the same questions the list shows, so the badge and the list agree', () => {
    const papers = body('hod_needs_you_papers');
    const counts = body('hod_desk_counts');
    for (const part of ["q.review_bucket in ('escalated', 'admin')", "approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open'"]) {
      expect(papers).toContain(part);
      expect(counts).toContain(part);
    }
  });

  it('still keeps live Maths copies out of publishing and Ready to go live', () => {
    expect(body('hod_desk_counts')).toContain("ap.approval_state = 'awaiting' and ap.source <> 'live_copy'");
  });

  it('does not touch hod_edit_question, so a question that is already live still needs an admin to change its words', () => {
    expect(sql).not.toContain('hod_edit_question(');
  });

  it('never writes the live questions or papers itself', () => {
    expect(sql).not.toMatch(/\b(insert into|update|delete from)\s+public\.(bank_questions|bank_papers)\b/i);
    expect(sql).not.toMatch(/\bdrop (table|function)\b/i);
  });

  it('checks the changes at the bottom, four lines', () => {
    expect((sql.match(/\bunion all\b/g) ?? []).length).toBe(3);
  });
});
