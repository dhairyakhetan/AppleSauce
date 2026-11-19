import { supabase } from '@/integrations/supabase/client';

/* The admin audit log, read through one small API object so the page can be
   handed a fake in dummy mode (D75). Read-only: RLS on admin_audit_log lets
   `authenticated` SELECT and INSERT only, and the only writer is
   recordAdminAction() in audit.ts.

   The column list is explicit. admin_audit_log also holds actor_id and
   target_id, which this screen never shows. */

export interface AuditRow {
  id: string;
  actor_name: string;
  action: string;
  target_type: string;
  target_label: string;
  reason: string | null;
  created_at: string;
}

export const AUDIT_COLUMNS = 'id, actor_name, action, target_type, target_label, reason, created_at';

/** How many entries the page asks for. The page says so when it reaches this. */
export const AUDIT_LIMIT = 500;

export interface AuditApi {
  /** Newest first. Rejects when the read fails: a failed read is never an empty log. */
  list(limit: number): Promise<AuditRow[]>;
}

export const realAuditApi: AuditApi = {
  async list(limit) {
    const { data, error } = await supabase
      .from('admin_audit_log')
      .select(AUDIT_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as AuditRow[];
  },
};
