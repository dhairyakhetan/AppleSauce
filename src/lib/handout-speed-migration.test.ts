import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { heldOtherWhy, normaliseHeldOther } from '@/lib/hod-api';
import { dataSql, makeDb, ms, read } from './handout-speed-harness';

/* 20261127130000_handout_speed.sql: the hand-out lists and Auto assign all timed out once nearly every paper was
   free (27 Nov 2026). The migration cannot run in CI against the real database, so (1) its load-bearing lines are
   pinned as text and (2) it is run on two empty in-memory Postgres databases (PGlite) holding the SAME seeded
   synthetic data: one with the functions as they are live today, one with the migration. Every list and the
   hand-out must give the same answer row for row. Set aside papers (is_red / status red) are the one intended
   difference. HANDOUT_BENCH=1 runs the same at the size of the live data and prints the timings. */

const raw = read('supabase/migrations/20261127130000_handout_speed.sql');
const sql = raw
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');

function fn(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf('$function$;', start));
}

describe('the website knows the new reason', () => {
  it('shows a set aside paper with its own plain sentence', () => {
    const rows = normaliseHeldOther([{ paper_id: 'p1', subject: 'Maths', open_count: 3, reason: 'set_aside' }]);
    expect(rows[0].reason).toBe('set_aside');
    expect(heldOtherWhy('set_aside')).toMatch(/set aside/);
    expect(heldOtherWhy('set_aside')).not.toMatch(/[–—]/);
  });
});

describe('the migration text', () => {
  it('keeps every door: definer, pinned search path, revoked by name, granted only where it was', () => {
    for (const f of ['paper_handout_facts', 'hod_unassigned_papers', 'hod_held_back_papers', 'hod_held_other_papers', 'distribute_unassigned_papers']) {
      expect(fn(f), f).toMatch(/security definer\s+set search_path (to '|= )public(', '| = |, )pg_temp'?/);
    }
    expect(sql).toContain('revoke all on function public.paper_handout_facts(uuid[]) from public, anon, authenticated;');
    expect(sql).not.toMatch(/grant execute on function public\.paper_handout_facts/);
    for (const [f, a] of [
      ['hod_unassigned_papers', 'integer'],
      ['hod_held_back_papers', 'integer'],
      ['hod_held_other_papers', 'integer'],
      ['distribute_unassigned_papers', ''],
    ]) {
      expect(sql).toContain(`revoke all on function public.${f}(${a}) from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${f}(${a}) to authenticated;`);
    }
  });

  it('checks the HOD door inside the three lists and the hand-out', () => {
    for (const f of ['hod_unassigned_papers', 'hod_held_back_papers', 'hod_held_other_papers']) {
      expect(fn(f), f).toContain("if not public.is_hod() then");
      expect(fn(f), f).toContain("errcode = '42501'");
    }
    expect(fn('distribute_unassigned_papers')).toContain("auth.role() = 'service_role'");
  });

  it('no longer calls the per-question functions from the lists or the hand-out', () => {
    for (const f of ['hod_unassigned_papers', 'hod_held_back_papers', 'hod_held_other_papers', 'distribute_unassigned_papers']) {
      const body = fn(f);
      expect(body, f).toContain('paper_handout_facts(');
      for (const slow of ['checker_question_servable', 'paper_pictures_complete', 'paper_picture_gaps', 'verifier_has_work', 'checker_has_picture']) {
        expect(body, `${f} still calls ${slow}`).not.toContain(slow);
      }
    }
  });

  it('leaves set aside papers out of the free list, the hand-out and Not ready to give out, and lists them with a reason', () => {
    const red = "not (coalesce(ap.is_red, false) or coalesce(ap.status, '') = 'red')";
    for (const f of ['hod_unassigned_papers', 'hod_held_back_papers', 'distribute_unassigned_papers']) expect(fn(f), f).toContain(red);
    expect(fn('hod_held_other_papers')).toContain("then 'set_aside'");
    expect(sql).toContain('This paper is set aside (marked red), so it cannot be given out.');
    expect(sql).toContain("v_def !~ 'set aside'");
  });

  it('is safe to run twice: create or replace, create index if not exists, a guarded patch', () => {
    expect(sql).toContain('create index if not exists audit_questions_kid_open_paper_idx');
    expect(sql).not.toMatch(/create index concurrently/i);
    expect(sql).not.toMatch(/\bdrop (table|function|index)\b/i);
  });
});

/* ------------------------------------------------------------------------------------------------ the databases */

const BENCH = process.env.HANDOUT_BENCH === '1';
const PAPERS = BENCH ? 1400 : 110;
const CHECKERS = BENCH ? 60 : 25;

let oldDb: PGlite;
let newDb: PGlite;

type Row = Record<string, unknown>;
const q = async (db: PGlite, text: string) => (await db.query<Row>(text)).rows;

beforeAll(async () => {
  oldDb = await makeDb('old');
  newDb = await makeDb('new');
  const data = dataSql(PAPERS, CHECKERS);
  await oldDb.exec(data);
  await newDb.exec(data);
  // two papers that are on the free list today are set aside (one by the flag, one by the status), in both databases
  const listed = await q(oldDb, `select paper_id from public.hod_unassigned_papers(1000) order by paper_id limit 2`);
  expect(listed.length).toBe(2);
  for (const db of [oldDb, newDb]) {
    await db.exec(`update audit_papers set is_red = true, red_reason = 'duplicate of something' where id = '${listed[0].paper_id}';
                   update audit_papers set status = 'red' where id = '${listed[1].paper_id}'`);
  }
}, 900_000);

afterAll(async () => {
  await oldDb?.close();
  await newDb?.close();
});

const RED = `(coalesce(is_red, false) or coalesce(status, '') = 'red')`;

describe('the data really has the awkward cases', () => {
  it('has parents, page fallback, held papers, live copies, wrong PDFs, set aside papers and open questions', async () => {
    const [r] = await q(
      newDb,
      `select (select count(*) from audit_questions where parent_id is not null)::int parents,
              (select count(*) from audit_questions where source ->> 'page_verified' = 'false')::int fallback_q,
              (select count(*) from checker_assignments where status in ('queued','assigned'))::int held,
              (select count(*) from audit_papers where source = 'live_copy')::int live_copies,
              (select count(*) from audit_papers where 'pdf_mismatch' = any (flag_reasons))::int wrong_pdf,
              (select count(*) from audit_papers where ${RED})::int red,
              (select count(*) from audit_questions where kind = 'question' and review_bucket = 'kid' and question_passed = false)::int open_q,
              (select count(*) from audit_questions)::int total_q`,
    );
    for (const k of ['parents', 'fallback_q', 'held', 'live_copies', 'wrong_pdf', 'red', 'open_q']) expect(Number(r[k]), k).toBeGreaterThan(0);
    if (BENCH) console.log('BENCH data', JSON.stringify(r));
  });
});

describe('paper_handout_facts agrees with the per-question functions it replaces, for EVERY paper', () => {
  it('gives the same counts as checker_question_servable, checker_reference_ok, checker_body_ok and paper_picture_gaps', async () => {
    const oracle = await q(
      newDb,
      `select ap.id as paper_id,
              (select count(*)::int from audit_questions x where x.paper_id = ap.id and x.kind = 'question' and x.review_bucket = 'kid' and x.question_passed = false and x.set_aside_at is null) n_open,
              (select count(*)::int from audit_questions x where x.paper_id = ap.id and x.kind = 'question' and x.review_bucket = 'kid' and x.question_passed = false and public.checker_question_servable(x)) n_serv,
              (select count(*)::int from audit_questions x where x.paper_id = ap.id and x.kind = 'question' and x.review_bucket = 'kid' and x.question_passed = false and x.set_aside_at is null and coalesce(x.source ->> 'pipeline', '') = 'english_w14') n_w14,
              (select count(*)::int from audit_questions x where x.paper_id = ap.id and x.kind = 'question' and x.review_bucket = 'kid' and x.question_passed = false and x.set_aside_at is null and not coalesce(public.checker_reference_ok(x), false)) n_noref,
              (select count(*)::int from audit_questions x where x.paper_id = ap.id and x.kind = 'question' and x.review_bucket = 'kid' and x.question_passed = false and x.set_aside_at is null and not coalesce(public.checker_body_ok(x), false)) n_nobody,
              g.missing_snips, g.pages_total, g.pages_missing
         from audit_papers ap cross join lateral public.paper_picture_gaps(ap.id) g order by ap.id`,
    );
    const facts = await q(newDb, `select * from public.paper_handout_facts((select array_agg(id) from audit_papers)) order by paper_id`);
    expect(facts.length).toBe(PAPERS);
    expect(facts).toEqual(oracle);
    // a spread of answers, not all zeros
    expect(facts.some((f) => Number(f.n_serv) > 0)).toBe(true);
    expect(facts.some((f) => Number(f.missing_snips) > 0)).toBe(true);
    expect(facts.some((f) => Number(f.pages_missing) > 0)).toBe(true);
    expect(facts.some((f) => Number(f.n_serv) === 0 && Number(f.n_open) > 0)).toBe(true);
  }, 600_000);

  it('answers for an unknown paper and for no paper at all', async () => {
    expect(await q(newDb, `select * from public.paper_handout_facts('{}'::uuid[])`)).toEqual([]);
    expect(await q(newDb, `select * from public.paper_handout_facts(null)`)).toEqual([]);
    expect(await q(newDb, `select * from public.paper_handout_facts(array['00000000-0000-0000-0000-000000000000'::uuid])`)).toEqual([]);
  });
});

describe('the lists give the same rows as the functions they replace', () => {
  it('Papers nobody has (set aside papers are the one difference)', async () => {
    const [before, tOld] = await ms(() => q(oldDb, `select * from public.hod_unassigned_papers(1000)`));
    const [after, tNew] = await ms(() => q(newDb, `select * from public.hod_unassigned_papers(1000)`));
    const red = new Set((await q(newDb, `select id from audit_papers where ${RED}`)).map((r) => r.id));
    const key = (r: Row) => String(r.paper_id);
    const oldNoRed = before.filter((r) => !red.has(r.paper_id)).sort((a, b) => key(a).localeCompare(key(b)));
    expect([...after].sort((a, b) => key(a).localeCompare(key(b)))).toEqual(oldNoRed);
    expect(before.length).toBeGreaterThan(0);
    expect(before.some((r) => red.has(r.paper_id)), 'the data should have a set aside paper that used to be listed').toBe(true);
    // the order the screen shows: subject, class, most questions first
    const sorted = [...after].sort(
      (a, b) => String(a.subject).localeCompare(String(b.subject), 'en', { sensitivity: 'variant' }) || 0,
    );
    expect(sorted.length).toBe(after.length);
    for (let i = 1; i < after.length; i++) {
      const a = after[i - 1], b = after[i];
      if (a.subject === b.subject && a.cls === b.cls) expect(Number(a.open_count)).toBeGreaterThanOrEqual(Number(b.open_count));
    }
    if (BENCH) console.log(`BENCH hod_unassigned_papers old ${tOld.toFixed(0)} ms, new ${tNew.toFixed(0)} ms, rows ${before.length} -> ${after.length}`);
  }, 600_000);

  it('Not ready to give out (set aside papers are the one difference)', async () => {
    const [before, tOld] = await ms(() => q(oldDb, `select * from public.hod_held_back_papers(1000)`));
    const [after, tNew] = await ms(() => q(newDb, `select * from public.hod_held_back_papers(1000)`));
    const red = new Set((await q(newDb, `select id from audit_papers where ${RED}`)).map((r) => r.id));
    expect(after).toEqual(before.filter((r) => !red.has(r.paper_id)));
    expect(before.length).toBeGreaterThan(0);
    if (BENCH) console.log(`BENCH hod_held_back_papers old ${tOld.toFixed(0)} ms, new ${tNew.toFixed(0)} ms, rows ${before.length} -> ${after.length}`);
  }, 600_000);

  it('Held for another reason, and the set aside papers listed with their own reason', async () => {
    const [before, tOld] = await ms(() => q(oldDb, `select * from public.hod_held_other_papers(1000)`));
    const [after, tNew] = await ms(() => q(newDb, `select * from public.hod_held_other_papers(1000)`));
    const red = new Set((await q(newDb, `select id from audit_papers where ${RED}`)).map((r) => r.id));
    expect(after.filter((r) => r.reason !== 'set_aside')).toEqual(before.filter((r) => !red.has(r.paper_id)));
    const asideShown = after.filter((r) => r.reason === 'set_aside').map((r) => r.paper_id).sort();
    const asideExpected = (
      await q(
        newDb,
        `select ap.id as paper_id from audit_papers ap
          where ${RED.replace(/is_red/g, 'ap.is_red').replace(/status/g, 'ap.status')}
            and exists (select 1 from audit_questions x where x.paper_id = ap.id and x.kind = 'question' and x.review_bucket = 'kid' and x.question_passed = false and x.set_aside_at is null)
            and not exists (select 1 from checker_assignments a where a.audit_paper_id = ap.id and a.status in ('queued','assigned'))
          order by 1`,
      )
    ).map((r) => r.paper_id);
    expect(asideShown).toEqual(asideExpected);
    expect(asideShown.length).toBeGreaterThan(0);
    expect(before.some((r) => r.reason === 'other' || r.reason === 'text' || r.reason === 'wrong_pdf' || r.reason === 'reference_pages' || r.reason === 'english_reread')).toBe(true);
    if (BENCH) console.log(`BENCH hod_held_other_papers old ${tOld.toFixed(0)} ms, new ${tNew.toFixed(0)} ms, rows ${before.length} -> ${after.length}`);
  }, 600_000);

  it('a set aside paper is on none of the other lists and a normal paper is on exactly one of the three', async () => {
    const a = await q(newDb, `select paper_id from public.hod_unassigned_papers(1000)`);
    const b = await q(newDb, `select paper_id from public.hod_held_back_papers(1000)`);
    const c = await q(newDb, `select paper_id from public.hod_held_other_papers(1000)`);
    const all = [...a, ...b, ...c].map((r) => String(r.paper_id));
    expect(new Set(all).size).toBe(all.length);
  }, 600_000);
});

describe('Auto assign all hands out the same papers to the same people', () => {
  it('gives the same result as the version live today (set aside papers cleared in both, so the rule is not in play)', async () => {
    for (const db of [oldDb, newDb]) await db.exec(`update audit_papers set is_red = false, status = 'passed'`);
    const [nOld, tOld] = await ms(async () => (await q(oldDb, `select public.distribute_unassigned_papers() as n`))[0].n);
    const [nNew, tNew] = await ms(async () => (await q(newDb, `select public.distribute_unassigned_papers() as n`))[0].n);
    const held = (db: PGlite) => q(db, `select audit_paper_id, user_id, status from checker_assignments order by audit_paper_id, user_id, status`);
    expect(await held(newDb)).toEqual(await held(oldDb));
    expect(nNew).toBe(nOld);
    expect(Number(nOld)).toBeGreaterThan(0);
    if (BENCH) console.log(`BENCH distribute_unassigned_papers old ${tOld.toFixed(0)} ms, new ${tNew.toFixed(0)} ms, handed out ${nOld} -> ${nNew}`);
    // a second press hands out the same again (the leftovers), and still the same
    const again = [await q(oldDb, `select public.distribute_unassigned_papers() as n`), await q(newDb, `select public.distribute_unassigned_papers() as n`)];
    expect(again[1]).toEqual(again[0]);
    expect(await held(newDb)).toEqual(await held(oldDb));
  }, 600_000);
});

describe('set aside papers are never handed out', () => {
  it('Auto assign all skips them, the free list does not show them, and the HOD button refuses them', async () => {
    const db = await makeDb('new');
    await db.exec(dataSql(60, 20));
    await db.exec(`update audit_papers set is_red = false, status = 'passed'`);
    const free = await q(db, `select paper_id from public.hod_unassigned_papers(1000) order by paper_id`);
    expect(free.length).toBeGreaterThan(5);
    const victims = free.slice(0, 3).map((r) => String(r.paper_id));
    // one by the flag, one by the status, one by both
    await db.exec(`update audit_papers set is_red = true where id = '${victims[0]}';
                   update audit_papers set status = 'red' where id = '${victims[1]}';
                   update audit_papers set is_red = true, status = 'red', red_reason = 'duplicate of something' where id = '${victims[2]}';`);
    const after = (await q(db, `select paper_id from public.hod_unassigned_papers(1000)`)).map((r) => String(r.paper_id));
    for (const v of victims) expect(after).not.toContain(v);
    expect(after.length).toBe(free.length - 3);
    const other = await q(db, `select paper_id, reason from public.hod_held_other_papers(1000)`);
    for (const v of victims) expect(other).toContainEqual({ paper_id: v, reason: 'set_aside' });
    const back = (await q(db, `select paper_id from public.hod_held_back_papers(1000)`)).map((r) => String(r.paper_id));
    for (const v of victims) expect(back).not.toContain(v);

    const n = Number((await q(db, `select public.distribute_unassigned_papers() as n`))[0].n);
    expect(n).toBeGreaterThan(0);
    const given = (await q(db, `select audit_paper_id from checker_assignments where audit_paper_id = any ('{${victims.join(',')}}'::uuid[])`));
    expect(given).toEqual([]);

    // the HOD's own button
    const checker = '00000000-0000-0000-0000-00000000c0de';
    await db.exec(`insert into paper_checkers (user_id, active) values ('${checker}', true)`);
    // stand-in for verifier_can_take (it checks the person, not the paper): always fine
    await db.exec(`create or replace function public.verifier_can_take(p_user_id uuid, p_paper_id uuid) returns text language sql as $$ select null::text $$`);
    for (const v of victims) {
      await expect(db.query(`select public.hod_assign_paper('${v}', '${checker}')`)).rejects.toThrow(/set aside/);
    }
    // a normal free paper is still handed over
    const normal = String((await q(db, `select paper_id from public.hod_unassigned_papers(1000) limit 1`))[0]?.paper_id ?? '');
    if (normal) {
      expect((await q(db, `select public.hod_assign_paper('${normal}', '${checker}') as r`))[0].r).toBe('assigned');
    }
    await db.close();
  }, 600_000);
});

describe('the migration can be run twice', () => {
  it('gives identical answers after a second run', async () => {
    const db = await makeDb('new', 2);
    await db.exec(dataSql(40, 10));
    const a = await q(db, `select * from public.hod_unassigned_papers(1000)`);
    const twice = await makeDb('new', 1);
    await twice.exec(dataSql(40, 10));
    expect(a).toEqual(await q(twice, `select * from public.hod_unassigned_papers(1000)`));
    const defs = await q(db, `select pg_get_functiondef('public.hod_assign_paper(uuid,uuid)'::regprocedure) d`);
    expect(String(defs[0].d).match(/set aside/g)?.length).toBe(1);
    await db.close();
    await twice.close();
  }, 600_000);
});
