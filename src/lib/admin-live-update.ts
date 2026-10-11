import { supabase } from '@/integrations/supabase/client';
import { paperTitleFrom, writeErrorWords } from '@/lib/admin-approval-shape';
import { adminFlagLines } from '@/lib/paper-edit';

/* "Update live paper": the admin button that pushes a live paper's reviewed
   changes (updated text, added rows, hidden rows) to the site. Two RPCs, both
   admin-only SECURITY DEFINER (migration 20261004100000):
     admin_live_paper_pending()          what is waiting, per paper
     admin_update_live_paper(uuid)       do it (refuses while questions are open)
   The browser never writes a table directly. */

export const LIVE_UPDATE_RPC = {
  pending: 'admin_live_paper_pending',
  update: 'admin_update_live_paper',
  openQuestions: 'admin_live_paper_open_questions',
} as const;

export interface LivePendingRow {
  audit_paper_id: string;
  live_bank_paper_id: string;
  title: string;
  school: string | null;
  updated: number;
  added: number;
  hidden: number;
  open: number;
}

/** One question that still blocks the update (migration 20261005130000). */
export interface OpenQuestion {
  id: string;
  label: string;
  where: 'Student queue' | 'Admin queue';
  reasons: string[];
}

export interface LiveUpdateResult {
  updated: number;
  added: number;
  hidden: number;
}

export interface LiveUpdateApi {
  pending(): Promise<LivePendingRow[]>;
  update(auditPaperId: string): Promise<LiveUpdateResult>;
  openQuestions(auditPaperId: string): Promise<OpenQuestion[]>;
}

const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
};
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export function normalisePending(raw: unknown): LivePendingRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = s(r.audit_paper_id);
  if (!id) return null;
  return {
    audit_paper_id: id,
    live_bank_paper_id: s(r.live_bank_paper_id) ?? '',
    title: paperTitleFrom({ cls: s(r.cls), subject: s(r.subject), year: s(r.year) }),
    school: s(r.school),
    updated: n(r.questions_updated),
    added: n(r.questions_added),
    hidden: n(r.questions_hidden),
    open: n(r.open_questions),
  };
}

export function normaliseResult(raw: unknown): LiveUpdateResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { updated: n(r.updated), added: n(r.added), hidden: n(r.hidden) };
}

export function normaliseOpenQuestion(raw: unknown, index = 0): OpenQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = s(r.audit_question_id);
  if (!id) return null;
  const reasons = Array.isArray(r.flag_reasons) ? r.flag_reasons.filter((x): x is string => typeof x === 'string') : [];
  const lines = adminFlagLines(reasons, s(r.flag_detail));
  return {
    id,
    label: s(r.display_number) ?? s(r.number_path) ?? `Row ${index + 1}`,
    where: r.review_bucket === 'kid' ? 'Student queue' : 'Admin queue',
    reasons: lines.length > 0 ? lines : ['No reason was recorded. Open it and read it against the paper.'],
  };
}

/** Where an admin passes, fixes or sets aside this question: the paper review page, scrolled to it. */
export const solveHref = (auditPaperId: string, questionId: string): string =>
  `/admin/paper-approvals/${auditPaperId}#q-${questionId}`;

/** A paper can be pushed once no question is still open. */
export const canUpdate = (r: LivePendingRow): boolean => r.open === 0;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "This changes the live paper: 3 questions updated, 2 added, 1 hidden. Logged and reversible." */
export function confirmWords(r: Pick<LivePendingRow, 'updated' | 'added' | 'hidden'>): string {
  return `This changes the live paper: ${plural(r.updated, 'question', 'questions')} updated, ${r.added} added, ${r.hidden} hidden. Logged and reversible.`;
}

export function doneWords(r: LiveUpdateResult): string {
  return `Live paper updated: ${plural(r.updated, 'question', 'questions')} updated, ${r.added} added, ${r.hidden} hidden.`;
}

export function updateErrorWords(e: unknown): string {
  return writeErrorWords(e, 'The live paper was not changed. Check your internet and try again.');
}

export const realLiveUpdateApi: LiveUpdateApi = {
  async pending() {
    const { data, error } = await supabase.rpc(LIVE_UPDATE_RPC.pending as never);
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(normalisePending).filter((r): r is LivePendingRow => r !== null);
  },
  async update(auditPaperId) {
    const { data, error } = await supabase.rpc(LIVE_UPDATE_RPC.update as never, { p_audit_paper_id: auditPaperId } as never);
    if (error) throw error;
    return normaliseResult(data);
  },
  async openQuestions(auditPaperId) {
    const { data, error } = await supabase.rpc(LIVE_UPDATE_RPC.openQuestions as never, { p_audit_paper_id: auditPaperId } as never);
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(normaliseOpenQuestion).filter((r): r is OpenQuestion => r !== null);
  },
};
