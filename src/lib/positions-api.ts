import { supabase } from '@/integrations/supabase/client';
import type { ChangeResult, GrantResult, PositionHolder, PositionKey, PositionsApi, RevokeResult } from '@/lib/positions';

/* The four admin_* functions behind the Positions section (migration
   20261013100000_admin_manage_positions). Not in the generated types, hence the
   `as never` casts, the same pattern checker-admin-api.ts uses. */

export const realPositionsApi: PositionsApi = {
  async list() {
    const { data, error } = await supabase.rpc('admin_position_holders' as never);
    if (error) throw error;
    return ((data ?? []) as unknown) as PositionHolder[];
  },
  async grant(email: string, role: PositionKey) {
    const { data, error } = await supabase.rpc('admin_grant_position' as never, { p_email: email.trim(), p_role: role } as never);
    if (error) throw error;
    return data as unknown as GrantResult;
  },
  async revoke(email: string, role: PositionKey) {
    const { data, error } = await supabase.rpc('admin_revoke_position' as never, { p_email: email, p_role: role } as never);
    if (error) throw error;
    return data as unknown as RevokeResult;
  },
  async change(email: string, from: PositionKey, to: PositionKey) {
    const { data, error } = await supabase.rpc('admin_change_position' as never, { p_email: email, p_from: from, p_to: to } as never);
    if (error) throw error;
    return data as unknown as ChangeResult;
  },
};
