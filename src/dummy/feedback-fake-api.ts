import type { FeedbackApi, FeedbackRow } from '@/lib/feedback-admin-api';

/**
 * In-memory fake of the feedback table for /admin/feedback?dummy=1 (D75).
 * Every entry is made up. 620 of them, so "Showing the latest 500 of 620" and
 * Load older both have something to do. Nothing touches Supabase.
 */
const COMMENTS = [
  'Found a good maths teacher in two days. Very easy.',
  'The old papers are helpful. More science please.',
  'Search is slow on my phone.',
  'Loved the layout. Could the fees be shown up front?',
  'Could not find a teacher for my area.',
  null,
  'Great site, told my neighbours.',
  'The teacher never called back.',
];

function make(count: number): FeedbackRow[] {
  return Array.from({ length: count }, (_, i) => {
    const guest = i % 3 === 0;
    return {
      id: `dummy-feedback-${i}`,
      user_id: guest ? null : `dummy-user-${i}`,
      rating: i % 7 === 0 ? null : 1 + (i % 5),
      comment: COMMENTS[i % COMMENTS.length],
      is_guest: guest,
      guest_email: guest ? `visitor${i}@example.com` : null,
      created_at: new Date(Date.now() - i * 5 * 3600_000).toISOString(),
    };
  });
}

export function createFakeFeedbackApi(): FeedbackApi {
  let rows = make(620);
  return {
    async list({ offset, limit }) {
      await new Promise((r) => setTimeout(r, 150));
      return rows.slice(offset, offset + limit).map((r) => ({ ...r }));
    },
    async total() {
      return rows.length;
    },
    async remove(id) {
      rows = rows.filter((r) => r.id !== id);
    },
  };
}
