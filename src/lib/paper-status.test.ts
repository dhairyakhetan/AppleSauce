import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_MOMENTS,
  MOMENTS,
  STAGES,
  STAGE_ORDER,
  STAGE_TAB,
  STUCK_DAYS,
  activityLookup,
  buildTimeline,
  checkerCardLine,
  daysSince,
  hasUndatedSteps,
  isPaperStage,
  normaliseActivity,
  normaliseMoments,
  parseStageParam,
  shortDate,
  stageOfApprovalRow,
  stageOfAssignment,
  stageOfCheckerCard,
  stageOfFree,
  stageOfHeldBack,
  stageOfLive,
  stageOfReady,
  stuckReason,
  waitingForHodReason,
  waitingReason,
} from '@/lib/paper-status';

const NOW = new Date('2026-11-13T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('paper status: the stages and their words', () => {
  it('has the five stages in order, each with its own words', () => {
    expect(STAGE_ORDER).toEqual(['not_ready', 'ready', 'checking', 'waiting', 'live']);
    expect(STAGES.not_ready.label).toBe('Not ready');
    expect(STAGES.ready.label).toBe('Ready, waiting for a checker');
    expect(STAGES.checking.label).toBe('Being checked');
    expect(STAGES.waiting.label).toBe('Checked, waiting to go live');
    expect(STAGES.live.label).toBe('Live');
    // The strip uses the short words.
    expect(STAGE_ORDER.map((s) => STAGES[s].short)).toEqual(['Not ready', 'Ready', 'Being checked', 'Waiting approval', 'Live']);
  });

  it('every stage has a plain sentence for the tooltip and for screen readers', () => {
    for (const s of STAGE_ORDER) expect(STAGES[s].hint.length).toBeGreaterThan(10);
  });

  it('knows a stage name from anything else', () => {
    expect(isPaperStage('live')).toBe(true);
    expect(isPaperStage('hidden')).toBe(false);
    expect(parseStageParam('checking')).toBe('checking');
    expect(parseStageParam('nonsense')).toBeNull();
    expect(parseStageParam(null)).toBeNull();
  });

  it('the first three stages are lists on Assignments; waiting and live have their own tabs', () => {
    expect(STAGE_TAB).toEqual({ not_ready: 'assignments', ready: 'assignments', checking: 'assignments', waiting: 'ready', live: 'live' });
  });
});

describe('paper status: which stage a row is at', () => {
  it('each HOD list says its own stage', () => {
    expect(stageOfHeldBack()).toBe('not_ready');
    expect(stageOfFree()).toBe('ready');
    expect(stageOfAssignment()).toBe('checking');
  });

  it('a row waiting for a yes is "waiting", and the same row already on the site is "live"', () => {
    expect(stageOfReady({ is_live: false })).toBe('waiting');
    expect(stageOfReady({})).toBe('waiting');
    expect(stageOfReady({ is_live: true })).toBe('live');
  });

  it('a hidden paper has no stage', () => {
    expect(stageOfLive({ is_published: true })).toBe('live');
    expect(stageOfLive({ is_published: false })).toBeNull();
  });

  it('a checker card with questions left is being checked; with none left it waits for approval', () => {
    expect(stageOfCheckerCard({ remaining: 4 })).toBe('checking');
    expect(stageOfCheckerCard({ remaining: 0 })).toBe('waiting');
  });

  it('the admin screen: an old live paper stays live, a new one is checking until nothing is open', () => {
    expect(stageOfApprovalRow({ kind: 'retro', open: 3 })).toBe('live');
    expect(stageOfApprovalRow({ kind: 'new', open: 3 })).toBe('checking');
    expect(stageOfApprovalRow({ kind: 'new', open: 0 })).toBe('waiting');
  });

  it('a later "Live" label reads the same shape as "Checked, waiting to go live" (only words and colour change)', () => {
    const waiting = stageOfReady({ is_live: false });
    const live = stageOfReady({ is_live: true });
    expect(STAGES[waiting].key).not.toBe(STAGES[live].key);
    expect(Object.keys(STAGES[waiting]).sort()).toEqual(Object.keys(STAGES[live]).sort());
  });
});

describe('paper status: the checker card line', () => {
  it('says how many are left, and who else holds some', () => {
    expect(checkerCardLine({ remaining: 3, with_hod: 0 })).toBe('3 questions left for you.');
    expect(checkerCardLine({ remaining: 1, with_hod: 2 })).toBe('1 question left for you. 2 questions waiting for the HOD.');
  });
  it('when the checker is done it says what the paper waits for', () => {
    expect(checkerCardLine({ remaining: 0, with_hod: 2 })).toBe('Your part is done. 2 questions waiting for the HOD.');
    expect(checkerCardLine({ remaining: 0, with_hod: 0 })).toBe('Your part is done. It waits for approval before it goes live.');
  });
});

describe('paper status: stuck means nothing done for 7 days', () => {
  const held = { paper_id: 'p1', user_id: 'u1', checker_name: 'Asha', assigned_at: daysAgo(9), started_at: null as string | null };

  it('the 7 is one named constant', () => {
    expect(STUCK_DAYS).toBe(7);
  });

  it('the number 7 days is not written anywhere else in the code that decides this', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) files.push(p);
      }
    };
    walk('src');
    const definers = files.filter((f) => /export const STUCK_DAYS\s*=/.test(readFileSync(f, 'utf8')));
    expect(definers.map((f) => f.replace(/\\/g, '/'))).toEqual(['src/lib/paper-status.ts']);
    // The screens read the constant and never write their own copy of the number.
    for (const f of ['src/components/hod/AssignmentsTab.tsx', 'src/components/hod/ReadyTab.tsx', 'src/components/hod/HodStageStrip.tsx']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/\b7\s*\*\s*(24|86)/);
    }
  });

  it('with the server last-action times: nothing done for 7 days is stuck, and the reason names the person and the days', () => {
    const lookup = activityLookup([{ audit_paper_id: 'p1', user_id: 'u1', last_action_at: daysAgo(8) }]);
    expect(stuckReason(held, lookup, NOW)).toBe('Asha has done nothing on this for 8 days.');
  });

  it('exactly 7 days is stuck, 6 days is not', () => {
    expect(stuckReason(held, activityLookup([{ audit_paper_id: 'p1', user_id: 'u1', last_action_at: daysAgo(7) }]), NOW)).not.toBeNull();
    expect(stuckReason(held, activityLookup([{ audit_paper_id: 'p1', user_id: 'u1', last_action_at: daysAgo(6) }]), NOW)).toBeNull();
  });

  it('a holder who has done nothing at all is judged from the day it was given', () => {
    const lookup = activityLookup([{ audit_paper_id: 'p1', user_id: 'u1', last_action_at: null }]);
    expect(stuckReason(held, lookup, NOW)).toBe('Asha was given this 9 days ago and has not started it.');
    expect(stuckReason({ ...held, assigned_at: daysAgo(3) }, lookup, NOW)).toBeNull();
  });

  it('a paper missing from the server answer counts as nothing done since it was given', () => {
    expect(stuckReason(held, activityLookup([]), NOW)).toContain('has not started it');
  });

  it('a checker with nothing left to do is never called stuck: the rest waits for an HOD (13 Nov 2026: 32 papers were blamed wrongly)', () => {
    const lookup = activityLookup([{ audit_paper_id: 'p1', user_id: 'u1', last_action_at: daysAgo(18) }]);
    expect(stuckReason({ ...held, remaining: 0 }, lookup, NOW)).toBeNull();
    expect(stuckReason({ ...held, remaining: 0 }, null, NOW)).toBeNull();
    // With work left the old rule still applies, and a row without the number is judged as before.
    expect(stuckReason({ ...held, remaining: 3 }, lookup, NOW)).toContain('has done nothing on this for 18 days');
    expect(stuckReason(held, lookup, NOW)).toContain('has done nothing on this for 18 days');
  });

  it('waitingForHodReason: only for nothing left, held 7 days or more, and it blames nobody', () => {
    const done = { checker_name: 'Asha', assigned_at: daysAgo(9), remaining: 0 };
    expect(waitingForHodReason(done, NOW)).toBe('Asha has finished their part. The questions that are left wait for an HOD to decide (open Needs you).');
    expect(waitingForHodReason({ ...done, assigned_at: daysAgo(7) }, NOW)).not.toBeNull();
    expect(waitingForHodReason({ ...done, assigned_at: daysAgo(6) }, NOW)).toBeNull();
    expect(waitingForHodReason({ ...done, remaining: 2 }, NOW)).toBeNull();
    expect(waitingForHodReason({ checker_name: null, assigned_at: daysAgo(9) }, NOW)).toBeNull();
    expect(waitingForHodReason({ ...done, assigned_at: null }, NOW)).toBeNull();
    expect(waitingForHodReason({ ...done, checker_name: null }, NOW)).toContain('The checker has finished their part');
    expect(waitingForHodReason(done, NOW)).not.toMatch(/nothing on this|not started/);
  });

  it('without the server answer, only a paper never started can be stuck (a started one might have been worked on last night)', () => {
    expect(stuckReason(held, null, NOW)).toBe('Asha was given this 9 days ago and has not started it.');
    expect(stuckReason({ ...held, started_at: daysAgo(8) }, null, NOW)).toBeNull();
    expect(stuckReason({ ...held, assigned_at: daysAgo(2) }, null, NOW)).toBeNull();
  });

  it('a holder with no name still gets a sentence, and a missing date is never an alarm', () => {
    expect(stuckReason({ ...held, checker_name: null }, null, NOW)).toMatch(/^The checker was given this/);
    expect(stuckReason({ ...held, assigned_at: null }, null, NOW)).toBeNull();
    expect(stuckReason({ ...held, assigned_at: 'not a date' }, null, NOW)).toBeNull();
  });

  it('a paper waiting for a yes: failing checks and a long wait are said in words', () => {
    const checks = [
      { key: 'pictures', ok: false },
      { key: 'marks', ok: true },
    ] as never;
    expect(waitingReason({ checks, queued_at: daysAgo(1) }, NOW)).toMatch(/^These checks are not passing yet: .+\.$/);
    expect(waitingReason({ checks: [], queued_at: daysAgo(10) }, NOW)).toBe('It has waited for a yes for 10 days.');
    expect(waitingReason({ checks: [], queued_at: daysAgo(2) }, NOW)).toBeNull();
    expect(waitingReason({ checks, queued_at: daysAgo(10) }, NOW)).toContain('waited for a yes for 10 days');
    // A paper that is already on the site is never "held up".
    expect(waitingReason({ checks, queued_at: daysAgo(30), is_live: true }, NOW)).toBeNull();
  });

  it('counts whole days and ignores a missing date', () => {
    expect(daysSince(daysAgo(3), NOW)).toBe(3);
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince('x', NOW)).toBeNull();
    expect(daysSince(new Date(NOW.getTime() + 86_400_000).toISOString(), NOW)).toBe(0);
  });
});

describe('paper status: the key moments of a paper', () => {
  it('lists the six key moments, not every click', () => {
    expect(MOMENTS.map((m) => m.label)).toEqual(['Loaded', 'Pictures complete', 'Given to a checker', 'Finished by checkers', 'Approved', 'Live']);
  });

  it('a paper that is not ready has been loaded and is stuck at its pictures', () => {
    const steps = buildTimeline(EMPTY_MOMENTS, 'not_ready');
    expect(steps.map((s) => s.state)).toEqual(['done', 'current', 'later', 'later', 'later', 'later']);
  });

  it('being checked: loaded, pictures and given out are done; the paper is on "Finished by checkers"', () => {
    const steps = buildTimeline(EMPTY_MOMENTS, 'checking');
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'current', 'later', 'later']);
  });

  it('waiting to go live: only approval and going live are left', () => {
    expect(buildTimeline(EMPTY_MOMENTS, 'waiting').map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'current', 'later']);
  });

  it('live: every step is done', () => {
    expect(buildTimeline(EMPTY_MOMENTS, 'live').every((s) => s.state === 'done')).toBe(true);
  });

  it('a recorded date marks its step done and is carried through', () => {
    const steps = buildTimeline({ ...EMPTY_MOMENTS, loaded_at: daysAgo(20), given_at: daysAgo(5) }, 'checking');
    expect(steps[0].at).toBe(daysAgo(20));
    expect(steps[2].at).toBe(daysAgo(5));
    expect(steps[1].at).toBeNull();
    expect(steps[1].state).toBe('done');
  });

  it('there is only ever one current step', () => {
    for (const stage of STAGE_ORDER) expect(buildTimeline(EMPTY_MOMENTS, stage).filter((s) => s.state === 'current').length).toBeLessThanOrEqual(1);
  });

  it('says when a finished step has no date to show', () => {
    expect(hasUndatedSteps(buildTimeline(EMPTY_MOMENTS, 'checking'))).toBe(true);
    const all = buildTimeline(
      { loaded_at: daysAgo(9), pictures_at: daysAgo(8), given_at: daysAgo(7), finished_at: null, approved_at: null, live_at: null },
      'checking',
    );
    expect(all.filter((s) => s.state === 'done').every((s) => s.at !== null)).toBe(true);
    expect(hasUndatedSteps(all)).toBe(false);
  });

  it('reads the server row, an array of one row, or says nothing when there is nothing', () => {
    const row = { loaded_at: '2026-10-01T00:00:00Z', pictures_at: null, given_at: '2026-10-05T00:00:00Z', finished_at: null, approved_at: null, live_at: null };
    expect(normaliseMoments(row)?.loaded_at).toBe('2026-10-01T00:00:00Z');
    expect(normaliseMoments([row])?.given_at).toBe('2026-10-05T00:00:00Z');
    expect(normaliseMoments([])).toBeNull();
    expect(normaliseMoments(null)).toBeNull();
    expect(normaliseMoments({ loaded_at: null })).toBeNull();
    expect(normaliseMoments('x')).toBeNull();
  });

  it('reads the activity rows and skips the broken ones', () => {
    const rows = normaliseActivity([
      { audit_paper_id: 'p1', user_id: 'u1', last_action_at: '2026-11-01T00:00:00Z' },
      { audit_paper_id: 'p2', user_id: 'u2', last_action_at: null },
      { audit_paper_id: 'p3' },
      null,
    ]);
    expect(rows).toEqual([
      { audit_paper_id: 'p1', user_id: 'u1', last_action_at: '2026-11-01T00:00:00Z' },
      { audit_paper_id: 'p2', user_id: 'u2', last_action_at: null },
    ]);
    expect(normaliseActivity('nope')).toEqual([]);
  });

  it('writes a short date and survives a bad one', () => {
    expect(shortDate('2026-11-12T12:00:00Z')).toMatch(/12 Nov/);
    expect(shortDate(null)).toBe('');
    expect(shortDate('bad')).toBe('');
  });
});
