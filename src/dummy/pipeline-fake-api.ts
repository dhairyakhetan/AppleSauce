import type { DailyPoint, FeedRow, PipelineApi, PipelineStats } from '@/lib/pipeline-stats';

/* /admin/pipeline's fake API for dummy mode (D75). Every number and name is
   made up; nothing here is read from the real database. */

function days(): DailyPoint[] {
  const out: DailyPoint[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const k = 30 - i;
    out.push({
      day: d.toISOString().slice(0, 10),
      papers_added: k % 9 === 0 ? 12 : k % 4 === 0 ? 3 : 0,
      desk_papers: k > 24 ? 25 - (k % 3) * 4 : k % 5 === 0 ? 6 : 0,
      questions_cleared: k > 20 ? 120 + k * 9 : k % 6 === 0 ? 40 : 0,
    });
  }
  return out;
}

export function createFakePipelineApi(mode: 'full' | 'error' = 'full', delayMs = 900): PipelineApi {
  const tick = () => new Promise((r) => setTimeout(r, delayMs));
  const stats: PipelineStats = {
    generated_at: new Date().toISOString(),
    library: {
      papers: 1200, published: 980, verified: 610, needs_review: 370, hidden: 220, questions: 31000,
      maths_papers: 400, maths_verified: 388, maths_needs_review: 7, maths_hidden: 5,
    },
    by_subject: [
      { subject: 'Mathematics', published: 395, verified: 388, needs_review: 7, hidden: 5 },
      { subject: 'Physics', published: 210, verified: 120, needs_review: 90, hidden: 40 },
      { subject: 'Chemistry', published: 180, verified: 60, needs_review: 120, hidden: 70 },
      { subject: 'Biology', published: 195, verified: 42, needs_review: 153, hidden: 105 },
    ],
    by_board: { ICSE: 700, ISC: 160, CBSE: 120 },
    desk: { papers: 1500, new_scans: 90, live_copies: 1410, passed: 18, red: 2, by_status: { pending: 1478, passed: 18, red: 4 } },
    queues: { questions: 52000, passed: 21400, student_queue: 640, admin_queue: 35, other_open: 29925, with_figure: 1800 },
    recent_papers: [
      { id: 'demo01', subject: 'Geography', cls: 'X', board: 'ICSE', school: 'Sample High School', year: '2025-26', exam: 'Pre-board Examination', questions: 38, published: true, needs_review: true, created_at: new Date(Date.now() - 2 * 3600e3).toISOString() },
      { id: 'demo02', subject: 'Mathematics', cls: 'IX', board: 'ICSE', school: 'Example Academy', year: '2024-25', exam: 'Term 2', questions: 26, published: true, needs_review: false, created_at: new Date(Date.now() - 26 * 3600e3).toISOString() },
      { id: 'demo03', subject: 'Hindi', cls: 'XII', board: 'ISC', school: null, year: '2026', exam: 'Board Examination', questions: 18, published: false, needs_review: true, created_at: new Date(Date.now() - 50 * 3600e3).toISOString() },
    ],
    daily: days(),
  };
  const feed: FeedRow[] = [
    { at: new Date(Date.now() - 5 * 60e3).toISOString(), stream: 'log', event_id: '1', actor_label: 'ai:sonnet', actor_kind: 'ai', action: 'ai_fix', paper_id: null, detail: 'Fixed an option label on a demo question' },
    { at: new Date(Date.now() - 40 * 60e3).toISOString(), stream: 'log', event_id: '2', actor_label: 'checker', actor_kind: 'checker', action: 'checker_pass', paper_id: null, detail: 'Passed after reading the page picture' },
    { at: new Date(Date.now() - 3 * 3600e3).toISOString(), stream: 'version', event_id: '3', actor_label: 'pipeline', actor_kind: 'pipeline', action: 'paper_loaded', paper_id: null, detail: 'Demo paper loaded to the desk' },
  ];
  return {
    async stats() {
      // a short wait, so the registry (which loads on its own) is seen before the stats arrive
      await tick();
      if (mode === 'error') throw new Error('The pipeline numbers could not be read.');
      return stats;
    },
    async feed(limit) {
      return feed.slice(0, limit);
    },
  };
}
