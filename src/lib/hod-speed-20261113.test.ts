import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { isTimeoutError, retryUnlessTimeout } from '@/lib/query-retry';
import { RequestTimeoutError } from '@/lib/checker-timeout';
import { hodRefreshPlan, refreshHod, type HodChange } from '@/lib/hod-refresh';
import { papersAfterVerdict, type MyPaper } from '@/lib/verifier-papers';
import { ROUTE_POLL_MS } from '@/hooks/usePipelineRoute';

/* The slow-screens fixes of 13 Nov 2026: no automatic retry after a timeout, each HOD action re-reads only what it
   changed, the Assignments sections show as their own data arrives, the Verifiers tab makes no call of its own for
   hints, the Pipeline page reads once a minute, and the checking screen does not re-read the papers list after every
   answer. There is no browser here, so the wiring is pinned by reading the source and the rules run as plain functions. */

const read = (p: string) => readFileSync(p, 'utf8');

describe('retry: a read that timed out is not tried again', () => {
  it('knows the ways a read can run out of time', () => {
    expect(isTimeoutError(new RequestTimeoutError(60_000))).toBe(true);
    expect(isTimeoutError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(true);
    expect(isTimeoutError({ message: 'canceling statement due to statement timeout' })).toBe(true);
    expect(isTimeoutError({ name: 'RequestTimeoutError' })).toBe(true);
  });

  it('does not take other failures for a timeout', () => {
    expect(isTimeoutError(new Error('Failed to fetch'))).toBe(false);
    expect(isTimeoutError({ code: '42501', message: 'Not authorized' })).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError('boom')).toBe(false);
  });

  it('retries a dropped connection once and a timeout never', () => {
    expect(retryUnlessTimeout(0, new Error('Failed to fetch'))).toBe(true);
    expect(retryUnlessTimeout(1, new Error('Failed to fetch'))).toBe(false);
    expect(retryUnlessTimeout(0, new RequestTimeoutError())).toBe(false);
    expect(retryUnlessTimeout(0, { code: '57014' })).toBe(false);
  });

  it('is what the whole app uses instead of a flat retry of 1', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('retry: retryUnlessTimeout');
    expect(app).not.toMatch(/retry: 1\b/);
  });
});

describe('HOD actions re-read only what they changed', () => {
  const changes: HodChange[] = ['assignments', 'needs-you', 'publish', 'live', 'uploads', 'requests', 'verifiers'];

  it('never re-reads the whole desk', () => {
    for (const c of changes) {
      for (const key of [...hodRefreshPlan('real', c).now, ...hodRefreshPlan('real', c).later]) {
        expect(key.length, `${c} names a part of the desk`).toBeGreaterThanOrEqual(3);
        expect(key.slice(0, 2)).toEqual(['hod', 'real']);
      }
    }
  });

  it('giving out papers re-reads the three paper lists, not the counts or the team', () => {
    const plan = hodRefreshPlan('real', 'assignments');
    const now = plan.now.map((k) => k[2]);
    expect(now).toEqual(expect.arrayContaining(['assignments', 'unassigned', 'held-back']));
    expect(now).not.toContain('counts');
    expect(now).not.toContain('team');
    expect(plan.later.map((k) => k[2])).toContain('team');
  });

  it('a request decision touches nothing but the requests and their badge', () => {
    expect(hodRefreshPlan('real', 'requests').now.map((k) => k[2])).toEqual(['requests', 'request-counts']);
  });

  it('only the actions that change a badge or the strip re-read the counts', () => {
    const withCounts = changes.filter((c) => hodRefreshPlan('real', c).now.some((k) => k[2] === 'counts'));
    expect(withCounts.sort()).toEqual(['live', 'needs-you', 'publish', 'uploads']);
  });

  it('marks the neighbours stale without reading them', async () => {
    const qc = new QueryClient();
    const calls: Array<{ key: unknown; refetchType?: string }> = [];
    vi.spyOn(qc, 'invalidateQueries').mockImplementation((f) => {
      calls.push({ key: (f as { queryKey: unknown }).queryKey, refetchType: (f as { refetchType?: string }).refetchType });
      return Promise.resolve();
    });
    refreshHod(qc, 'real', 'assignments');
    const team = calls.find((c) => (c.key as string[])[2] === 'team');
    const list = calls.find((c) => (c.key as string[])[2] === 'assignments');
    expect(team?.refetchType).toBe('none');
    expect(list?.refetchType).toBeUndefined();
  });

  it('skips a list the caller has just read itself', () => {
    const qc = new QueryClient();
    const keys: string[] = [];
    vi.spyOn(qc, 'invalidateQueries').mockImplementation((f) => {
      keys.push(String((f as { queryKey: string[] }).queryKey[2]));
      return Promise.resolve();
    });
    refreshHod(qc, 'real', 'assignments', ['assignments', 'unassigned']);
    expect(keys).not.toContain('assignments');
    expect(keys).not.toContain('unassigned');
    expect(keys).toContain('held-back');
  });

  it('no HOD screen invalidates the whole tree any more', () => {
    for (const f of ['AssignmentsTab', 'LiveTab', 'NeedsYouTab', 'PublishFlow', 'RequestsTab', 'UploadsTab', 'VerifiersTab']) {
      const src = read(`src/components/hod/${f}.tsx`);
      expect(src, f).not.toMatch(/invalidateQueries\(\{ queryKey: \['hod', scope\] \}\)/);
      expect(src, f).toContain('refreshHod(');
    }
    const form = read('src/components/requests/RequestForm.tsx');
    expect(form).not.toMatch(/invalidateQueries\(\{ queryKey: \['hod', scope\] \}\)/);
    expect(form).toContain("refreshHod(qc, scope, 'requests')");
  });

  it('the hand-out and the read-back are not read twice in a row', () => {
    const src = read('src/components/hod/AssignmentsTab.tsx');
    expect(src).toContain("refresh(perPerson ? ['assignments', 'unassigned'] : [])");
    expect(src).toContain("fresh = ['assignments']");
  });
});

describe('Assignments: each section shows as its own data arrives', () => {
  const src = read('src/components/hod/AssignmentsTab.tsx');

  it('no early return waits for the slowest call', () => {
    expect(src).not.toMatch(/if \(loadGate\(assignmentsQ\) === 'loading' \|\| loadGate\(unassignedQ\)/);
    expect(src).not.toMatch(/if \(assignmentsQ\.isError\) return/);
    expect(src).not.toMatch(/if \(teamQ\.isError\) return/);
  });

  it('who has what, the free papers and the not-ready list each have their own loading and error state', () => {
    expect(src).toContain('<ListSkeleton label="Loading who has what" />');
    expect(src).toContain('<ListSkeleton label="Loading free papers" />');
    expect(src).toContain('<ListSkeleton label="Loading papers that are not ready" />');
    expect(src).toContain('what="The assignments"');
    expect(src).toContain('what="The list of free papers"');
    expect(src).toContain('what="The list of checkers"');
  });

  it('the pickers wait for the team, so an empty list is never read as nobody to give it to', () => {
    expect(src).toContain("const pickersBusy = busy || teamGate !== 'ready'");
    expect((src.match(/busy=\{pickersBusy\}/g) ?? []).length).toBe(2);
  });
});

describe('Verifiers tab: the hints cost no call of their own', () => {
  const src = read('src/components/hod/VerifiersTab.tsx');
  it('takes the free-papers list the strip already reads, never refreshes it on open, never retries it', () => {
    const line = src.split('\n').find((l) => l.includes('const waitingQ = useQuery'))!;
    expect(line).toContain('refetchOnMount: false');
    expect(line).toContain('retryOnMount: false');
    expect(line).toContain('retry: false');
    expect(line).not.toContain('refetchOnMount: true');
  });
  it('shares its key with the strip, so it is the same call', () => {
    const strip = read('src/components/hod/HodStageStrip.tsx');
    expect(src).toContain("const WAITING_KEY = (scope: string) => ['hod', scope, 'unassigned'] as const;");
    expect(strip).toContain('UNASSIGNED_KEY(scope)');
    expect(read('src/components/hod/AssignmentsTab.tsx')).toContain("export const UNASSIGNED_KEY = (scope: string) => ['hod', scope, 'unassigned'] as const;");
  });
});

describe('Pipeline page: read once a minute', () => {
  it('polls every 60 seconds', () => {
    expect(ROUTE_POLL_MS).toBe(60_000);
  });
  it('the admin hint says so', () => {
    expect(read('src/lib/admin-hints.ts')).toContain('The route checks again every minute');
    expect(read('src/lib/admin-hints.ts')).not.toContain('every 20 seconds');
  });
});

describe('checking screen: no whole-list re-read after every answer', () => {
  const row = (over: Partial<MyPaper>): MyPaper => ({
    assignment_id: 1,
    paper_id: 'p1',
    subject: null,
    school: null,
    cls: null,
    exam: null,
    year: null,
    given_by_hod: false,
    assigned_at: null,
    total: 10,
    done: 4,
    remaining: 6,
    with_hod: 0,
    skipped: 1,
    paper_total: 12,
    paper_passed: 5,
    ...over,
  });

  it('a pass or a fix finishes one question', () => {
    for (const kind of ['pass', 'fix'] as const) {
      const [p] = papersAfterVerdict([row({})], 'p1', kind)!;
      expect(p.done).toBe(5);
      expect(p.remaining).toBe(5);
      expect(p.paper_passed).toBe(6);
    }
  });

  it('a skip keeps the question on the paper, marked skipped', () => {
    const [p] = papersAfterVerdict([row({})], 'p1', 'skip')!;
    expect(p.remaining).toBe(6);
    expect(p.done).toBe(4);
    expect(p.skipped).toBe(2);
  });

  it('asking for help hands the question to the HOD', () => {
    const [p] = papersAfterVerdict([row({})], 'p1', 'ask_help')!;
    expect(p.remaining).toBe(5);
    expect(p.with_hod).toBe(1);
    expect(p.done).toBe(4);
  });

  it('never goes below zero, never lets skipped exceed what is left, leaves other papers alone', () => {
    const rows = [row({ remaining: 0, skipped: 0 }), row({ paper_id: 'p2', assignment_id: 2 })];
    const out = papersAfterVerdict(rows, 'p1', 'pass')!;
    expect(out[0].remaining).toBe(0);
    expect(out[1]).toBe(rows[1]);
    const [last] = papersAfterVerdict([row({ remaining: 1, skipped: 1 })], 'p1', 'pass')!;
    expect(last.skipped).toBe(0);
  });

  it('does nothing before the list has loaded', () => {
    expect(papersAfterVerdict(undefined, 'p1', 'pass')).toBeUndefined();
  });

  it('the screen patches the row and only marks the list stale after an answer; it reads for real when the paper ends', () => {
    const screen = read('src/components/checker/VerifyScreen.tsx');
    const acked = screen.slice(screen.indexOf('function ackedVerdict('), screen.indexOf('function rejectedVerdict('));
    expect(acked).toContain("qc.setQueryData<MyPaper[]>(['verifier-papers', scope], (rows) => papersAfterVerdict(rows, entry.paperId, entry.kind))");
    expect(acked).toContain("qc.invalidateQueries({ queryKey: ['verifier-papers', scope], refetchType: 'none' })");
    expect(acked).toContain("if (decision.kind === 'fetch' || decision.kind === 'end') qc.invalidateQueries({ queryKey: ['verifier-papers', scope] })");
    // The live-activity refresh (my own answers cause activity too) no longer re-reads the list either.
    const live = screen.slice(screen.indexOf('const refreshCounters = useLiveRefresh'), screen.indexOf('usePaperReviewChannel({'));
    expect(live).toContain("refetchType: 'none'");
  });
});

describe('20261113320000: paper trail and hand-out speed', () => {
  const sql = read('supabase/migrations/20261113320000_hod_trail_and_handout_speed.sql');
  const trail = sql.slice(sql.indexOf('create or replace function public.hod_paper_trail()'), sql.indexOf('create or replace function public.distribute_unassigned_papers()'));
  const handout = sql.slice(sql.indexOf('create or replace function public.distribute_unassigned_papers()'), sql.indexOf('-- Same doors'));

  it('the trail works the state out in place, not through the helper', () => {
    const code = trail.replace(/--.*$/gm, '');
    expect(code).not.toContain('approval_question_state(');
    expect(code).toContain("when q.kind <> 'question' then 'section'");
    expect(code).toContain("when coalesce(q.question_passed, false) then 'passed'");
    expect(code).toContain("when q.set_aside_at is not null then 'set_aside'");
    expect(code).toContain("else 'open' end as st");
  });

  it('the trail keeps its signature, its is_hod gate and its order', () => {
    expect(trail).toContain('returns table(audit_paper_id uuid, stage text, total integer, passed integer, checking integer, needs_you integer, set_aside integer, title text, subject text, cls text, school text, is_live boolean)');
    expect(trail).toContain('if not public.is_hod() then');
    expect(trail).toContain('order by ap.id;');
    expect(trail).toContain('security definer');
    expect(trail).toContain('set search_path = public, pg_temp');
  });

  it('the hand-out collects the free papers first and checks only their questions', () => {
    expect(handout).toContain('v_free uuid[]');
    expect(handout.indexOf('into v_free')).toBeLessThan(handout.indexOf('insert into _dist_papers'));
    expect(handout).toContain('q.paper_id = any (v_free)');
    // The grown-up rules are untouched.
    expect(handout).toContain('pg_advisory_xact_lock(hashtext(\'distribute_unassigned_papers\'))');
    expect(handout).toContain('public.verifier_paper_cap()');
    expect(handout).toContain("app.dist_internal");
  });

  it('keeps the doors: closed to the public and signed-out visitors, open to signed-in people', () => {
    expect(sql).toContain('revoke all on function public.hod_paper_trail() from public, anon, authenticated;');
    expect(sql).toContain('revoke all on function public.distribute_unassigned_papers() from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.hod_paper_trail() to authenticated;');
    expect(sql).toContain('grant execute on function public.distribute_unassigned_papers() to authenticated;');
  });

  it('ends with four ok checks and has no dashes in its plain-English text', () => {
    const checks = sql.slice(sql.indexOf('-- CHECK'));
    expect((checks.match(/'ok'/g) ?? []).length).toBe(4);
    expect(sql).not.toMatch(/[–—]/);
  });

  it('never alters question text', () => {
    expect(sql).not.toMatch(/update\s+public\.(audit|bank)_questions/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
  });
});
