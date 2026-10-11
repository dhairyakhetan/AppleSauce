import { supabase } from '@/integrations/supabase/client';
import type { FeedRow, PipelineApi, PipelineStats } from '@/lib/pipeline-stats';

/* The real /admin/pipeline API: two admin-only RPCs. A refused or failed read
   is thrown, never turned into an empty list. Its own file so
   pipeline-stats.ts stays free of the Supabase client (and testable). */

export const realPipelineApi: PipelineApi = {
  async stats() {
    const { data, error } = await supabase.rpc('admin_pipeline_stats' as never);
    if (error) throw error;
    return data as unknown as PipelineStats;
  },
  async feed(limit) {
    const { data, error } = await supabase.rpc('admin_activity_feed' as never, { p_limit: limit, p_scope: 'all' } as never);
    if (error) throw error;
    return (data as unknown as FeedRow[]) ?? [];
  },
};
