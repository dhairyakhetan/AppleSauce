import { supabase } from '@/integrations/supabase/client';

/* The data side of /admin/reviews: parents' comments about teachers,
   teachers that parents recommended, and upvote totals.

   The page takes a `ReviewsAdminApi`, so dummy mode can hand it an in-memory
   fake and the tests can hand it one that fails. The real implementation below
   runs the same queries and writes the same columns the page used to run
   inline; only the explicit column lists are new.

   Pure helpers (what a row looks like after a write, a contact link, the
   upvote sentence) live here too, so they can be tested without rendering. */

export type CommentFilter = 'pending' | 'approved' | 'all';
export type SortOrder = 'newest' | 'oldest';
export type RecommendationStatus = 'pending' | 'contacted' | 'onboarded' | 'rejected';

export const REVIEWS_PAGE_SIZE = 50;

export interface ReviewComment {
  id: string;
  teacher_id: string;
  user_id: string;
  comment: string;
  is_anonymous: boolean;
  approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  profiles: {
    full_name: string | null;
    role: string | null;
    school_college: string | null;
    grade: string | null;
  } | null;
  approver_name: string | null;
  teachers_list: { name: string; slug: string } | null;
}

export interface Recommendation {
  id: string;
  user_id: string | null;
  recommender_name: string;
  recommender_contact: string;
  teacher_name: string;
  teacher_contact: string;
  status: RecommendationStatus;
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpvoteStat {
  teacher_id: string;
  teacher_name: string;
  teacher_slug: string;
  upvote_count: number;
}

/** Head-counts of what is waiting. A field that could not be read is undefined, never 0. */
export interface ReviewCounts {
  pendingReviews?: number;
  approvedReviews?: number;
  pendingRecommendations?: number;
}

export interface CommentsPage {
  rows: ReviewComment[];
  hasMore: boolean;
}

export interface ReviewsAdminApi {
  /** `offset`, when given, is where to start reading (the number of rows already held
   *  for this filter), and wins over `page`. Paging by held rows keeps "Load more"
   *  correct on the Waiting filter, where publishing a review removes it from the list. */
  comments(opts: { filter: CommentFilter; sort: SortOrder; page: number; offset?: number }): Promise<CommentsPage>;
  recommendations(sort: SortOrder): Promise<Recommendation[]>;
  upvoteStats(): Promise<UpvoteStat[]>;
  /** Independent of the loaded page and of the filter. */
  counts(): Promise<ReviewCounts>;
  /** Display names for admin user ids ("reviewed by"). Never throws. */
  reviewerNames(ids: string[]): Promise<Record<string, string>>;
  publishComment(id: string): Promise<void>;
  removeComment(id: string): Promise<void>;
  saveRecommendation(id: string, fields: { status: string; notes?: string }, approverId: string): Promise<void>;
  /** Inserts a teacher application, then marks the recommendation onboarded.
   *  `marked` is false when the application was created but the status update failed. */
  convertRecommendation(rec: Recommendation, approverId: string): Promise<{ marked: boolean }>;
  clearUpvotes(teacherId: string): Promise<void>;
}

const VALID_STATUSES: RecommendationStatus[] = ['pending', 'contacted', 'onboarded', 'rejected'];

const COMMENT_COLUMNS = 'id, teacher_id, user_id, comment, is_anonymous, approved, approved_by, approved_at, created_at, updated_at';
const RECOMMENDATION_COLUMNS =
  'id, user_id, recommender_name, recommender_contact, teacher_name, teacher_contact, status, notes, approved_by, approved_at, created_at, updated_at';
const UPVOTE_COLUMNS = 'teacher_id, teacher_name, teacher_slug, upvote_count';

function head(r: { count: number | null; error: unknown }): number | undefined {
  return r.error ? undefined : typeof r.count === 'number' ? r.count : undefined;
}

/** A recommendation right after an admin decided it: the status, and who decided and
 *  when, so its card stops reading "Sent ..." while the badge already says otherwise. */
export function stampDecision<T extends { status: RecommendationStatus; approved_by: string | null; approved_at: string | null }>(
  rec: T,
  status: RecommendationStatus,
  adminId: string | null,
  nowIso: string,
): T {
  return { ...rec, status, approved_by: adminId ?? rec.approved_by, approved_at: nowIso };
}

/** Where a read of reviews starts: the rows already held when known, else the page's start. */
export function commentsStart(page: number, offset?: number): number {
  return typeof offset === 'number' && offset >= 0 ? offset : page * REVIEWS_PAGE_SIZE;
}

export const realReviewsAdminApi: ReviewsAdminApi = {
  async comments({ filter, sort, page, offset }) {
    const from = commentsStart(page, offset);
    const to = from + REVIEWS_PAGE_SIZE - 1;
    let query = supabase
      .from('teacher_comments')
      .select(COMMENT_COLUMNS)
      .order('created_at', { ascending: sort === 'oldest' })
      .range(from, to);
    if (filter === 'pending') query = query.eq('approved', false);
    else if (filter === 'approved') query = query.eq('approved', true);

    const { data, error } = await query;
    if (error) throw error;
    const raw = data || [];
    const hasMore = raw.length === REVIEWS_PAGE_SIZE;
    if (raw.length === 0) return { rows: [], hasMore };

    const userIds = [...new Set(raw.flatMap((c) => (c.approved_by ? [c.user_id, c.approved_by] : [c.user_id])))];
    const teacherIds = [...new Set(raw.map((c) => c.teacher_id))];
    const [profilesRes, teachersRes] = await Promise.all([
      userIds.length > 0 ? supabase.from('profiles').select('id, full_name, role, school_college, grade').in('id', userIds) : Promise.resolve({ data: [] }),
      teacherIds.length > 0 ? supabase.from('teachers_list').select('id, name, slug').in('id', teacherIds) : Promise.resolve({ data: [] }),
    ]);
    const profilesMap = new Map<string, unknown>((profilesRes.data || []).map((p: { id: string }) => [p.id, p]));
    const teachersMap = new Map<string, unknown>((teachersRes.data || []).map((t: { id: string }) => [t.id, t]));

    const rows = raw.map((comment) => {
      const approver = comment.approved_by ? (profilesMap.get(comment.approved_by) as { full_name?: string | null } | undefined) : null;
      return {
        ...comment,
        profiles: profilesMap.get(comment.user_id) || null,
        approver_name: approver?.full_name || (comment.approved_by ? 'an admin' : null),
        teachers_list: teachersMap.get(comment.teacher_id) || null,
      };
    }) as unknown as ReviewComment[];
    return { rows, hasMore };
  },

  async recommendations(sort) {
    const { data, error } = await supabase
      .from('teacher_recommendations')
      .select(RECOMMENDATION_COLUMNS)
      .order('created_at', { ascending: sort === 'oldest' });
    if (error) throw error;
    return (data || []).map((row) => ({
      ...row,
      status: (VALID_STATUSES as string[]).includes(row.status ?? '') ? (row.status as RecommendationStatus) : 'pending',
    }));
  },

  async upvoteStats() {
    const { data, error } = await supabase.from('teacher_upvote_stats').select(UPVOTE_COLUMNS).order('upvote_count', { ascending: false });
    if (!error) return (data || []) as UpvoteStat[];
    if (!(error.code === 'PGRST116' || error.message?.includes('does not exist'))) throw error;

    // The view is missing: count the raw upvotes instead.
    const { data: upvotesData, error: upvotesError } = await supabase.from('teacher_upvotes').select('teacher_id');
    if (upvotesError) throw upvotesError;
    const counts = new Map<string, number>();
    (upvotesData || []).forEach((u: { teacher_id: string }) => counts.set(u.teacher_id, (counts.get(u.teacher_id) || 0) + 1));
    const teacherIds = Array.from(counts.keys());
    if (teacherIds.length === 0) return [];
    const { data: teachersData, error: teachersError } = await supabase.from('teachers_list').select('id, name, slug').in('id', teacherIds);
    if (teachersError) throw teachersError;
    const stats: UpvoteStat[] = (teachersData || []).map((t: { id: string; name: string; slug: string }) => ({
      teacher_id: t.id,
      teacher_name: t.name,
      teacher_slug: t.slug,
      upvote_count: counts.get(t.id) || 0,
    }));
    return stats.sort((a, b) => b.upvote_count - a.upvote_count);
  },

  async counts() {
    const [pending, approved, recs] = await Promise.all([
      supabase.from('teacher_comments').select('id', { count: 'exact', head: true }).eq('approved', false),
      supabase.from('teacher_comments').select('id', { count: 'exact', head: true }).eq('approved', true),
      supabase.from('teacher_recommendations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);
    return { pendingReviews: head(pending), approvedReviews: head(approved), pendingRecommendations: head(recs) };
  },

  async reviewerNames(ids) {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return {};
    try {
      const { data, error } = await supabase.from('profiles').select('id, full_name, email').in('id', unique);
      if (error || !data) return {};
      const map: Record<string, string> = {};
      data.forEach((row) => {
        map[row.id] = row.full_name || row.email || 'an admin';
      });
      return map;
    } catch {
      return {};
    }
  },

  async publishComment(id) {
    const { error } = await supabase.from('teacher_comments').update({ approved: true }).eq('id', id);
    if (error) throw error;
  },

  async removeComment(id) {
    const { error } = await supabase.from('teacher_comments').delete().eq('id', id);
    if (error) throw error;
  },

  async saveRecommendation(id, fields, approverId) {
    const { error } = await supabase
      .from('teacher_recommendations')
      .update({ ...fields, approved_by: approverId, approved_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async convertRecommendation(rec, approverId) {
    const { error: insertError } = await supabase.from('teacher_applications').insert({
      name: rec.teacher_name,
      phone_number: rec.teacher_contact,
      email: '',
      sir_maam: '',
      subjects: '',
      classes_taught_for_backend: '',
      status: 'pending',
      reference_name: rec.recommender_name,
      reference_number: rec.recommender_contact,
      description: rec.notes || `Recommended by ${rec.recommender_name} (${rec.recommender_contact})`,
    });
    if (insertError) throw insertError;

    const { error: updateError } = await supabase
      .from('teacher_recommendations')
      .update({ status: 'onboarded', approved_by: approverId, approved_at: new Date().toISOString() })
      .eq('id', rec.id);
    return { marked: !updateError };
  },

  async clearUpvotes(teacherId) {
    const { error } = await supabase.from('teacher_upvotes').delete().eq('teacher_id', teacherId);
    if (error) throw error;
  },
};

// ------------------------------------------------------------------ pure helpers

/** The loaded list after a successful publish: the row leaves the Waiting view, or flips to published elsewhere. */
export function afterPublish(rows: ReviewComment[], id: string, filter: CommentFilter, now: string): ReviewComment[] {
  if (filter === 'pending') return rows.filter((c) => c.id !== id);
  return rows.map((c) => (c.id === id ? { ...c, approved: true, approved_at: now } : c));
}

/** The loaded list after a successful remove. */
export function afterRemove(rows: ReviewComment[], id: string): ReviewComment[] {
  return rows.filter((c) => c.id !== id);
}

/** Counts after a publish: one moves from waiting to published. Unknown stays unknown. */
export function countsAfterPublish(c: ReviewCounts): ReviewCounts {
  return {
    ...c,
    pendingReviews: c.pendingReviews === undefined ? undefined : Math.max(0, c.pendingReviews - 1),
    approvedReviews: c.approvedReviews === undefined ? undefined : c.approvedReviews + 1,
  };
}

/** "37 upvotes across 12 teachers". */
export function upvoteSummary(stats: UpvoteStat[]): string {
  const total = stats.reduce((n, s) => n + s.upvote_count, 0);
  return `${total} ${total === 1 ? 'upvote' : 'upvotes'} across ${stats.length} ${stats.length === 1 ? 'teacher' : 'teachers'}`;
}

/** Only a recommendation that is still open can become an application. */
export function canConvert(status: RecommendationStatus): boolean {
  return status === 'pending' || status === 'contacted';
}

/** A tap target for a contact: a phone number or an email, or null when it is neither. */
export function contactHref(contact: string): string | null {
  const c = contact.trim();
  if (!c) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return `mailto:${c}`;
  const digits = c.replace(/[\s()-]/g, '');
  if (/^\+?\d{8,15}$/.test(digits)) return `tel:${digits}`;
  return null;
}

export function recommendationLabel(status: RecommendationStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export type ConvertOutcome = 'cancelled' | 'failed' | 'marked' | 'unmarked';

/** Asks first, then creates the application. `unmarked` means the application exists but the recommendation
 *  could not be marked onboarded, so the admin must mark it by hand. */
export async function convertConfirmed(
  ask: () => Promise<boolean>,
  api: Pick<ReviewsAdminApi, 'convertRecommendation'>,
  rec: Recommendation,
  approverId: string,
): Promise<ConvertOutcome> {
  if (!(await ask())) return 'cancelled';
  try {
    const { marked } = await api.convertRecommendation(rec, approverId);
    return marked ? 'marked' : 'unmarked';
  } catch {
    return 'failed';
  }
}
