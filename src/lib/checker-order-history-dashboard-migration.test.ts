import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Pins the two things that are easy to silently regress in
 * supabase/migrations/20260929120000_checker_order_history_dashboard.sql:
 *
 *   1. Every new/replaced function is revoked from public/anon/authenticated
 *      and then granted only to authenticated (CLAUDE.md's "trap": Supabase
 *      grants EXECUTE to anon/authenticated by role name on every new
 *      function, so a bare `revoke ... from public` is not enough).
 *   2. checker_next_question never references an OUT-parameter name
 *      (id, paper_id, ord, display_number, number_path, body, options,
 *      marks, instructions, flag_reasons, flag_detail, source, subject,
 *      school, cls, exam, year) unqualified inside its claiming UPDATE --
 *      an unqualified `body` there took the live checker down for a whole
 *      day (hotfixed in 20260929110000_checker_next_question_body_ambiguity.sql).
 *      This is a regex over the SQL text, not a real Postgres parse, so it
 *      checks "as far as practical": the claiming UPDATE's own WHERE/SET/
 *      RETURNING clause, which is where the real bug lived.
 */

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20260929120000_checker_order_history_dashboard.sql'),
  'utf-8',
);

const OUT_PARAM_NAMES = [
  'id',
  'paper_id',
  'ord',
  'display_number',
  'number_path',
  'body',
  'options',
  'marks',
  'instructions',
  'flag_reasons',
  'flag_detail',
  'source',
  'subject',
  'school',
  'cls',
  'exam',
  'year',
];

const NEW_OR_REPLACED_FUNCTIONS = [
  { name: 'checker_next_question', args: '' },
  { name: 'admin_question_history', args: 'uuid' },
  { name: 'admin_team_stats', args: 'timestamptz, timestamptz' },
  { name: 'admin_paper_progress', args: '' },
];

describe('20260929120000_checker_order_history_dashboard.sql', () => {
  it('revokes every new/replaced function from public, anon and authenticated before re-granting', () => {
    for (const fn of NEW_OR_REPLACED_FUNCTIONS) {
      const revokePattern = new RegExp(
        `revoke all on function public\\.${fn.name}\\([^)]*\\) from public, anon, authenticated;`,
      );
      expect(SQL, `missing revoke-all for ${fn.name}`).toMatch(revokePattern);

      const grantPattern = new RegExp(`grant execute on function public\\.${fn.name}\\([^)]*\\) to authenticated;`);
      expect(SQL, `missing grant-to-authenticated for ${fn.name}`).toMatch(grantPattern);
    }
  });

  it('also revokes the two new trigger functions from public, anon and authenticated', () => {
    for (const fn of ['trg_log_audit_question_created', 'trg_log_audit_question_ai_verdict']) {
      const pattern = new RegExp(`revoke all on function public\\.${fn}\\(\\) from public, anon, authenticated;`);
      expect(SQL, `missing revoke-all for ${fn}`).toMatch(pattern);
    }
  });

  it('gates every new admin function on is_admin(), and the checker function on is_paper_checker()', () => {
    expect(SQL).toMatch(/checker_next_question[\s\S]{0,800}is_paper_checker\(\)/);
    expect(SQL).toMatch(/admin_question_history[\s\S]{0,400}is_admin\(\)/);
    expect(SQL).toMatch(/admin_team_stats[\s\S]{0,400}is_admin\(\)/);
    expect(SQL).toMatch(/admin_paper_progress[\s\S]{0,400}is_admin\(\)/);
  });

  it('sets search_path to public on every new/replaced function', () => {
    const setSearchPathCount = (SQL.match(/set search_path to 'public'/g) ?? []).length;
    // checker_next_question, trg_log_audit_question_created,
    // trg_log_audit_question_ai_verdict, admin_question_history,
    // admin_team_stats, admin_paper_progress
    expect(setSearchPathCount).toBeGreaterThanOrEqual(6);
  });

  it("qualifies every OUT-parameter name inside checker_next_question's claiming UPDATE", () => {
    const updateMatch = SQL.match(/update public\.audit_questions\s+set locked_by[\s\S]*?into v_claimed_id;/);
    expect(updateMatch, 'could not find the claiming UPDATE statement').not.toBeNull();
    const updateBlock = updateMatch![0];

    for (const name of OUT_PARAM_NAMES) {
      // Every occurrence of this bare word in the block must be immediately
      // preceded by a qualifier (a dot), e.g. "public.audit_questions.body"
      // or "aq.body" -- never a bare "body" on its own that could resolve to
      // the plpgsql OUT-parameter variable of the same name.
      const bareWordPattern = new RegExp(`(?<![.\\w])${name}(?!\\w)`, 'g');
      const matches = [...updateBlock.matchAll(bareWordPattern)];
      for (const m of matches) {
        const start = m.index ?? 0;
        const precedingChar = updateBlock[start - 1];
        expect(
          precedingChar === '.',
          `unqualified "${name}" found in the claiming UPDATE at "...${updateBlock.slice(Math.max(0, start - 30), start + name.length + 5)}..."`,
        ).toBe(true);
      }
    }
  });

  it('keeps the fewest-open-doubts count scoped to review_bucket = kid, unpassed, non-blank rows', () => {
    const ctePattern = /paper_open_counts as \([\s\S]*?\) as open_count\s*from paper_ids p\s*\)/;
    const cte = SQL.match(ctePattern);
    expect(cte, 'could not find paper_open_counts CTE').not.toBeNull();
    const block = cte![0];
    expect(block).toContain("review_bucket = 'kid'");
    expect(block).toContain('question_passed = false');
    expect(block).toContain("btrim(coalesce(r.body, '')) <> ''");
  });

  it('does NOT double-log skips: admin_question_history merges audit_review_log and bank_question_revisions only', () => {
    const fnMatch = SQL.match(/create or replace function public\.admin_question_history[\s\S]*?\$function\$;/);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];
    expect(body).toContain('from public.audit_review_log l');
    expect(body).toContain('from public.bank_question_revisions r');
    expect(body).not.toContain('audit_question_skips');
  });

  it.each(['trg_log_audit_question_created', 'trg_log_audit_question_ai_verdict'])(
    '%s guards its log insert so a logging failure never aborts the pipeline write',
    (fn) => {
      const m = SQL.match(new RegExp(`create or replace function public\\.${fn}\\(\\)[\\s\\S]*?\\$function\\$;`));
      expect(m).not.toBeNull();
      expect(m![0]).toMatch(/begin\s+insert into public\.audit_review_log[\s\S]*?exception when others then\s+raise warning/);
    },
  );
});
