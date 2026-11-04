/* The papers route as the database returned it on 12 October 2026 (the real
   numbers from the live read that day), for tests. Where the live database had
   nothing yet (the picture queue and the PDF count on the computer had not been
   synced) the numbers come from the desk's own status files of that day. A
   made-up number is marked.
   Raw jsonb shape: keys the database leaves out are left out here too. */
export const EXAMPLE_ROUTE_RAW = {
  generated_at: '2026-10-12T06:00:00.000Z',
  registry: {
    total: 8038,
    excluded: 13,
    // current stage only: each paper of the new route is in one of these
    by_state: { loaded: 73, ocr_done: 1189, ai_checked: 3, ocr_queued: 121, not_started: 4869 },
    frozen_by_state: { live: 1259, ocr_done: 255, ocr_queued: 254, fully_checked: 4, loaded: 4, ai_checked: 3, not_started: 3, awaiting_approval: 1 },
    // loaded or ai_checked, split by whether the swarm has read the paper (live read, 12 Oct)
    swarm_read: { papers: 74, desk_without_swarm: 2 },
    last_updated_at: '2026-10-08T23:24:22.000Z',
  },
  // desk papers with no PDF path, and live library papers no desk paper points at (live read, 12 Oct)
  no_pdf: { audit_papers: 514, live_only: 1 },
  desk: {
    papers: 479,
    // made up: the split of the 479 desk papers
    papers_by_status: { pending: 408, in_review: 7, passed: 46, red: 18 },
    questions: 14929,
    questions_passed: 171,
  },
  open: {
    questions_by_pile: { kid: 9291, admin: 223, data: 148, none: 5081 },
    papers_by_pile: { kid: 318, admin: 13, data: 11, none: 158 },
    student_papers_by_questions_left: { '1-5': 29, '6-15': 72, '16-40': 129, '41+': 88 },
  },
  checkers: { papers_assigned: 1, active_verifiers: 1 },
  checking: { questions: 9291, papers: 318 },
  needs_you: { questions: 223, papers: 13, escalated_questions: 0, admin_questions: 223 },
  ready: { papers: 2, can_go_live: 1, left_out_questions: 12 },
  live: { total: 1506, hidden: 5, on_route: 129 },
  trust: {
    checks_done: 0,
    agreed: 0,
    changed: 0,
    threshold: 100,
    reached: false,
    agreement_rate: null,
    levels: [
      { level: 'high', decision: 'fix', checked: 0, agreed: 0, waiting: 2, trusted: false },
      { level: 'high', decision: 'pass', checked: 0, agreed: 0, waiting: 69, trusted: false },
      { level: 'medium', decision: 'fix', checked: 0, agreed: 0, waiting: 447, trusted: false },
      { level: 'medium', decision: 'pass', checked: 0, agreed: 0, waiting: 806, trusted: false },
      { level: 'low', decision: 'fix', checked: 0, agreed: 0, waiting: 166, trusted: false },
      { level: 'low', decision: 'pass', checked: 0, agreed: 0, waiting: 35, trusted: false },
    ],
  },
  // From the desk's picture queue status of 12 October: nothing queued yet, 3,382 pictures (702 MB) waiting for their questions to be sorted.
  pictures: {
    queued_papers: 0,
    queued_pictures: 0,
    queued_bytes: 0,
    awaiting_route_questions: 3382,
    awaiting_route_pictures: 3382,
    awaiting_route_bytes: 736100000,
    storage_used_bytes: 607000000,
    storage_cap_bytes: 943718400,
    desk_synced_at: '2026-10-12T05:30:00.000Z',
  },
  // From the drive map of 12 October.
  drive: {
    total_pdfs: 6880,
    classified: 6445,
    unclassified: 434,
    set_aside: 1,
    student_upload: 0,
    loaded_or_live: 710,
    bytes_total: 9971689088,
    by_status: { filed: 4794, read: 942, loaded: 480, live: 230, unclassified: 433, set_aside: 1 },
    generated_at: '2026-10-11T23:42:55.000Z',
    updated_at: '2026-10-12T05:30:00.000Z',
  },
  synced: {
    desk_synced_at: '2026-10-12T05:30:00.000Z',
    drive_synced_at: '2026-10-12T05:30:00.000Z',
    registry_changed_at: '2026-10-08T23:24:22.000Z',
  },
};

/** The same route when the desk has not synced the pictures or the PDF count yet: the shape the live database returned before the desk was wired up. */
export const UNSYNCED_ROUTE_RAW = {
  ...EXAMPLE_ROUTE_RAW,
  pictures: null,
  drive: null,
  synced: { desk_synced_at: null, drive_synced_at: null, registry_changed_at: '2026-10-08T23:24:22.000Z' },
};
