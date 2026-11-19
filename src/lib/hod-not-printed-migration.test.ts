import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261105000000_hod_not_printed_flags.sql cannot run in CI (no database), so its load-bearing
   lines are pinned here. The HOD may say a printed paper has no general instructions or no time
   allowed; only then does that one blank pass the details check. Every other required detail still
   blocks, and the banner count function stays closed to everyone but an HOD. */

const raw = readFileSync('supabase/migrations/20261105000000_hod_not_printed_flags.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

function body(fn: string): string {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  expect(start).toBeGreaterThan(-1);
  const next = sql.indexOf('create or replace function', start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

describe('hod_update_publish_meta', () => {
  const b = body('hod_update_publish_meta');
  it('accepts the two flags and treats them as strict yes/no like is_board_paper', () => {
    expect(b).toContain("'instructions_not_printed', 'time_not_printed'];");
    expect(b).toContain("p_field in ('is_board_paper', 'has_school', 'instructions_not_printed', 'time_not_printed')");
    expect(b).toContain("raise exception 'Choose yes or no.'");
  });
  it('keeps the HOD gate, the frozen-copy refusal, the approved refusal and the audit row', () => {
    expect(b).toContain('if not public.is_hod() then');
    expect(b).toContain("errcode = '42501'");
    expect(b).toContain("v_p.source = 'live_copy'");
    expect(b).toContain("v_p.approval_state = 'approved'");
    expect(b).toContain("'hod_edit_publish_meta'");
  });
});

describe('approval_header_values', () => {
  const b = body('approval_header_values');
  it('exposes both flags and defaults them to false', () => {
    expect(b).toMatch(/'instructions_not_printed', coalesce\(case when \(p\.publish_meta ->> 'instructions_not_printed'\) in \('true', 'false'\)/);
    expect(b).toMatch(/'time_not_printed', coalesce\(case when \(p\.publish_meta ->> 'time_not_printed'\) in \('true', 'false'\)/);
    // is_board_paper plus the two new flags default to false (has_school defaults to true).
    expect(b.match(/end, false\)/g)?.length).toBe(3);
  });
});

describe('approval_paper_checks', () => {
  const b = body('approval_paper_checks');
  it('lets a missing time pass only when time_not_printed is true', () => {
    expect(b).toMatch(/jsonb_typeof\(v_hdr -> 'allowed_time_minutes'\) <> 'number'\)\s+and not coalesce\(\(v_hdr ->> 'time_not_printed'\)::boolean, false\)/);
  });
  it('lets missing instructions pass only when instructions_not_printed is true', () => {
    expect(b).toMatch(/nullif\(v_hdr ->> 'general_instructions', ''\) is null\s+and not coalesce\(\(v_hdr ->> 'instructions_not_printed'\)::boolean, false\)/);
  });
  it('still requires school, class, subject, board, year, exam and total marks unconditionally', () => {
    for (const k of ['school', 'cls', 'subject', 'board', 'year', 'exam']) {
      expect(b).toContain(`if nullif(v_hdr ->> '${k}', '') is null then`);
    }
    expect(b).toContain("if v_hdr -> 'marks' is null or jsonb_typeof(v_hdr -> 'marks') <> 'number' then");
  });
  it('keeps the four checks, the AI-only rule and the picture check', () => {
    for (const k of ['questions_checked', 'pictures_present', 'header_complete', 'scanner_junk_gone']) {
      expect(b).toContain(`'key', '${k}'`);
    }
    expect(b).toContain('approval_person_verdict');
    expect(b).toContain("(q.figure ->> 'path') is null");
  });
});

describe('hod_unqueued_papers_count', () => {
  const b = body('hod_unqueued_papers_count');
  it('is an HOD-only read of pipeline papers not yet queued, checked, and not parked for re-segmenting', () => {
    expect(b).toContain('if not public.is_hod() then');
    expect(b).toContain("ap.source = 'new_ocr'");
    expect(b).toContain('ap.live_bank_paper_id is null');
    expect(b).toContain('ap.approval_state is null');
    expect(b).toContain('not coalesce(ap.is_red, false)');
    expect(b).toContain('q.question_passed');
    expect(b).toContain('q.set_aside_at is null');
  });
  it('is closed to public, anon and authenticated, then granted to authenticated only', () => {
    expect(sql).toContain('revoke all on function public.hod_unqueued_papers_count() from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.hod_unqueued_papers_count() to authenticated;');
    expect(sql).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
  });
});
