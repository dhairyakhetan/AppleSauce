import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261003160000_checker_lanes_pictures_lost_text.sql cannot run in CI (no
   database), so its load-bearing lines are pinned here: the grant trap from
   CLAUDE.md, "no picture, no student", and the lost-text rule. */

const raw = readFileSync('supabase/migrations/20261003160000_checker_lanes_pictures_lost_text.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('checker lanes migration', () => {
  it('closes the helpers to every client role, by name', () => {
    for (const f of ['checker_has_picture(public.audit_questions)', 'checker_body_ok(public.audit_questions)']) {
      expect(sql, f).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(sql, f).not.toMatch(new RegExp(`grant execute on function public\\.${f.replace(/[()]/g, '\\$&')}`));
    }
  });

  it('keeps checker_next_question open to authenticated only', () => {
    expect(sql).toContain('revoke all on function public.checker_next_question() from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.checker_next_question() to authenticated;');
    expect(sql).not.toContain('to anon');
    expect(sql).toContain('if not public.is_paper_checker() then');
  });

  it('serves only a question with a picture, in the pick, the claim and the counts', () => {
    expect(sql.match(/public\.checker_has_picture\(/g)!.length).toBeGreaterThanOrEqual(5); // definition, revoke, 3 uses
    expect(sql).toContain('public.checker_has_picture(aq)');
    expect(sql).toContain('public.checker_has_picture(r)');
    expect(sql).toContain('public.checker_has_picture(aqu)');
  });

  it('counts a crop only when trusted, and a page only when verified and registered', () => {
    expect(sql).toContain('>= 0.9');
    expect(sql).toContain("p_q.source ->> 'page_verified' = 'true'");
    expect(sql).toContain('public.audit_paper_pages');
  });

  it('lets a blank body through only with an AI transcription', () => {
    expect(sql).toContain("like '%suggestion: {%body%'");
    expect(sql).toContain('public.checker_body_ok(aq)');
    expect(sql).toContain('public.checker_body_ok(aqu)');
    expect(sql).not.toMatch(/btrim\(coalesce\(aq\.body/);
  });
});
