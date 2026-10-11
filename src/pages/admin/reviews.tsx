import { useCallback, useEffect, useRef, useState, lazy, Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/lib/auth-context';
import { recordAdminAction } from '@/lib/audit';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { adminFieldStyle, adminPanelStyle, adminToast, useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminPageIntroPanel } from '@/components/admin/AdminHelp';
import { useRefreshAdminCounts } from '@/pages/admin/useAdminSectionCounts';
import { AdminStatusPill, AdminRowActions, rowSubject, AdminPanelHeader, type AdminStatus, type AdminRowAction } from '@/pages/admin/AdminTable';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { AdminFilterChips } from '@/components/admin/AdminFilterChips';
import { AdminPillButton } from '@/components/admin/AdminPillButton';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { useConfirm } from '@/components/ui/use-confirm';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useBusyActions } from '@/lib/busy-guard';
import { loadView } from '@/lib/admin-load-view';
import {
  afterPublish,
  afterRemove,
  canConvert,
  contactHref,
  convertConfirmed,
  countsAfterPublish,
  realReviewsAdminApi,
  recommendationLabel,
  stampDecision,
  upvoteSummary,
  type CommentFilter,
  type Recommendation,
  type RecommendationStatus,
  type ReviewComment,
  type ReviewCounts,
  type ReviewsAdminApi,
  type SortOrder,
  type UpvoteStat,
} from '@/lib/reviews-admin-api';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { ThumbsUp } from 'lucide-react';

const DummyAdminReviews = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminReviewsDummy')) : null;

/* Handoff 09i AD-007 "Reviews" -- the single-page merge of the three legacy
   review-adjacent admin routes (comments, recommendations, upvotes), switched
   by tabs that live in the URL as ?tab= (reviews, recommendations, upvotes).
   Visitor feedback (site ratings, unrelated to teacher reviews) has its own
   page at admin/feedback.tsx.

   AD-007: this screen is "not a table, a queue of cards" and "reported
   reviews only" (a moderator clears a queue, they do not browse all
   reviews). The real `teacher_comments` schema has no reported/flagged
   column distinct from the pre-publish `approved` moderation flag, so the
   Waiting view is the card queue; Published and All are real working
   filters kept beside it. The destructive action is a real delete (no
   `hidden` flag exists to soft-hide with), so it keeps the honest verb
   "Remove" and a permanent-delete confirm.

   Admin rework, Batch 5:
   - Each source (reviews, recommendations, upvotes) fails on its own: its
     own error with Try again that re-runs only its own read. A failed read
     is never "nothing waiting".
   - The tab badges and filter counts are their own head-counts, so they do
     not depend on how many rows are loaded or on the filter. The nav badge
     comes from the shared counts hook.
   - A write updates the list in place (the row leaves, or flips), then the
     counts refresh in the background. The page never blanks the queue.
   - The data goes through ReviewsAdminApi (src/lib/reviews-admin-api.ts), so
     dummy mode and tests can swap it. */

type Source = 'reviews' | 'recommendations' | 'upvotes';
const SOURCES: Source[] = ['reviews', 'recommendations', 'upvotes'];

const PAGE_TITLE: Record<Source, string> = { reviews: 'Reviews', recommendations: 'Recommendations', upvotes: 'Upvotes by teacher' };

/** AD-007's card shape, shared by all three sources on this page. */
export interface QueueCardData {
  id: string;
  quote: ReactNode;
  attribution: string;
  /** Extra lines under the attribution (contact numbers). */
  details?: ReactNode;
  badge: ReactNode;
  actions: AdminRowAction[];
  /** Rendered inside the card under the content (the inline edit form). */
  extra?: ReactNode;
  /** Short name of what the card is about, for the action buttons' accessible names. */
  subject?: string;
}

/** AD-007: `rounded-2xl bg-muted`, quote at 15px/1.55, attribution 13px muted,
 *  badge, then the actions. Below `sm` the actions drop under the text and
 *  wrap, with the first action leading. */
function AdminQueueCard({ card }: { card: QueueCardData }) {
  return (
    <div className="rounded-2xl bg-muted px-[18px] py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-pretty break-words text-[15px] leading-[1.55] text-warm-prose">{card.quote}</p>
          <div className="mt-2 text-[13px] text-warm-meta">{card.attribution}</div>
          {card.details}
          <div className="mt-2.5">{card.badge}</div>
        </div>
        <div className="sm:shrink-0">
          <AdminRowActions actions={card.actions} stack subject={rowSubject({ subject: card.subject, cells: [card.quote] })} />
        </div>
      </div>
      {card.extra}
    </div>
  );
}

/** One source's list, or the reason there is none. Pure, so every state can be checked. */
export function SourcePanel({
  what,
  settled,
  error,
  cards,
  emptyTitle,
  emptyHint,
  emptyAction,
  onRetry,
  dim,
}: {
  /** "the reviews", for the error sentence. */
  what: string;
  settled: boolean;
  error: boolean;
  cards: QueueCardData[];
  emptyTitle: string;
  emptyHint?: string;
  emptyAction?: { label: string; onClick: () => void };
  onRetry: () => void;
  /** A refetch is under way: keep the cards, soften them. */
  dim?: boolean;
}) {
  const view = loadView({ settled, error, count: cards.length });
  if (view === 'skeleton') return <AdminLoading shape="cards" rows={4} label={`Loading ${what}`} />;
  if (view === 'error') return <AdminError what={what} onRetry={onRetry} />;
  if (view === 'empty') return <AdminEmpty title={emptyTitle} hint={emptyHint} action={emptyAction} className="rounded-2xl bg-muted py-12" />;
  return (
    <>
      {error ? <AdminError what={`the latest ${what.replace(/^the /, '')}`} onRetry={onRetry} detail="The list below may be out of date." className="mb-3" /> : null}
      <div className={cn('flex flex-col gap-2.5 transition-opacity duration-150', dim && 'opacity-60')}>
        {cards.map((card) => (
          <AdminQueueCard key={card.id} card={card} />
        ))}
      </div>
    </>
  );
}

function ContactLink({ contact }: { contact: string }) {
  const href = contactHref(contact);
  if (!href) return <span className="text-warm-secondary">{contact || 'No contact given'}</span>;
  return (
    <a href={href} className="inline-flex min-h-10 items-center font-bold text-brand-blue underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {contact}
    </a>
  );
}

/** "Teacher:" and "Recommended by:" with a tap-to-call number, from data already loaded. */
function ContactLines({ rec }: { rec: Recommendation }) {
  return (
    <dl className="mt-1.5 space-y-0 text-[13px] text-warm-secondary">
      <div>
        <dt className="inline font-semibold text-foreground">Teacher: </dt>
        <dd className="inline">
          {rec.teacher_name} <ContactLink contact={rec.teacher_contact} />
        </dd>
      </div>
      <div>
        <dt className="inline font-semibold text-foreground">Recommended by: </dt>
        <dd className="inline">
          {rec.recommender_name} <ContactLink contact={rec.recommender_contact} />
        </dd>
      </div>
    </dl>
  );
}

function RecommendationEditForm({
  rec,
  status,
  notes,
  saving,
  error,
  onStatus,
  onNotes,
  onSave,
  onCancel,
}: {
  rec: Recommendation;
  status: string;
  notes: string;
  saving: boolean;
  error: string | null;
  onStatus: (v: string) => void;
  onNotes: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const statusRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    statusRef.current?.focus();
  }, []);
  return (
    <div className={cn(adminPanelStyle, 'mt-4 max-w-[560px] space-y-4 p-5')} data-testid="recommendation-edit">
      <div className="text-sm font-bold text-foreground">Editing recommendation: {rec.teacher_name}</div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={`rec-status-${rec.id}`} className="mb-2 block text-sm font-medium text-warm-secondary">
            Status
          </label>
          <Select value={status} onValueChange={onStatus}>
            <SelectTrigger id={`rec-status-${rec.id}`} ref={statusRef} className={`h-auto border-0 ${adminFieldStyle}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="onboarded">Onboarded</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor={`rec-notes-${rec.id}`} className="mb-2 block text-sm font-medium text-warm-secondary">
            Notes
          </label>
          <Textarea
            id={`rec-notes-${rec.id}`}
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            placeholder="Add notes..."
            rows={3}
            className={`border-0 ${adminFieldStyle}`}
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <AdminPillButton variant="primary" busy={saving} onClick={onSave}>
          {saving ? 'Saving...' : 'Save'}
        </AdminPillButton>
        <AdminPillButton variant="secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </AdminPillButton>
      </div>
    </div>
  );
}

const REC_TONE: Record<RecommendationStatus, AdminStatus> = { onboarded: 'live', rejected: 'hidden', contacted: 'paused', pending: 'pending' };

export function AdminReviewsPage({
  api = realReviewsAdminApi,
  dummy = false,
  banner,
}: {
  api?: ReviewsAdminApi;
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Reviews | Shikshaq Admin', 'Moderate parents\' reviews of teachers, recommended teachers and upvotes waiting on the admin queue.');
  const { confirm, confirmDialog } = useConfirm();
  const { user, profile } = useAuth();
  const actorName = profile?.full_name || user?.email || 'an admin';
  const signedInName = profile?.full_name || user?.email || 'Admin';
  const refreshNav = useRefreshAdminCounts();
  // One write at a time per row: a second tap while the first is running is ignored,
  // and the button reads as disabled meanwhile.
  const { run: runBusy, busy } = useBusyActions();

  const guard = useAdminGuard(dummy ? null : user, { redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const { error: adminGuardError, retry: retryAdminGuard } = guard;

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const source: Source = (SOURCES as string[]).includes(tabParam ?? '') ? (tabParam as Source) : 'reviews';
  function setSource(next: string) {
    const p = new URLSearchParams(searchParams);
    if (next === 'reviews') p.delete('tab');
    else p.set('tab', next);
    setSearchParams(p);
  }

  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  // --- Counts: their own reads, independent of what is loaded ---------------
  const [counts, setCounts] = useState<ReviewCounts>({});
  const [countsSettled, setCountsSettled] = useState(false);
  const refreshCounts = useCallback(() => {
    void api
      .counts()
      .then((c) => setCounts(c))
      .catch(() => setCounts({}))
      .finally(() => setCountsSettled(true));
    refreshNav();
  }, [api, refreshNav]);

  // --- Reviews --------------------------------------------------------------
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [commentsSettled, setCommentsSettled] = useState(false);
  const [commentsError, setCommentsError] = useState(false);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false);
  const [commentsHasMore, setCommentsHasMore] = useState(true);
  const [commentsPage, setCommentsPage] = useState(0);
  const [commentFilter, setCommentFilter] = useState<CommentFilter>('pending');
  const commentsSeq = useRef(0);
  // The rows held right now, read when "Load more" starts so the next read begins
  // after them even if some were published or removed since the last read.
  const commentsRef = useRef<ReviewComment[]>([]);
  commentsRef.current = comments;

  const fetchComments = useCallback(
    async (append = false) => {
      const seq = ++commentsSeq.current;
      if (append) setCommentsLoadingMore(true);
      else setCommentsBusy(true);
      try {
        const r = await api.comments({
          filter: commentFilter,
          sort: sortOrder,
          page: append ? commentsPage : 0,
          ...(append ? { offset: commentsRef.current.length } : {}),
        });
        if (seq !== commentsSeq.current) return;
        setCommentsHasMore(r.hasMore);
        if (append) {
          setComments((prev) => [...prev, ...r.rows.filter((n) => !prev.some((p) => p.id === n.id))]);
          setCommentsPage((p) => p + 1);
        } else {
          setComments(r.rows);
          setCommentsPage(1);
          setCommentsError(false);
        }
      } catch (error) {
        if (seq !== commentsSeq.current) return;
        if (import.meta.env.DEV) console.error('Error fetching comments:', error);
        if (append) adminToast('Could not load more reviews. Try again.');
        else setCommentsError(true);
      } finally {
        if (seq === commentsSeq.current) {
          setCommentsSettled(true);
          setCommentsBusy(false);
          setCommentsLoadingMore(false);
        }
      }
    },
    [api, commentFilter, sortOrder, commentsPage],
  );

  useEffect(() => {
    if (isAdmin) void fetchComments(false);
    // Reload when the filter or sort changes; "load more" is its own call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, commentFilter, sortOrder, api]);

  const handlePublish = async (c: ReviewComment) => {
    try {
      await api.publishComment(c.id);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error approving comment:', error);
      adminToast('Failed to publish review');
      return;
    }
    adminToast('Review published');
    if (user) {
      void recordAdminAction({
        actorId: user.id,
        actorName,
        action: 'approve',
        targetType: 'comment',
        targetId: c.id,
        targetLabel: c.teachers_list?.name || 'review',
      });
    }
    setComments((prev) => afterPublish(prev, c.id, commentFilter, new Date().toISOString()));
    setCounts((prev) => countsAfterPublish(prev));
    refreshCounts();
  };

  const handleRemoveComment = async (c: ReviewComment) => {
    const ok = await confirm({
      title: 'Remove this review?',
      description: 'It disappears from the teacher\'s profile straight away. This cannot be undone.',
      confirmLabel: 'Remove review',
    });
    if (!ok) return;
    try {
      await api.removeComment(c.id);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error deleting comment:', error);
      adminToast('Failed to remove review');
      return;
    }
    adminToast('Review removed');
    if (user) {
      void recordAdminAction({
        actorId: user.id,
        actorName,
        action: 'delete',
        targetType: 'comment',
        targetId: c.id,
        targetLabel: c.teachers_list?.name || 'review',
      });
    }
    setComments((prev) => afterRemove(prev, c.id));
    refreshCounts();
  };

  const authorName = (c: ReviewComment) => (c.is_anonymous ? 'Anonymous' : c.profiles?.full_name || 'Anonymous');
  const authorInfo = (c: ReviewComment): string => {
    if (c.is_anonymous) return '';
    if (c.profiles?.role === 'guardian') return 'Guardian';
    if (c.profiles?.role === 'student') {
      const parts: string[] = [];
      if (c.profiles.school_college) parts.push(c.profiles.school_college);
      if (c.profiles.grade) parts.push(`Grade ${c.profiles.grade}`);
      return parts.join(' • ');
    }
    return '';
  };

  // --- Recommendations ------------------------------------------------------
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [recsSettled, setRecsSettled] = useState(false);
  const [recsError, setRecsError] = useState(false);
  const [recsBusy, setRecsBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [reviewerNames, setReviewerNames] = useState<Record<string, string>>({});
  const recsSeq = useRef(0);

  const fetchRecs = useCallback(async () => {
    const seq = ++recsSeq.current;
    setRecsBusy(true);
    try {
      const rows = await api.recommendations(sortOrder);
      if (seq !== recsSeq.current) return;
      setRecs(rows);
      setRecsError(false);
    } catch (error) {
      if (seq !== recsSeq.current) return;
      if (import.meta.env.DEV) console.error('Error fetching recommendations:', error);
      setRecsError(true);
    } finally {
      if (seq === recsSeq.current) {
        setRecsSettled(true);
        setRecsBusy(false);
      }
    }
  }, [api, sortOrder]);

  useEffect(() => {
    if (isAdmin) void fetchRecs();
  }, [isAdmin, fetchRecs]);

  useEffect(() => {
    const ids = recs.map((r) => r.approved_by).filter((x): x is string => Boolean(x));
    if (ids.length === 0) return;
    let cancelled = false;
    void api.reviewerNames(ids).then((m) => {
      if (!cancelled) setReviewerNames(m);
    });
    return () => {
      cancelled = true;
    };
  }, [api, recs]);

  const openEdit = (rec: Recommendation) => {
    setEditingId(rec.id);
    setEditStatus(rec.status);
    setEditNotes(rec.notes || '');
    setEditError(null);
  };

  const handleSaveRecommendation = async (rec: Recommendation) => {
    if (!user && !dummy) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await api.saveRecommendation(rec.id, { status: editStatus, notes: editNotes }, user?.id ?? 'dummy');
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error updating recommendation:', error);
      setEditError('Could not save this recommendation. Your notes are still here. Try again.');
      setEditSaving(false);
      return;
    }
    setEditSaving(false);
    adminToast('Recommendation updated');
    if (user) {
      void recordAdminAction({
        actorId: user.id,
        actorName,
        action: 'edit',
        targetType: 'recommendation',
        targetId: rec.id,
        targetLabel: rec.teacher_name || 'recommendation',
      });
    }
    setRecs((prev) =>
      prev.map((r) =>
        r.id === rec.id
          ? { ...r, status: editStatus as RecommendationStatus, notes: editNotes, approved_by: user?.id ?? r.approved_by, approved_at: new Date().toISOString() }
          : r,
      ),
    );
    setEditingId(null);
    refreshCounts();
  };

  const handleQuickStatus = async (rec: Recommendation, status: RecommendationStatus) => {
    if (!user && !dummy) return;
    const previous = rec.status;
    setRecs((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status } : r)));
    try {
      await api.saveRecommendation(rec.id, { status }, user?.id ?? 'dummy');
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error updating recommendation:', error);
      setRecs((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status: previous } : r)));
      adminToast('Failed to update recommendation');
      return;
    }
    // Now that it is saved, the card shows who decided and when, not "Sent ...".
    setRecs((prev) => prev.map((r) => (r.id === rec.id ? stampDecision(r, status, user?.id ?? null, new Date().toISOString()) : r)));
    adminToast(status === 'contacted' ? 'Marked as contacted' : 'Recommendation dismissed');
    if (user) {
      void recordAdminAction({
        actorId: user.id,
        actorName,
        action: status === 'contacted' ? 'edit' : 'reject',
        targetType: 'recommendation',
        targetId: rec.id,
        targetLabel: rec.teacher_name || 'recommendation',
      });
    }
    refreshCounts();
  };

  /** Turns a recommendation into a teacher application (the intake Approvals reads). */
  const handleConvert = async (rec: Recommendation) => {
    if (!user && !dummy) return;
    const outcome = await convertConfirmed(
      async () => {
        const yes = await confirm({
          title: `Create a teacher application for ${rec.teacher_name}?`,
          description: 'It appears in Applications, ready to review, with the recommender as the reference. This recommendation is then marked onboarded.',
          confirmLabel: 'Create application',
        });
        // Disable the button only once the admin has said yes.
        if (yes) setConvertingId(rec.id);
        return yes;
      },
      api,
      rec,
      user?.id ?? 'dummy',
    );
    setConvertingId(null);
    if (outcome === 'cancelled') return;
    if (outcome === 'failed') {
      adminToast('Failed to convert recommendation to an application');
      return;
    }
    if (outcome === 'marked') {
      adminToast('Converted to an application');
      setRecs((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status: 'onboarded' } : r)));
    } else {
      adminToast('Application created, but the recommendation could not be marked onboarded. Mark it manually.');
    }
    if (user) {
      void recordAdminAction({
        actorId: user.id,
        actorName,
        action: 'edit',
        targetType: 'recommendation',
        targetId: rec.id,
        targetLabel: rec.teacher_name,
        reason: 'Converted recommendation to teacher application',
      });
    }
    refreshCounts();
  };

  // --- Upvotes --------------------------------------------------------------
  const [upvotes, setUpvotes] = useState<UpvoteStat[]>([]);
  const [upvotesSettled, setUpvotesSettled] = useState(false);
  const [upvotesError, setUpvotesError] = useState(false);

  const fetchUpvotes = useCallback(async () => {
    try {
      setUpvotes(await api.upvoteStats());
      setUpvotesError(false);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error fetching upvote stats:', error);
      setUpvotesError(true);
    } finally {
      setUpvotesSettled(true);
    }
  }, [api]);

  useEffect(() => {
    if (isAdmin) {
      void fetchUpvotes();
      refreshCounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, api]);

  /** AdminUpvotes had no per-row mutation at all. Every source gets a row action,
   *  so upvotes get a real destructive one: clear all upvotes recorded for a teacher. */
  const handleClearUpvotes = async (stat: UpvoteStat) => {
    const ok = await confirm({
      title: `Clear upvotes for ${stat.teacher_name}?`,
      description: `Removes all ${stat.upvote_count} recorded upvote${stat.upvote_count === 1 ? '' : 's'} for this teacher. This cannot be undone.`,
      confirmLabel: 'Clear upvotes',
    });
    if (!ok) return;
    try {
      await api.clearUpvotes(stat.teacher_id);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error clearing upvotes:', error);
      adminToast('Failed to clear upvotes');
      return;
    }
    adminToast('Upvotes cleared');
    if (user) {
      void recordAdminAction({
        actorId: user.id,
        actorName,
        action: 'delete',
        targetType: 'upvotes',
        targetId: stat.teacher_id,
        targetLabel: stat.teacher_name,
      });
    }
    setUpvotes((prev) => prev.filter((s) => s.teacher_id !== stat.teacher_id));
  };

  // --- Cards ----------------------------------------------------------------
  const reviewCards: QueueCardData[] = comments.map((comment) => {
    const teacherName = comment.teachers_list?.name || `Teacher ${comment.teacher_id}`;
    const attribution = comment.approved
      ? `${authorName(comment)} · on ${teacherName} · published ${comment.approved_at ? formatDistanceToNow(new Date(comment.approved_at), { addSuffix: true }) : 'recently'}${comment.approver_name ? ` by ${comment.approver_name}` : ''}`
      : [authorName(comment), `on ${teacherName}`, authorInfo(comment), formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })].filter(Boolean).join(' · ');
    return {
      id: comment.id,
      quote: `"${comment.comment}"`,
      attribution,
      badge: <AdminStatusPill status={comment.approved ? 'live' : 'pending'} label={comment.approved ? 'Published' : 'Waiting'} />,
      actions: comment.approved
        ? [{ label: 'Remove', tone: 'destructive', disabled: busy(`c:${comment.id}`), onClick: () => void runBusy(`c:${comment.id}`, () => handleRemoveComment(comment)) }]
        : [{ label: 'Publish', tone: 'mint', disabled: busy(`c:${comment.id}`), onClick: () => void runBusy(`c:${comment.id}`, () => handlePublish(comment)) }],
    };
  });

  const recommendationCards: QueueCardData[] = recs.map((rec) => {
    const reviewedMeta = rec.approved_at
      ? `Reviewed by ${rec.approved_by ? reviewerNames[rec.approved_by] || 'an admin' : 'an admin'}, ${formatDistanceToNow(new Date(rec.approved_at), { addSuffix: true })}`
      : `Sent ${formatDistanceToNow(new Date(rec.created_at), { addSuffix: true })}`;
    const actions: AdminRowAction[] = [
      ...(rec.status === 'pending'
        ? [
            { label: 'Mark as contacted', tone: 'mint' as const, disabled: busy(`r:${rec.id}`), onClick: () => void runBusy(`r:${rec.id}`, () => handleQuickStatus(rec, 'contacted')) },
            { label: 'Dismiss', tone: 'muted' as const, disabled: busy(`r:${rec.id}`), onClick: () => void runBusy(`r:${rec.id}`, () => handleQuickStatus(rec, 'rejected')) },
          ]
        : []),
      ...(canConvert(rec.status)
        ? [{ label: convertingId === rec.id ? 'Creating...' : 'Convert to application', tone: 'mint' as const, disabled: convertingId !== null, onClick: () => void handleConvert(rec) }]
        : []),
      { label: 'Edit', tone: 'muted', onClick: () => openEdit(rec) },
    ];
    return {
      id: rec.id,
      quote: rec.notes || `Recommended: ${rec.teacher_name}`,
      attribution: reviewedMeta,
      details: <ContactLines rec={rec} />,
      badge: <AdminStatusPill status={REC_TONE[rec.status]} label={recommendationLabel(rec.status)} />,
      actions,
      extra:
        editingId === rec.id ? (
          <RecommendationEditForm
            rec={rec}
            status={editStatus}
            notes={editNotes}
            saving={editSaving}
            error={editError}
            onStatus={setEditStatus}
            onNotes={setEditNotes}
            onSave={() => void handleSaveRecommendation(rec)}
            onCancel={() => setEditingId(null)}
          />
        ) : undefined,
    };
  });

  const upvoteCards: QueueCardData[] = upvotes.map((stat, index) => ({
    id: stat.teacher_id,
    quote: stat.teacher_name,
    attribution: `#${index + 1} by upvote count`,
    badge: (
      <span className="inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-full bg-success-subtle-bg px-[10px] text-[12px] font-bold tabular-nums text-success-subtle-text">
        <ThumbsUp className="h-3 w-3" aria-hidden="true" />
        {stat.upvote_count}
      </span>
    ),
    actions: [
      { label: 'View profile', tone: 'primary', onClick: () => window.open(`/tuition-teachers/${stat.teacher_slug}`, '_blank', 'noopener') },
      { label: 'Clear upvotes', tone: 'destructive', disabled: busy(`u:${stat.teacher_id}`), onClick: () => void runBusy(`u:${stat.teacher_id}`, () => handleClearUpvotes(stat)) },
    ],
  }));

  // --- Chrome ---------------------------------------------------------------
  const nav = buildAdminNav('reviews');

  const countOrUnknown = (n: number | undefined): number | null | undefined => (countsSettled ? (n === undefined ? null : n) : undefined);
  const allReviews =
    counts.pendingReviews !== undefined && counts.approvedReviews !== undefined ? counts.pendingReviews + counts.approvedReviews : undefined;

  const waitingMeta = (n: number | undefined) => (n === undefined ? undefined : n > 0 ? `${n} waiting` : 'Nothing waiting');

  if (adminGuardError) return <AdminGuardErrorState onRetry={retryAdminGuard} />;

  if (checkingAdmin) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={user?.email ?? signedInName} />
        <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
          <div className="px-[18px]">
            <AdminLoading shape="cards" rows={4} label="Checking admin access" />
          </div>
        </BentoPanel>
        <AdminAuditNote />
      </BentoStack>
    );
  }

  if (!isAdmin) return null;

  const showSort = source !== 'upvotes';
  const sortSlot = (
    <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as SortOrder)}>
      <SelectTrigger aria-label="Sort order" className="h-11 w-[150px] rounded-full border-0 bg-muted text-sm font-semibold">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="newest">Newest first</SelectItem>
        <SelectItem value="oldest">Oldest first</SelectItem>
      </SelectContent>
    </Select>
  );

  const reviewEmpty =
    commentFilter === 'pending'
      ? { title: 'No reviews waiting', hint: 'You are all caught up. New reviews from parents land here.' }
      : commentFilter === 'approved'
      ? { title: 'No published reviews yet', hint: 'Publish a waiting review and it shows here.' }
      : { title: 'No reviews found', hint: 'Parents have not written any reviews yet.' };

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={user?.email ?? signedInName} />
      <AdminPageIntroPanel page="reviews" />
      {banner}

      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <AdminPanelHeader
          title={PAGE_TITLE[source]}
          meta={
            source === 'reviews'
              ? waitingMeta(counts.pendingReviews)
              : source === 'recommendations'
              ? waitingMeta(counts.pendingRecommendations)
              : upvotesSettled && !upvotesError
              ? upvoteSummary(upvotes)
              : undefined
          }
        />

        <AdminTabs
          label="What to moderate"
          value={source}
          onChange={setSource}
          className="px-[18px]"
          tabs={[
            { key: 'reviews', label: 'Reviews', count: countOrUnknown(counts.pendingReviews) },
            { key: 'recommendations', label: 'Recommendations', count: countOrUnknown(counts.pendingRecommendations) },
            { key: 'upvotes', label: 'Upvotes' },
          ]}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {source === 'reviews' ? (
              <AdminFilterChips
                label="Which reviews"
                value={commentFilter}
                onChange={(k) => setCommentFilter(k as CommentFilter)}
                onClear={() => setCommentFilter('pending')}
                defaultValue="pending"
                chips={[
                  { key: 'pending', label: 'Waiting', count: counts.pendingReviews, hint: 'Written by parents, not yet on the site.' },
                  { key: 'approved', label: 'Published', count: counts.approvedReviews, hint: 'Already on the teacher\'s page.' },
                  { key: 'all', label: 'All', count: allReviews },
                ]}
              />
            ) : (
              <span />
            )}
            {showSort ? sortSlot : <span className="text-[13px] font-semibold text-warm-secondary">Most upvotes first</span>}
          </div>

          {source === 'reviews' ? (
            <>
              <SourcePanel
                what="the reviews"
                settled={commentsSettled}
                error={commentsError}
                cards={reviewCards}
                emptyTitle={reviewEmpty.title}
                emptyHint={reviewEmpty.hint}
                emptyAction={commentFilter !== 'pending' ? { label: 'Show waiting reviews', onClick: () => setCommentFilter('pending') } : undefined}
                onRetry={() => void fetchComments(false)}
                dim={commentsBusy && commentsSettled}
              />
              {commentsHasMore && commentsSettled && !commentsError && comments.length > 0 ? (
                <div className="mt-6 flex justify-center">
                  <AdminPillButton variant="secondary" busy={commentsLoadingMore} className="min-w-[140px]" onClick={() => void fetchComments(true)}>
                    {commentsLoadingMore ? 'Loading...' : 'Load more'}
                  </AdminPillButton>
                </div>
              ) : null}
            </>
          ) : source === 'recommendations' ? (
            <SourcePanel
              what="the recommendations"
              settled={recsSettled}
              error={recsError}
              cards={recommendationCards}
              emptyTitle="No recommendations yet"
              emptyHint="When a parent recommends a teacher, it shows here."
              onRetry={() => void fetchRecs()}
              dim={recsBusy && recsSettled}
            />
          ) : (
            <SourcePanel
              what="the upvotes"
              settled={upvotesSettled}
              error={upvotesError}
              cards={upvoteCards}
              emptyTitle="No upvotes yet"
              emptyHint="Parents upvote teachers from their profile. The totals show here."
              onRetry={() => void fetchUpvotes()}
            />
          )}
        </AdminTabs>
      </BentoPanel>

      <AdminAuditNote />
      {confirmDialog}
    </BentoStack>
  );
}

export default function AdminReviews() {
  if (DummyAdminReviews && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyAdminReviews />
      </Suspense>
    );
  }
  return <AdminReviewsPage />;
}
