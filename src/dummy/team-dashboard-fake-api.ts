import type { TeamDashboardApi, TeamStatsRow, PaperProgressRow, QuestionHistoryRow } from '@/lib/team-dashboard-api';

/**
 * In-memory fake of the Team dashboard RPCs, made-up data only (D75 rule:
 * fixtures are never copied from a real paper or a real person). Lets the
 * owner preview the dashboard and the per-question timeline without a
 * login or the migration being applied yet.
 */

const FAKE_STATS: TeamStatsRow[] = [
  { user_id: 'dummy-checker-1', name: 'Ananya Roy', questions_checked: 58, passed: 40, fixed: 14, asked_help: 4, skipped: 6, papers_completed: 3, median_seconds: 42, admin_overturns: 0 },
  { user_id: 'dummy-checker-2', name: 'Rohan Ghosh', questions_checked: 31, passed: 20, fixed: 9, asked_help: 2, skipped: 3, papers_completed: 1, median_seconds: 95, admin_overturns: 2 },
  { user_id: 'dummy-checker-3', name: 'Ipsita Sarkar', questions_checked: 12, passed: 9, fixed: 2, asked_help: 1, skipped: 0, papers_completed: 0, median_seconds: null, admin_overturns: 0 },
];

const FAKE_PROGRESS: PaperProgressRow[] = [
  { audit_paper_id: 'dummy-audit-paper-1', live_bank_paper_id: 'dummy-paper-1', subject: 'Mathematics', cls: 'X', school: 'Dummy Academy', open_doubts: 2, cleared: 18, total: 20, pct_done: 90, last_activity: new Date().toISOString(), workers: ['Ananya Roy'] },
  { audit_paper_id: 'dummy-audit-paper-2', live_bank_paper_id: 'dummy-paper-2', subject: 'Economics', cls: 'XII', school: 'Dummy Public School', open_doubts: 9, cleared: 6, total: 15, pct_done: 40, last_activity: new Date(Date.now() - 3600_000).toISOString(), workers: ['Rohan Ghosh', 'Ipsita Sarkar'] },
  { audit_paper_id: 'dummy-audit-paper-3', live_bank_paper_id: null, subject: 'History & Civics', cls: 'IX', school: 'School not recorded', open_doubts: 0, cleared: 0, total: 0, pct_done: 0, last_activity: null, workers: [] },
];

// 40 more made-up papers so Show more has something to show.
const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Economics', 'Commerce', 'Geography', 'English'];
const CLASSES = ['IX', 'X', 'XI', 'XII'];
const GENERATED: PaperProgressRow[] = Array.from({ length: 40 }, (_, i) => {
  const total = 12 + (i % 7) * 3;
  const cleared = Math.min(total, 2 + ((i * 5) % total));
  return {
    audit_paper_id: `dummy-audit-paper-gen-${i}`,
    live_bank_paper_id: null,
    subject: SUBJECTS[i % SUBJECTS.length],
    cls: CLASSES[i % CLASSES.length],
    school: `Dummy School ${String.fromCharCode(65 + (i % 12))}`,
    open_doubts: total - cleared,
    cleared,
    total,
    pct_done: Math.round((cleared / total) * 100),
    last_activity: new Date(Date.now() - i * 3600_000).toISOString(),
    workers: i % 3 === 0 ? [] : ['Ananya Roy'],
  };
});

const FAKE_HISTORY: QuestionHistoryRow[] = [
  { at: '2026-09-20T04:00:00Z', actor_kind: 'ai', actor_name: 'system', action: 'created', detail: null, before: null, after: ['ai_doubt'] },
  { at: '2026-09-20T04:00:01Z', actor_kind: 'ai', actor_name: 'system', action: 'ai_flagged', detail: 'The answer may have been typed into the question', before: null, after: ['ai_doubt'] },
  { at: '2026-09-22T09:14:00Z', actor_kind: 'checker', actor_name: 'Ananya Roy', action: 'checker_fix', detail: null, before: '15. Solve for x...', after: 'Solve for x...' },
  { at: '2026-09-23T11:02:00Z', actor_kind: 'system', actor_name: 'system', action: 'live_apply', detail: null, before: 'Solve for x...(old)', after: 'Solve for x...' },
  { at: '2026-09-24T08:30:00Z', actor_kind: 'admin', actor_name: 'Owner', action: 'admin_edit_bank_question', detail: 'Corrected the marks', before: 2, after: 3 },
];

async function delay<T>(value: T): Promise<T> {
  await new Promise((r) => setTimeout(r, 150));
  return value;
}

export const dummyTeamDashboardApi: TeamDashboardApi = {
  teamStats: () => delay(FAKE_STATS),
  paperProgress: () => delay([...FAKE_PROGRESS, ...GENERATED]),
  // Two ids make the other states visible: "fail" cannot be read, "empty" has no history.
  questionHistory: async (id: string) => {
    if (id === 'fail') {
      await delay(null);
      throw new Error('Made-up failure');
    }
    return delay(id === 'empty' ? [] : FAKE_HISTORY);
  },
};
