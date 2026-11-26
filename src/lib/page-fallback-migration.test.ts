import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261126200000_page_fallback_when_not_found.sql cannot run in CI (no database), so its load-bearing lines are
   pinned here (owner, 26 Nov 2026: "If you can't find the question on the paper, just fall back to showing the
   pages"). A question whose page was looked for and not found now has a picture when every printed page of its
   paper is stored; checker_has_picture and checker_reference_ok keep every rule they had and gain one "or". */

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const raw = read('supabase/migrations/20261126200000_page_fallback_when_not_found.sql');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

function fn(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$function$;', start);
  return sql.slice(start, end);
}

const allStored = fn('paper_all_pages_stored');
const fallback = fn('checker_page_fallback_ok');
const hasPicture = fn('checker_has_picture');
const refOk = fn('checker_reference_ok');
const oldHasPicture = read('supabase/migrations/20261003160000_checker_lanes_pictures_lost_text.sql');
const oldRefOk = read('supabase/migrations/20261103000000_reference_pages_before_serving.sql');

/** The body between the $function$ markers, from a file's first definition of `name`. */
function bodyOf(text: string, name: string): string {
  const start = text.indexOf(`create or replace function public.${name}(`);
  const open = text.indexOf('$function$', start) + '$function$'.length;
  return text.slice(open, text.indexOf('$function$', open)).trim();
}

describe('paper_all_pages_stored', () => {
  it('needs a known page count and every page 1..page_count stored', () => {
    expect(allStored).toContain('coalesce(ap.page_count, 0) > 0');
    expect(allStored).toContain('count(distinct pg.page)');
    expect(allStored).toContain('pg.page between 1 and ap.page_count) = ap.page_count');
    expect(allStored).toContain("coalesce(pg.object_path, '') <> ''");
    // an unknown paper is "not stored", never null
    expect(allStored).toMatch(/select coalesce\(\(/);
    expect(allStored).toMatch(/\), false\);\s*$/);
  });

  it('reads the tables only, so it cannot loop back through the picture rule', () => {
    for (const other of ['checker_has_picture', 'paper_pictures_complete', 'paper_picture_gaps', 'checker_page_fallback_ok']) {
      expect(allStored, other).not.toContain(other);
    }
    expect(fallback).not.toContain('paper_pictures_complete');
    expect(fallback).not.toContain('paper_picture_gaps');
    expect(fallback).not.toContain('checker_has_picture');
  });
});

describe('checker_page_fallback_ok', () => {
  it('is the page looked for and not found, plus every page stored', () => {
    expect(fallback).toContain("coalesce(p_q.source ->> 'page_verified', '') = 'false'");
    expect(fallback).toContain('public.paper_all_pages_stored(p_q.paper_id)');
    // a page never looked for (no page_verified) is not covered: the pipeline locates it first
    expect(fallback).not.toContain("is null");
  });
});

describe('both helpers', () => {
  it('are stable, security definer, with a pinned search path', () => {
    for (const f of [allStored, fallback]) {
      expect(f).toMatch(/language sql\s+stable\s+security definer/);
      expect(f).toContain("set search_path to 'public', 'pg_temp'");
    }
  });

  it('are closed to public, anon AND authenticated, and granted to no one', () => {
    expect(sql).toContain('revoke all on function public.paper_all_pages_stored(uuid) from public, anon, authenticated;');
    expect(sql).toContain(
      'revoke all on function public.checker_page_fallback_ok(public.audit_questions) from public, anon, authenticated;',
    );
    expect(sql).not.toMatch(/\bgrant\b/i);
  });
});

describe('checker_has_picture', () => {
  it('keeps the 20261003160000 body word for word and adds the fallback as the last "or"', () => {
    const before = bodyOf(oldHasPicture, 'checker_has_picture').replace(/;$/, '');
    const after = bodyOf(sql, 'checker_has_picture');
    expect(after).toBe(`${before}\n    or public.checker_page_fallback_ok(p_q);`);
  });

  it('stays security definer and closed to every client role', () => {
    expect(hasPicture).toMatch(/language sql\s+stable\s+security definer/);
    expect(sql).toContain('revoke all on function public.checker_has_picture(public.audit_questions) from public, anon, authenticated;');
  });
});

describe('checker_reference_ok', () => {
  it('keeps the 20261103000000 body word for word and adds the fallback as the last "or"', () => {
    const before = bodyOf(oldRefOk, 'checker_reference_ok').replace(/;$/, '');
    const after = bodyOf(sql, 'checker_reference_ok');
    expect(after).toBe(`${before}\n      or public.checker_page_fallback_ok(p_q);`);
  });

  it('is not made security definer, and stays closed (20261105100000)', () => {
    expect(refOk).not.toMatch(/security definer/i);
    expect(sql).toContain('revoke all on function public.checker_reference_ok(public.audit_questions) from public, anon, authenticated;');
  });
});

describe('the whole file', () => {
  it('changes nothing else: no drop, exactly four functions', () => {
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect((sql.match(/create or replace function/g) ?? []).length).toBe(4);
    expect(sql).not.toContain('checker_question_servable');
    expect(sql).not.toContain('paper_pictures_complete');
  });
});
