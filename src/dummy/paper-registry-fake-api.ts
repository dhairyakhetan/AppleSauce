import {
  PROCESSED_STATES,
  type PaperRegistryApi,
  type ProcessedState,
  type RegistryPage,
  type RegistryRow,
  type RegistrySummary,
} from '@/lib/paper-registry';

/* The paper registry's fake API for dummy mode (D75). Every name, school and
   number is made up; nothing here is read from the real database. It filters,
   searches and pages the way the real RPCs do, so the panel can be exercised
   end to end without a sign-in. */

const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'Geography', 'Not recorded'];
const SCHOOLS = ['Sample High School', 'Example Academy', 'Demo Public School', 'Placeholder Institute', ''];
const BOARDS = ['ICSE', 'ISC', 'CBSE'];
const CLASSES = ['IX', 'X', 'XI', 'XII'];
const YEARS = ['2023', '2024', '2025', '2026'];

// Weighted so "not started" is the biggest pile, like the real backlog.
const STATE_PLAN: ProcessedState[] = [
  ...Array<ProcessedState>(46).fill('not_started'),
  ...Array<ProcessedState>(8).fill('ocr_queued'),
  ...Array<ProcessedState>(6).fill('ocr_done'),
  ...Array<ProcessedState>(14).fill('loaded'),
  ...Array<ProcessedState>(10).fill('ai_checked'),
  ...Array<ProcessedState>(5).fill('fully_checked'),
  ...Array<ProcessedState>(7).fill('awaiting_approval'),
  ...Array<ProcessedState>(34).fill('live'),
];

const STATE_RANK = Object.fromEntries(PROCESSED_STATES.map((s, i) => [s, i])) as Record<ProcessedState, number>;

function fakeUuid(i: number): string {
  const hex = (i + 1).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function buildRows(): RegistryRow[] {
  const now = Date.now();
  return STATE_PLAN.map((state, i) => {
    const subject = SUBJECTS[i % SUBJECTS.length];
    const started = state !== 'not_started' && state !== 'ocr_queued' && state !== 'ocr_done';
    const total = started ? 20 + (i % 25) : null;
    const passed =
      total == null ? null
      : state === 'loaded' ? Math.floor(total * 0.1)
      : state === 'ai_checked' ? Math.floor(total * 0.6)
      : total;
    const open = total == null || passed == null ? null : total - passed;
    return {
      registry_key: `demo-${String(i + 1).padStart(3, '0')}`,
      pdf_name: `Demo_${subject.replace(/\s/g, '')}_${CLASSES[i % 4]}_${YEARS[i % 4]}_paper_${i + 1}.pdf`,
      board: BOARDS[i % 3],
      class: CLASSES[i % 4],
      subject: subject === 'Not recorded' ? null : subject,
      year: YEARS[i % 4],
      school: SCHOOLS[i % SCHOOLS.length] || null,
      ocr_state: state === 'not_started' ? null : state === 'ocr_queued' ? 'queued' : 'done',
      processed_state: state,
      audit_paper_id: started ? fakeUuid(i) : null,
      bank_paper_id: state === 'live' ? `demo-bank-${i + 1}` : null,
      source: i % 5 === 0 ? 'folder_sort' : 'desk',
      questions_total: total,
      questions_passed: passed,
      open_student: open == null ? null : Math.ceil(open * 0.7),
      open_admin: open == null ? null : Math.floor(open * 0.3),
      approval_state: state === 'awaiting_approval' ? 'ready' : state === 'live' ? 'approved' : null,
      frozen: i % 31 === 0 && state !== 'live',
      excluded: false,
      updated_at: new Date(now - (i % 40) * 3600e3).toISOString(),
    };
  });
}

function summarise(rows: RegistryRow[], excluded: number): RegistrySummary {
  const by_state: RegistrySummary['by_state'] = {};
  const subjects = new Map<string, { total: number; by_state: RegistrySummary['by_state'] }>();
  const by_board: Record<string, number> = {};
  for (const r of rows) {
    by_state[r.processed_state] = (by_state[r.processed_state] ?? 0) + 1;
    const subject = r.subject || 'Not recorded';
    const s = subjects.get(subject) ?? { total: 0, by_state: {} };
    s.total += 1;
    s.by_state[r.processed_state] = (s.by_state[r.processed_state] ?? 0) + 1;
    subjects.set(subject, s);
    const board = r.board || 'Not recorded';
    by_board[board] = (by_board[board] ?? 0) + 1;
  }
  return {
    total: rows.length,
    by_state,
    by_subject: [...subjects.entries()]
      .map(([subject, v]) => ({ subject, total: v.total, by_state: v.by_state }))
      .sort((a, b) => b.total - a.total || a.subject.localeCompare(b.subject)),
    by_board,
    frozen: rows.filter((r) => r.frozen).length,
    excluded,
    last_updated_at: rows.length ? new Date(Date.now() - 4 * 60e3).toISOString() : null,
  };
}

/** `mode` lets a screenshot or a test reach the empty and error states. */
export function createFakePaperRegistryApi(mode: 'full' | 'empty' | 'error' = 'full'): PaperRegistryApi {
  const rows = mode === 'empty' ? [] : buildRows();
  return {
    async summary() {
      if (mode === 'error') throw new Error('fake registry failure');
      return summarise(rows, mode === 'empty' ? 0 : 3);
    },
    async list(q): Promise<RegistryPage> {
      if (mode === 'error') throw new Error('fake registry failure');
      const needle = q.search.trim().toLowerCase();
      const hits = rows
        .filter((r) => !q.state || r.processed_state === q.state)
        .filter((r) => !q.subject || (r.subject || 'Not recorded') === q.subject)
        .filter(
          (r) =>
            !needle ||
            r.pdf_name?.toLowerCase().includes(needle) ||
            r.registry_key.toLowerCase().includes(needle) ||
            r.audit_paper_id?.toLowerCase().includes(needle) ||
            r.bank_paper_id?.toLowerCase().includes(needle),
        )
        .sort(
          (a, b) =>
            STATE_RANK[a.processed_state] - STATE_RANK[b.processed_state] ||
            (a.pdf_name ?? '').localeCompare(b.pdf_name ?? '') ||
            a.registry_key.localeCompare(b.registry_key),
        );
      return { total: hits.length, rows: hits.slice(q.offset, q.offset + q.limit) };
    },
  };
}
