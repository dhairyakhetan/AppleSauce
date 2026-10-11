import type {
  ApprovalApi,
  ApprovalHistoryRow,
  ApprovalQueueRow,
  HistoryEvent,
  PaperReview,
  QuestionChanges,
  QuestionCheck,
  QuestionVersion,
  ReviewRow,
} from '@/lib/admin-approval-shape';
import { reviewCounts, versionChanges } from '@/lib/admin-approval-shape';
import type { ActorKind, FieldChange } from '@/lib/history-labels';

/**
 * In-memory fake of the admin paper-approval RPCs (D75), for previewing
 * /admin/paper-approvals and its review page without an admin sign-in.
 * Test builds only: reached solely through the PREVIEW_TOOLS-gated lazy
 * imports in admin/paper-approvals.tsx and admin/paper-approval.tsx.
 *
 * Every paper, question, school and person here is MADE UP. Nothing is copied
 * from a real paper or a real account. Edits, restores and approvals change
 * this in-memory copy only, and are gone on reload.
 */

/** The fixtures' clock: 2 Oct 2026, 6 pm in Kolkata. */
export const FIXTURE_NOW = new Date('2026-10-02T12:30:00Z');

function at(minutesAgo: number): string {
  return new Date(FIXTURE_NOW.getTime() - minutesAgo * 60_000).toISOString();
}

const P_PHYSICS = 'f1a00000-0000-4000-8000-0000000000a1';
const P_GEO = 'f1a00000-0000-4000-8000-0000000000a2';
const P_HIST = 'f1a00000-0000-4000-8000-0000000000a3';
const P_BIO = 'f1a00000-0000-4000-8000-0000000000a4';

const PEOPLE = {
  priya: 'Priya Sharma',
  arjun: 'Arjun Mehta',
  rahul: 'Rahul Das',
  meera: 'Meera Iyer',
};

type Store = {
  queue: ApprovalQueueRow[];
  decided: ApprovalHistoryRow[];
  papers: Map<string, PaperReview>;
  versions: Map<string, QuestionVersion[]>;
  events: Map<string, HistoryEvent[]>; // by question id
  checks: Map<string, QuestionCheck[]>;
  paperEvents: Map<string, HistoryEvent[]>; // paper-level only
};

function ev(e: Partial<HistoryEvent> & Pick<HistoryEvent, 'at' | 'actor_kind' | 'action'>): HistoryEvent {
  return {
    actor_name: null,
    model: null,
    question_id: null,
    question_label: null,
    changes: [],
    note: null,
    verdict: null,
    confidence: null,
    version: null,
    to_version: null,
    ...e,
  };
}

function q(r: Partial<ReviewRow> & Pick<ReviewRow, 'id' | 'ord' | 'body'>): ReviewRow {
  return {
    kind: 'question',
    parent_id: null,
    display_number: null,
    number_path: null,
    options: [],
    marks: null,
    instructions: null,
    figure: null,
    state: 'passed',
    version: 1,
    flag_reasons: [],
    flag_detail: null,
    review_bucket: 'none',
    live_bank_question_id: null,
    set_aside_reason: null,
    ...r,
  };
}

function v(
  version: number,
  body: string,
  who: { kind: ActorKind; name?: string | null },
  minutesAgo: number,
  extra: Partial<QuestionVersion> = {},
): QuestionVersion {
  return {
    version,
    body,
    options: [],
    marks: null,
    display_number: null,
    instructions: null,
    created_at: at(minutesAgo),
    actor_name: who.name ?? null,
    actor_kind: who.kind,
    action: null,
    note: null,
    changes: null,
    restored_from_version: null,
    ...extra,
  };
}

function seed(): Store {
  const s: Store = {
    queue: [],
    decided: [],
    papers: new Map(),
    versions: new Map(),
    events: new Map(),
    checks: new Map(),
    paperEvents: new Map(),
  };

  // ---- The main fixture: a physics paper with every state on it ----------
  const id = (n: number) => `f1b00000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
  const rows: ReviewRow[] = [
    q({ id: id(90), ord: 0, kind: 'section_break', body: 'Section A (40 marks)', state: 'passed' }),
    q({ id: id(91), ord: 1, kind: 'section_instruction', body: 'Attempt all questions from this section.', state: 'passed' }),
    q({
      id: id(1),
      ord: 2,
      display_number: '1',
      marks: 1,
      body: 'Which of these is the SI unit of power?',
      options: [
        { label: 'a', text: 'joule' },
        { label: 'b', text: 'watt' },
        { label: 'c', text: 'newton' },
        { label: 'd', text: 'pascal' },
      ],
      version: 1,
    }),
    q({
      id: id(2),
      ord: 3,
      display_number: '2',
      marks: 3,
      body: 'A ball of mass $0.5\\,\\text{kg}$ is dropped from a height of $20\\,\\text{m}$. Taking $g = 10\\,\\text{m s}^{-2}$, find the kinetic energy of the ball just before it reaches the ground.',
      version: 3,
    }),
    q({
      id: id(3),
      ord: 4,
      display_number: '3',
      marks: 4,
      body: 'Explain why a convex lens is called a converging lens. Draw a ray diagram to support your answer.',
      instructions: 'Answer in not more than five sentences.',
      version: 2,
    }),
    q({
      id: id(4),
      ord: 5,
      display_number: '4',
      marks: null,
      body: 'Answer the following:',
      version: 1,
    }),
    q({
      id: id(5),
      ord: 6,
      parent_id: id(4),
      display_number: '4(a)',
      marks: 2,
      body: 'State two factors on which the resistance of a wire depends.',
      version: 1,
    }),
    q({
      id: id(6),
      ord: 7,
      parent_id: id(4),
      display_number: '4(b)',
      marks: 2,
      body: 'A wire of resistance 12 ohm is cut into three equal parts. Find the resistance of each part.',
      state: 'open',
      flag_reasons: ['ocr_disagreement', 'marks_mismatch'],
      version: 2,
      review_bucket: 'admin',
    }),
    q({ id: id(92), ord: 8, kind: 'section_break', body: 'Section B (40 marks)', state: 'passed' }),
    q({
      id: id(7),
      ord: 9,
      display_number: '5',
      marks: 5,
      body: 'Describe an experiment to show that sound needs a material medium to travel. Name one place where sound cannot travel.',
      version: 1,
    }),
    q({
      id: id(8),
      ord: 10,
      display_number: '6',
      marks: 3,
      body: 'The page here is torn and only part of the question can be read.',
      state: 'set_aside',
      version: 1,
      review_bucket: 'none',
      set_aside_reason: 'The scan is torn here',
    }),
  ];
  const counts = reviewCounts(rows);
  s.papers.set(P_PHYSICS, {
    paper: {
      audit_paper_id: P_PHYSICS,
      title: 'ICSE Class 10 Physics, 2026',
      board: 'ICSE',
      cls: '10',
      subject: 'Physics',
      school: 'Greenfield Model School',
      year: '2026',
      exam: 'Pre-board',
      kind: 'new',
      live_bank_paper_id: null,
      is_published: false,
      approval: 'pending',
      approval_note: null,
      general_instructions: 'Answers to this paper must be written on the paper provided separately. The time given at the head of this paper is the time allowed for writing the answers.',
      allowed_time_minutes: 120,
    },
    rows,
    open_count: counts.open,
  });

  // versions and events for the questions that have a story
  s.versions.set(id(2), [
    v(1, 'A ball of mass $0.5\\,\\text{kg}$ is dropped from a height of $20\\,\\text{m}$. Taking $g = 10\\,\\text{m s}^{-2}$, find the kinetc energy of the ball just before it reaches the ground.', { kind: 'pipeline' }, 600, { marks: 2, display_number: '2' }),
    v(2, 'A ball of mass $0.5\\,\\text{kg}$ is dropped from a height of $20\\,\\text{m}$. Taking $g = 10\\,\\text{m s}^{-2}$, find the kinetic energy of the ball just before it reaches the ground.', { kind: 'student', name: PEOPLE.rahul }, 300, { marks: 2, display_number: '2', action: 'checker_fix' }),
    v(3, 'A ball of mass $0.5\\,\\text{kg}$ is dropped from a height of $20\\,\\text{m}$. Taking $g = 10\\,\\text{m s}^{-2}$, find the kinetic energy of the ball just before it reaches the ground.', { kind: 'admin', name: PEOPLE.priya }, 108, { marks: 3, display_number: '2', action: 'admin_edit', note: 'The paper prints [3] at the end' }),
  ]);
  s.checks.set(id(2), [
    { checker_kind: 'haiku_paddle', model: 'haiku', verdict: 'fix', confidence: 0.74, at: at(420), actor_name: null },
    { checker_kind: 'sonnet', model: 'claude-sonnet', verdict: 'pass', confidence: 0.92, at: at(240), actor_name: null },
    { checker_kind: 'student', model: null, verdict: 'pass', confidence: null, at: at(300), actor_name: PEOPLE.rahul },
  ]);
  s.versions.set(id(3), [
    v(1, 'Explain why a convex lens is called a converging lens. Draw a ray diagram to suport your answer.', { kind: 'pipeline' }, 600, { marks: 4, display_number: '3', instructions: 'Answer in not more than five sentences.' }),
    v(2, 'Explain why a convex lens is called a converging lens. Draw a ray diagram to support your answer.', { name: 'ai:sonnet', kind: 'ai' }, 230, { marks: 4, display_number: '3', instructions: 'Answer in not more than five sentences.', action: 'ai_fix' }),
  ]);
  s.checks.set(id(3), [
    { checker_kind: 'haiku_pdf', model: 'haiku', verdict: 'printed_typo', confidence: 0.68, at: at(400), actor_name: null },
    { checker_kind: 'sonnet', model: 'sonnet', verdict: 'fix', confidence: 0.88, at: at(230), actor_name: null },
  ]);
  s.versions.set(id(6), [
    v(1, 'A wire of resistance 12 ohm is cut into three equal parts. Find the resistance of each part.', { kind: 'pipeline' }, 600, { marks: 3, display_number: '4(b)' }),
    v(2, 'A wire of resistance 12 ohm is cut into three equal parts. Find the resistance of each part.', { kind: 'student', name: PEOPLE.meera }, 95, { marks: 2, display_number: '4(b)', action: 'checker_fix' }),
  ]);
  s.checks.set(id(6), [
    { checker_kind: 'haiku_paddle', model: 'haiku', verdict: 'escalate', confidence: 0.41, at: at(410), actor_name: null },
  ]);
  for (const r of rows) {
    if (r.kind === 'question' && !s.versions.has(r.id)) {
      s.versions.set(r.id, [
        v(1, r.body, { kind: 'pipeline' }, 600, { marks: r.marks, display_number: r.display_number, options: r.options, instructions: r.instructions }),
      ]);
    }
  }

  // the paper's own history (newest first is applied on read)
  s.paperEvents.set(P_PHYSICS, [
    ev({ at: at(610), actor_kind: 'pipeline', action: 'paper_loaded' }),
    ev({ at: at(420), actor_kind: 'ai', model: 'haiku', action: 'ai_verdict', verdict: 'fix', confidence: 0.74, question_id: id(2), question_label: '2' }),
    ev({ at: at(410), actor_kind: 'ai', model: 'haiku', action: 'ai_escalate', confidence: 0.41, question_id: id(6), question_label: '4(b)' }),
    ev({ at: at(300), actor_kind: 'student', actor_name: PEOPLE.rahul, action: 'checker_fix', question_id: id(2), question_label: '2', changes: [{ field: 'body', before: s.versions.get(id(2))![0].body, after: s.versions.get(id(2))![1].body }] }),
    ev({ at: at(299), actor_kind: 'student', actor_name: PEOPLE.rahul, action: 'checker_pass', question_id: id(5), question_label: '4(a)' }),
    ev({ at: at(240), actor_kind: 'ai', model: 'sonnet', action: 'ai_verdict', verdict: 'pass', confidence: 0.92, question_id: id(2), question_label: '2' }),
    ev({ at: at(230), actor_kind: 'ai', model: 'sonnet', action: 'ai_fix', confidence: 0.88, question_id: id(3), question_label: '3', changes: [{ field: 'body', before: s.versions.get(id(3))![0].body, after: s.versions.get(id(3))![1].body }] }),
    ev({ at: at(200), actor_kind: 'admin', actor_name: PEOPLE.priya, action: 'admin_set_aside', question_id: id(8), question_label: '6', note: 'The scan is torn here' }),
    ev({ at: at(108), actor_kind: 'admin', actor_name: PEOPLE.priya, action: 'admin_edit', question_id: id(2), question_label: '2', note: 'The paper prints [3] at the end', changes: [{ field: 'marks', before: 2, after: 3 }] }),
    ev({ at: at(95), actor_kind: 'student', actor_name: PEOPLE.meera, action: 'checker_fix', question_id: id(6), question_label: '4(b)', changes: [{ field: 'marks', before: 3, after: 2 }] }),
    ev({ at: at(94), actor_kind: 'student', actor_name: PEOPLE.meera, action: 'checker_ask_help', question_id: id(6), question_label: '4(b)', note: 'The scan cuts off the marks box' }),
    ev({ at: at(60), actor_kind: 'pipeline', action: 'queued_for_approval' }),
  ]);

  // ---- A second, ready paper and two retro ones, for the queue -----------
  const simple = (pid: string, title: string, school: string, n: number, kind: 'new' | 'retro', openCount = 0): PaperReview => {
    const rs: ReviewRow[] = Array.from({ length: n }, (_, i) =>
      q({
        // The paper's own last four characters sit in the middle, so two papers never share a question id.
        id: `${pid.slice(0, 26)}${pid.slice(-4)}${String(i + 10).padStart(6, '0')}`,
        ord: i,
        display_number: String(i + 1),
        marks: 2,
        body: `Made-up question ${i + 1} for the preview. Write a short note on the topic named in the heading.`,
        live_bank_question_id: kind === 'retro' ? `lq${i}` : null,
        ...(i < openCount ? { state: 'open' as const, flag_reasons: ['possible_duplicate'], review_bucket: 'admin' } : {}),
      }),
    );
    return {
      paper: {
        audit_paper_id: pid,
        title,
        board: title.split(' ')[0],
        cls: null,
        subject: null,
        school,
        year: '2025',
        exam: 'Annual',
        kind,
        live_bank_paper_id: kind === 'retro' ? `bk${pid.slice(-4)}` : null,
        is_published: kind === 'retro',
        approval: 'pending',
        general_instructions: null,
        allowed_time_minutes: null,
        approval_note: null,
      },
      rows: rs,
      open_count: openCount,
    };
  };
  s.papers.set(P_GEO, simple(P_GEO, 'CBSE Class 9 Geography, 2025', 'Riverside Public School', 6, 'new'));
  s.papers.set(P_HIST, simple(P_HIST, 'ICSE Class 8 History and Civics, 2025', 'St. Aldric High School', 5, 'retro'));
  s.papers.set(P_BIO, simple(P_BIO, 'ISC Class 12 Biology, 2025', 'Lakeview Academy', 7, 'retro', 2));
  for (const pid of [P_GEO, P_HIST, P_BIO]) {
    s.paperEvents.set(pid, [
      ev({ at: at(900), actor_kind: 'pipeline', action: 'paper_loaded' }),
      ev({ at: at(700), actor_kind: 'ai', model: 'haiku', action: 'ai_pass', confidence: 0.95 }),
      ...(s.papers.get(pid)!.paper.kind === 'retro'
        ? [ev({ at: at(500), actor_kind: 'pipeline', action: 'published' })]
        : []),
      ev({ at: at(80), actor_kind: 'pipeline', action: 'queued_for_approval' }),
    ]);
  }

  s.decided = [
    {
      audit_paper_id: 'f1a00000-0000-4000-8000-0000000000d1',
      title: 'ICSE Class 10 Chemistry, 2023',
      kind: 'new',
      state: 'approved',
      by_name: PEOPLE.arjun,
      at: at(60 * 26),
      note: 'Read through, two numbers fixed.',
      live_bank_paper_id: 'bkd001',
    },
    {
      audit_paper_id: 'f1a00000-0000-4000-8000-0000000000d2',
      title: 'CBSE Class 9 Science, 2022',
      kind: 'new',
      state: 'rejected',
      by_name: PEOPLE.priya,
      at: at(60 * 50),
      note: 'Half the pages are missing from the scan.',
      live_bank_paper_id: null,
    },
  ];
  s.queue = [
    { pid: P_PHYSICS, ai: { pass: 6, fix: 1, student: 2 }, queued: 60 },
    { pid: P_GEO, ai: { pass: 6, fix: 0, student: 0 }, queued: 80 },
    { pid: P_HIST, ai: { pass: 4, fix: 1, student: 0 }, queued: 300 },
    { pid: P_BIO, ai: { pass: 5, fix: 2, student: 0 }, queued: 320 },
  ].map(({ pid, ai, queued }) => {
    const p = s.papers.get(pid)!;
    const c = reviewCounts(p.rows);
    return {
      audit_paper_id: pid,
      title: p.paper.title,
      board: p.paper.board,
      cls: p.paper.cls,
      subject: p.paper.subject,
      school: p.paper.school,
      year: p.paper.year,
      questions_total: c.total,
      passed: c.passed,
      open: c.open,
      set_aside: c.set_aside,
      ai_summary: ai,
      queued_at: at(queued),
      kind: p.paper.kind,
      live_bank_paper_id: p.paper.live_bank_paper_id,
    };
  });
  return s;
}

function findPaperOf(s: Store, questionId: string): PaperReview | null {
  for (const p of s.papers.values()) if (p.rows.some((r) => r.id === questionId)) return p;
  return null;
}

/** `delayMs` imitates the network so loading states show in the preview; tests pass 0. */
export function createFakeApprovalApi(delayMs = 250): ApprovalApi {
  const s = seed();
  const tick = () => new Promise((r) => setTimeout(r, delayMs));
  let clock = 0;
  const nowIso = () => new Date(FIXTURE_NOW.getTime() + ++clock * 60_000).toISOString();

  function addVersion(questionId: string, next: Omit<QuestionVersion, 'version' | 'created_at'>): number {
    const list = s.versions.get(questionId) ?? [];
    const version = (list[list.length - 1]?.version ?? 0) + 1;
    list.push({ ...next, version, created_at: nowIso() });
    s.versions.set(questionId, list);
    return version;
  }

  function applyToRow(row: ReviewRow, ver: QuestionVersion) {
    row.body = ver.body;
    row.marks = ver.marks;
    row.display_number = ver.display_number;
    row.options = ver.options;
    row.instructions = ver.instructions;
    row.version = ver.version;
  }

  function logPaper(paperId: string, e: HistoryEvent) {
    s.paperEvents.set(paperId, [...(s.paperEvents.get(paperId) ?? []), e]);
  }

  return {
    async history() {
      await tick();
      return s.decided.map((r) => ({ ...r }));
    },
    async queue() {
      await tick();
      return s.queue.map((r) => ({ ...r }));
    },
    async review(auditPaperId) {
      await tick();
      const p = s.papers.get(auditPaperId) ?? s.papers.get(P_PHYSICS)!;
      return structuredClone(p);
    },
    async approve(auditPaperId, note) {
      await tick();
      const p = s.papers.get(auditPaperId);
      if (!p) throw new Error('not found');
      if (reviewCounts(p.rows).open > 0)
        throw { code: '55000', message: 'This paper still has open questions. Pass or set each one aside first' };
      p.paper.approval = 'approved';
      p.paper.is_published = true;
      p.paper.live_bank_paper_id ??= `bk${auditPaperId.slice(-4)}`;
      logPaper(auditPaperId, ev({ at: nowIso(), actor_kind: 'admin', actor_name: PEOPLE.arjun, action: p.paper.kind === 'retro' ? 'admin_retro_approve' : 'admin_approve', note }));
      const done = s.queue.find((r) => r.audit_paper_id === auditPaperId);
      s.decided.unshift({ audit_paper_id: auditPaperId, title: p.paper.title, kind: done?.kind ?? 'new', state: 'approved', by_name: PEOPLE.arjun, at: nowIso(), note: note || null, live_bank_paper_id: p.paper.live_bank_paper_id });
      s.queue = s.queue.filter((r) => r.audit_paper_id !== auditPaperId);
      return p.paper.live_bank_paper_id;
    },
    async reject(auditPaperId, note) {
      await tick();
      const p = s.papers.get(auditPaperId);
      if (!p) throw new Error('not found');
      p.paper.approval = 'rejected';
      logPaper(auditPaperId, ev({ at: nowIso(), actor_kind: 'admin', actor_name: PEOPLE.arjun, action: 'admin_reject', note }));
    },
    async unpublish(bankPaperId, note) {
      await tick();
      const p = [...s.papers.values()].find((x) => x.paper.live_bank_paper_id === bankPaperId);
      if (!p) throw new Error('not found');
      if (!p.paper.is_published) throw { code: '55000', message: 'This paper is already off the site' };
      p.paper.is_published = false;
      logPaper(p.paper.audit_paper_id, ev({ at: nowIso(), actor_kind: 'admin', actor_name: PEOPLE.arjun, action: 'admin_unpublish', note }));
    },
    async editQuestion(questionId, version, changes: QuestionChanges, note) {
      await tick();
      const p = findPaperOf(s, questionId);
      const row = p?.rows.find((r) => r.id === questionId);
      if (!p || !row) throw new Error('not found');
      if (row.version !== version) throw { code: '40001', message: 'stale version' };
      const list = s.versions.get(questionId) ?? [];
      const prev = list[list.length - 1] ?? null;
      const next = {
        body: changes.body ?? row.body,
        options: changes.options ?? row.options,
        marks: changes.marks !== undefined ? changes.marks : row.marks,
        display_number: changes.display_number !== undefined ? changes.display_number : row.display_number,
        instructions: row.instructions,
        actor_name: PEOPLE.arjun,
        actor_kind: 'admin' as const,
        action: 'admin_edit',
        note: note || null,
        changes: null,
        restored_from_version: null,
      };
      const nv = addVersion(questionId, next);
      const ver = s.versions.get(questionId)!.slice(-1)[0];
      const fc: FieldChange[] = prev ? versionChanges(prev, ver) : [];
      applyToRow(row, ver);
      logPaper(p.paper.audit_paper_id, ev({ at: ver.created_at, actor_kind: 'admin', actor_name: PEOPLE.arjun, action: 'admin_edit', question_id: questionId, question_label: row.display_number, changes: fc, note: note || null }));
      return nv;
    },
    async revertQuestion(questionId, toVersion, note) {
      await tick();
      const p = findPaperOf(s, questionId);
      const row = p?.rows.find((r) => r.id === questionId);
      const list = s.versions.get(questionId) ?? [];
      const target = list.find((x) => x.version === toVersion);
      if (!p || !row || !target) throw new Error('not found');
      const prev = list[list.length - 1];
      const nv = addVersion(questionId, { ...target, actor_name: PEOPLE.arjun, actor_kind: 'admin', action: 'admin_revert', note: note || null, changes: null, restored_from_version: toVersion });
      const ver = s.versions.get(questionId)!.slice(-1)[0];
      applyToRow(row, ver);
      logPaper(p.paper.audit_paper_id, ev({ at: ver.created_at, actor_kind: 'admin', actor_name: PEOPLE.arjun, action: 'admin_revert', to_version: toVersion, question_id: questionId, question_label: row.display_number, changes: versionChanges(prev, ver), note: note || null }));
      return nv;
    },
    async setQuestionState(questionId, state, note) {
      await tick();
      const p = findPaperOf(s, questionId);
      const row = p?.rows.find((r) => r.id === questionId);
      if (!p || !row) throw { code: 'P0002', message: 'Question not found' };
      // Like admin_set_question_state: while the paper waits anything goes; once
      // approved a question can only be passed; after a send-back, nothing.
      const latePass = p.paper.approval === 'approved' && state === 'pass';
      if (p.paper.approval !== 'pending' && !latePass)
        throw { code: '55000', message: 'Questions can be set aside or reopened only while the paper waits for approval; after approval a question can only be passed' };
      if (state === 'set_aside' && !note.trim()) throw { code: '22023', message: 'Say why the question is set aside' };
      row.state = state === 'pass' ? 'passed' : state === 'set_aside' ? 'set_aside' : 'open';
      row.set_aside_reason = state === 'set_aside' ? note : null;
      if (state === 'pass') row.flag_reasons = [];
      p.open_count = reviewCounts(p.rows).open;
      const q = s.queue.find((x) => x.audit_paper_id === p.paper.audit_paper_id);
      if (q) Object.assign(q, (({ passed, open, set_aside }) => ({ passed, open, set_aside }))(reviewCounts(p.rows)));
      logPaper(p.paper.audit_paper_id, ev({ at: nowIso(), actor_kind: 'admin', actor_name: PEOPLE.arjun, action: state === 'pass' ? 'admin_pass' : state === 'set_aside' ? 'admin_set_aside' : 'admin_reopen', question_id: questionId, question_label: row.display_number, note: note || null }));
      return row.state;
    },
    async restorePaper(bankPaperId) {
      await tick();
      const p = [...s.papers.values()].find((x) => x.paper.live_bank_paper_id === bankPaperId);
      if (!p) throw { code: 'P0002', message: 'Paper not found' };
      p.paper.is_published = true;
      logPaper(p.paper.audit_paper_id, ev({ at: nowIso(), actor_kind: 'admin', actor_name: PEOPLE.arjun, action: 'admin_restore' }));
    },
    async questionHistory(questionId) {
      await tick();
      const p = findPaperOf(s, questionId);
      const events = p ? (s.paperEvents.get(p.paper.audit_paper_id) ?? []).filter((e) => e.question_id === questionId) : [];
      return structuredClone({
        versions: s.versions.get(questionId) ?? [],
        events: [...events].sort((a, b) => b.at.localeCompare(a.at)),
        checks: s.checks.get(questionId) ?? [],
      });
    },
    async paperHistory(auditPaperId) {
      await tick();
      return structuredClone([...(s.paperEvents.get(auditPaperId) ?? [])].sort((a, b) => b.at.localeCompare(a.at)));
    },
  };
}

export const FIXTURE_PAPER_ID = P_PHYSICS;

let shared: ApprovalApi | null = null;
/** One fake per tab, so an approval on the review page shows in the queue. */
export function sharedFakeApprovalApi(): ApprovalApi {
  shared ??= createFakeApprovalApi();
  return shared;
}
