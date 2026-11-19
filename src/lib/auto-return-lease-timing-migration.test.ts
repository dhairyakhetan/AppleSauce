import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Pins the shape of 20260929140000_auto_return_and_lease_timing.sql. No
 * typecheck or lint rule can see inside a SQL string that is `execute`d from
 * a patched pg_get_functiondef() text, so this is a string assertion, the
 * same way bank-sql-grants.test.ts and paper-review-realtime.test.ts guard
 * the migrations that came before it.
 *
 * Two owner-approved changes, 2026-09-29:
 *   1. apply_live_copy_paper_to_live() republishes a paper once it has
 *      questions again, but ONLY when the paper's most recent is_published
 *      revision was the logged 'ai:empty-paper-hide' (369 papers hidden for
 *      having zero questions) -- never a paper hidden for any other reason
 *      (e.g. the 104 rows hidden as 'owner-decision').
 *   2. checker_next_question() stamps audit_questions.leased_at when it
 *      claims a question; a new BEFORE INSERT trigger on audit_review_log
 *      turns that into audit_review_log.seconds_on_question for the four
 *      checker actions; admin_team_stats() reports the per-user median of
 *      that value instead of a hardcoded null, with its RETURNS TABLE
 *      signature untouched.
 */

const MIGRATION = 'supabase/migrations/20260929140000_auto_return_and_lease_timing.sql';

describe('the auto-return and lease-timing migration', () => {
  /* Comments stripped so an explanation in prose (e.g. this file's own
     header, which names every action and column) can never be mistaken for
     the SQL itself. */
  const sql = readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  describe('auto-return', () => {
    it('only fires for the logged empty-paper hide, never any other reason', () => {
      expect(sql).toMatch(/v_last_hide_actor\s*=\s*'ai:empty-paper-hide'/);
      // It reads the MOST RECENT is_published revision for the paper, not
      // just any revision -- an admin-red hide after the empty-paper hide
      // must win.
      expect(sql).toMatch(/order by r\.created_at desc, r\.id desc\s*\n\s*limit 1/);
    });

    it('requires at least one live bank_questions row before republishing', () => {
      expect(sql).toMatch(/select count\(\*\) into v_qcount from public\.bank_questions where paper_id = v_live_paper_id/);
      expect(sql).toMatch(/if v_qcount >= 1 then/);
    });

    it('sets is_published back to true and logs it the same way the hide was logged', () => {
      expect(sql).toMatch(/update public\.bank_papers set is_published = true where id = v_live_paper_id/);
      expect(sql).toContain(
        "values ('bank_papers', v_live_paper_id, 'auto_return', 'is_published',",
      );
      expect(sql).toContain("'system:chokepoint', 'system', p_audit_paper_id,");
      expect(sql).toContain("'auto_return: questions cleared'");
    });

    it('adds auto_return to the closed action enum without dropping an existing action', () => {
      const before = ['admin_edit', 'admin_merge', 'admin_split', 'admin_reorder', 'admin_add',
        'admin_delete', 'admin_hide', 'admin_restore', 'admin_undo', 'live_apply', 'live_clear'];
      for (const action of before) expect(sql).toContain(`'${action}'`);
      expect(sql).toContain("'auto_return'");
    });

    it('patches the live definition and refuses to apply if the anchors are gone', () => {
      expect(sql).toMatch(/pg_get_functiondef\('public\.apply_live_copy_paper_to_live\(uuid\)'::regprocedure\)/);
      expect(sql).toMatch(/raise exception 'apply_live_copy_paper_to_live: declare anchor not found'/);
      expect(sql).toMatch(/raise exception 'apply_live_copy_paper_to_live: end anchor not found'/);
    });

    it('restates the function as revoked from public, anon and authenticated (it has no grantee live)', () => {
      expect(sql).toMatch(/revoke all on function public\.apply_live_copy_paper_to_live\(uuid\) from public, anon, authenticated;/);
    });
  });

  describe('lease timing', () => {
    it('adds a nullable leased_at column and stamps it on claim', () => {
      expect(sql).toMatch(/alter table public\.audit_questions add column if not exists leased_at timestamptz;/);
      // The replacement text lives inside an E'' string in the patch DO
      // block, so its embedded quotes are backslash-escaped literally.
      expect(sql).toContain(
        "locked_until = now() + interval \\'10 minutes\\', leased_at = now()",
      );
      expect(sql).toMatch(/raise exception 'checker_next_question: claiming UPDATE anchor not found'/);
    });

    it('keeps checker_next_question granted only to authenticated', () => {
      expect(sql).toMatch(/revoke all on function public\.checker_next_question\(\) from public, anon, authenticated;/);
      expect(sql).toMatch(/grant execute on function public\.checker_next_question\(\) to authenticated;/);
    });

    it('adds a nullable seconds_on_question column', () => {
      expect(sql).toMatch(/alter table public\.audit_review_log add column if not exists seconds_on_question numeric;/);
    });

    it('computes seconds_on_question only for the four checker actions, qualifying the lookup column', () => {
      expect(sql).toMatch(
        /new\.action in \('checker_pass', 'checker_fix', 'checker_ask_help', 'checker_skip'\)/,
      );
      expect(sql).toMatch(/select public\.audit_questions\.leased_at into v_leased_at/);
      expect(sql).toMatch(/new\.seconds_on_question := extract\(epoch from \(coalesce\(new\.at, now\(\)\) - v_leased_at\)\)/);
    });

    it('never lets a logging failure abort the checker action it rides on', () => {
      /* Same guard as the two triggers fixed in 2916aa4: the lookup is
         wrapped in its own begin/exception, not the trigger's outer one. */
      const trigger = sql.match(/create or replace function public\.trg_audit_review_log_seconds_on_question\(\)[\s\S]*?\$function\$;/)?.[0] ?? '';
      expect(trigger).toMatch(/begin\s*\n\s*select public\.audit_questions\.leased_at/);
      expect(trigger).toMatch(/exception when others then\s*\n\s*raise warning 'audit_review_log seconds_on_question skipped: %', sqlerrm;/);
    });

    it('installs the trigger as BEFORE INSERT so it can set the new column', () => {
      expect(sql).toMatch(/drop trigger if exists audit_review_log_seconds_on_question on public\.audit_review_log;/);
      expect(sql).toMatch(/create trigger audit_review_log_seconds_on_question\s*\n\s*before insert on public\.audit_review_log/);
    });

    it('keeps the trigger function unreachable directly, like its siblings', () => {
      expect(sql).toMatch(/revoke all on function public\.trg_audit_review_log_seconds_on_question\(\) from public, anon, authenticated;/);
    });
  });

  describe('admin_team_stats', () => {
    it('patches the live definition rather than redefining it from scratch', () => {
      expect(sql).toMatch(
        /pg_get_functiondef\('public\.admin_team_stats\(timestamp with time zone, timestamp with time zone\)'::regprocedure\)/,
      );
    });

    it('computes median_seconds as a per-user percentile_cont(0.5) with NULLs dropped', () => {
      expect(sql).toMatch(/percentile_cont\(0\.5\) within group \(order by s\.seconds_on_question\) as median_seconds/);
      expect(sql).toMatch(/and l\.seconds_on_question is not null/);
    });

    it('scopes the median to the same four checker actions and the same window', () => {
      // The CTE text lives inside an E'' string in the patch DO block, so
      // its line breaks and embedded quotes are literal \n and \' escapes,
      // not real characters -- match it as the literal text Postgres will
      // unescape at execute() time.
      expect(sql).toContain(
        "and l.at >= p_from and l.at < p_to\\n      and l.action in (\\'checker_pass\\', \\'checker_fix\\', \\'checker_ask_help\\', \\'checker_skip\\')\\n      and l.seconds_on_question is not null",
      );
    });

    it('replaces the hardcoded null median_seconds with the real column', () => {
      expect(sql).not.toMatch(/select\s*\n\s*pu\.actor_user_id as user_id,[\s\S]*?null::numeric as median_seconds,/);
      // percentile_cont returns double precision; RETURN QUERY needs the declared numeric.
      expect(sql).toMatch(/round\(mb\.median_seconds::numeric, 1\) as median_seconds,/);
    });

    it('left-joins the new median CTE without dropping the existing overturns join', () => {
      expect(sql).toContain(
        'left join overturns ov on ov.actor_user_id = pu.actor_user_id\\n  left join median_by_user mb on mb.actor_user_id = pu.actor_user_id\\n  order by questions_checked desc;',
      );
    });

    it('keeps admin_team_stats granted only to authenticated', () => {
      expect(sql).toMatch(
        /revoke all on function public\.admin_team_stats\(timestamp with time zone, timestamp with time zone\) from public, anon, authenticated;/,
      );
      expect(sql).toMatch(
        /grant execute on function public\.admin_team_stats\(timestamp with time zone, timestamp with time zone\) to authenticated;/,
      );
    });
  });

  it('wraps every DDL statement in one transaction', () => {
    const trimmed = sql.trim();
    expect(trimmed.startsWith('begin;')).toBe(true);
    expect(trimmed.endsWith('commit;')).toBe(true);
  });
});
