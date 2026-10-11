import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

// CI has no Supabase env; the pages under test only need the client to exist.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import {
  approveCopy,
  approveClosedReason,
  HISTORY_LIMIT,
  historyCapNote,
  isRecordOnly,
  lookupNextWaiting,
  nextWaitingPaper,
  openQuestionsAdvice,
  oldestFirst,
  resolveMode,
  rowStatus,
  type ApprovalQueueRow,
  changesFrom,
  isReady,
  normalisePaperHistory,
  normaliseQuestionHistory,
  normaliseQueueRow,
  normaliseReview,
  questionState,
  versionChanges,
  versionFrom,
  writeErrorWords,
  changesFromDraft,
} from './admin-approval-shape';
import { HistoryList } from '@/components/admin/approval/HistoryPanel';
import { ReviewQuestionCard } from '@/components/admin/approval/ReviewQuestionCard';
import { actionCopy, type Action } from '@/pages/admin/paper-approval';
import { viewFromParam } from '@/pages/admin/paper-approvals';
import { HeldQuestionCard } from '@/components/papers/held-question-card';
import { createFakeApprovalApi, FIXTURE_NOW, FIXTURE_PAPER_ID } from '@/dummy/approval-fake-api';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('approval RPC shapes are absorbed', () => {
  it('reads a queue row under the contract names and near-synonyms', () => {
    const a = normaliseQueueRow({
      audit_paper_id: 'p1',
      board: 'ICSE',
      cls: '10',
      subject: 'Physics',
      year: '2026',
      questions_total: 10,
      passed: 8,
      open: 1,
      set_aside: 1,
      ai_summary: { pass: 7, fix: 1, student: 2 },
      kind: 'retro',
      live_bank_paper_id: 'abc123',
    });
    expect(a.title).toBe('ICSE Class 10 Physics, 2026');
    expect(a.kind).toBe('retro');
    expect(isReady(a)).toBe(false);
    const b = normaliseQueueRow({ id: 'p2', total_questions: '4', passed_questions: 4, open_questions: 0 });
    expect(b.audit_paper_id).toBe('p2');
    expect(b.questions_total).toBe(4);
    expect(b.kind).toBe('new');
    expect(isReady(b)).toBe(true);
  });

  it('maps question status to passed / open / set aside', () => {
    expect(questionState('passed')).toBe('passed');
    expect(questionState('pending', true)).toBe('passed');
    expect(questionState('set_aside')).toBe('set_aside');
    expect(questionState('rejected')).toBe('set_aside');
    expect(questionState('flagged')).toBe('open');
    expect(questionState(null)).toBe('open');
  });

  it('reads a review payload, sorting by ord and counting open rows', () => {
    const r = normaliseReview({
      paper: { audit_paper_id: 'p', board: 'CBSE' },
      rows: [
        { id: 'b', ord: 2, kind: 'question', body: 'two', status: 'pending', options: ['x', { label: 'b', text: 'y' }] },
        { id: 'a', ord: 1, kind: 'question', body: 'one', status: 'passed', version: 3 },
      ],
    });
    expect(r.rows.map((x) => x.id)).toEqual(['a', 'b']);
    expect(r.open_count).toBe(1);
    expect(r.rows[0].version).toBe(3);
    expect(r.rows[1].options).toEqual([{ label: null, text: 'x' }, { label: 'b', text: 'y' }]);
  });

  it('reads admin_paper_review exactly as 20261003100000 returns it', () => {
    const r = normaliseReview({
      paper: {
        audit_paper_id: 'p', title: 'T', board: 'ICSE', class: '10', subject: 'Physics', exam_type: 'Pre-board',
        instructions: 'Answer all.', approval_state: 'awaiting', kind: 'retro', live_bank_paper_id: 'b1', is_live: true,
        approval_note: null,
      },
      counts: { total: 2, passed: 1, open: 1, set_aside: 0 },
      open: 1,
      pages: [{ page: 1, object_path: 'x' }],
      rows: [
        { id: 's', ord: 0, kind: 'section_break', body: 'Section A', state: 'section' },
        { id: 'a', ord: 1, kind: 'question', body: 'one', state: 'passed', figure: { path: 'f/1.webp' }, figure_path: 'f/1.webp', version: 2 },
        { id: 'b', ord: 2, kind: 'question', body: 'two', state: 'open', status: 'passed', set_aside_reason: null },
      ],
    });
    expect(r.paper.cls).toBe('10');
    expect(r.paper.exam).toBe('Pre-board');
    expect(r.paper.general_instructions).toBe('Answer all.');
    expect(r.paper.approval).toBe('pending');
    expect(r.paper.is_published).toBe(true);
    expect(r.open_count).toBe(1);
    expect(r.rows[1].figure).toBe('f/1.webp');
    expect(r.rows[2].state).toBe('open');
  });

  it('turns audit_review_log before/after objects into field changes', () => {
    expect(
      changesFrom({ before: { body: 'a', marks: 2, display_number: '1' }, after: { body: 'b', marks: 2, display_number: '1' } }),
    ).toEqual([{ field: 'body', before: 'a', after: 'b' }]);
    expect(changesFrom({ field: 'review_bucket', before: 'kid', after: 'escalated' })).toEqual([
      { field: 'review_bucket', before: 'kid', after: 'escalated' },
    ]);
    expect(changesFrom({ changes: [{ field: 'marks', before: 1, after: 2 }] })).toEqual([{ field: 'marks', before: 1, after: 2 }]);
  });

  it('reads histories newest first and versions oldest first', () => {
    const h = normaliseQuestionHistory({
      versions: [{ version: 2, snapshot: { body: 'b' }, created_at: '2026-10-02T02:00:00Z' }, { version: 1, body: 'a', created_at: '2026-10-02T01:00:00Z' }],
      events: [{ at: '2026-10-02T01:00:00Z', action: 'x' }, { at: '2026-10-02T03:00:00Z', action: 'y', actor_kind: 'checker' }],
      checks: [{ checker_kind: 'sonnet', verdict: 'pass', confidence: 0.9 }],
    });
    expect(h.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(h.versions[1].body).toBe('b');
    expect(h.events[0].action).toBe('y');
    expect(h.events[0].actor_kind).toBe('student');
    expect(versionChanges(h.versions[0], h.versions[1])).toEqual([{ field: 'body', before: 'a', after: 'b' }]);
    expect(normalisePaperHistory({ events: [{ at: '1', action: 'a' }] })).toHaveLength(1);
  });

  it('reads a version number from any return shape', () => {
    expect(versionFrom(4)).toBe(4);
    expect(versionFrom('5')).toBe(5);
    expect(versionFrom({ version: 6 })).toBe(6);
    expect(versionFrom([{ new_version: 7 }])).toBe(7);
    expect(versionFrom(null)).toBeNull();
  });

  it('explains a failed write in words', () => {
    expect(writeErrorWords({ code: '42501', message: 'Not authorized' }, 'x')).toMatch(/not allowed/);
    expect(writeErrorWords({ message: 'paper has open questions' }, 'x')).toMatch(/still open/);
    expect(writeErrorWords({ message: 'stale version 3' }, 'x')).toMatch(/Someone else changed/);
    expect(writeErrorWords(new Error('boom'), 'fallback')).toBe('fallback');
    expect(writeErrorWords({ code: '55000', message: 'This paper is already off the site' }, 'x')).toBe(
      'This paper is already off the site.',
    );
    expect(writeErrorWords({ code: '55000', message: 'bad live_bank_question_id' }, 'fallback')).toBe('fallback');
    expect(writeErrorWords({ code: '40001', message: 'could not serialize' }, 'x')).toMatch(/Someone else changed/);
    expect(writeErrorWords({ code: '22023', message: 'These fields cannot be edited here: kind' }, 'x')).toMatch(
      /Only the question text/,
    );
    expect(writeErrorWords({ code: '22023', message: 'Say why the question is set aside' }, 'x')).toBe(
      'Say why the question is set aside.',
    );
  });
});

describe('the inline editor sends only what changed', () => {
  const row = normaliseReview({ rows: [{ id: 'q', body: 'Find x.', marks: 2, display_number: '3', options: [] }] }).rows[0];
  it('sends nothing when nothing changed', () => {
    expect(changesFromDraft(row, { body: 'Find x.', number: '3', marks: '2', options: [] })).toEqual({});
  });
  it('sends only the changed fields, and refuses marks that are not a number', () => {
    expect(changesFromDraft(row, { body: 'Find y.', number: '3', marks: '3', options: [] })).toEqual({ body: 'Find y.', marks: 3 });
    expect(changesFromDraft(row, { body: 'Find x.', number: '', marks: '', options: [] })).toEqual({ display_number: null, marks: null });
    expect(changesFromDraft(row, { body: 'Find x.', number: '3', marks: 'two', options: [] })).toBe('bad-marks');
  });
});

describe('rendered history reads like people', () => {
  it('the fixture paper history renders sentences with names, never codes', async () => {
    const api = createFakeApprovalApi(0);
    const events = await api.paperHistory(FIXTURE_PAPER_ID);
    const html = renderToStaticMarkup(<HistoryList events={events} now={FIXTURE_NOW} />);
    const t = text(html);
    expect(t).toContain('Priya Sharma changed the marks on question 2');
    expect(t).toContain('Rahul Das (student checker) fixed a reading mistake in the question text on question 2');
    expect(t).toContain('AI check (Sonnet) passed question 2, confidence 92%');
    expect(t).toContain('Pipeline (automatic) put the paper in the approval queue');
    expect(t).not.toMatch(UUID);
    expect(t).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    expect(t).not.toMatch(/\bai:/);
    expect(t).not.toContain('{');
  });

  it('an approval writes a new history line with the admin\'s name', async () => {
    const api = createFakeApprovalApi(0);
    const queue = await api.queue();
    const ready = queue.find((q) => q.open === 0 && q.kind === 'new');
    expect(ready).toBeTruthy();
    await api.approve(ready!.audit_paper_id, 'Read it end to end');
    const events = await api.paperHistory(ready!.audit_paper_id);
    const t = text(renderToStaticMarkup(<HistoryList events={events} now={FIXTURE_NOW} />));
    expect(t).toContain('Arjun Mehta approved the paper for launch');
    expect(t).toContain('Read it end to end');
    await expect(api.approve(FIXTURE_PAPER_ID, '')).rejects.toBeTruthy();
  });

  it('an edit then a restore are both versions, both named', async () => {
    const api = createFakeApprovalApi(0);
    const review = await api.review(FIXTURE_PAPER_ID);
    const q = review.rows.find((r) => r.display_number === '5')!;
    const v2 = await api.editQuestion(q.id, q.version, { marks: 6 }, '');
    expect(v2).toBe(2);
    const v3 = await api.revertQuestion(q.id, 1, 'Paper says 5');
    expect(v3).toBe(3);
    const h = await api.questionHistory(q.id);
    expect(h.versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(h.versions[2].marks).toBe(5);
    await expect(api.editQuestion(q.id, 1, { marks: 7 }, '')).rejects.toBeTruthy();
  });
});

describe('resolving open questions', () => {
  it('pass and set aside bring the open count to zero, then approval goes through', async () => {
    const api = createFakeApprovalApi(0);
    const review = await api.review(FIXTURE_PAPER_ID);
    const open = review.rows.filter((r) => r.kind === 'question' && r.state === 'open');
    expect(open.length).toBeGreaterThan(0);
    await expect(api.setQuestionState(open[0].id, 'set_aside', '')).rejects.toMatchObject({ code: '22023' });
    for (const q of open) expect(await api.setQuestionState(q.id, 'pass', '')).toBe('passed');
    expect((await api.review(FIXTURE_PAPER_ID)).open_count).toBe(0);
    await api.approve(FIXTURE_PAPER_ID, '');
    const t = text(renderToStaticMarkup(<HistoryList events={await api.paperHistory(FIXTURE_PAPER_ID)} now={FIXTURE_NOW} />));
    expect(t).toContain('Arjun Mehta passed question 4(b)');
    expect(t).toContain('Priya Sharma set question 6 aside');
  });

  it('take off the site, then put back', async () => {
    const api = createFakeApprovalApi(0);
    const queue = await api.queue();
    const retro = queue.find((q) => q.kind === 'retro')!;
    await api.unpublish(retro.live_bank_paper_id!, 'Wrong school');
    expect((await api.review(retro.audit_paper_id)).paper.is_published).toBe(false);
    await expect(api.unpublish(retro.live_bank_paper_id!, 'again')).rejects.toMatchObject({ code: '55000' });
    await api.restorePaper(retro.live_bank_paper_id!);
    expect((await api.review(retro.audit_paper_id)).paper.is_published).toBe(true);
  });
});

describe('the live page placeholder for a held question', () => {
  it('shows its number and one friendly line, no question text', () => {
    const html = renderToStaticMarkup(<HeldQuestionCard id="h1" number="6" />);
    expect(text(html)).toContain('This question is being checked and will appear soon.');
    expect(html).toContain('>6<');
    expect(html).not.toMatch(/[–—]/);
  });
});

describe('one status for a paper in the queue', () => {
  it('a live paper with open questions is never a plain green Already live', () => {
    expect(rowStatus({ kind: 'retro', open: 2 })).toEqual({ tone: 'pending', label: 'Live, 2 open', ready: false });
    expect(rowStatus({ kind: 'retro', open: 0 })).toEqual({ tone: 'live', label: 'Live, ready', ready: true });
    expect(rowStatus({ kind: 'new', open: 0 })).toEqual({ tone: 'pending', label: 'Ready', ready: true });
    expect(rowStatus({ kind: 'new', open: 3 })).toEqual({ tone: 'paused', label: '3 open', ready: false });
  });

  it('the status and the filters agree because both come from isReady', () => {
    for (const open of [0, 1, 5]) {
      for (const kind of ['new', 'retro'] as const) {
        expect(rowStatus({ kind, open }).ready).toBe(isReady({ open }));
      }
    }
  });

  it('the fake queue has a live paper with open questions, and it reads Live, N open', async () => {
    const queue = await createFakeApprovalApi(0).queue();
    const live = queue.find((q) => q.kind === 'retro' && q.open > 0)!;
    expect(live).toBeTruthy();
    expect(rowStatus(live).label).toBe(`Live, ${live.open} open`);
  });
});

describe('the approve words depend on whether the paper is already on the site', () => {
  it('a paper already live only records the yes and says nothing changes', () => {
    const c = approveCopy('retro');
    expect(c.title).toBe('Record your approval?');
    expect(c.body).toContain('Nothing on the site changes.');
    expect(c.button).toBe('Record approval');
    expect(c.toast).toMatch(/nothing on the site changed/i);
  });

  it('a new paper still goes on the site and says so', () => {
    const c = approveCopy('new');
    expect(c.title).toBe('Approve this paper for launch?');
    expect(c.body).toContain('Passed questions go on the site straight away.');
    expect(c.toast).toBe('Paper approved. It is now on the site.');
  });

  it('the page picks the words from the paper, and sending back a live paper does not claim it stays off', () => {
    const live = { kind: 'retro' as const, live_bank_paper_id: 'bk1' };
    const fresh = { kind: 'new' as const, live_bank_paper_id: null };
    expect(isRecordOnly(live)).toBe(true);
    expect(isRecordOnly(fresh)).toBe(false);
    expect(actionCopy('approve', live).button).toBe('Record approval');
    expect(actionCopy('approve', fresh).button).toBe('Approve for launch');
    expect(actionCopy('reject', fresh).body).toContain('stays off the site');
    expect(actionCopy('reject', live).body).not.toContain('stays off the site');
    expect(actionCopy('reject', live).toast).toContain('stays on the site');
    for (const a of ['approve', 'reject', 'unpublish', 'restore'] as Action[]) {
      for (const p of [live, fresh]) {
        const c = actionCopy(a, p);
        expect(`${c.title} ${c.body} ${c.button} ${c.toast}`, a).not.toMatch(/[–—]/);
      }
    }
  });
});

describe('who can resolve a question', () => {
  it('everything while the paper waits, only Pass once approved, nothing after a send-back', () => {
    expect(resolveMode('pending')).toBe('full');
    expect(resolveMode('approved')).toBe('pass-only');
    expect(resolveMode('rejected')).toBe('none');
  });

  it('the fake mirrors the server: an approved paper accepts a pass but not a set-aside', async () => {
    const api = createFakeApprovalApi(0);
    const review = await api.review(FIXTURE_PAPER_ID);
    for (const q of review.rows.filter((r) => r.kind === 'question' && r.state === 'open')) await api.setQuestionState(q.id, 'pass', '');
    await api.approve(FIXTURE_PAPER_ID, '');
    const done = await api.review(FIXTURE_PAPER_ID);
    const target = done.rows.find((r) => r.kind === 'question')!;
    await expect(api.setQuestionState(target.id, 'set_aside', 'late')).rejects.toMatchObject({ code: '55000' });
    await expect(api.setQuestionState(target.id, 'reopen', '')).rejects.toMatchObject({ code: '55000' });
    expect(await api.setQuestionState(target.id, 'pass', '')).toBe('passed');
  });

  it('the card on an approved paper offers Pass and nothing else to resolve with', () => {
    const open = {
      id: 'q1',
      kind: 'question' as const,
      ord: 0,
      parent_id: null,
      display_number: '3',
      number_path: '3',
      body: 'Made-up question.',
      options: [],
      marks: 2,
      instructions: null,
      figure: null,
      state: 'open' as const,
      version: 1,
      flag_reasons: [],
      flag_detail: null,
      review_bucket: 'admin',
      live_bank_question_id: null,
      set_aside_reason: null,
    };
    const api = createFakeApprovalApi(0);
    const render = (props: { canResolve: boolean; passOnly?: boolean }, row: typeof open | (Omit<typeof open, 'state'> & { state: 'passed' }) = open) =>
      text(renderToStaticMarkup(<ReviewQuestionCard row={row} label="3" depth={0} api={api} onSaved={() => {}} {...props} />));
    const full = render({ canResolve: true });
    expect(full).toContain('Pass');
    expect(full).toContain('Set aside');
    const late = render({ canResolve: true, passOnly: true });
    expect(late).toContain('Pass');
    expect(late).not.toContain('Set aside');
    expect(late).toContain('can be passed but not set aside');
    const passed = render({ canResolve: true, passOnly: true }, { ...open, state: 'passed' as const });
    expect(passed).not.toContain('Reopen');
    expect(render({ canResolve: false })).not.toContain('Pass');
  });
});

describe('the next paper after a decision', () => {
  const row = (id: string, open: number, queued_at: string | null): Pick<ApprovalQueueRow, 'audit_paper_id' | 'open' | 'queued_at'> => ({
    audit_paper_id: id,
    open,
    queued_at,
  });
  it('is the oldest ready paper that is not the one just done', () => {
    const rows = [row('c', 0, '2026-10-03T10:00:00Z'), row('a', 0, '2026-10-01T10:00:00Z'), row('b', 2, '2026-09-30T10:00:00Z'), row('d', 0, null)];
    expect(oldestFirst(rows).map((r) => r.audit_paper_id)).toEqual(['b', 'a', 'c', 'd']);
    expect(nextWaitingPaper(rows, 'x')?.audit_paper_id).toBe('a');
    expect(nextWaitingPaper(rows, 'a')?.audit_paper_id).toBe('c');
    expect(nextWaitingPaper([row('a', 0, '2026-10-01T10:00:00Z')], 'a')).toBeNull();
    expect(nextWaitingPaper([row('b', 2, '2026-09-30T10:00:00Z')], 'z')).toBeNull();
  });

  it('a queue that cannot be read is "unknown", never "nothing else is ready"', async () => {
    expect(await lookupNextWaiting(() => Promise.reject(new Error('offline')), 'a')).toBe('unknown');
    expect(await lookupNextWaiting(() => Promise.resolve([row('a', 0, '2026-10-01T10:00:00Z')]), 'a')).toBeNull();
    const hit = await lookupNextWaiting(() => Promise.resolve([row('b', 0, '2026-10-01T10:00:00Z')]), 'a');
    expect(hit).not.toBe('unknown');
    expect(hit && hit !== 'unknown' ? hit.audit_paper_id : null).toBe('b');
  });
});

describe('the Already decided list says when it is capped', () => {
  it('stays quiet under the cap and names the cap at it', () => {
    expect(historyCapNote(HISTORY_LIMIT - 1)).toBeNull();
    expect(historyCapNote(HISTORY_LIMIT)).toContain(`${HISTORY_LIMIT}`);
    expect(historyCapNote(HISTORY_LIMIT)).not.toMatch(/[–—]/);
  });
});

describe('what the paper page says about open questions and the Approve button', () => {
  it('a sent back paper no longer claims its questions cannot be changed', () => {
    const words = openQuestionsAdvice('none');
    expect(words).toContain('cannot be passed or set aside');
    expect(words).toContain('Edit');
    expect(words).not.toContain('cannot be changed here');
    expect(openQuestionsAdvice('full')).toContain('before this paper can be approved');
    expect(openQuestionsAdvice('pass-only')).toContain('passed but not set aside');
  });

  it('says why Approve is shut in every closed case, and nothing when it is open', () => {
    expect(approveClosedReason({ open: 0, approved: false, rejected: true })).toMatch(/sent back/);
    expect(approveClosedReason({ open: 3, approved: false, rejected: true })).toMatch(/sent back/);
    expect(approveClosedReason({ open: 0, approved: true, rejected: false })).toMatch(/already approved/);
    expect(approveClosedReason({ open: 2, approved: false, rejected: false })).toMatch(/open questions/);
    expect(approveClosedReason({ open: 0, approved: false, rejected: false })).toBeUndefined();
  });
});

describe('the views of Ready to go live live in the URL', () => {
  it('knows its three views, falls back to waiting, and hides Live updates when there is no source', () => {
    expect(viewFromParam(null, true)).toBe('waiting');
    expect(viewFromParam('decided', true)).toBe('decided');
    expect(viewFromParam('live-updates', true)).toBe('live-updates');
    expect(viewFromParam('live-updates', false)).toBe('waiting');
    expect(viewFromParam('nonsense', true)).toBe('waiting');
  });
});

describe('copy and classes in the approval pages', () => {
  it('has no em or en dashes, no glued class names and no raw hex on Pass and Set aside', () => {
    for (const f of [
      'src/pages/admin/paper-approvals.tsx',
      'src/pages/admin/paper-approval.tsx',
      'src/pages/admin/admin-queue.tsx',
      'src/components/admin/approval/ReviewQuestionCard.tsx',
      'src/lib/admin-approval-shape.ts',
    ]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/[–—]/);
      expect(src, f).not.toMatch(/min-h-\d+[a-z]/);
    }
    expect(readFileSync('src/components/admin/approval/ReviewQuestionCard.tsx', 'utf8')).not.toMatch(/#24603D|#F9E2E2|#8C2A2A/);
  });
});
