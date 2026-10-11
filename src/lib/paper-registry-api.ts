import { supabase } from '@/integrations/supabase/client';
import type { PaperRegistryApi, RegistryPage, RegistrySummary } from '@/lib/paper-registry';

/* The real paper-registry API: two admin-only RPCs (see paper-registry.ts).
   Its own file so paper-registry.ts stays free of the Supabase client and
   testable. A refusal comes back as a 42501 error and is thrown, so the panel
   shows its retry rather than an empty list. */

export const realPaperRegistryApi: PaperRegistryApi = {
  async summary() {
    const { data, error } = await supabase.rpc('admin_paper_registry_summary' as never);
    if (error) throw error;
    return data as unknown as RegistrySummary;
  },
  async list(q) {
    const { data, error } = await supabase.rpc('admin_paper_registry' as never, {
      p_state: q.state,
      p_search: q.search.trim() || null,
      p_subject: q.subject,
      p_limit: q.limit,
      p_offset: q.offset,
    } as never);
    if (error) throw error;
    return data as unknown as RegistryPage;
  },
};
