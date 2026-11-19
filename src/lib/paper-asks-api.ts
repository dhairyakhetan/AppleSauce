import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/lib/checker-timeout';
import { normaliseAskedAt, normaliseAskOutcome, normalisePaperAsks, type AskOutcome, type PaperAsk } from '@/lib/paper-asks';

/**
 * Client wrapper for "Ask HOD for more papers". Every call is one of the functions in
 * 20261113200000_ask_for_papers.sql, each of which checks who is calling inside. They are not in the generated types, hence
 * the `as never` casts, the same as hod-api.ts and fix-requests-api.ts. The table itself is never read or written from the
 * website.
 */

export interface PaperAsksApi {
  /** paper_ask_for_more(): a checker with no paper says "I am free". */
  ask(): Promise<AskOutcome>;
  /** paper_ask_mine(): when their open ask was made, or null when they have none. */
  mine(): Promise<string | null>;
  /** hod_paper_asks(): HOD and admin. Who is waiting for papers, oldest first. */
  list(): Promise<PaperAsk[]>;
  /** hod_paper_ask_dismiss(): HOD and admin. Clear one. */
  dismiss(id: string): Promise<void>;
}

async function call(fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await withTimeout(supabase.rpc(fn as never, (args ?? {}) as never), 30_000);
  if (error) throw error;
  return data;
}

export const realPaperAsksApi: PaperAsksApi = {
  async ask() {
    const out = normaliseAskOutcome(await call('paper_ask_for_more'));
    if (!out) throw new Error('Unexpected answer from the server.');
    return out;
  },
  async mine() {
    return normaliseAskedAt(await call('paper_ask_mine'));
  },
  async list() {
    return normalisePaperAsks(await call('hod_paper_asks'));
  },
  async dismiss(id) {
    await call('hod_paper_ask_dismiss', { p_id: id });
  },
};
