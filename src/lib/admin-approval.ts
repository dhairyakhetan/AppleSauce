import { supabase } from '@/integrations/supabase/client';
import {
  HISTORY_LIMIT,
  normalisePaperHistory,
  normaliseQuestionHistory,
  normaliseQueueRow,
  normaliseHistoryRow,
  normaliseReview,
  questionState,
  versionFrom,
  type ApprovalApi,
} from '@/lib/admin-approval-shape';

/* The admin paper-approval flow's RPC calls, and nothing else
   (QUEUE_20261002 "API contract"). Every function is admin-only SECURITY
   DEFINER on the server; the browser never writes a table directly.

   ONE place to adjust if the backend migration names things differently:
   RPC below maps each call to its function name, and the argument names are
   spelled once each in realApprovalApi. Shapes are absorbed by the
   normalisers in admin-approval-shape.ts.

   Names and shapes match supabase/migrations/20261003100000_admin_paper_approval.sql
   (the queue is admin_approval_queue, not admin_paper_queue, which stays
   the /admin/paper-review list). */

export const RPC = {
  queue: 'admin_approval_queue',
  history: 'admin_approval_history',
  review: 'admin_paper_review',
  approve: 'admin_approve_paper',
  reject: 'admin_reject_paper',
  unpublish: 'admin_unpublish_paper',
  edit: 'admin_edit_question',
  revert: 'admin_revert_question',
  questionHistory: 'admin_question_full_history',
  paperHistory: 'admin_paper_full_history',
  setState: 'admin_set_question_state',
  restorePaper: 'admin_restore_bank_paper',
} as const;

async function call(fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn as never, (args ?? {}) as never);
  if (error) throw error;
  return data as unknown;
}

export const realApprovalApi: ApprovalApi = {
  async queue() {
    const data = await call(RPC.queue);
    return (Array.isArray(data) ? data : []).map(normaliseQueueRow).filter((r) => r.audit_paper_id);
  },
  async history() {
    const data = await call(RPC.history, { p_limit: HISTORY_LIMIT });
    return (Array.isArray(data) ? data : []).map(normaliseHistoryRow).filter((r) => r.audit_paper_id);
  },
  async review(auditPaperId) {
    return normaliseReview(await call(RPC.review, { p_audit_paper_id: auditPaperId }));
  },
  async approve(auditPaperId, note) {
    const data = await call(RPC.approve, { p_audit_paper_id: auditPaperId, p_note: note });
    return typeof data === 'string' ? data : null;
  },
  async reject(auditPaperId, note) {
    await call(RPC.reject, { p_audit_paper_id: auditPaperId, p_note: note });
  },
  async unpublish(bankPaperId, note) {
    await call(RPC.unpublish, { p_bank_paper_id: bankPaperId, p_note: note });
  },
  async editQuestion(questionId, version, changes, note) {
    return versionFrom(
      await call(RPC.edit, { p_question_id: questionId, p_version: version, p_changes: changes, p_note: note }),
    );
  },
  async revertQuestion(questionId, toVersion, note) {
    return versionFrom(
      await call(RPC.revert, { p_question_id: questionId, p_to_version: toVersion, p_note: note }),
    );
  },
  async questionHistory(questionId) {
    return normaliseQuestionHistory(await call(RPC.questionHistory, { p_question_id: questionId }));
  },
  async paperHistory(auditPaperId) {
    return normalisePaperHistory(await call(RPC.paperHistory, { p_audit_paper_id: auditPaperId }));
  },
  async setQuestionState(questionId, state, note) {
    const data = await call(RPC.setState, { p_question_id: questionId, p_state: state, p_note: note || null });
    return questionState(typeof data === 'string' ? data : null);
  },
  async restorePaper(bankPaperId) {
    await call(RPC.restorePaper, { p_paper_id: bankPaperId });
  },
};
