import type { EscalationRow } from '@/lib/checker-api';
import type { AdminQueueApi, QueuePaper, QueueQuestion } from '@/lib/admin-queue';
import type { ReviewRow } from '@/lib/admin-approval-shape';

/* In-memory fake of the Admin queue reads and the three decisions (D75), for
   previewing /admin/admin-queue without an admin sign-in. Every paper, school
   and question is MADE UP. Decisions change this copy only and are gone on
   reload. */

const P1 = 'f2a00000-0000-4000-8000-0000000000b1';
const P2 = 'f2a00000-0000-4000-8000-0000000000b2';
const P3 = 'f2a00000-0000-4000-8000-0000000000b3';

function q(id: string, paper: string, ord: number, num: string, body: string, flags: string[], page: number, detail: string | null = null): QueueQuestion {
  const row: ReviewRow = {
    id,
    kind: 'question',
    ord,
    parent_id: null,
    display_number: num,
    number_path: num,
    body,
    options: [],
    marks: 2,
    instructions: null,
    figure: null,
    state: 'open',
    version: 1,
    flag_reasons: flags,
    flag_detail: detail,
    review_bucket: 'admin',
    live_bank_question_id: null,
    set_aside_reason: null,
  };
  return { row, page: page > 0 ? page : null, page_path: page > 0 ? `pages/${paper}/${page}.jpg` : null, snippet_path: null };
}

export function createFakeAdminQueueApi(): AdminQueueApi {
  const papers: QueuePaper[] = [
    { audit_paper_id: P1, title: 'ICSE Class 10 Mathematics, 2024', school: 'Sample Hill School', waiting: 3, is_live: true },
    { audit_paper_id: P2, title: 'CBSE Class 12 Physics, 2023', school: 'Riverside Academy', waiting: 2, is_live: false },
    { audit_paper_id: P3, title: 'ISC Class 11 Commerce, 2022', school: 'Lakeview Institute', waiting: 1, is_live: false },
  ];
  const questions = new Map<string, QueueQuestion[]>([
    [P1, [
      q('f2b00000-0000-4000-8000-000000000001', P1, 1, '3', 'A shopkeeper buys a table for Rs 1,200 and sells it at a gain of 15%. Find the selling price.', ['possible_duplicate'], 2),
      q('f2b00000-0000-4000-8000-000000000002', P1, 2, '7(b)', 'Solve for x: 2x + 5 = 17.', ['display_number_missing'], 0),
      q('f2b00000-0000-4000-8000-000000000003', P1, 3, '9', 'The sum of two numbers is 40 and their difference is', ['incomplete_text'], 0),
    ]],
    [P2, [
      q('f2b00000-0000-4000-8000-000000000004', P2, 1, '2', 'State Ohm\'s law and write its formula.', ['low_ocr_confidence'], 1),
      q('f2b00000-0000-4000-8000-000000000005', P2, 2, '5', 'A wire of resistance 4 ohm carries a current of 3 A. Find the potential difference across it.', ['possible_duplicate'], 2),
    ]],
    [P3, [q('f2b00000-0000-4000-8000-000000000006', P3, 1, '1', 'Define a journal and state two of its uses.', ['low_ocr_confidence'], 0)]],
  ]);
  const help: EscalationRow[] = [
    {
      question_id: 'f2b00000-0000-4000-8000-000000000009',
      paper_id: P1,
      live_bank_paper_id: null,
      display_number: '4',
      body: 'Find the value of $x$ if $3x + 7 = 22$. Show each step of your working.',
      flag_reasons: ['display_number_missing'],
      school: 'Sample Hill School',
      subject: 'Mathematics',
      cls: '10',
      updated_at: new Date().toISOString(),
    },
    {
      question_id: 'f2b00000-0000-4000-8000-00000000000a',
      paper_id: P2,
      live_bank_paper_id: null,
      display_number: '6(a)',
      body: 'A body of mass 2 kg moves with a speed of 5 m/s. Calculate its kinetic energy.',
      flag_reasons: ['possible_duplicate'],
      school: 'Riverside Academy',
      subject: 'Physics',
      cls: '12',
      updated_at: new Date().toISOString(),
    },
  ];

  const page = (n: number) =>
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#fbf8f2"/><rect x="24" y="24" width="592" height="372" fill="none" stroke="#cfc6b8"/><text x="48" y="64" font-family="serif" font-size="18" fill="#555">Made-up printed page ${n}</text><g fill="#d9d2c6"><rect x="48" y="96" width="480" height="10"/><rect x="48" y="122" width="520" height="10"/><rect x="48" y="148" width="430" height="10"/><rect x="48" y="200" width="500" height="10"/><rect x="48" y="226" width="380" height="10"/></g></svg>`,
    );

  function find(id: string): { list: QueueQuestion[]; item: QueueQuestion; paper: string } {
    for (const [paper, list] of questions) {
      const item = list.find((x) => x.row.id === id);
      if (item) return { list, item, paper };
    }
    throw new Error('Question not found');
  }
  function drop(id: string) {
    const { list, item, paper } = find(id);
    questions.set(paper, list.filter((x) => x !== item));
    const p = papers.find((x) => x.audit_paper_id === paper);
    if (p) p.waiting = Math.max(0, p.waiting - 1);
  }

  return {
    async papers() {
      return papers.filter((p) => p.waiting > 0).map((p) => ({ ...p }));
    },
    async questions(id) {
      return (questions.get(id) ?? []).map((x) => ({ ...x, row: { ...x.row } }));
    },
    async helpRequests() {
      return help.map((h) => ({ ...h }));
    },
    async resolveHelp(id) {
      const i = help.findIndex((h) => h.question_id === id);
      if (i >= 0) help.splice(i, 1);
    },
    async paperPages(id) {
      // P3 has no pictures at all, to preview the plain "nothing to look at" message.
      if (id === P3) return [];
      return [1, 2, 3, 4].map((n) => ({ page: n, object_path: `pages/${id}/${n}.jpg` }));
    },
    async pictureUrl(path) {
      const m = /\/(\d+)\.jpg$/.exec(path);
      return page(m ? Number(m[1]) : 1);
    },
    async editQuestion(id, _version, changes) {
      const { item } = find(id);
      const c = changes as { body?: string; display_number?: string };
      if (typeof c.body === 'string') item.row.body = c.body;
      if (typeof c.display_number === 'string') item.row.display_number = c.display_number;
      item.row.version += 1;
      return item.row.version;
    },
    async revertQuestion() {
      return 1;
    },
    async questionHistory() {
      return { versions: [], events: [], checks: [] };
    },
    async setQuestionState(id, state) {
      if (state === 'pass') {
        drop(id);
        return 'passed';
      }
      if (state === 'set_aside') {
        drop(id);
        return 'set_aside';
      }
      return 'open';
    },
  };
}
