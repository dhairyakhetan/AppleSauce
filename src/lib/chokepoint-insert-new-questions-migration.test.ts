import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Pins the shape of 20260929150000_chokepoint_insert_new_questions.sql.
 *
 * apply_live_copy_paper_to_live() used to update existing bank_questions rows
 * and insert only split children; a passed audit question with no live row and
 * no split parent (a hidden empty paper refilled through the pipeline) was
 * never inserted, so the paper cleared needs_review but stayed empty and the
 * auto-return block never fired. The migration adds a "Pass 0" that inserts
 * those rows. No typecheck or lint rule can see inside a SQL string that is
 * `execute`d from a patched pg_get_functiondef() text, so this is a string
 * assertion, like auto-return-lease-timing-migration.test.ts.
 *
 * The rollback probes that proved the behaviour live are recorded in the
 * commit messages; this test only stops the key lines being edited away.
 */

const MIGRATION = 'supabase/migrations/20260929150000_chokepoint_insert_new_questions.sql';

describe('the chokepoint insert-new-questions migration', () => {
  /* Comments stripped so prose (the header names every column and action)
     can never be mistaken for the SQL itself. */
  const sql = readFileSync(MIGRATION, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('patches the live definition in place', () => {
    expect(sql).toMatch(/pg_get_functiondef\('public\.apply_live_copy_paper_to_live\(uuid\)'::regprocedure\)/);
    expect(sql).toMatch(/replace\(d, v_pass1_anchor, v_pass0 \|\| v_pass1_anchor\)/);
  });

  it('refuses to apply twice, and unless every anchor occurs exactly once', () => {
    expect(sql).toMatch(/if position\('Pass 0 \(owner 2026-09-29\)' in d\) > 0 then/);
    expect(sql).toMatch(/Pass 0 already present, refusing to apply twice/);
    expect(sql).toMatch(
      /foreach v_x in array array\[v_declare_anchor, v_pass1_anchor, v_needs_anchor, v_return_anchor\] loop/,
    );
    expect(sql).toMatch(/\(length\(d\) - length\(replace\(d, v_x, ''\)\)\) \/ length\(v_x\) <> 1/);
    expect(sql).toMatch(/anchor not found exactly once/);
  });

  it('runs before the split pass, so a split child of a new parent can be placed', () => {
    expect(sql).toContain('Pass 1: split halves that have no live row yet (fix #3)');
    expect(sql).toMatch(/v_pass0 \|\| v_pass1_anchor/);
  });

  it('selects exactly the passed, unlinked, unsplit, non-null-body question rows in audit order', () => {
    expect(sql).toMatch(
      /and kind = 'question'\s+and question_passed = true\s+and live_bank_question_id is null\s+and split_from_id is null\s+and body is not null\s+order by ord, id/,
    );
  });

  it('copies the body byte-exact, never trimmed or normalised', () => {
    expect(sql).toMatch(/v_q\.body, v_q\.marks, v_q\.chapter, v_q\.answer_key/);
    expect(sql).not.toMatch(/\b(btrim|trim|ltrim|rtrim|lower|upper|regexp_replace|translate)\s*\(\s*v_q\.body/i);
    expect(sql).not.toMatch(/replace\s*\(\s*v_q\.body/i);
  });

  it('ties the insert column list to the values list, position for position', () => {
    const m = sql.match(
      /insert into public\.bank_questions \(([^)]*)\)\s+values \(([\s\S]*?)\);\n/,
    );
    expect(m).not.toBeNull();
    const cols = m![1].split(',').map((s) => s.trim());
    const vals = m![2].split(',').map((s) => s.trim());
    expect(cols).toEqual([
      'id', 'paper_id', 'ord', 'number', 'display_number', 'body', 'marks',
      'chapter', 'answer_key', 'qtype', 'page', 'figure', 'options',
    ]);
    expect(vals).toEqual([
      'v_new_live_id', 'v_live_paper_id', 'v_anchor_ord + 1', 'v_q.display_number', 'v_q.display_number',
      'v_q.body', 'v_q.marks', 'v_q.chapter', 'v_q.answer_key', 'null', 'null', 'null', 'null',
    ]);
    expect(vals).toHaveLength(cols.length);
  });

  it('derives the id from the audit row uuid, like the split branch, and is idempotent', () => {
    expect(sql).toMatch(/v_new_live_id := v_live_paper_id \|\| '-n-' \|\| left\(replace\(v_q\.id::text, '-', ''\), 12\)/);
    expect(sql).toMatch(/if exists \(select 1 from public\.bank_questions where id = v_new_live_id and paper_id = v_live_paper_id\)/);
  });

  it('places the row after the nearest preceding live row (ties broken by id), or first, with the two-step shift', () => {
    expect(sql).toMatch(/and \(a\.ord, a\.id\) < \(v_q\.ord, v_q\.id\)\s+order by a\.ord desc, a\.id desc\s+limit 1/);
    expect(sql).toMatch(/v_anchor_ord := coalesce\(v_anchor_ord, -1\)/);
    expect(sql).toMatch(/set ord = -\(ord \+ 1\)\s+where paper_id = v_live_paper_id and ord > v_anchor_ord/);
    expect(sql).toMatch(/set ord = -ord\s+where paper_id = v_live_paper_id and ord < 0/);
  });

  it('records the new id on the audit row and logs each insert as live_apply', () => {
    expect(sql).toMatch(/update public\.audit_questions set live_bank_question_id = v_new_live_id where id = v_q\.id/);
    expect(sql).toMatch(/values \('bank_questions', v_new_live_id, 'live_apply', null, null, v_new_row/);
  });

  it('resyncs question_count unconditionally, after Pass 2 and before the needs_review block', () => {
    expect(sql).toMatch(/if v_qc_sync_before is distinct from v_qc_sync_after then/);
    expect(sql).toMatch(/update public\.bank_papers set question_count = v_qc_sync_after where id = v_live_paper_id/);
    expect(sql).toMatch(/'live_apply', 'question_count'/);
    // Not gated on Pass 0 having inserted anything.
    expect(sql).not.toMatch(/if v_inserted > 0 then/);
    // Placement: spliced in front of the needs_review header (which follows
    // Pass 2), and NOT inside the Pass 0 text (which would miss split children).
    expect(sql).toMatch(/replace\(d, v_needs_anchor, v_resync \|\| v_needs_anchor\)/);
    const pass0 = sql.slice(sql.indexOf('v_pass0 text := $p0$'), sql.indexOf('$p0$;', sql.indexOf('v_pass0 text := $p0$') + 20));
    expect(pass0).not.toMatch(/question_count/);
  });

  it('leaves marks alone', () => {
    expect(sql).not.toMatch(/update public\.bank_papers set marks/);
  });

  it('only auto-returns a paper whose questions are all passed', () => {
    expect(sql).toMatch(
      /if v_last_hide_actor = \\'ai:empty-paper-hide\\' and v_total > 0 and v_total = v_passed then/,
    );
  });

  it('restates EXECUTE revoked from public, anon and authenticated, and grants nothing', () => {
    expect(sql).toMatch(
      /revoke all on function public\.apply_live_copy_paper_to_live\(uuid\) from public, anon, authenticated;/,
    );
    expect(sql).not.toMatch(/grant execute on function public\.apply_live_copy_paper_to_live/i);
  });
});
