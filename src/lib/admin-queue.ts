import { supabase } from '@/integrations/supabase/client';
import { realApprovalApi } from '@/lib/admin-approval';
import { normaliseReviewRow, paperTitleFrom, type ApprovalApi, type ReviewRow } from '@/lib/admin-approval-shape';
import { adminEscalationQueue, adminResolveEscalation, checkerPictureUrl, isMissingFunctionError, paperPagePictures, type EscalationRow } from '@/lib/checker-api';
import type { PaperPage } from '@/lib/paper-pages';

/* The Admin queue: questions whose checking ended with "an admin must decide"
   (the question's review bucket is "admin" and it is not passed). The owner's
   first question was "why is the admin queue 657 and where can I see it?", so
   this page exists to answer both: the number, the 38 papers it sits on, and
   every question with the page it came from.

   Two reads, so the page opens fast and a paper's questions load only when it
   is opened (a flat list of 657 question bodies is the slow way to do it):
     admin_queue_papers()                  one light row per paper (counts only)
     admin_queue_questions(audit paper id) that paper's waiting questions
   both in 20261003130000_admin_queue_library.sql. Pass, Edit and Set aside
   reuse the approval flow's functions (admin_set_question_state,
   admin_edit_question), so a decision here is versioned and logged the same
   way as one made on a paper's review page. */

export interface QueuePaper {
  audit_paper_id: string;
  title: string;
  school: string | null;
  /** Questions of this paper waiting for an admin. */
  waiting: number;
  /** Whether the paper is on the site now. */
  is_live: boolean;
}

export interface QueueQuestion {
  row: ReviewRow;
  /** 1-based page of the printed paper this question sits on. */
  page: number | null;
  /** Storage path of that page's picture in the private audit-figures bucket. */
  page_path: string | null;
  /** Storage path of the crop of this question, when there is one. */
  snippet_path: string | null;
}

export interface AdminQueueApi extends Pick<ApprovalApi, 'editQuestion' | 'questionHistory' | 'revertQuestion' | 'setQuestionState'> {
  papers(): Promise<QueuePaper[] | null>;
  questions(auditPaperId: string): Promise<QueueQuestion[]>;
  helpRequests(): Promise<EscalationRow[]>;
  resolveHelp(questionId: string): Promise<void>;
  /** A short-lived link to a stored picture, or null. */
  pictureUrl(path: string): Promise<string | null>;
  /** Every page picture of a paper, for the whole-paper fallback. */
  paperPages(auditPaperId: string): Promise<PaperPage[]>;
}

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const n = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
};

export function normaliseQueuePaper(raw: unknown): QueuePaper | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = s(r.audit_paper_id);
  if (!id) return null;
  const base = { board: s(r.board), cls: s(r.cls) ?? s(r.class), subject: s(r.subject), year: s(r.year) };
  return {
    audit_paper_id: id,
    title: s(r.title) ?? paperTitleFrom(base),
    school: s(r.school),
    waiting: n(r.waiting) ?? 0,
    is_live: r.is_live === true || r.is_live === 'true',
  };
}

export function normaliseQueueQuestion(raw: unknown, i: number): QueueQuestion {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    row: normaliseReviewRow(raw, i),
    page: n(r.page),
    page_path: s(r.page_path),
    snippet_path: s(r.snippet_path),
  };
}

async function rpc(fn: string, args?: Record<string, unknown>) {
  return supabase.rpc(fn as never, (args ?? {}) as never);
}

/** What the papers read means. Null ONLY when the server does not have
 *  admin_queue_papers yet (the page says so). Any other failure throws, so the page
 *  shows an error with Try again instead of blaming a missing update. Pure. */
export function queuePapersFromRpc(res: { data: unknown; error: { code?: string | null } | null }): QueuePaper[] | null {
  if (res.error) {
    if (isMissingFunctionError(res.error)) return null;
    throw res.error;
  }
  return ((Array.isArray(res.data) ? res.data : []) as unknown[]).map(normaliseQueuePaper).filter((p): p is QueuePaper => p !== null);
}

export const realAdminQueueApi: AdminQueueApi = {
  editQuestion: realApprovalApi.editQuestion,
  questionHistory: realApprovalApi.questionHistory,
  revertQuestion: realApprovalApi.revertQuestion,
  setQuestionState: realApprovalApi.setQuestionState,
  async papers() {
    return queuePapersFromRpc(await rpc('admin_queue_papers'));
  },
  async questions(auditPaperId) {
    const { data, error } = await rpc('admin_queue_questions', { p_audit_paper_id: auditPaperId });
    if (error) throw error;
    return ((Array.isArray(data) ? data : []) as unknown[]).map(normaliseQueueQuestion);
  },
  helpRequests: adminEscalationQueue,
  resolveHelp: (id) => adminResolveEscalation(id),
  pictureUrl: checkerPictureUrl,
  paperPages: paperPagePictures,
};
