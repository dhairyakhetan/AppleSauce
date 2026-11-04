/**
 * The go-live half of the HOD desk's in-memory fake (dummy mode, test builds
 * only): Needs you, Ready to go live and its preview, Student uploads, Live
 * papers, the route trail, the desk counts, the overall AI trust counter and
 * "Why this paper?". Every paper, school and question here is MADE UP.
 *
 * It copies the server's rules, in the server's words: a question the students
 * still own cannot be passed or set aside; set-aside needs a note; the four
 * checks are worked out from the data; approving a paper that fails a check, or
 * one with questions left out that were not confirmed, is refused with the
 * server's sentence; hiding needs a reason; rejecting an upload needs a note.
 */

import type { AiTrustOverall, AssignmentExplanation, HodCheck, HodDeskCounts, HodLivePaper, HodNeedsQuestion, HodNeedsYouPaper, HodPreview, HodReadyPaper, HodStudentUpload, HodTrailRow, PreviewHeader, PreviewQuestion, TrailStage, UploadStatus } from '@/lib/hod-publish';
import { CHECKS, allChecksPass, fieldProblem, PUBLISH_FIELDS, LIVE_FIELDS, normaliseChecks } from '@/lib/hod-publish';
import { dummyPageDataUrl, dummyPictureDataUrl } from '@/dummy/checker-fixtures';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function pgError(message: string, code = '22023') {
  return Object.assign(new Error(message), { code, message, details: null, hint: null });
}

type Pile = 'students' | 'escalated' | 'admin';

interface FQ {
  id: string;
  ord: number;
  kind: 'question' | 'section_break' | 'master_instruction';
  parent_id: string | null;
  display_number: string | null;
  instructions: string | null;
  body: string;
  options: unknown[] | null;
  marks: number | null;
  figure_path: string | null;
  figure_storage_path: string | null;
  has_picture: boolean;
  picture_staged: boolean;
  page: number | null;
  page_path: string | null;
  snippet_path: string | null;
  state: 'passed' | 'open' | 'set_aside';
  pile: Pile;
  version: number;
  set_aside_reason: string | null;
  scanner_junk: boolean;
  flag_reasons: string[];
  escalated_by_name: string | null;
  escalated_at: string | null;
  reason: string | null;
  ai_review_reason: string | null;
}

interface FP {
  id: string;
  title: string;
  approval: 'none' | 'awaiting' | 'approved';
  kind: 'new' | 'retro';
  queued_at: string | null;
  live_id: string | null;
  header: PreviewHeader;
  questions: FQ[];
}

export const GL = {
  maths: 'e1000000-0000-4000-8000-000000000001',
  physics: 'e1000000-0000-4000-8000-000000000002',
  history: 'e1000000-0000-4000-8000-000000000004',
  eco: 'e1000000-0000-4000-8000-000000000006',
  nopic: 'e1000000-0000-4000-8000-000000000007',
  chem: 'e1000000-0000-4000-8000-000000000008',
  econ2: 'e1000000-0000-4000-8000-000000000009',
  commerce: 'e1000000-0000-4000-8000-000000000003',
};

const header = (over: Partial<PreviewHeader>): PreviewHeader => ({
  school: null,
  school_raw: null,
  is_board_paper: false,
  has_school: true,
  cls: null,
  subject: null,
  board: null,
  year: null,
  exam: null,
  marks: null,
  allowed_time_minutes: null,
  general_instructions: null,
  incomplete_note: null,
  ...over,
});

let seq = 0;
const q = (over: Partial<FQ> & Pick<FQ, 'ord' | 'body'>): FQ => ({
  id: `f1000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  kind: 'question',
  parent_id: null,
  display_number: String(over.ord),
  instructions: null,
  options: null,
  marks: 2,
  figure_path: null,
  figure_storage_path: null,
  has_picture: false,
  picture_staged: false,
  page: 1,
  page_path: null,
  snippet_path: null,
  state: 'passed',
  pile: 'students',
  version: 1,
  set_aside_reason: null,
  scanner_junk: false,
  flag_reasons: [],
  escalated_by_name: null,
  escalated_at: null,
  reason: null,
  ai_review_reason: null,
  ...over,
});

const TABLE_BODY = 'The table shows the marks of four pupils.\n<table><tr><th>Pupil</th><th>Marks</th></tr><tr><td>Asha</td><td>18</td></tr><tr><td>Nikhil</td><td>15</td></tr><tr><td>Tara</td><td>20</td></tr></table>\nFind the mean mark.';

function seedPapers(): FP[] {
  seq = 0;
  const maths: FP = {
    id: GL.maths,
    title: 'ICSE Class X Mathematics, 2024',
    approval: 'none',
    kind: 'new',
    queued_at: null,
    live_id: null,
    header: header({ school: 'Sample Hill School', cls: 'X', subject: 'Mathematics', board: 'ICSE', year: '2024', exam: 'Prelims' }),
    questions: [
      q({ ord: 1, body: 'Choose the correct answer. The value of $3^2$ is', options: ['6', '9', '12', '27'], marks: 1 }),
      q({ ord: 2, body: TABLE_BODY, marks: 3 }),
      q({
        ord: 4,
        display_number: '4(ii)',
        body: '(ii) Solve for $x$ and verify your answer: $$2x^2 - 7x + 3 = 0$$',
        marks: 3,
        page: 2,
        snippet_path: 'dummy/q-quadratic.png',
        state: 'open',
        pile: 'escalated',
        version: 2,
        escalated_by_name: 'Asha Reviewer',
        escalated_at: minutesAgo(12),
        reason: 'The picture is of a different question',
      }),
      q({
        ord: 5,
        body: 'Find the area of a circle of radius 7 cm. Take pi as 22/7. [2] 6. Find its circumference. [2]',
        marks: 2,
        page: 2,
        page_path: `pages/${GL.maths}/2.jpg`,
        state: 'open',
        pile: 'admin',
        flag_reasons: ['two_questions_in_one'],
        ai_review_reason: 'This looks like two questions joined together.',
      }),
    ],
  };
  const physics: FP = {
    id: GL.physics,
    title: 'ISC Class XII Physics, 2023',
    approval: 'none',
    kind: 'new',
    queued_at: null,
    live_id: null,
    header: header({ school: 'Riverside Academy', cls: 'XII', subject: 'Physics', board: 'ISC', year: '2023', exam: 'Pre-board' }),
    questions: [
      q({ ord: 6, body: 'Define the unit of power.', marks: 2 }),
      q({
        ord: 7,
        body: '7. State two uses of a lever in daily life. [2] 8. Define power. Give its unit. [2]',
        page: 2,
        page_path: `pages/${GL.physics}/2.jpg`,
        state: 'open',
        pile: 'escalated',
        escalated_by_name: 'Nikhil K',
        escalated_at: minutesAgo(70),
        reason: 'There is no question here',
      }),
    ],
  };
  const nopic: FP = {
    id: GL.nopic,
    title: 'ICSE Class X Geography, 2021',
    approval: 'none',
    kind: 'new',
    queued_at: null,
    live_id: null,
    header: header({ school: 'Greenfield School', cls: 'X', subject: 'Geography', board: 'ICSE', year: '2021', exam: 'Prelims' }),
    questions: [
      q({
        ord: 2,
        body: 'Define latitude and longitude in one sentence each.',
        page: null,
        state: 'open',
        pile: 'escalated',
        escalated_by_name: 'Nikhil K',
        escalated_at: minutesAgo(180),
        reason: 'The page pictures are missing',
      }),
    ],
  };
  const eco: FP = {
    id: GL.eco,
    title: 'ISC Class XII Economics, 2025',
    approval: 'none',
    kind: 'new',
    queued_at: null,
    live_id: null,
    header: header({ school: 'Riverside Academy', cls: 'XII', subject: 'Economics', board: 'ISC', year: '2025', exam: 'Prelims' }),
    questions: [
      q({
        ord: 5,
        body: 'Name the three main types of rainfall and give one example of a place where each is found.',
        marks: 4,
        state: 'open',
        pile: 'admin',
        ai_review_reason: 'The words may have been scanned wrongly.',
      }),
    ],
  };
  const history: FP = {
    id: GL.history,
    title: 'ICSE Class X History and Civics, 2025',
    approval: 'none',
    kind: 'new',
    queued_at: null,
    live_id: null,
    header: header({ school: 'Greenfield School', cls: 'X', subject: 'History & Civics', board: 'ICSE', year: '2025' }),
    questions: [q({ ord: 1, body: 'Who founded the Indian National Congress?', state: 'open', pile: 'students' }), q({ ord: 2, body: 'Name one cause of the Revolt of 1857.', state: 'open', pile: 'students' })],
  };
  const commerce: FP = {
    id: GL.commerce,
    title: 'ISC Class XI Commerce, 2022',
    approval: 'none',
    kind: 'new',
    queued_at: null,
    live_id: null,
    header: header({ school: 'Lakeview Institute', cls: 'XI', subject: 'Commerce', board: 'ISC', year: '2022' }),
    questions: [q({ ord: 1, body: 'Define a partnership.', state: 'open', pile: 'students' })],
  };
  const chem: FP = {
    id: GL.chem,
    title: 'ICSE Class IX Chemistry, 2024',
    approval: 'awaiting',
    kind: 'new',
    queued_at: minutesAgo(60 * 20),
    live_id: null,
    header: header({
      school: 'Sample Hill School',
      cls: 'IX',
      subject: 'Chemistry',
      board: 'ICSE',
      year: '2024',
      exam: 'Annual',
      marks: 8,
      allowed_time_minutes: 90,
      general_instructions: 'Answer all questions.\nThe marks for each question are in brackets [ ].',
    }),
    questions: [
      q({ ord: 0, kind: 'section_break', body: 'SECTION A', display_number: null, marks: null }),
      q({ ord: 1, body: 'Name the gas given off when zinc reacts with dilute sulphuric acid.', marks: 2 }),
      q({
        ord: 2,
        body: 'Look at the diagram of the apparatus and name the part marked $A$.',
        marks: 2,
        has_picture: true,
        picture_staged: true,
        figure_path: 'dummy/q-quadratic.png',
        figure_storage_path: 'dummy/q-quadratic.png',
      }),
      q({ ord: 3, body: 'Balance: $\\mathrm{H_2 + O_2 \\to H_2O}$', marks: 2 }),
      q({ ord: 4, body: 'State one use of a catalyst.', marks: 2 }),
    ],
  };
  const econ2: FP = {
    id: GL.econ2,
    title: 'ISC Class XII Economics, 2023',
    approval: 'awaiting',
    kind: 'new',
    queued_at: minutesAgo(60 * 50),
    live_id: null,
    header: header({ school: 'Riverside Academy', cls: 'XII', subject: 'Economics', board: 'ISC', year: null, exam: 'Prelims', marks: 12 }),
    questions: [
      q({ ord: 1, body: 'What is meant by opportunity cost?', marks: 3 }),
      q({ ord: 2, body: 'Scanned with CamScanner\nDistinguish between a market and a mall.', marks: 3, scanner_junk: true }),
      q({
        ord: 3,
        body: 'Study the graph and say what happens to price when demand rises.',
        marks: 3,
        has_picture: true,
        picture_staged: false,
        figure_storage_path: 'dummy/q-quadratic.png',
      }),
      q({ ord: 4, body: 'Explain the law of diminishing returns.', marks: 3, state: 'set_aside', set_aside_reason: 'The scan is torn here' }),
    ],
  };
  return [maths, physics, nopic, eco, history, commerce, chem, econ2];
}

const LIVE_SEED: HodLivePaper[] = [
  ['live-1', 'ICSE Class X Mathematics, 2022', 'Mathematics', 'X', 'Sample Hill School', 'ICSE', '2022', 'Prelims', 80, 22, 150],
  ['live-2', 'ICSE Class X Physics, 2022', 'Physics', 'X', 'Riverside Academy', 'ICSE', '2022', 'Prelims', 80, 18, 120],
  ['live-3', 'ISC Class XII Chemistry, 2021', 'Chemistry', 'XII', 'Lakeview Institute', 'ISC', '2021', 'Pre-board', 70, 25, 180],
  ['live-4', 'ICSE Class IX Biology, 2023', 'Biology', 'IX', 'Greenfield School', 'ICSE', '2023', 'Annual', 50, 16, 90],
  ['live-5', 'ISC Class XII Mathematics, 2020', 'Mathematics', 'XII', 'Riverside Academy', 'ISC', '2020', 'Pre-board', 100, 30, 180],
  ['live-6', 'CBSE Class X Science, 2023', 'Science', 'X', 'Sample Hill School', 'CBSE', '2023', 'Half-yearly', 80, 33, 180],
  ['live-7', 'ICSE Class VIII English, 2024', 'English', 'VIII', 'Greenfield School', 'ICSE', '2024', 'Annual', 60, 14, 120],
  ['live-8', 'ICSE Class X Economics, 2021', 'Economics', 'X', 'Lakeview Institute', 'ICSE', '2021', 'Prelims', 40, 12, 90],
  ['live-9', 'ISC Class XI Commerce, 2022', 'Commerce', 'XI', 'Riverside Academy', 'ISC', '2022', 'Final', 80, 20, 180],
  ['live-10', 'ICSE Class X Geography, 2020', 'Geography', 'X', 'Sample Hill School', 'ICSE', '2020', 'Prelims', 80, 19, 120],
].map(([paper_id, title, subject, cls, school, board, year, exam, marks, question_count, time], i): HodLivePaper => ({
  paper_id: paper_id as string,
  title: title as string,
  subject: subject as string,
  cls: cls as string,
  school: school as string,
  board: board as string,
  year: year as string,
  exam: exam as string,
  marks: marks as number,
  question_count: question_count as number,
  allowed_time_minutes: time as number,
  is_published: i !== 3 && i !== 7,
  hidden_reason: i === 3 ? 'Two questions had the wrong pictures' : i === 7 ? 'A duplicate of another paper' : null,
  hidden_at: i === 3 || i === 7 ? minutesAgo(60 * 30) : null,
  hidden_by: i === 3 || i === 7 ? 'Meena Roy' : null,
  audit_paper_id: null,
  from_pipeline: false,
  waiting_students: 0,
  waiting_you: i === 4 ? 2 : 0,
  general_instructions: null,
  incomplete_note: null,
}));

function uploadsSeed(): HodStudentUpload[] {
  const u = (id: string, status: string, over: Partial<HodStudentUpload>): HodStudentUpload => ({
    id: `u1000000-0000-4000-8000-00000000000${id}`,
    created_at: minutesAgo(60 * (Number(id) * 7)),
    school: null,
    board: null,
    cls: null,
    subject: null,
    year: null,
    exam_type: null,
    submitter_name: null,
    file_count: 1,
    file_paths: [],
    status,
    review_note: null,
    reviewed_at: null,
    reviewed_by_name: null,
    ...over,
  });
  return [
    u('1', 'pending', { school: 'Greenfield School', board: 'ICSE', cls: 'X', subject: 'Mathematics', year: '2024', exam_type: 'Prelims', submitter_name: 'Ishaan D', file_count: 2, file_paths: ['submissions/ishaan/maths-p1.pdf', 'submissions/ishaan/maths-p2.pdf'] }),
    u('2', 'pending', { school: 'Lakeview Institute', board: 'ISC', cls: 'XII', subject: 'Physics', year: '2023', exam_type: 'Pre-board', submitter_name: 'Riya S', file_paths: ['submissions/riya/physics.pdf'] }),
    u('3', 'approved', { school: 'Riverside Academy', board: 'CBSE', cls: 'X', subject: 'Science', year: '2022', submitter_name: 'Kabir M', file_paths: ['submissions/kabir/science.pdf'], reviewed_at: minutesAgo(60 * 20), reviewed_by_name: 'Meena Roy' }),
    u('4', 'rejected', { school: 'Sample Hill School', board: 'ICSE', cls: 'IX', subject: 'Biology', year: '2021', submitter_name: 'Anaya P', file_paths: ['submissions/anaya/bio.jpg'], review_note: 'The photo is too dark to read.', reviewed_at: minutesAgo(60 * 50), reviewed_by_name: 'Meena Roy' }),
  ];
}

export interface GoLiveFake {
  reset(): void;
  api: {
    deskCounts(): Promise<HodDeskCounts>;
    paperTrail(): Promise<HodTrailRow[]>;
    needsYouPapers(): Promise<HodNeedsYouPaper[]>;
    needsYouQuestions(id: string): Promise<HodNeedsQuestion[]>;
    setQuestionState(id: string, state: 'pass' | 'set_aside' | 'reopen', note?: string): Promise<string>;
    editQuestion(id: string, version: number, changes: Record<string, unknown>, note?: string): Promise<number>;
    sendBack(id: string, note: string): Promise<void>;
    readyPapers(): Promise<HodReadyPaper[]>;
    paperPreview(id: string): Promise<HodPreview>;
    updatePublishMeta(id: string, field: string, value: string): Promise<void>;
    approvePaper(id: string, note?: string, confirmLeftOut?: boolean): Promise<{ live_bank_paper_id: string | null; question_count: number }>;
    livePapers(): Promise<HodLivePaper[]>;
    hidePaper(id: string, reason: string): Promise<void>;
    restorePaper(id: string): Promise<void>;
    editLivePaper(id: string, field: string, value: string | null): Promise<void>;
    studentUploads(status: UploadStatus): Promise<HodStudentUpload[]>;
    reviewUpload(id: string, decision: 'approved' | 'rejected', note?: string): Promise<void>;
    uploadFileUrl(path: string): Promise<string | null>;
    aiTrustOverall(): Promise<AiTrustOverall>;
    explainAssignment(checkerId: string, paperId: string): Promise<AssignmentExplanation>;
    figureUrl(path: string): string | null;
  };
}

export function createGoLiveFake(record: (what: string) => void, ckNames: (id: string) => string): GoLiveFake {
  let papers: FP[] = [];
  let live: HodLivePaper[] = [];
  let uploads: HodStudentUpload[] = [];
  let metaSeq = 0;

  function seed() {
    papers = seedPapers();
    live = LIVE_SEED.map((x) => ({ ...x }));
    uploads = uploadsSeed();
    metaSeq = 0;
  }
  seed();

  const real = (p: FP) => p.questions.filter((x) => x.kind === 'question');
  const isOpen = (x: FQ) => x.state === 'open';
  const waitingYou = (x: FQ) => isOpen(x) && (x.pile === 'escalated' || x.pile === 'admin');

  function checksOf(p: FP): HodCheck[] {
    const rs = real(p);
    const open = rs.filter(isOpen).length;
    const aside = rs.filter((x) => x.state === 'set_aside').length;
    const unstaged = rs.filter((x) => x.state === 'passed' && x.has_picture && !x.picture_staged).length;
    const h = p.header;
    const missing = [
      !h.school && 'the school',
      !h.cls && 'the class',
      !h.subject && 'the subject',
      !h.board && 'the board',
      !h.year && 'the year',
      !h.exam && 'the exam',
      h.marks === null && 'the total marks',
      h.allowed_time_minutes === null && 'the time allowed',
      !h.general_instructions && 'the general instructions',
    ].filter(Boolean) as string[];
    const junk = rs.filter((x) => x.state !== 'set_aside' && x.scanner_junk);
    return normaliseChecks([
      {
        key: 'questions_checked',
        label: CHECKS[0].label,
        ok: rs.some((x) => x.state === 'passed') && open === 0,
        detail:
          open > 0
            ? `${open} ${open === 1 ? 'question is' : 'questions are'} still open. Every question must be passed or set aside.`
            : !rs.some((x) => x.state === 'passed')
              ? 'No question is passed yet. At least one must be passed to go live.'
              : `All ${rs.length} questions are checked.${aside > 0 ? ` ${aside} ${aside === 1 ? 'question is' : 'questions are'} left out. ${aside === 1 ? 'It' : 'They'} will not go live.` : ''}`,
      },
      {
        key: 'pictures_present',
        label: CHECKS[1].label,
        ok: unstaged === 0,
        detail: unstaged > 0 ? `${unstaged} ${unstaged === 1 ? 'picture is' : 'pictures are'} not on the site yet.` : 'Every picture is in place.',
      },
      {
        key: 'header_complete',
        label: CHECKS[2].label,
        ok: missing.length === 0,
        detail: missing.length ? `Missing: ${missing.join(', ')}.` : 'The paper details are complete.',
      },
      {
        key: 'scanner_junk_gone',
        label: CHECKS[3].label,
        ok: junk.length === 0,
        detail: junk.length ? `Scanner marks are left in question ${junk.map((x) => x.display_number ?? x.ord).join(', ')}.` : 'No scanner junk found.',
      },
    ]);
  }

  function stageOf(p: FP): TrailStage {
    if (p.approval === 'approved') return 'live';
    if (p.approval === 'awaiting') return 'ready';
    const rs = real(p);
    if (rs.some(waitingYou)) return 'needs_you';
    if (rs.some(isOpen)) return 'checking';
    return 'read';
  }

  function find(id: string): FP {
    const p = papers.find((x) => x.id === id);
    if (!p) throw pgError('That paper was not found.');
    return p;
  }
  function findQ(id: string): { p: FP; q: FQ } {
    for (const p of papers) {
      const x = p.questions.find((y) => y.id === id);
      if (x) return { p, q: x };
    }
    throw pgError('That question was not found.');
  }

  const toNeeds = (p: FP, x: FQ): HodNeedsQuestion => ({
    id: x.id,
    paper_id: p.id,
    ord: x.ord,
    kind: x.kind,
    parent_id: x.parent_id,
    number_path: x.display_number,
    display_number: x.display_number,
    instructions: x.instructions,
    body: x.body,
    options: [],
    options_raw: x.options,
    marks: x.marks,
    figure_path: x.figure_path,
    state: x.state,
    version: x.version,
    flag_reasons: x.flag_reasons,
    review_bucket: x.pile === 'escalated' ? 'escalated' : 'admin',
    live_bank_question_id: null,
    ai_decision: null,
    ai_review_reason: x.ai_review_reason,
    page: x.page,
    page_path: x.page_path,
    snippet_path: x.snippet_path,
    escalated_by: null,
    escalated_by_name: x.escalated_by_name,
    escalated_at: x.escalated_at,
    reason: x.reason,
  });

  const toPreviewQ = (x: FQ): PreviewQuestion => ({
    id: x.id,
    ord: x.ord,
    kind: x.kind,
    parent_id: x.parent_id,
    section_label: null,
    number_path: x.display_number,
    display_number: x.display_number,
    instructions: x.instructions,
    body: x.body,
    options: (x.options ?? []).map((o) => ({ label: null, text: String(o) })),
    marks: x.marks,
    figure_path: x.picture_staged ? x.figure_path : null,
    figure_storage_path: x.figure_storage_path,
    has_picture: x.has_picture,
    picture_staged: x.picture_staged,
    page: x.page,
    state: x.kind === 'section_break' ? 'section' : x.state,
    version: x.version,
    review_bucket: x.pile,
    flag_reasons: x.flag_reasons,
    set_aside_reason: x.set_aside_reason,
    scanner_junk: x.scanner_junk,
  });

  const api: GoLiveFake['api'] = {
    async deskCounts() {
      const stages = papers.map(stageOf);
      const count = (s: TrailStage) => stages.filter((x) => x === s).length;
      const ready = papers.filter((p) => p.approval === 'awaiting');
      return {
        read: count('read'),
        checking: count('checking'),
        needs_you: count('needs_you'),
        ready: ready.length,
        ready_ok: ready.filter((p) => allChecksPass(checksOf(p))).length,
        approved: count('live'),
        needs_you_questions: papers.reduce((n, p) => n + real(p).filter(waitingYou).length, 0),
        live: live.filter((l) => l.is_published).length,
        hidden: live.filter((l) => !l.is_published).length,
        student_uploads_pending: uploads.filter((u) => u.status === 'pending').length,
      };
    },
    async paperTrail() {
      return papers.map((p) => {
        const rs = real(p);
        return {
          audit_paper_id: p.id,
          stage: stageOf(p),
          total: rs.length,
          passed: rs.filter((x) => x.state === 'passed').length,
          checking: rs.filter((x) => isOpen(x) && x.pile === 'students').length,
          needs_you: rs.filter(waitingYou).length,
          set_aside: rs.filter((x) => x.state === 'set_aside').length,
          title: p.title,
          subject: p.header.subject,
          cls: p.header.cls,
          school: p.header.school,
          is_live: p.approval === 'approved',
        };
      });
    },
    async needsYouPapers() {
      return papers
        .filter((p) => p.approval !== 'approved')
        .map((p) => {
          const rs = real(p);
          const escalated = rs.filter((x) => isOpen(x) && x.pile === 'escalated').length;
          const admin = rs.filter((x) => isOpen(x) && x.pile === 'admin').length;
          return {
            audit_paper_id: p.id,
            title: p.title,
            subject: p.header.subject,
            cls: p.header.cls,
            school: p.header.school,
            is_live: false,
            escalated,
            admin_bucket: admin,
            total: rs.length,
          };
        })
        .filter((p) => p.escalated + p.admin_bucket > 0)
        .sort((a, b) => b.escalated + b.admin_bucket - (a.escalated + a.admin_bucket));
    },
    async needsYouQuestions(id) {
      const p = find(id);
      return p.questions.filter((x) => x.kind === 'question' && waitingYou(x)).map((x) => toNeeds(p, x));
    },
    async setQuestionState(id, state, note) {
      const { p, q: x } = findQ(id);
      if (p.approval === 'approved') throw pgError('This paper is approved. Change its details from Live papers.', '55000');
      if (state === 'reopen') {
        x.state = 'open';
        x.set_aside_reason = null;
        if (x.pile === 'students') x.pile = 'admin';
        record(`reopen ${id}`);
        return 'open';
      }
      if (x.state === 'open' && x.pile === 'students') throw pgError('This question is still with the student checkers.', '55000');
      if (state === 'set_aside') {
        if (!note || !note.trim()) throw pgError('Say why the question is set aside');
        x.state = 'set_aside';
        x.set_aside_reason = note.trim();
        record(`set aside ${id} ${note}`);
        return 'set_aside';
      }
      x.state = 'passed';
      record(`pass ${id}`);
      return 'passed';
    },
    async editQuestion(id, version, changes) {
      const { q: x } = findQ(id);
      if (x.version !== version) throw Object.assign(new Error('stale question text'), { code: '40001' });
      if (typeof changes.body === 'string') x.body = changes.body;
      if (typeof changes.display_number === 'string') x.display_number = changes.display_number;
      if ('marks' in changes) x.marks = (changes.marks as number | null) ?? null;
      // A fixed question loses its scanner-junk mark when the junk words are gone.
      if (typeof changes.body === 'string' && !/camscanner|scanned with|scanned by/i.test(changes.body)) x.scanner_junk = false;
      x.version += 1;
      record(`edit ${id} ${JSON.stringify(changes)}`);
      return x.version;
    },
    async sendBack(id, note) {
      const { q: x } = findQ(id);
      if (x.pile !== 'escalated') throw pgError('This question was not sent up by a student.', '55000');
      x.pile = 'students';
      x.escalated_by_name = null;
      record(`send back ${id} ${note}`);
    },
    async readyPapers() {
      return papers
        .filter((p) => p.approval === 'awaiting')
        .map((p) => {
          const checks = checksOf(p);
          const rs = real(p);
          return {
            audit_paper_id: p.id,
            title: p.title,
            subject: p.header.subject,
            cls: p.header.cls,
            school: p.header.school,
            question_count: rs.length,
            passed_count: rs.filter((x) => x.state === 'passed').length,
            left_out: rs.filter((x) => x.state === 'set_aside').length,
            checks,
            board: p.header.board,
            year: p.header.year,
            exam: p.header.exam,
            kind: p.kind,
            queued_at: p.queued_at,
            all_ok: allChecksPass(checks),
            is_live: false,
          };
        });
    },
    async paperPreview(id) {
      const p = find(id);
      const rs = real(p);
      return {
        paper: {
          audit_paper_id: p.id,
          title: p.title,
          approval_state: p.approval === 'none' ? 'queued' : p.approval,
          kind: p.kind,
          queued_at: p.queued_at,
          live_bank_paper_id: p.live_id,
          is_live: p.approval === 'approved',
          page_count: 8,
          header: { ...p.header },
          marks_from_questions: rs.filter((x) => x.state === 'passed').reduce((n, x) => n + (x.marks ?? 0), 0),
          approval_note: null,
        },
        questions: p.questions.map(toPreviewQ),
        counts: {
          total: rs.length,
          passed: rs.filter((x) => x.state === 'passed').length,
          open: rs.filter(isOpen).length,
          set_aside: rs.filter((x) => x.state === 'set_aside').length,
        },
        pages: [1, 2, 3].map((n) => ({ page: n, object_path: `pages/${p.id}/${n}.jpg` })),
        checks: checksOf(p),
      };
    },
    async updatePublishMeta(id, field, value) {
      const p = find(id);
      if (p.approval === 'approved') throw pgError('Change its details from Live papers.', '55000');
      const def = PUBLISH_FIELDS.find((f) => f.key === field);
      if (!def) throw pgError(`The field ${field} cannot be changed here.`);
      const problem = fieldProblem(def, value);
      if (problem) throw pgError(problem);
      const h = p.header as unknown as Record<string, unknown>;
      const v = value.trim();
      if (field === 'marks' || field === 'allowed_time_minutes') h[field] = v === '' ? null : Number(v);
      else if (field === 'is_board_paper') h[field] = v === '' ? null : v === 'true';
      else h[field] = field === 'general_instructions' || field === 'incomplete_note' ? (value === '' ? null : value) : v === '' ? null : v;
      metaSeq++;
      record(`meta ${field}=${value}`);
    },
    async approvePaper(id, note, confirmLeftOut) {
      const p = find(id);
      if (p.approval !== 'awaiting') throw pgError('This paper is not waiting to go live.', '55000');
      const checks = checksOf(p);
      const bad = checks.filter((c) => !c.ok);
      if (bad.length > 0) {
        throw pgError(`This paper cannot go live yet. ${bad.map((c) => `${c.label}: ${c.detail}`).join(' ')}`, '55000');
      }
      const aside = real(p).filter((x) => x.state === 'set_aside').length;
      if (aside > 0 && confirmLeftOut !== true) {
        throw Object.assign(
          pgError(
            aside === 1 ? '1 question is left out of this paper. Confirm to publish it without it.' : `${aside} questions are left out of this paper. Confirm to publish it without them.`,
            'P0001',
          ),
          { details: `left_out:${aside}`, hint: 'left_out' },
        );
      }
      p.approval = 'approved';
      p.live_id = `live-${100 + live.length}`;
      const passed = real(p).filter((x) => x.state === 'passed');
      live.unshift({
        paper_id: p.live_id,
        title: p.title,
        subject: p.header.subject,
        cls: p.header.cls,
        school: p.header.school,
        board: p.header.board,
        year: p.header.year,
        exam: p.header.exam,
        marks: p.header.marks,
        question_count: passed.length,
        allowed_time_minutes: p.header.allowed_time_minutes,
        is_published: true,
        hidden_reason: null,
        hidden_at: null,
        hidden_by: null,
        audit_paper_id: p.id,
        from_pipeline: true,
        waiting_students: 0,
        waiting_you: 0,
        general_instructions: p.header.general_instructions,
        incomplete_note: p.header.incomplete_note,
      });
      record(`approve ${id} ${note ?? ''}`);
      return { live_bank_paper_id: p.live_id, question_count: passed.length };
    },
    async livePapers() {
      return live.map((l) => ({ ...l }));
    },
    async hidePaper(id, reason) {
      const l = live.find((x) => x.paper_id === id);
      if (!l) throw pgError('That paper was not found.');
      if (!reason.trim()) throw pgError('Say why the paper is being hidden.');
      if (!l.is_published) throw pgError('This paper is already hidden.', '55000');
      l.is_published = false;
      l.hidden_reason = reason.trim();
      l.hidden_at = new Date().toISOString();
      l.hidden_by = 'You';
      record(`hide ${id}`);
    },
    async restorePaper(id) {
      const l = live.find((x) => x.paper_id === id);
      if (!l) throw pgError('That paper was not found.');
      if (l.is_published) throw pgError('This paper is already live.', '55000');
      l.is_published = true;
      l.hidden_reason = null;
      l.hidden_at = null;
      l.hidden_by = null;
      record(`restore ${id}`);
    },
    async editLivePaper(id, field, value) {
      const l = live.find((x) => x.paper_id === id);
      if (!l) throw pgError('That paper was not found.');
      const def = LIVE_FIELDS.find((f) => f.key === field);
      if (!def) throw pgError(`Field ${field} is not editable through this function`);
      const problem = fieldProblem(def, value ?? '');
      if (problem) throw pgError(problem);
      const r = l as unknown as Record<string, unknown>;
      r[field] = field === 'marks' || field === 'allowed_time_minutes' ? (value === null ? null : Number(value)) : value;
      record(`edit live ${id} ${field}`);
    },
    async studentUploads(status) {
      return uploads.filter((u) => status === 'all' || u.status === status).map((u) => ({ ...u }));
    },
    async reviewUpload(id, decision, note) {
      const u = uploads.find((x) => x.id === id);
      if (!u) throw pgError('That upload was not found.');
      if (u.status !== 'pending') throw pgError(`This upload has already been ${u.status}.`, '55000');
      if (decision === 'rejected' && !(note ?? '').trim()) throw pgError('Say why it is rejected.');
      u.status = decision;
      u.review_note = note?.trim() ? note.trim() : null;
      u.reviewed_at = new Date().toISOString();
      u.reviewed_by_name = 'You';
      record(`upload ${decision} ${id}`);
    },
    async uploadFileUrl(path) {
      return dummyPageDataUrl(`pages/${path.length}/1.jpg`);
    },
    async aiTrustOverall() {
      return { checks_done: 34, agreed: 31, changed: 3, threshold: 100, reached: false, agreement_rate: 31 / 34 };
    },
    async explainAssignment(checkerId, paperId) {
      const who = ckNames(checkerId);
      if (paperId === GL.history) {
        return {
          eligible: true,
          score: 80,
          summary: `${who} is a good fit for this paper.`,
          reasons: [
            { key: 'subject', ok: true, text: 'History is one of their preferred subjects.' },
            { key: 'grade', ok: true, text: 'Class X is within two classes of theirs.' },
            { key: 'board', ok: true, text: 'The board matches theirs.' },
            { key: 'school', ok: null, text: 'Their school is not the paper\'s school.' },
            { key: 'load', ok: true, text: 'They hold only a few papers right now.' },
          ],
        };
      }
      return {
        eligible: true,
        score: 35,
        summary: `${who} can take this paper, though it is not a perfect match.`,
        reasons: [
          { key: 'subject', ok: false, text: 'This subject is not one they asked for.' },
          { key: 'grade', ok: true, text: 'The class is within their range.' },
          { key: 'board', ok: null, text: 'The paper\'s board is not recorded.' },
          { key: 'load', ok: true, text: 'They hold fewer papers than most.' },
        ],
      };
    },
    figureUrl(path) {
      return dummyPictureDataUrl(path);
    },
  };

  return { api, reset: seed };
}
