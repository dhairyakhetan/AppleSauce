import { supabase } from '@/integrations/supabase/client';

/**
 * Admin audit log — new table `admin_audit_log` (see
 * supabase/migrations/20260818000000_admin_audit_log.sql — APPLIED and verified:
 * only SELECT and INSERT policies exist, RLS is on, and `authenticated` has no
 * UPDATE or DELETE privilege). Append-only: admins can
 * SELECT and INSERT their own rows, nobody can UPDATE or DELETE (RLS-enforced,
 * see the migration).
 *
 * CRITICAL: audit logging must never break the mutation it observes.
 * `recordAdminAction` swallows its own errors — a failed insert is logged to
 * the console (dev only) and otherwise silently dropped. Callers must invoke
 * this AFTER the mutation has already succeeded, never before and never
 * inside the same try/catch that would roll the mutation back on failure.
 */

export type AdminAuditAction =
  | 'approve'
  | 'reject'
  | 'sent_back'
  | 'edit'
  | 'delete'
  | 'takedown'
  | 'hold'
  | 'publish'
  | 'unpublish'
  | 'resolve';

export interface RecordAdminActionInput {
  actorId: string;
  actorName: string;
  action: AdminAuditAction | (string & {});
  targetType: string;
  targetId: string;
  targetLabel: string;
  reason?: string | null;
}

/**
 * Insert one row into the audit log. Fire-and-forget from the caller's point
 * of view: never throws, never rejects. Call it AFTER the admin mutation you
 * are recording has already succeeded.
 */
export async function recordAdminAction(input: RecordAdminActionInput): Promise<void> {
  try {
    const { error } = await supabase.from('admin_audit_log').insert({
      actor_id: input.actorId,
      actor_name: input.actorName,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      target_label: input.targetLabel,
      reason: input.reason ?? null,
    });

    if (error && import.meta.env.DEV) {
      console.error('[audit] failed to record admin action', error, input);
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error('[audit] unexpected error recording admin action', err, input);
    }
  }
}
