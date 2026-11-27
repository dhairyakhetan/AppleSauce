import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Pins the shape of 20261127120000_review_log_skip_picture_paths.sql (string assertions, the same way the other
 * migration tests in this folder work: no typecheck or lint rule can see inside a SQL string).
 *
 * Owner, 27 Nov 2026: the database was at 491 MB of 500 MB. 46,983 of 56,269 'ai_verdict' log rows only recorded a
 * picture path changing. The trigger now skips those, and the hand-out timer (which only does the 7-day return)
 * runs hourly.
 */

const MIGRATION = 'supabase/migrations/20261127120000_review_log_skip_picture_paths.sql';

describe('the review-log skip-picture-paths migration', () => {
  /* Comments stripped so prose in the header can never be mistaken for the SQL itself. */
  const sql = readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const listed = (sql.match(/v_picture_keys constant text\[\] := array\[([^\]]*)\]/)?.[1] ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);

  describe('the skip rule', () => {
    it('replaces the existing trigger function and keeps the trigger on source changes only', () => {
      expect(sql).toMatch(/create or replace function public\.trg_log_audit_question_ai_verdict\(\)/);
      expect(sql).toMatch(/create trigger audit_question_log_ai_verdict\s+after update on public\.audit_questions/);
      expect(sql).toMatch(/when \(new\.source is distinct from old\.source\)/);
    });

    it('still writes the ai_verdict row for any other change in source', () => {
      expect(sql).toMatch(
        /values \(null, null, new\.paper_id, new\.id, 'ai_verdict', 'source', old\.source, new\.source\)/,
      );
      // The skip only happens when NO key outside the list changed.
      expect(sql).toMatch(
        /where \(old\.source -> all_keys\.k\) is distinct from \(new\.source -> all_keys\.k\)\s+and not \(all_keys\.k = any \(v_picture_keys\)\)/,
      );
      expect(sql).toMatch(/if v_only_picture then\s+return new;/);
    });

    it('logs anyway when source is not a JSON object on both sides', () => {
      expect(sql).toMatch(/jsonb_typeof\(old\.source\) = 'object' and jsonb_typeof\(new\.source\) = 'object'/);
    });

    it('lists the picture and page bookkeeping keys the pipeline writes', () => {
      for (const key of [
        'snippet_path', 'snippet_object', 'whole_snippet_object', 'whole_snippet_members', 'align_score',
        'page', 'bbox', 'dpi', 'page_verified', 'page_match_score', 'page_method', 'page_before_locate',
        'page_from', 'page_found_by', 'page_find_score', 'page_find_method', 'picture_rule',
      ]) {
        expect(listed).toContain(key);
      }
    });

    it('never lists a content or AI-verdict key as bookkeeping', () => {
      for (const key of ['body', 'options', 'answer', 'text', 'marks', 'rescue_decision', 'pipeline', 'flag_reasons', 'instructions']) {
        expect(listed).not.toContain(key);
      }
    });

    it('does not weaken the function permissions or the failure guard', () => {
      expect(sql).toMatch(
        /revoke all on function public\.trg_log_audit_question_ai_verdict\(\) from public, anon, authenticated/,
      );
      expect(sql).toMatch(/exception when others then\s+raise warning 'audit_question ai_verdict log skipped: %', sqlerrm/);
    });
  });

  describe('the timer', () => {
    it('moves distribute-unassigned-papers to hourly, same job name and same command', () => {
      expect(sql).toContain(
        "select cron.schedule('distribute-unassigned-papers', '0 * * * *', 'select public.distribute_unassigned_papers_cron()');",
      );
      expect(sql).not.toContain('*/2 * * * *');
    });

    it('is still true that the timer only does the 7-day return (so hourly is safe)', () => {
      const cron = readFileSync('supabase/migrations/20261126100000_assign_only_on_button.sql', 'utf8');
      const body = cron
        .split('create or replace function public.distribute_unassigned_papers_cron()')[1]
        .split('$function$;')[0];
      expect(body).toContain('perform public.verifier_return_idle();');
      expect(body).not.toContain('public.distribute_unassigned_papers()');
    });
  });

  it('touches no data row', () => {
    expect(sql).not.toMatch(/\b(delete from|truncate|drop table|update public\.)/i);
  });
});
