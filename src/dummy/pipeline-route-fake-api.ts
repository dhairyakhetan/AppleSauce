import { normaliseRoute, type PipelineRoute, type PipelineRouteApi } from '@/lib/pipeline-route';

/* The papers route's fake API for dummy mode (D75). The numbers start at the
   real ones from 11 October 2026 and drift a little on every read, so the
   count tween, the lanes and "Updated ... ago" can be watched working.
   Nothing here is read from the real database. */

type Mode = 'full' | 'error' | 'flaky' | 'empty';

function start() {
  return {
    generated_at: new Date().toISOString(),
    registry: {
      total: 8038,
      excluded: 7,
      by_state: { live: 774, loaded: 101, ocr_done: 763, ai_checked: 294, ocr_queued: 101, not_started: 4869, awaiting_approval: 1 },
      frozen_by_state: { live: 611, ocr_done: 255, ocr_queued: 254, fully_checked: 4, loaded: 4, ai_checked: 3, not_started: 3, awaiting_approval: 1 },
      last_updated_at: new Date().toISOString(),
    },
    desk: {
      papers: 403,
      papers_by_status: { pending: 301, in_review: 62, passed: 33, red: 7 },
      swarm_papers: 188,
      swarm_questions: 5151,
      questions: 14200,
      questions_passed: 6210,
    },
    open: {
      questions_by_pile: { kid: 7403, admin: 295, data: 16740, renderer: 32, none: 26665 },
      papers_by_pile: { kid: 295, admin: 41, data: 188, renderer: 6, none: 402 },
      student_papers_by_questions_left: { '1-5': 47, '6-15': 77, '16-40': 106, '41+': 65 },
    },
    checkers: { papers_assigned: 212, active_verifiers: 14 },
  };
}

/** `mode` reaches the other states: error (never loads), flaky (every third read after the first fails), empty (nothing yet). */
export function createFakePipelineRouteApi(mode: Mode = 'full', delayMs = 700): PipelineRouteApi {
  const d = start();
  let calls = 0;
  const wait = () => new Promise((r) => setTimeout(r, delayMs));
  const step = (n: number) => Math.floor(Math.random() * (n + 1));

  function drift() {
    const s = d.registry.by_state;
    const moved = step(6);
    s.not_started = Math.max(0, s.not_started - moved);
    s.ocr_queued += moved - step(moved);
    s.ocr_done += step(3);
    s.ai_checked += step(2);
    d.desk.swarm_papers += step(2);
    d.desk.swarm_questions += step(60);
    d.desk.questions_passed = Math.min(d.desk.questions, d.desk.questions_passed + step(40));
    d.open.questions_by_pile.kid = Math.max(0, d.open.questions_by_pile.kid - step(30));
    d.open.papers_by_pile.kid = Math.max(0, d.open.papers_by_pile.kid - (step(5) === 0 ? 1 : 0));
    d.desk.papers_by_status.passed += step(1);
    d.generated_at = new Date().toISOString();
  }

  return {
    async route(): Promise<PipelineRoute> {
      calls += 1;
      await wait();
      if (mode === 'error') throw new Error('fake pipeline route failure');
      if (mode === 'flaky' && calls > 1 && calls % 3 === 0) throw new Error('fake pipeline route failure');
      if (mode === 'empty') {
        return normaliseRoute({ generated_at: d.generated_at, registry: {}, desk: {}, open: {}, checkers: {} });
      }
      if (calls > 1) drift();
      return normaliseRoute(JSON.parse(JSON.stringify(d)));
    },
  };
}
