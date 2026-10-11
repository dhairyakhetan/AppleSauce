/* The paper registry, as /admin/pipeline reads it.

   public.paper_registry (supabase/migrations/20261005140000_paper_registry.sql)
   holds one row per source PDF the pipeline knows about, processed or not.
   The desk writes it; the site only reads it, through two admin-only RPCs:
   admin_paper_registry_summary() and admin_paper_registry(...). Names, ids and
   counts only: no question text and no answer keys ever reach this page.

   This file is the shapes plus the small pure helpers (labels, counters,
   merging pages), kept out of the component so the arithmetic has tests. The
   panel reads through one PaperRegistryApi object (real one in
   paper-registry-api.ts) so dummy mode (D75) can hand it a fake. */

export const PROCESSED_STATES = [
  'not_started',
  'ocr_queued',
  'ocr_done',
  'loaded',
  'ai_checked',
  'fully_checked',
  'awaiting_approval',
  'live',
] as const;

export type ProcessedState = (typeof PROCESSED_STATES)[number];

export function isProcessedState(s: unknown): s is ProcessedState {
  return typeof s === 'string' && (PROCESSED_STATES as readonly string[]).includes(s);
}

interface StateLook {
  /** Plain-words name shown to the admin. */
  label: string;
  /** One line on what it means, for tooltips and the key. */
  hint: string;
  /** Solid colour of this state's slice of the stacked bar. */
  bar: string;
  /** Badge fill and text. */
  pill: string;
  /** Dot inside the badge. */
  dot: string;
}

export const STATE_LOOK: Record<ProcessedState, StateLook> = {
  not_started: {
    label: 'Not started',
    hint: 'The PDF is known but nothing has been done with it yet.',
    bar: 'bg-rose-500',
    pill: 'bg-rose-100 text-rose-900',
    dot: 'bg-rose-600',
  },
  ocr_queued: {
    label: 'Waiting to be read',
    hint: 'Queued for reading, or in the middle of it.',
    bar: 'bg-amber-300',
    pill: 'bg-amber-100 text-amber-900',
    dot: 'bg-amber-600',
  },
  ocr_done: {
    label: 'Read, not loaded',
    hint: 'The pages are read, but the paper is not on the checking desk yet.',
    bar: 'bg-amber-500',
    pill: 'bg-amber-100 text-amber-900',
    dot: 'bg-amber-700',
  },
  loaded: {
    label: 'Loaded, not checked',
    hint: 'On the checking desk, waiting for its first checks.',
    bar: 'bg-sky-400',
    pill: 'bg-sky-100 text-sky-900',
    dot: 'bg-sky-600',
  },
  ai_checked: {
    label: 'Checked by the AI',
    hint: 'The AI pass is done. Verifiers and admins still have questions to clear.',
    bar: 'bg-blue-500',
    pill: 'bg-blue-100 text-blue-900',
    dot: 'bg-blue-600',
  },
  fully_checked: {
    label: 'Fully checked',
    hint: 'Every question is cleared.',
    bar: 'bg-indigo-500',
    pill: 'bg-indigo-100 text-indigo-900',
    dot: 'bg-indigo-600',
  },
  awaiting_approval: {
    label: 'Waiting for your approval',
    hint: 'Fully checked. It needs an admin to approve it before it goes live.',
    bar: 'bg-violet-500',
    pill: 'bg-violet-100 text-violet-900',
    dot: 'bg-violet-600',
  },
  live: {
    label: 'Live',
    hint: 'Published in the library for visitors.',
    bar: 'bg-emerald-500',
    pill: 'bg-mint text-[#24603D]',
    dot: 'bg-[#24603D]',
  },
};

export function stateLabel(s: string | null | undefined): string {
  return isProcessedState(s) ? STATE_LOOK[s].label : 'Not started';
}

/** One row of admin_paper_registry(): explicit columns, no question text. */
export interface RegistryRow {
  registry_key: string;
  pdf_name: string | null;
  board: string | null;
  class: string | null;
  subject: string | null;
  year: string | null;
  school: string | null;
  ocr_state: string | null;
  processed_state: ProcessedState;
  audit_paper_id: string | null;
  bank_paper_id: string | null;
  source: string | null;
  questions_total: number | null;
  questions_passed: number | null;
  open_student: number | null;
  open_admin: number | null;
  approval_state: string | null;
  frozen: boolean;
  excluded: boolean;
  updated_at: string | null;
}

export interface RegistryPage {
  total: number;
  rows: RegistryRow[];
}

export interface RegistrySubjectCounts {
  subject: string;
  total: number;
  by_state: Partial<Record<ProcessedState, number>>;
}

/** What admin_paper_registry_summary() returns. */
export interface RegistrySummary {
  total: number;
  by_state: Partial<Record<ProcessedState, number>>;
  by_subject: RegistrySubjectCounts[];
  by_board: Record<string, number>;
  frozen: number;
  excluded: number;
  last_updated_at: string | null;
}

export interface RegistryQuery {
  state: ProcessedState | null;
  search: string;
  subject: string | null;
  limit: number;
  offset: number;
}

export interface PaperRegistryApi {
  summary(): Promise<RegistrySummary>;
  list(q: RegistryQuery): Promise<RegistryPage>;
}

export const REGISTRY_PAGE_SIZE = 50;

/** A list request that may span several states. An empty list of states means every state. */
export type RegistryStatesQuery = Omit<RegistryQuery, 'state'> & { states: readonly ProcessedState[] };

/** The server filters on one state at a time. Rows come back in pipeline order (state first, then name), so the pages of
    several states are each state's pages laid end to end: this walks them in order and fills one page. */
export async function listForStates(api: Pick<PaperRegistryApi, 'list'>, q: RegistryStatesQuery): Promise<RegistryPage> {
  const { states, ...rest } = q;
  if (states.length <= 1) return api.list({ ...rest, state: states[0] ?? null });
  let rows: RegistryRow[] = [];
  let total = 0;
  for (const s of PROCESSED_STATES.filter((x) => states.includes(x))) {
    const room = rest.limit - rows.length;
    // Every state is asked, even once the page is full, because the total counts all of them.
    const page = await api.list({ ...rest, state: s, offset: Math.max(0, rest.offset - total), limit: Math.max(1, room) });
    if (room > 0) rows = rows.concat(page.rows.slice(0, room));
    total += page.total;
  }
  return { total, rows };
}

/** Count for one state, never undefined, never negative. */
export function stateCount(summary: Pick<RegistrySummary, 'by_state'>, s: ProcessedState): number {
  return Math.max(0, Number(summary.by_state?.[s]) || 0);
}

/** The three headline numbers: not started, in progress, on the site. */
export function headlineCounts(summary: Pick<RegistrySummary, 'total' | 'by_state'>) {
  const notStarted = stateCount(summary, 'not_started');
  const live = stateCount(summary, 'live');
  const inProgress = PROCESSED_STATES.filter((s) => s !== 'not_started' && s !== 'live')
    .reduce((n, s) => n + stateCount(summary, s), 0);
  return { notStarted, inProgress, live, total: Math.max(0, Number(summary.total) || 0) };
}

/** Bar slices in pipeline order, empty states dropped, widths as percent of the total. */
export function barSegments(summary: Pick<RegistrySummary, 'total' | 'by_state'>) {
  const total = headlineCounts(summary).total;
  return PROCESSED_STATES.map((s) => ({ state: s, count: stateCount(summary, s) }))
    .filter((x) => x.count > 0)
    .map((x) => ({ ...x, widthPct: total > 0 ? (x.count / total) * 100 : 0 }));
}

/** Whole-number percent of part in whole; 0 when whole is 0, never NaN. */
export function percent(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((Math.max(0, part) / whole) * 100);
}

/** Subjects for the filter, each with how many papers it holds in the chosen state. */
export function subjectOptions(summary: Pick<RegistrySummary, 'by_subject'>, state: ProcessedState | null) {
  return (summary.by_subject ?? [])
    .map((s) => ({
      subject: s.subject,
      count: state ? Math.max(0, Number(s.by_state?.[state]) || 0) : Math.max(0, Number(s.total) || 0),
    }))
    .filter((s) => s.count > 0)
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

/** Adds the next page to what is already shown, skipping any repeated row. */
export function mergeRows(prev: RegistryRow[], next: RegistryRow[]): RegistryRow[] {
  const seen = new Set(prev.map((r) => r.registry_key));
  return [...prev, ...next.filter((r) => !seen.has(r.registry_key))];
}

export function hasMore(total: number, shown: number): boolean {
  return shown < total;
}

/** "Show more" is offered only when there is more, nothing failed, and no new first page is on its way. A click while a new filter is
    still loading would append that page's rows onto the old filter's rows. */
export function canShowMore(total: number, shown: number, state: { listError: boolean; listLoading: boolean }): boolean {
  return hasMore(total, shown) && !state.listError && !state.listLoading;
}

/** A row's display name: the PDF, or its key when the PDF name was not sent. */
export function rowTitle(r: Pick<RegistryRow, 'pdf_name' | 'registry_key'>): string {
  return r.pdf_name?.trim() || r.registry_key;
}

/** What a row leads with: "ICSE Class X Physics, 2025", or the PDF name when the desk sent no facts. */
export function rowHeading(r: Pick<RegistryRow, 'board' | 'class' | 'subject' | 'year' | 'pdf_name' | 'registry_key'>): string {
  const main = [r.board, r.class ? `Class ${r.class}` : null, r.subject]
    .map((x) => (x ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const year = (r.year ?? '').trim();
  if (!main) return rowTitle(r);
  return year ? `${main}, ${year}` : main;
}

/** Under the heading: the PDF name, then the school. Skips the PDF name when it is the heading already. */
export function rowSubline(r: Pick<RegistryRow, 'board' | 'class' | 'subject' | 'year' | 'pdf_name' | 'registry_key' | 'school'>): string {
  const parts = [rowHeading(r) === rowTitle(r) ? '' : rowTitle(r), (r.school ?? '').trim()].filter(Boolean);
  return parts.join(', ');
}

/** "ICSE, Class X, Physics, 2025" with whatever is known, no stray commas. */
export function rowFacts(r: Pick<RegistryRow, 'board' | 'class' | 'subject' | 'year' | 'school'>): string {
  return [r.board, r.class ? `Class ${r.class}` : null, r.subject, r.year, r.school]
    .map((x) => (x ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/** "12 of 40 questions cleared", or '' when the desk has not counted yet. */
export function questionsLine(r: Pick<RegistryRow, 'questions_total' | 'questions_passed'>): string {
  const total = r.questions_total;
  if (total == null || total <= 0) return '';
  const passed = Math.min(Math.max(0, r.questions_passed ?? 0), total);
  return `${passed} of ${total} questions cleared`;
}

/** The admin review page for a paper, only when the registry knows its audit id. */
export function adminPaperHref(r: Pick<RegistryRow, 'audit_paper_id'>): string | null {
  return r.audit_paper_id ? `/admin/paper-approvals/${r.audit_paper_id}` : null;
}

/** Open-question count as shown in a cell: a number, or an en-dash-free "n/a". */
export function openCount(n: number | null | undefined): string {
  return n == null ? 'n/a' : String(Math.max(0, n));
}
