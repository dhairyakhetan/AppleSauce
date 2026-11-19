import { supabase } from '@/integrations/supabase/client';

/* The data side of /admin/feedback (the `feedback` table). RLS does the
   gating ("Admins can view all feedback" / "Admins can delete feedback"), so
   the page reads and deletes the table directly, the same as the audit page.

   The page takes a `FeedbackApi` so dummy mode and tests can hand it a fake. */

export interface FeedbackRow {
  id: string;
  user_id: string | null;
  rating: number | null;
  comment: string | null;
  is_guest: boolean;
  guest_email: string | null;
  created_at: string;
}

/** How many entries one read returns. The first read is the latest this many. */
export const FEEDBACK_PAGE = 500;

export interface FeedbackApi {
  /** Newest first. `offset` 0 is the latest page; pass the number already held for the next one. */
  list(opts: { offset: number; limit: number }): Promise<FeedbackRow[]>;
  /** The true total, or undefined when it could not be read. Never 0 for a failure. */
  total(): Promise<number | undefined>;
  remove(id: string): Promise<void>;
}

const FEEDBACK_COLUMNS = 'id, user_id, rating, comment, is_guest, guest_email, created_at';

export const realFeedbackApi: FeedbackApi = {
  async list({ offset, limit }) {
    const { data, error } = await supabase
      .from('feedback')
      .select(FEEDBACK_COLUMNS)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return (data || []) as FeedbackRow[];
  },
  async total() {
    try {
      const { count, error } = await supabase.from('feedback').select('id', { count: 'exact', head: true });
      return error || typeof count !== 'number' ? undefined : count;
    } catch {
      return undefined;
    }
  },
  async remove(id) {
    const { error } = await supabase.from('feedback').delete().eq('id', id);
    if (error) throw error;
  },
};

/** "Showing the latest 500 of 1,203", or "1,203 entries" when everything is held. Empty when unknown and complete. */
export function feedbackShownText(held: number, total: number | undefined, moreMayExist: boolean): string {
  if (total === undefined) return moreMayExist ? `Showing the latest ${held.toLocaleString('en-IN')}. There may be older entries.` : `${held.toLocaleString('en-IN')} ${held === 1 ? 'entry' : 'entries'}`;
  if (held >= total) return `${total.toLocaleString('en-IN')} ${total === 1 ? 'entry' : 'entries'}`;
  return `Showing the latest ${held.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`;
}

/** Whether a Load older button should be offered. */
export function hasOlder(held: number, total: number | undefined, lastPageSize: number, pageSize: number = FEEDBACK_PAGE): boolean {
  if (total !== undefined) return held < total;
  return lastPageSize >= pageSize;
}

export type FeedbackDeleteOutcome = 'cancelled' | 'deleted' | 'failed';

/** Asks first. Nothing is deleted unless the admin says yes. */
export async function deleteFeedbackConfirmed(
  ask: () => Promise<boolean>,
  api: Pick<FeedbackApi, 'remove'>,
  id: string,
): Promise<FeedbackDeleteOutcome> {
  if (!(await ask())) return 'cancelled';
  try {
    await api.remove(id);
    return 'deleted';
  } catch {
    return 'failed';
  }
}
