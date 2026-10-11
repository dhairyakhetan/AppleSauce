import { supabase } from '@/integrations/supabase/client';
import { normaliseCheckerRow, normaliseDayLog, type CheckerLogApi } from '@/lib/checker-log';

/* The checker log's two admin-only RPCs (being added by the backend agent):
     admin_checker_list()                          -> rows {actor_key, name, role, first_at, last_at, total_actions}
     admin_checker_day_log(p_actor_key, p_from, p_to) -> {actor: {name, role}, days: [{day, counts, events}]}
   Names spelled once here; shapes absorbed by checker-log.ts. */

export const CHECKER_LOG_RPC = {
  list: 'admin_checker_list',
  dayLog: 'admin_checker_day_log',
} as const;

export const realCheckerLogApi: CheckerLogApi = {
  async list() {
    const { data, error } = await supabase.rpc(CHECKER_LOG_RPC.list as never);
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(normaliseCheckerRow).filter((r) => r.actor_key);
  },
  async dayLog(actorKey, from, to) {
    const { data, error } = await supabase.rpc(
      CHECKER_LOG_RPC.dayLog as never,
      { p_actor_key: actorKey, p_from: from, p_to: to } as never,
    );
    if (error) throw error;
    return normaliseDayLog(data, actorKey);
  },
};
