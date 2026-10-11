/* The papers route as the database returned it on 11 October 2026 (the real
   numbers from the owner's brief), for tests. Where the brief did not give a
   number (papers per pile, desk statuses, checkers) a made-up one stands in.
   Raw jsonb shape: keys the database leaves out are left out here too. */
export const EXAMPLE_ROUTE_RAW = {
  generated_at: '2026-10-11T09:00:00.000Z',
  registry: {
    total: 8038,
    excluded: 7,
    by_state: { live: 774, loaded: 101, ocr_done: 763, ai_checked: 294, ocr_queued: 101, not_started: 4869, awaiting_approval: 1 },
    frozen_by_state: { live: 611, ocr_done: 255, ocr_queued: 254, fully_checked: 4, loaded: 4, ai_checked: 3, not_started: 3, awaiting_approval: 1 },
    last_updated_at: '2026-10-11T08:55:00.000Z',
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
