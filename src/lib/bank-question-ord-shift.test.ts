import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* bank_questions has UNIQUE (paper_id, ord) and it is NOT deferrable, so
   Postgres checks it row by row. A one-statement range shift like
     update public.bank_questions set ord = ord + 1 where ... and ord > x
   collides with the next row and fails with 23505. That broke every split
   and insert on a live paper until 20260928200000. These tests read the
   migrations as text: no database is touched. */

const DIR = 'supabase/migrations';
const stripComments = (sql: string) =>
  sql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

/* Latest definition of every public function, replaying migrations in order. */
function latestDefinitions(): Map<string, string> {
  const defs = new Map<string, string>();
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = stripComments(readFileSync(`${DIR}/${file}`, 'utf8'));
    const re = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      // The body runs from its opening dollar-quote tag ($function$, $$, ...)
      // to the matching close, whatever tag this definition happens to use.
      const open = /\bas\s+(\$\w*\$)/i.exec(sql.slice(m.index));
      if (!open) continue;
      const bodyStart = m.index + open.index + open[0].length;
      const end = sql.indexOf(open[1], bodyStart);
      if (end < 0) continue;
      defs.set(m[1], sql.slice(m.index, end));
    }
  }
  return defs;
}

/* One statement that moves a RANGE of bank_questions rows up by a constant. */
const ONE_STEP_RANGE_SHIFT =
  /update\s+public\.bank_questions\s+set\s+ord\s*=\s*ord\s*\+\s*\d+[^;]*\bord\s*>/i;

describe('bank_questions ord shifts', () => {
  const defs = latestDefinitions();

  /* Parking the tail far out of range (+1000000, guarded against rows that
     are already there) and bringing it back is the other safe two-step form;
     english_open_ord_gap (20260928190000) uses it. */
  const PARKS_OUT_OF_RANGE = (body: string) =>
    /set\s+ord\s*=\s*ord\s*\+\s*1000000/i.test(body) &&
    /set\s+ord\s*=\s*ord\s*-\s*999999/i.test(body) &&
    /ord\s*>=\s*1000000\)\s*then\s*raise/i.test(body.replace(/\s+/g, ' '));

  it('no current function shifts a range of bank_questions.ord in one statement', () => {
    const offenders = [...defs]
      .filter(([, body]) => ONE_STEP_RANGE_SHIFT.test(body) && !PARKS_OUT_OF_RANGE(body))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it('english_open_ord_gap parks out of range and refuses when rows are already there', () => {
    const body = defs.get('english_open_ord_gap') ?? '';
    expect(PARKS_OUT_OF_RANGE(body)).toBe(true);
  });

  for (const name of ['apply_live_copy_paper_to_live', 'admin_split_bank_question', 'admin_add_bank_question']) {
    it(`${name} parks the tail below zero, then flips it back`, () => {
      const body = defs.get(name);
      expect(body).toBeDefined();
      expect(body).toMatch(/update public\.bank_questions set ord = -\(ord \+ 1\)\s+where paper_id = \w+(\.\w+)? and ord > \w+(\.\w+)?;/);
      expect(body).toMatch(/update public\.bank_questions set ord = -ord\s+where paper_id = \w+(\.\w+)? and ord < 0;/);
      expect(body).toMatch(/perform pg_advisory_xact_lock\(hashtext\(/);
    });
  }
});

describe('the ord-shift fix migration', () => {
  const sql = stripComments(readFileSync(`${DIR}/20260928200000_fix_bank_question_ord_shift.sql`, 'utf8'));

  /* The grant trap (CLAUDE.md): revoke from public, anon AND authenticated. */
  it('restates the lockdown exactly as 20260928000000 set it', () => {
    expect(sql).toMatch(/revoke all on function public\.apply_live_copy_paper_to_live\(uuid\) from public, anon, authenticated;/);
    expect(sql).not.toMatch(/grant[^;]*apply_live_copy_paper_to_live/i);
    for (const sig of ['admin_split_bank_question\\(text, int\\)', 'admin_add_bank_question\\(text, int, text, numeric, text\\)']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${sig} from public, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${sig} to authenticated;`));
    }
  });

  it('never grants anything to anon', () => {
    expect(sql).not.toMatch(/grant[^;]*\banon\b/i);
  });

  it('keeps both admin functions admin-checked and definer', () => {
    for (const name of ['admin_split_bank_question', 'admin_add_bank_question']) {
      const body = sql.slice(sql.indexOf(`function public.${name}(`));
      const head = body.slice(0, body.indexOf('$function$;'));
      expect(head).toMatch(/security definer/);
      expect(head).toMatch(/set search_path to 'public'/);
      expect(head).toMatch(/if not public\.is_admin\(\) then\s+raise exception 'Not authorized' using errcode = '42501';/);
    }
  });
});
