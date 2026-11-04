import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHECKS,
  LIVE_FIELDS,
  NO_LIVE_FILTER,
  PUBLISH_FIELDS,
  TRAIL_STAGES,
  allChecksPass,
  buildQuestionChanges,
  canPublishNow,
  canSendBack,
  errorWords,
  fieldDirty,
  fieldPayload,
  fieldProblem,
  filterLivePapers,
  leftOutConfirmText,
  leftOutText,
  liveCounts,
  marksMismatch,
  normaliseChecks,
  normaliseLivePapers,
  normaliseNeedsQuestions,
  normaliseNeedsYouPapers,
  normalisePreview,
  normaliseReadyPapers,
  normaliseTrail,
  normaliseTrustOverall,
  normaliseUploads,
  overallProgress,
  overallUnlocks,
  stageIndex,
  trailSentence,
  uploadDecisionProblem,
  whyItNeedsYou,
} from '@/lib/hod-publish';

const four = (ok: boolean[]) => CHECKS.map((c, i) => ({ key: c.key, label: c.label, ok: ok[i], detail: ok[i] ? '' : 'Not yet.' }));
const DASH = /[–—]/;

describe('the four checks', () => {
  it('always come back as four, in order, whatever the server sent', () => {
    expect(normaliseChecks(four([true, true, true, true])).map((c) => c.key)).toEqual(CHECKS.map((c) => c.key));
    expect(normaliseChecks([four([true, true, true, true])[2]]).map((c) => c.key)).toEqual(CHECKS.map((c) => c.key));
  });

  it('a check that did not load, or a payload that is not a list, is NOT ok', () => {
    expect(allChecksPass(normaliseChecks(null))).toBe(false);
    expect(allChecksPass(normaliseChecks('garbage'))).toBe(false);
    const partial = normaliseChecks([four([true, true, true, true])[0]]);
    expect(partial.filter((c) => c.ok)).toHaveLength(1);
    expect(allChecksPass(partial)).toBe(false);
  });

  it('only all four ok passes, and only a literal true counts', () => {
    expect(allChecksPass(normaliseChecks(four([true, true, true, true])))).toBe(true);
    expect(allChecksPass(normaliseChecks(four([true, true, true, false])))).toBe(false);
    expect(allChecksPass(normaliseChecks([{ key: 'questions_checked', ok: 'yes' }]))).toBe(false);
    expect(allChecksPass(null)).toBe(false);
    expect(allChecksPass([])).toBe(false);
  });
});

describe('Publish is enabled only when all four checks pass', () => {
  const ok = normaliseChecks(four([true, true, true, true]));
  it('is off while any check fails', () => {
    for (let i = 0; i < 4; i++) {
      const flags = [true, true, true, true];
      flags[i] = false;
      expect(canPublishNow(normaliseChecks(four(flags)), 0, true, true)).toBe(false);
    }
  });
  it('is on when all four pass and nothing is left out', () => {
    expect(canPublishNow(ok, 0, false, true)).toBe(true);
  });
  it('needs the left-out tick when questions are left out, and says how many', () => {
    expect(canPublishNow(ok, 3, false, true)).toBe(false);
    expect(canPublishNow(ok, 3, true, true)).toBe(true);
    expect(leftOutConfirmText(1)).toBe('I know 1 question is left out. It will not go live.');
    expect(leftOutConfirmText(3)).toBe('I know 3 questions are left out. They will not go live.');
  });
  it('is off for a paper that is not waiting', () => {
    expect(canPublishNow(ok, 0, true, false)).toBe(false);
  });
  it('the Publish step is wired to it, and shows the server refusal as written', () => {
    const src = readFileSync('src/components/hod/PublishFlow.tsx', 'utf8');
    expect(src).toContain('canPublishNow(data.checks, leftOutCount, confirmedLeftOut, waiting)');
    expect(src).toMatch(/disabled=\{!canPublish\}/);
    expect(src).toContain('errorWords(err)');
    expect(src).toContain('Not published');
  });
});

describe('left out questions', () => {
  it('reads as N questions left out', () => {
    expect(leftOutText(0)).toBeNull();
    expect(leftOutText(1)).toBe('1 question left out');
    expect(leftOutText(12)).toBe('12 questions left out');
  });
});

describe('the route trail', () => {
  it('has the five stops in the pipeline words', () => {
    expect(TRAIL_STAGES.map((s) => s.label)).toEqual(['Read', 'Checking by students', 'Needs you', 'Ready', 'Live']);
    expect(stageIndex('needs_you')).toBe(2);
    expect(trailSentence('ready')).toBe('Where it is: step 4 of 5, Ready.');
  });
  it('drops rows with no id or an unknown stage', () => {
    const rows = normaliseTrail([{ audit_paper_id: 'a', stage: 'live', total: '4' }, { audit_paper_id: 'b', stage: 'mystery' }, { stage: 'read' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(4);
  });
});

describe('Needs you', () => {
  it('reads papers with their counts', () => {
    const [p] = normaliseNeedsYouPapers([{ audit_paper_id: 'a', title: 'Maths', escalated: 2, admin_bucket: '1', total: 30, is_live: false }]);
    expect(p).toMatchObject({ escalated: 2, admin_bucket: 1, total: 30, title: 'Maths' });
  });
  it('keeps the question words byte for byte and sorts by order', () => {
    const qs = normaliseNeedsQuestions([
      { id: 'q2', paper_id: 'p', ord: 5, body: 'second', review_bucket: 'admin' },
      { id: 'q1', paper_id: 'p', ord: 2, body: '  Solve   $x^2$  \n', review_bucket: 'escalated', marks: '3', flag_reasons: ['x', 4] },
      { paper_id: 'p', body: 'no id' },
    ]);
    expect(qs.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(qs[0].body).toBe('  Solve   $x^2$  \n');
    expect(qs[0].marks).toBe(3);
    expect(qs[0].flag_reasons).toEqual(['x']);
  });
  it('explains in plain words why a question came to the HOD', () => {
    const [esc, adm] = normaliseNeedsQuestions([
      { id: 'a', paper_id: 'p', ord: 1, body: 'b', review_bucket: 'escalated', escalated_by_name: 'Asha', reason: 'Wrong picture' },
      { id: 'b', paper_id: 'p', ord: 2, body: 'b', review_bucket: 'admin' },
    ]);
    expect(whyItNeedsYou(esc)).toBe('Asha asked you: Wrong picture');
    expect(whyItNeedsYou(adm)).toMatch(/could not settle/);
    expect(canSendBack(esc)).toBe(true);
    expect(canSendBack(adm)).toBe(false);
  });
  it('a fix sends only what changed, with the words exactly as typed', () => {
    const orig = { body: 'Find x', display_number: '4', marks: 2 };
    expect(buildQuestionChanges(orig, { body: 'Find x', number: '4', marks: '2' })).toEqual({ changes: {} });
    expect(buildQuestionChanges(orig, { body: ' Find  y\n', number: '4', marks: '2' })).toEqual({ changes: { body: ' Find  y\n' } });
    expect(buildQuestionChanges(orig, { body: 'Find x', number: '4(a)', marks: '2.5' })).toEqual({ changes: { display_number: '4(a)', marks: 2.5 } });
    expect('error' in buildQuestionChanges(orig, { body: 'Find x', number: '', marks: '2' })).toBe(true);
    expect('error' in buildQuestionChanges(orig, { body: 'Find x', number: '4', marks: 'abc' })).toBe(true);
    expect('error' in buildQuestionChanges(orig, { body: '   ', number: '4', marks: '2' })).toBe(true);
  });
});

describe('Ready to go live', () => {
  it('reads each paper and works out all_ok from the four checks itself', () => {
    const [a, b] = normaliseReadyPapers([
      { audit_paper_id: 'a', title: 'A', question_count: 10, passed_count: 10, checks: four([true, true, true, true]), all_ok: false },
      { audit_paper_id: 'b', title: 'B', checks: four([true, false, true, true]), all_ok: true, kind: 'retro' },
    ]);
    expect(a.all_ok).toBe(true);
    expect(b.all_ok).toBe(false);
    expect(b.kind).toBe('retro');
  });

  const preview = {
    paper: {
      audit_paper_id: 'p1',
      title: 'Economics ICSE 2023',
      approval_state: 'awaiting',
      kind: 'new',
      header: { school: 'S', cls: 'X', subject: 'Eco', board: 'ICSE', year: 'year-unknown', marks: '80', allowed_time_minutes: 150, general_instructions: 'Answer all.' },
      marks_from_questions: 70,
    },
    questions: [
      { id: 'b', ord: 2, kind: 'question', state: 'set_aside', body: 'x', set_aside_reason: 'torn' },
      { id: 'a', ord: 1, kind: 'question', state: 'passed', body: '  verbatim  ', has_picture: true, picture_staged: false },
      { id: 's', ord: 0, kind: 'section_break', state: 'section', body: 'SECTION A' },
    ],
    counts: { total: 2, passed: 1, open: 0, set_aside: 1 },
    pages: [{ page: 1, object_path: 'pages/p1/1.jpg' }, { page: 2 }],
    checks: four([false, true, true, true]),
  };
  it('reads the preview: ordered rows, numbers as numbers, placeholder year as unknown', () => {
    const p = normalisePreview(preview);
    expect(p.questions.map((q) => q.id)).toEqual(['s', 'a', 'b']);
    expect(p.questions[1].body).toBe('  verbatim  ');
    expect(p.paper.header.marks).toBe(80);
    expect(p.paper.header.year).toBeNull();
    expect(p.counts.set_aside).toBe(1);
    expect(p.pages).toHaveLength(1);
    expect(allChecksPass(p.checks)).toBe(false);
  });
  it('refuses a payload that is not a paper', () => {
    expect(() => normalisePreview({})).toThrow();
    expect(() => normalisePreview(null)).toThrow();
  });
  it('warns when the header marks and the question marks disagree', () => {
    const p = normalisePreview(preview);
    expect(marksMismatch(p.paper.header, p.paper.marks_from_questions)).toMatch(/80 marks.*70/);
    expect(marksMismatch({ marks: 70 }, 70)).toBeNull();
    expect(marksMismatch({ marks: null }, 70)).toBeNull();
  });
});

describe('the header fields', () => {
  const def = (k: string) => [...PUBLISH_FIELDS].find((f) => f.key === k)!;
  it('lists the fields the owner named, and the live list leaves out the board-paper switch', () => {
    expect(PUBLISH_FIELDS.map((f) => f.key)).toEqual(
      expect.arrayContaining(['cls', 'subject', 'board', 'year', 'school', 'exam', 'marks', 'allowed_time_minutes', 'general_instructions', 'incomplete_note']),
    );
    expect(LIVE_FIELDS.some((f) => f.key === 'is_board_paper')).toBe(false);
  });
  it('refuses blank required fields and bad numbers in plain words', () => {
    expect(fieldProblem(def('cls'), '  ')).toBe('This cannot be left blank.');
    expect(fieldProblem(def('year'), '')).toBeNull();
    expect(fieldProblem(def('marks'), '1001')).toMatch(/0 to 1000/);
    expect(fieldProblem(def('marks'), '80')).toBeNull();
    expect(fieldProblem(def('allowed_time_minutes'), '2.5')).toMatch(/whole number/);
    expect(fieldProblem(def('allowed_time_minutes'), '150')).toBeNull();
  });
  it('trims short fields but sends instructions as typed, and only a change counts as dirty', () => {
    expect(fieldPayload(def('school'), '  Hill  ')).toBe('Hill');
    expect(fieldPayload(def('general_instructions'), ' a\n b ')).toBe(' a\n b ');
    expect(fieldDirty(def('school'), 'Hill ', 'Hill')).toBe(false);
    expect(fieldDirty(def('school'), 'Hills', 'Hill')).toBe(true);
  });
});

describe('Live papers', () => {
  const rows = normaliseLivePapers([
    { paper_id: '1', title: 'A', subject: 'Maths', cls: 'X', school: 'Hill', is_published: true },
    { paper_id: '2', title: 'B', subject: 'Physics', cls: 'XII', school: 'River', is_published: false, hidden_reason: 'dup' },
    { paper_id: '3', title: 'C', subject: 'Maths', cls: 'XII', school: 'Hill', is_published: true, waiting_you: 2 },
  ]);
  it('counts Live and Hidden only', () => {
    expect(liveCounts(rows)).toEqual({ live: 2, hidden: 1 });
  });
  it('filters by status, subject, class and text', () => {
    expect(filterLivePapers(rows, { ...NO_LIVE_FILTER, status: 'hidden' }).map((r) => r.paper_id)).toEqual(['2']);
    expect(filterLivePapers(rows, { ...NO_LIVE_FILTER, subject: 'Maths' })).toHaveLength(2);
    expect(filterLivePapers(rows, { ...NO_LIVE_FILTER, subject: 'Maths', cls: 'XII' }).map((r) => r.paper_id)).toEqual(['3']);
    expect(filterLivePapers(rows, { ...NO_LIVE_FILTER, q: 'river' }).map((r) => r.paper_id)).toEqual(['2']);
  });
});

describe('Student uploads', () => {
  it('reads rows and never carries a contact', () => {
    const [u] = normaliseUploads([{ id: 'u', status: 'pending', file_paths: ['a/b.pdf'], submitter_name: 'Ishaan', phone: '999' }]);
    expect(u.file_count).toBe(1);
    expect(Object.keys(u)).not.toContain('phone');
  });
  it('rejecting needs a reason; approving does not', () => {
    expect(uploadDecisionProblem('rejected', '  ')).toBe('Say why it is rejected.');
    expect(uploadDecisionProblem('rejected', 'Too dark')).toBeNull();
    expect(uploadDecisionProblem('approved', '')).toBeNull();
  });
});

describe('AI trust: the overall counter', () => {
  it('reads a one-row table and says X of 100 checks', () => {
    const o = normaliseTrustOverall([{ checks_done: 34, agreed: 31, changed: 3, threshold: 100, reached: false, agreement_rate: 0.9118 }]);
    expect(overallProgress(o)).toBe('34 of 100 checks');
    expect(o.reached).toBe(false);
    expect(overallUnlocks(o)).toMatch(/66 more checks to go/);
  });

  it('never prints past the bar: at or above 100 it says 100 of 100, reached', () => {
    const at = normaliseTrustOverall([{ checks_done: 100, agreed: 98, changed: 2, threshold: 100, reached: true, agreement_rate: 0.98 }]);
    const past = normaliseTrustOverall([{ checks_done: 250, agreed: 240, changed: 10, threshold: 100, reached: true, agreement_rate: 0.96 }]);
    expect(overallProgress(at)).toBe('100 of 100 checks, reached');
    expect(overallProgress(past)).toBe('100 of 100 checks, reached');
  });
  it('shows no rate before any check, and says what it unlocks once reached', () => {
    const none = normaliseTrustOverall({ checks_done: 0, threshold: 100, reached: false, agreement_rate: 0 });
    expect(none.agreement_rate).toBeNull();
    const done = normaliseTrustOverall({ checks_done: 120, agreed: 110, changed: 10, threshold: 100, reached: true });
    expect(done.reached).toBe(true);
    expect(overallUnlocks(done)).toMatch(/approve clean questions/);
  });
});

describe('error words', () => {
  it('shows the server sentence as written', () => {
    expect(errorWords({ message: 'This paper cannot go live yet. Every question is checked: 12 questions are set aside.' })).toBe(
      'This paper cannot go live yet. Every question is checked: 12 questions are set aside.',
    );
  });
  it('explains a stale version, and falls back when there is no message', () => {
    expect(errorWords({ code: '40001', message: 'x' })).toMatch(/Someone changed this question/);
    expect(errorWords(null)).toMatch(/Nothing was changed/);
  });
});

describe('copy', () => {
  it('has no em or en dashes', () => {
    const words = [
      ...TRAIL_STAGES.flatMap((s) => [s.label, s.hint]),
      ...CHECKS.flatMap((c) => [c.label, c.short, c.fixHint]),
      ...PUBLISH_FIELDS.flatMap((f) => [f.label, f.hint ?? '']),
      leftOutConfirmText(2),
      overallUnlocks(normaliseTrustOverall({ checks_done: 1, threshold: 100 })),
      overallUnlocks(normaliseTrustOverall({ checks_done: 100, threshold: 100, reached: true })),
    ];
    for (const w of words) expect(w).not.toMatch(DASH);
  });
});
