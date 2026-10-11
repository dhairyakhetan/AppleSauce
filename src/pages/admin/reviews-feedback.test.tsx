import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { ReactElement } from 'react';

/* Reviews and Visitor feedback: each source fails on its own and says so, the
   counts are their own reads, a write changes the list in place, and the
   destructive and slow actions ask first. Nothing here renders a whole page;
   it renders the parts that decide what the admin sees, and runs the api
   against a recording stand-in for Supabase. */

type Call = { table: string; op: string; args: unknown[] };
const calls: Call[] = [];
let result: { data?: unknown; error?: unknown; count?: number | null } = { data: [], error: null };

function chain(table: string): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  const rec = (op: string) => (...args: unknown[]) => {
    calls.push({ table, op, args });
    return q;
  };
  for (const op of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'range']) q[op] = rec(op);
  q.then = (resolve: (v: unknown) => void) => resolve(result);
  return q;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (t: string) => chain(t), rpc: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));
vi.mock('@/lib/admin-debug', () => ({
  useAdminDebugToggle: () => ({ on: false, canToggle: false, toggle: () => {} }),
  useAdminDebugOn: () => false,
}));

import { SourcePanel, type QueueCardData } from '@/pages/admin/reviews';
import { FeedbackBody } from '@/pages/admin/feedback';
import {
  REVIEWS_PAGE_SIZE,
  afterPublish,
  afterRemove,
  canConvert,
  commentsStart,
  contactHref,
  convertConfirmed,
  countsAfterPublish,
  realReviewsAdminApi,
  stampDecision,
  upvoteSummary,
  type Recommendation,
  type ReviewComment,
} from '@/lib/reviews-admin-api';
import { FEEDBACK_PAGE, deleteFeedbackConfirmed, feedbackShownText, hasOlder, realFeedbackApi, type FeedbackRow } from '@/lib/feedback-admin-api';

const html = (el: ReactElement) => renderToStaticMarkup(<StaticRouter location="/">{el}</StaticRouter>);
const text = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const noop = () => {};

beforeEach(() => {
  calls.length = 0;
  result = { data: [], error: null, count: 0 };
});

const card = (id: string): QueueCardData => ({ id, quote: `quote ${id}`, attribution: 'someone', badge: null, actions: [{ label: 'Publish', tone: 'mint', onClick: noop }] });

describe('each source says what it is', () => {
  it('shows an error with Try again, never the empty copy, when a source failed', () => {
    const out = html(<SourcePanel what="the recommendations" settled error cards={[]} emptyTitle="No recommendations yet" onRetry={noop} />);
    expect(text(out)).toContain('The recommendations did not load.');
    expect(out).toContain('Try again');
    expect(out).not.toContain('No recommendations yet');
  });

  it('shows the empty copy only after a read that worked', () => {
    const out = html(<SourcePanel what="the reviews" settled error={false} cards={[]} emptyTitle="No reviews waiting" onRetry={noop} />);
    expect(text(out)).toContain('No reviews waiting');
    expect(out).not.toContain('did not load');
  });

  it('shows a skeleton before the first read settles', () => {
    const out = html(<SourcePanel what="the reviews" settled={false} error={false} cards={[]} emptyTitle="No reviews waiting" onRetry={noop} />);
    expect(out).toContain('Loading the reviews');
    expect(out).not.toContain('No reviews waiting');
  });

  it('keeps the cards when only a refresh failed', () => {
    const out = html(<SourcePanel what="the reviews" settled error cards={[card('a')]} emptyTitle="x" onRetry={noop} />);
    expect(out).toContain('quote a');
    expect(text(out)).toContain('did not load');
  });

  it('puts the action row under the text on a phone: the card stacks, the actions can wrap', () => {
    const out = html(<SourcePanel what="the reviews" settled error={false} cards={[card('a')]} emptyTitle="x" onRetry={noop} />);
    expect(out).toContain('flex-col');
    expect(out).toContain('flex-wrap');
  });
});

describe('writes change the list in place', () => {
  const c = (id: string, approved: boolean): ReviewComment => ({
    id,
    teacher_id: 't',
    user_id: 'u',
    comment: 'x',
    is_anonymous: false,
    approved,
    approved_by: null,
    approved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    profiles: null,
    approver_name: null,
    teachers_list: null,
  });

  it('drops a published review from the Waiting view and flips it elsewhere', () => {
    const rows = [c('a', false), c('b', false)];
    expect(afterPublish(rows, 'a', 'pending', 'now').map((r) => r.id)).toEqual(['b']);
    const all = afterPublish(rows, 'a', 'all', 'now');
    expect(all).toHaveLength(2);
    expect(all[0].approved).toBe(true);
    expect(all[0].approved_at).toBe('now');
    expect(all[1].approved).toBe(false);
  });

  it('removes a review by id', () => {
    expect(afterRemove([c('a', true), c('b', true)], 'a').map((r) => r.id)).toEqual(['b']);
  });

  it('moves one from waiting to published in the counts, and leaves an unknown count unknown', () => {
    expect(countsAfterPublish({ pendingReviews: 5, approvedReviews: 10, pendingRecommendations: 2 })).toEqual({ pendingReviews: 4, approvedReviews: 11, pendingRecommendations: 2 });
    const unknown = countsAfterPublish({ pendingReviews: undefined, approvedReviews: 3 });
    expect(unknown.pendingReviews).toBeUndefined();
    expect(unknown.approvedReviews).toBe(4);
    expect(countsAfterPublish({ pendingReviews: 0, approvedReviews: 0 }).pendingReviews).toBe(0);
  });
});

describe('recommendations', () => {
  it('offers Convert only while a recommendation is still open', () => {
    expect(canConvert('pending')).toBe(true);
    expect(canConvert('contacted')).toBe(true);
    expect(canConvert('onboarded')).toBe(false);
    expect(canConvert('rejected')).toBe(false);
  });

  it('links a phone number, an email, or nothing', () => {
    expect(contactHref('90000 00001')).toBe('tel:9000000001');
    expect(contactHref('+91 98300 12345')).toBe('tel:+919830012345');
    expect(contactHref('a@b.com')).toBe('mailto:a@b.com');
    expect(contactHref('ask at the shop')).toBeNull();
    expect(contactHref('  ')).toBeNull();
  });

  const rec: Recommendation = {
    id: 'r1',
    user_id: null,
    recommender_name: 'Sunita',
    recommender_contact: '9000000001',
    teacher_name: 'Mr. Kar',
    teacher_contact: '9000000101',
    status: 'pending',
    notes: null,
    approved_by: null,
    approved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('asks before it creates the application, and creates nothing if the answer is no', async () => {
    const convertRecommendation = vi.fn(async () => ({ marked: true }));
    expect(await convertConfirmed(async () => false, { convertRecommendation }, rec, 'admin')).toBe('cancelled');
    expect(convertRecommendation).not.toHaveBeenCalled();
    expect(await convertConfirmed(async () => true, { convertRecommendation }, rec, 'admin')).toBe('marked');
    expect(convertRecommendation).toHaveBeenCalledWith(rec, 'admin');
  });

  it('tells apart a failed insert from an application that exists but was not marked onboarded', async () => {
    const ask = async () => true;
    expect(await convertConfirmed(ask, { convertRecommendation: async () => ({ marked: false }) }, rec, 'a')).toBe('unmarked');
    expect(
      await convertConfirmed(ask, { convertRecommendation: async () => { throw new Error('insert failed'); } }, rec, 'a'),
    ).toBe('failed');
  });

  it('inserts the same application, then marks the recommendation onboarded; a failed mark is reported, not hidden', async () => {
    result = { data: null, error: null };
    const ok = await realReviewsAdminApi.convertRecommendation(rec, 'admin-1');
    expect(ok.marked).toBe(true);
    const insert = calls.find((x) => x.table === 'teacher_applications' && x.op === 'insert');
    expect(insert?.args[0]).toMatchObject({
      name: 'Mr. Kar',
      phone_number: '9000000101',
      status: 'pending',
      reference_name: 'Sunita',
      reference_number: '9000000001',
      description: 'Recommended by Sunita (9000000001)',
    });
    const update = calls.find((x) => x.table === 'teacher_recommendations' && x.op === 'update');
    expect(update?.args[0]).toMatchObject({ status: 'onboarded', approved_by: 'admin-1' });
  });

  it('writes status only for a quick action and status plus notes for an edit', async () => {
    await realReviewsAdminApi.saveRecommendation('r1', { status: 'contacted' }, 'admin-1');
    await realReviewsAdminApi.saveRecommendation('r1', { status: 'rejected', notes: 'n' }, 'admin-1');
    const updates = calls.filter((x) => x.op === 'update').map((x) => x.args[0] as Record<string, unknown>);
    expect(updates[0]).toMatchObject({ status: 'contacted', approved_by: 'admin-1' });
    expect('notes' in updates[0]).toBe(false);
    expect(updates[1]).toMatchObject({ status: 'rejected', notes: 'n', approved_by: 'admin-1' });
  });
});

describe('counts and reads', () => {
  it('counts waiting and published reviews and waiting recommendations as their own head-counts', async () => {
    result = { count: 7, error: null };
    const c = await realReviewsAdminApi.counts();
    expect(c).toEqual({ pendingReviews: 7, approvedReviews: 7, pendingRecommendations: 7 });
    const eqs = calls.filter((x) => x.op === 'eq').map((x) => `${x.table}.${x.args[0]}=${String(x.args[1])}`);
    expect(eqs).toEqual(expect.arrayContaining(['teacher_comments.approved=false', 'teacher_comments.approved=true', 'teacher_recommendations.status=pending']));
  });

  it('leaves a count it could not read undefined, never 0', async () => {
    result = { count: null, error: { message: 'boom' } };
    const c = await realReviewsAdminApi.counts();
    expect(c.pendingReviews).toBeUndefined();
    expect(c.pendingRecommendations).toBeUndefined();
  });

  it('names its columns: no select star on recommendations or upvote totals', async () => {
    await realReviewsAdminApi.recommendations('newest');
    await realReviewsAdminApi.upvoteStats();
    const selects = calls.filter((x) => x.op === 'select' && (x.table === 'teacher_recommendations' || x.table === 'teacher_upvote_stats'));
    expect(selects).toHaveLength(2);
    for (const s of selects) expect(s.args[0]).not.toBe('*');
    expect(String(selects[0].args[0])).toContain('teacher_contact');
    expect(String(selects[1].args[0])).toContain('upvote_count');
  });

  it('pages reviews fifty at a time', async () => {
    await realReviewsAdminApi.comments({ filter: 'all', sort: 'newest', page: 2 });
    const range = calls.find((x) => x.op === 'range');
    expect(range?.args).toEqual([2 * REVIEWS_PAGE_SIZE, 3 * REVIEWS_PAGE_SIZE - 1]);
  });

  it('"Load more" starts after the rows already held, not at a page multiple', async () => {
    expect(commentsStart(1, undefined)).toBe(REVIEWS_PAGE_SIZE);
    // 50 loaded, 3 published away, so 47 are held: the next read starts at 47, not 50.
    expect(commentsStart(1, 47)).toBe(47);
    expect(commentsStart(0, 0)).toBe(0);
    await realReviewsAdminApi.comments({ filter: 'pending', sort: 'newest', page: 1, offset: 47 });
    const range = calls.find((x) => x.op === 'range');
    expect(range?.args).toEqual([47, 47 + REVIEWS_PAGE_SIZE - 1]);
  });

  it('a decided recommendation shows who decided it and when', () => {
    const rec = { status: 'pending' as const, approved_by: null, approved_at: null, notes: 'n' };
    const out = stampDecision(rec, 'contacted', 'admin-1', '2026-10-11T10:00:00.000Z');
    expect(out).toMatchObject({ status: 'contacted', approved_by: 'admin-1', approved_at: '2026-10-11T10:00:00.000Z', notes: 'n' });
    expect(stampDecision({ ...rec, approved_by: 'old' }, 'rejected', null, '2026-10-11T10:00:00.000Z').approved_by).toBe('old');
  });

  it('every review row action goes through the one-at-a-time guard', () => {
    const src = readFileSync('src/pages/admin/reviews.tsx', 'utf8');
    for (const key of ['c:${comment.id}', 'r:${rec.id}', 'u:${stat.teacher_id}']) expect(src).toContain('runBusy(`' + key + '`');
    expect(src).toContain('disabled: busy(`c:${comment.id}`)');
  });

  it('words the upvote totals', () => {
    const stat = (n: number) => ({ teacher_id: String(n), teacher_name: 'T', teacher_slug: 't', upvote_count: n });
    expect(upvoteSummary([stat(30), stat(7)])).toBe('37 upvotes across 2 teachers');
    expect(upvoteSummary([stat(1)])).toBe('1 upvote across 1 teacher');
    expect(upvoteSummary([])).toBe('0 upvotes across 0 teachers');
  });
});

describe('visitor feedback', () => {
  const row = (i: number, over: Partial<FeedbackRow> = {}): FeedbackRow => ({
    id: `f${i}`,
    user_id: null,
    rating: 4,
    comment: `comment ${i}`,
    is_guest: true,
    guest_email: `g${i}@example.com`,
    created_at: new Date().toISOString(),
    ...over,
  });
  const body = (o: Partial<Parameters<typeof FeedbackBody>[0]>) =>
    html(<FeedbackBody rows={[]} settled error={false} searchQuery="" onRetry={noop} onClearSearch={noop} onDelete={noop} {...o} />);

  it('shows an error with Try again, not "No feedback submitted yet", when the read failed', () => {
    const out = body({ error: true });
    expect(text(out)).toContain('The feedback did not load.');
    expect(out).not.toContain('No feedback submitted yet');
  });

  it('says there is no feedback only after a read that worked', () => {
    expect(text(body({}))).toContain('No feedback submitted yet');
  });

  it('writes No rating and No comment instead of dashes', () => {
    const out = body({ rows: [row(1, { rating: null, comment: null })] });
    expect(out).toContain('No rating');
    expect(out).toContain('No comment');
    expect(out).not.toMatch(/[–—]/);
  });

  it('offers to clear a search that matches nothing', () => {
    const out = body({ rows: [row(1)], searchQuery: 'zzz' });
    expect(text(out)).toContain('No feedback matches "zzz"');
    expect(out).toContain('Clear search');
  });

  it('reads the latest 500 with a range, and the next page after the ones already held', async () => {
    await realFeedbackApi.list({ offset: 0, limit: FEEDBACK_PAGE });
    await realFeedbackApi.list({ offset: 500, limit: FEEDBACK_PAGE });
    const ranges = calls.filter((x) => x.op === 'range').map((x) => x.args);
    expect(ranges).toEqual([[0, 499], [500, 999]]);
    const select = calls.find((x) => x.op === 'select');
    expect(select?.args[0]).toBe('id, user_id, rating, comment, is_guest, guest_email, created_at');
  });

  it('says how much of the total is shown, and when there is more', () => {
    expect(feedbackShownText(500, 1203, true)).toMatch(/^Showing the latest 500 of 1,203$/);
    expect(feedbackShownText(3, 3, false)).toBe('3 entries');
    expect(feedbackShownText(500, undefined, true)).toContain('There may be older entries');
    expect(hasOlder(500, 1203, 500)).toBe(true);
    expect(hasOlder(1203, 1203, 203)).toBe(false);
    expect(hasOlder(500, undefined, 500)).toBe(true);
    expect(hasOlder(120, undefined, 120)).toBe(false);
  });

  it('asks before it deletes, and deletes nothing on no', async () => {
    const remove = vi.fn(async () => {});
    expect(await deleteFeedbackConfirmed(async () => false, { remove }, 'f1')).toBe('cancelled');
    expect(remove).not.toHaveBeenCalled();
    expect(await deleteFeedbackConfirmed(async () => true, { remove }, 'f1')).toBe('deleted');
    expect(remove).toHaveBeenCalledWith('f1');
    expect(await deleteFeedbackConfirmed(async () => true, { remove: async () => { throw new Error('x'); } }, 'f1')).toBe('failed');
  });
});
