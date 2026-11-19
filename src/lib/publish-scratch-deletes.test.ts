import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* Owner, 6 Nov 2026: publishing a paper failed with "DELETE requires a WHERE clause" and they said "this is
   what i menat by stress testing logic and suapaabse plumbing sttuff like this shouldnt break".
   The database refuses any DELETE or UPDATE with no WHERE for the website's roles. These tests pin the fix
   and stop a bare scratch-table delete from coming back in a later change. */

const DIR = 'supabase/migrations';
const FIX = '20261106300000_publish_scratch_deletes_need_where.sql';

function code(file: string): string {
  return readFileSync(`${DIR}/${file}`, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

describe('the publish fix (scratch-table deletes get a WHERE)', () => {
  const sql = code(FIX);

  it('patches exactly the two publish functions, by their live argument lists', () => {
    expect(sql).toContain("'approval_publish_paper', 'p_audit_paper_id uuid, p_note text'");
    expect(sql).toContain("'_update_live_paper',     'p_audit_paper_id uuid, p_actor text'");
  });

  it('names all three scratch tables it fixes', () => {
    expect(sql).toContain("array['pg_temp.approval_leaves']");
    expect(sql).toContain("array['pg_temp.live_update_plan', 'pg_temp.live_update_ord']");
  });

  it('adds "where true", refuses to go on if a swap did not happen, and checks the result', () => {
    expect(sql).toContain("'\\1 where true;'");
    expect(sql).toContain("raise exception 'could not fix the delete on");
    expect(sql).toContain("raise exception 'a bare delete is still there");
  });

  it('keeps the live function text (settings and access) instead of writing a new body by hand', () => {
    expect(sql).toContain('pg_get_functiondef(v_oid)');
    expect(sql).toContain('execute v_new');
    expect(sql).not.toMatch(/create or replace function/i);
    expect(sql).not.toMatch(/\b(grant|revoke|drop)\b/i);
  });

  it('touches no table and no row', () => {
    expect(sql).not.toMatch(/\b(insert into|alter table|create table|truncate)\b/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\./i);
  });
});

describe('no migration written from now on may empty a scratch table with a bare DELETE', () => {
  it('every delete from a pg_temp table in a migration dated after the fix has a WHERE', () => {
    const later = readdirSync(DIR).filter((f) => f.endsWith('.sql') && f > FIX);
    const offenders: string[] = [];
    for (const f of later) {
      if (/delete\s+from\s+pg_temp\.\w+\s*;/i.test(code(f))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
