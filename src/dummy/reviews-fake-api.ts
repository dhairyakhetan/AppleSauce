import {
  REVIEWS_PAGE_SIZE,
  commentsStart,
  type CommentFilter,
  type Recommendation,
  type ReviewComment,
  type ReviewsAdminApi,
  type SortOrder,
  type UpvoteStat,
} from '@/lib/reviews-admin-api';

/**
 * In-memory fake of the reviews, recommendations and upvotes data for
 * /admin/reviews?dummy=1 (D75). Every person, teacher and comment is made up;
 * nothing is copied from the real site and nothing touches Supabase.
 *
 * 12 reviews wait and 43 are published (55 in all, so "Load more" shows under
 * the All filter). Pass `failing: ['recommendations']` to make one source fail,
 * which is how the page's per-source error state is previewed.
 */

const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

const TEACHERS = [
  { id: 't-1', name: 'Sample Teacher One', slug: 'sample-teacher-one' },
  { id: 't-2', name: 'Sample Teacher Two', slug: 'sample-teacher-two' },
  { id: 't-3', name: 'Sample Teacher Three', slug: 'sample-teacher-three' },
  { id: 't-4', name: 'Sample Teacher Four', slug: 'sample-teacher-four' },
];

const TEXT = [
  'Explains every step slowly and gives good practice sheets.',
  'My daughter went from a pass mark to an A in two terms.',
  'Always on time and patient with questions.',
  'Good teacher, but the batch was too big for me.',
  'Clear, kind and strict about homework. Highly recommend.',
  'Fees are fair for the quality of teaching.',
];

function comment(i: number, approved: boolean): ReviewComment {
  const t = TEACHERS[i % TEACHERS.length];
  const anon = i % 4 === 0;
  return {
    id: `dummy-comment-${i}`,
    teacher_id: t.id,
    user_id: `dummy-user-${i}`,
    comment: TEXT[i % TEXT.length],
    is_anonymous: anon,
    approved,
    approved_by: approved ? 'dummy-admin' : null,
    approved_at: approved ? ago(i * 7) : null,
    created_at: ago(i * 7 + 2),
    updated_at: ago(i * 7 + 2),
    profiles: { full_name: ['Meera Das', 'Rahul Sen', 'Anita Paul', 'Dev Roy'][i % 4], role: i % 2 ? 'guardian' : 'student', school_college: 'Sample Hill School', grade: '10' },
    approver_name: approved ? 'Kanishk' : null,
    teachers_list: { name: t.name, slug: t.slug },
  };
}

function seedRecs(): Recommendation[] {
  const base = {
    user_id: null,
    approved_by: null,
    approved_at: null,
    updated_at: ago(30),
  };
  return [
    { ...base, id: 'dummy-rec-1', recommender_name: 'Sunita Ghosh', recommender_contact: '9000000001', teacher_name: 'Mr. Arun Kar', teacher_contact: '9000000101', status: 'pending', notes: 'Teaches physics very well, near Salt Lake.', created_at: ago(5) },
    { ...base, id: 'dummy-rec-2', recommender_name: 'Biplab Roy', recommender_contact: 'biplab.roy@example.com', teacher_name: 'Ms. Ishita Nag', teacher_contact: '9000000102', status: 'pending', notes: null, created_at: ago(26) },
    { ...base, id: 'dummy-rec-3', recommender_name: 'Priya Mehta', recommender_contact: '9000000003', teacher_name: 'Mr. Dipak Saha', teacher_contact: '', status: 'pending', notes: 'Chemistry, classes 11 and 12.', created_at: ago(70) },
    { ...base, id: 'dummy-rec-4', recommender_name: 'Tapan Dey', recommender_contact: '9000000004', teacher_name: 'Ms. Rupa Basu', teacher_contact: '9000000104', status: 'contacted', notes: 'Spoke on the phone. Will send her details.', approved_by: 'dummy-admin', approved_at: ago(20), created_at: ago(120) },
    { ...base, id: 'dummy-rec-5', recommender_name: 'Kabir Khan', recommender_contact: '9000000005', teacher_name: 'Mr. Soumen Pal', teacher_contact: '9000000105', status: 'onboarded', notes: null, approved_by: 'dummy-admin', approved_at: ago(200), created_at: ago(300) },
    { ...base, id: 'dummy-rec-6', recommender_name: 'Lata Iyer', recommender_contact: '9000000006', teacher_name: 'Ms. Neha Jain', teacher_contact: '9000000106', status: 'rejected', notes: 'Not teaching any more.', approved_by: 'dummy-admin', approved_at: ago(400), created_at: ago(500) },
  ];
}

const UPVOTES: UpvoteStat[] = [
  ['Sample Teacher One', 9],
  ['Sample Teacher Two', 6],
  ['Sample Teacher Three', 5],
  ['Sample Teacher Four', 4],
  ['Sample Teacher Five', 3],
  ['Sample Teacher Six', 3],
  ['Sample Teacher Seven', 2],
  ['Sample Teacher Eight', 2],
  ['Sample Teacher Nine', 1],
  ['Sample Teacher Ten', 1],
  ['Sample Teacher Eleven', 1],
  ['Sample Teacher Twelve', 0],
].map(([name, n], i) => ({ teacher_id: `up-${i}`, teacher_name: name as string, teacher_slug: `sample-teacher-${i + 1}`, upvote_count: n as number }));

const wait = () => new Promise((r) => setTimeout(r, 150));

export type ReviewsFakeSource = 'reviews' | 'recommendations' | 'upvotes';

export function createFakeReviewsAdminApi(opts: { failing?: ReviewsFakeSource[] } = {}): ReviewsAdminApi {
  const failing = new Set(opts.failing ?? []);
  // 12 waiting then 43 published, newest first by index.
  let comments: ReviewComment[] = [
    ...Array.from({ length: 12 }, (_, i) => comment(i, false)),
    ...Array.from({ length: 43 }, (_, i) => comment(i + 12, true)),
  ];
  let recs = seedRecs();
  let upvotes = UPVOTES.map((u) => ({ ...u }));

  const sorted = <T extends { created_at: string }>(rows: T[], sort: SortOrder) =>
    [...rows].sort((a, b) => (sort === 'newest' ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at)));

  return {
    async comments({ filter, sort, page, offset }: { filter: CommentFilter; sort: SortOrder; page: number; offset?: number }) {
      await wait();
      if (failing.has('reviews')) throw new Error('Made-up failure');
      const pool = comments.filter((c) => (filter === 'pending' ? !c.approved : filter === 'approved' ? c.approved : true));
      const ordered = sorted(pool, sort);
      const from = commentsStart(page, offset);
      const rows = ordered.slice(from, from + REVIEWS_PAGE_SIZE);
      return { rows: rows.map((r) => ({ ...r })), hasMore: rows.length === REVIEWS_PAGE_SIZE };
    },
    async recommendations(sort) {
      await wait();
      if (failing.has('recommendations')) throw new Error('Made-up failure');
      return sorted(recs, sort).map((r) => ({ ...r }));
    },
    async upvoteStats() {
      await wait();
      if (failing.has('upvotes')) throw new Error('Made-up failure');
      return upvotes.map((u) => ({ ...u }));
    },
    async counts() {
      return {
        pendingReviews: comments.filter((c) => !c.approved).length,
        approvedReviews: comments.filter((c) => c.approved).length,
        pendingRecommendations: recs.filter((r) => r.status === 'pending').length,
      };
    },
    async reviewerNames(ids) {
      return Object.fromEntries(ids.map((id) => [id, 'Kanishk']));
    },
    async publishComment(id) {
      comments = comments.map((c) => (c.id === id ? { ...c, approved: true, approved_at: new Date().toISOString(), approved_by: 'dummy-admin', approver_name: 'Kanishk' } : c));
    },
    async removeComment(id) {
      comments = comments.filter((c) => c.id !== id);
    },
    async saveRecommendation(id, fields, approverId) {
      recs = recs.map((r) =>
        r.id === id
          ? { ...r, status: fields.status as Recommendation['status'], notes: fields.notes ?? r.notes, approved_by: approverId, approved_at: new Date().toISOString() }
          : r,
      );
    },
    async convertRecommendation(rec, approverId) {
      recs = recs.map((r) => (r.id === rec.id ? { ...r, status: 'onboarded', approved_by: approverId, approved_at: new Date().toISOString() } : r));
      return { marked: true };
    },
    async clearUpvotes(teacherId) {
      upvotes = upvotes.filter((u) => u.teacher_id !== teacherId);
    },
  };
}
