import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { createFakeCheckerApi } from '@/dummy/checker-fake-api';
import { classGrade, pickBlock, type HodVerifierProfile } from '@/lib/hod-api';

describe('classGrade reads a class like public.class_grade (20261007160000)', () => {
  it.each([
    ['X', 10],
    ['XII', 12],
    ['10', 10],
    ['10th', 10],
    ['GRADE X', 10],
    ['GRADE-X', 10],
    ['Class X', 10],
    ['class 10', 10],
    ['Std 9', 9],
    ['Grade XII', 12],
    ['ix', 9],
    ['Class-XI', 11],
    ['1st', 1],
    ['13', null],
    ['0', null],
    ['unknown', null],
    ['', null],
    [null, null],
  ])('%s -> %s', (cls, want) => {
    expect(classGrade(cls as string | null)).toBe(want);
  });
});

describe('pickBlock: what the HOD cannot pick, before pressing', () => {
  const prof = (over: Partial<HodVerifierProfile>): HodVerifierProfile => ({
    user_id: 'u',
    email: null,
    name: null,
    active: true,
    full_name: 'V',
    grade: 10,
    school: 'S',
    board: 'ICSE',
    valid_until: '2027-03-31',
    expired: false,
    missing: false,
    preferred_subjects: [],
    requested_subjects: [],
    requested_at: null,
    ...over,
  });
  it('allows a paper at or below the grade, and an unknown class (the HOD decides)', () => {
    expect(pickBlock(prof({}), 'X')).toBeNull();
    expect(pickBlock(prof({}), 'IX')).toBeNull();
    expect(pickBlock(prof({}), 'unknown')).toBeNull();
  });
  it('blocks above a recorded grade and expired details only', () => {
    expect(pickBlock(prof({}), 'XII')).toBe('paper above their grade');
    expect(pickBlock(prof({ expired: true }), 'X')).toBe('details expired');
    expect(pickBlock(prof({ expired: true, grade: null }), 'X')).toBe('details expired');
  });
  it('a plain integer compare still works at both new ends (20261008130000)', () => {
    // Under grade 6 is 5: classes up to V, nothing above.
    expect(pickBlock(prof({ grade: 5 }), 'V')).toBeNull();
    expect(pickBlock(prof({ grade: 5 }), 'VI')).toBe('paper above their grade');
    // UG and Beyond UG (13 to 17) sit above every paper class.
    for (const g of [13, 14, 15, 16, 17]) expect(pickBlock(prof({ grade: g }), 'XII')).toBeNull();
  });
  it('allows any paper to a verifier with no details or no grade (20261008100000)', () => {
    expect(pickBlock(undefined, 'XII')).toBeNull();
    expect(pickBlock(prof({ grade: null }), 'XII')).toBeNull();
    expect(pickBlock(prof({ missing: true, grade: null }), 'XII')).toBeNull();
  });
});

describe('20261008100000 verifier self details and hand-out without details', () => {
  const s = readFileSync(resolve(__dirname, '../../supabase/migrations/20261008100000_verifier_self_details.sql'), 'utf8');
  it('lets a verifier set their own details but not the valid-until date', () => {
    expect(s).toContain('create or replace function public.verifier_set_my_profile(');
    expect(s).toContain('if not public.is_paper_checker() then');
    expect(s).toMatch(/do update\s+set full_name = excluded\.full_name, grade = excluded\.grade, school = excluded\.school,\s+board = excluded\.board, updated_by/);
    expect(s).not.toMatch(/valid_until = excluded\.valid_until/);
    expect(s).toContain("'verifier_set_my_profile'");
  });
  it('hands out papers without a profile, no grade = no class limit, expired still blocked', () => {
    expect(s).toContain('left join public.verifier_profiles vp on vp.user_id = pc.user_id');
    expect(s).toContain('coalesce(vp.grade, 12)');
    expect(s).toContain('vp.valid_until is null or vp.valid_until >= current_date');
    expect(s).toContain("raise exception 'patch did not apply'");
  });
  it('closes the functions to anon', () => {
    expect(s).toContain('revoke all on function %s from public, anon, authenticated');
    expect(s).not.toMatch(/grant execute[^;]*\banon\b/);
  });
});

describe('dummy verifier can fill in their own details', () => {
  it('saves name, grade, school and board; accepts 13 to 17, refuses 0 and 18; keeps valid until', async () => {
    const api = createFakeCheckerApi();
    const before = await api.myProfile();
    await api.setMyProfile({ full_name: 'Ria', grade: 9, school: 'Hill School', board: 'CBSE' });
    const after = await api.myProfile();
    expect(after).toMatchObject({ full_name: 'Ria', grade: 9, school: 'Hill School', board: 'CBSE', valid_until: before?.valid_until });
    for (const g of [13, 16, 17]) {
      await api.setMyProfile({ full_name: null, grade: g, school: null, board: null });
      expect((await api.myProfile())?.grade).toBe(g);
    }
    for (const g of [0, 18]) {
      await expect(api.setMyProfile({ full_name: null, grade: g, school: null, board: null })).rejects.toBeTruthy();
    }
    await api.setMyProfile({ full_name: null, grade: null, school: null, board: null });
    expect((await api.myProfile())?.grade).toBeNull();
  });
});

/* The owner's loophole answers, 7 Oct 2026 (20261007140000): idle papers
   come back after 7 days, a skipped question goes to the end of the paper,
   a paper with no class goes only to Class 12 verifiers. The last two were
   changed on 8 Oct 2026: skipped questions now wait on the paper until the
   verifier goes back to them (20261008160000), and a paper with no class can
   go to any verifier (20261008170000). This file pins the 7 Oct migration as
   it was written. */

const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261007140000_verifier_loophole_rules.sql'), 'utf8');

describe('20261007140000 verifier loophole rules', () => {
  it('returns papers idle for 7 days, logs it, and does not hand them straight back', () => {
    expect(sql).toMatch(/create or replace function public\.verifier_idle_days\(\)[\s\S]*select 7/);
    expect(sql).toContain("'auto_return_idle'");
    expect(sql).toContain('perform public.verifier_return_idle();');
    expect(sql).toContain("x.closed_reason like 'nothing done for %'");
  });

  it('as written on 7 Oct, treated an unknown class as Class 12 in the hand-out (later changed to any verifier)', () => {
    expect(sql).toContain('coalesce(public.class_grade(ap.class), 12) as grade');
    expect(sql).not.toContain('public.class_grade(ap.class) is not null');
  });

  it('puts skipped questions last instead of hiding them for a day', () => {
    expect(sql).toContain('sk.at nulls first');
    expect(sql).not.toContain("interval '24 hours'");
  });

  it('closes every new function to anon', () => {
    for (const f of ['verifier_idle_days()', 'verifier_return_idle()', 'distribute_unassigned_papers()', 'verifier_next_in_paper(uuid)']) {
      expect(sql).toContain(`'public.${f}'`);
    }
    expect(sql).toContain('revoke all on function %s from public, anon, authenticated');
    expect(sql).not.toMatch(/grant execute[^;]*\banon\b/);
  });
});

const read = (f: string) => readFileSync(resolve(__dirname, `../../supabase/migrations/${f}`), 'utf8');

describe('7 Oct edge-case fixes', () => {
  it('150000: idle return and the cap only count papers with work left; inactive verifiers lose papers at once', () => {
    const s = read('20261007150000_verifier_waiting_on_hod.sql');
    expect(s).toContain('and public.verifier_has_work(a.audit_paper_id)');
    expect(s).toContain("'auto_return_inactive'");
    expect(s).toContain('not exists (select 1 from public.paper_checkers pc where pc.user_id = a.user_id and pc.active)');
  });
  it('160000: class_grade upper-cases before stripping', () => {
    expect(read('20261007160000_class_grade_case.sql')).toContain("regexp_replace(upper(coalesce(p_class, ''))");
  });
  it('170000: subjects fold into families and unknown subjects are refused', () => {
    const s = read('20261007170000_subject_family.sql');
    expect(s).toContain("when s like '%english%' or s like '%literature%' then 'english'");
    expect(s).toContain("raise exception 'No papers in %.");
    expect(s).toContain('v := public.clean_subject_list(p_subjects);');
  });
  it('180000: preferred subjects go first and beat the even-load band, and the patch refuses to half-apply', () => {
    const s = read('20261007180000_preferred_subjects_first.sql');
    expect(s).toContain("raise exception 'patch did not apply'");
    expect(s).toContain('_dist_papers dp order by (exists');
  });
});

describe('dummy verifier: a skipped question waits for later', () => {
  it('serves the rest first, then only on request the skipped ones earliest first, and keeps counting them', async () => {
    const api = createFakeCheckerApi();
    const [paper] = await api.myPapers();
    const first = await api.nextInPaper(paper.paper_id);
    expect(first).not.toBeNull();
    await api.skipQuestion(first!.id);
    const second = await api.nextInPaper(paper.paper_id);
    expect(second?.id).not.toBe(first!.id);
    // Still to do: the skipped one is not dropped from the count.
    const [after] = await api.myPapers();
    expect(after.remaining).toBe(paper.remaining);

    // Skip everything else. Skipped questions wait (20261008160000): nothing
    // is served until the verifier asks for the skipped ones, and then the
    // first skipped one comes first.
    let q = second;
    let guard = 0;
    while (q && guard++ < 50) {
      await api.skipQuestion(q.id);
      q = await api.nextInPaper(paper.paper_id);
    }
    expect(q).toBeNull();
    expect((await api.nextInPaper(paper.paper_id, { includeSkipped: true }))?.id).toBe(first!.id);
    const [last] = await api.myPapers();
    expect(last.skipped).toBe(last.remaining);
  });
});
