import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '@/components/checker/CheckerBits';
import { RequestForm } from '@/components/requests/RequestForm';
import { actionToneClass } from '@/lib/checker-button-styles';
import type { FixRequestsApi } from '@/lib/fix-requests-api';
import { REQUESTS_QUERY_ROOT, SENT_AS_HOD, SENT_TO_HOD, describeScreen, kindWord, memberStatusLine, memberStatusWord, timeAgo, type FixRequest, type RequestStatus } from '@/lib/fix-requests';
import { cn } from '@/lib/utils';

/* "Report a problem": the dialog a checker opens from the Menu or from My papers. It has three views:
   the form, the thanks after sending ("Sent to your HOD. They will look at it before it goes on."), and
   My requests, where each request they sent shows what became of it in plain words. */

export type ReportView = 'form' | 'sent' | 'mine';

const STATUS_TONE: Record<RequestStatus, string> = {
  waiting_for_hod: 'bg-brand-subtle text-foreground',
  approved: 'bg-mint text-foreground',
  in_progress: 'bg-mint text-foreground',
  rejected: 'bg-destructive/10 text-destructive',
  done: 'bg-mint text-foreground',
};

export function ReportProblemDialog({
  api,
  scope,
  page,
  asHod = false,
  initialView = 'form',
  onClose,
}: {
  api: FixRequestsApi;
  scope: string;
  /** The path and query of the screen it was opened from. */
  page: string;
  /** An HOD sending one: the thanks says it went straight on. */
  asHod?: boolean;
  initialView?: ReportView;
  onClose: () => void;
}) {
  const [view, setView] = useState<ReportView>(initialView);
  const titleId = 'report-problem-title';
  // When the view changes the button that was pressed is gone, so keyboard and screen reader users are put
  // back at the heading, which names the new view. Not on the first showing: the dialog sets focus itself.
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [view]);

  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-balance text-[16px] font-bold text-foreground outline-none">
          {view === 'mine' ? 'My requests' : view === 'sent' ? 'Sent' : 'Report a problem'}
        </h2>
        {view !== 'mine' ? (
          <button type="button" onClick={() => setView('mine')} className="tap-44 shrink-0 text-[13px] font-semibold text-brand-blue">
            My requests
          </button>
        ) : (
          <button type="button" onClick={() => setView('form')} className="tap-44 shrink-0 text-[13px] font-semibold text-brand-blue">
            New request
          </button>
        )}
      </div>

      {view === 'form' ? (
        <RequestForm api={api} scope={scope} page={page} asHod={asHod} onSent={() => setView('sent')} onCancel={onClose} />
      ) : null}

      {view === 'sent' ? (
        <div className="flex flex-col gap-3">
          <p role="status" className="rounded-2xl bg-mint px-4 py-3 text-[14px] leading-snug text-foreground" data-testid="request-sent">
            {asHod ? SENT_AS_HOD : SENT_TO_HOD}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setView('mine')} className={actionToneClass('brand')}>
              See my requests
            </button>
            <button type="button" onClick={() => setView('form')} className={actionToneClass('muted')}>
              Send another
            </button>
            <button type="button" onClick={onClose} className={actionToneClass('muted')}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {view === 'mine' ? (
        <div className="flex flex-col gap-3">
          <MyRequestsList api={api} scope={scope} />
          <div>
            <button type="button" onClick={onClose} className={actionToneClass('muted')}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/** The requests this person sent, newest first, each with what became of it. */
export function MyRequestsList({ api, scope }: { api: FixRequestsApi; scope: string }) {
  const q = useQuery({
    queryKey: [REQUESTS_QUERY_ROOT, scope, 'mine'],
    queryFn: () => api.mine(),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  if (q.isLoading) {
    return <div className="h-24 animate-pulse rounded-2xl bg-muted" role="status" aria-label="Loading your requests" />;
  }
  if (q.isError) {
    return (
      <div role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground">
        <p>Your requests did not load.</p>
        <button type="button" onClick={() => void q.refetch()} className="tap-44 mt-1 font-semibold text-brand-blue">
          Try again
        </button>
      </div>
    );
  }
  const list = q.data ?? [];
  if (list.length === 0) {
    return <p className="rounded-2xl bg-muted px-4 py-6 text-center text-[14px] text-warm-secondary">You have not sent a request yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="My requests" data-testid="my-requests">
      {list.map((r) => (
        <MyRequestRow key={r.id} r={r} />
      ))}
    </ul>
  );
}

export function MyRequestRow({ r }: { r: FixRequest }) {
  return (
    <li className="rounded-2xl bg-muted p-3" data-testid="my-request" data-status={r.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words text-[14px] font-bold text-foreground">{r.title}</p>
        <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold', STATUS_TONE[r.status])}>{memberStatusWord(r.status)}</span>
      </div>
      <p className="mt-0.5 text-[12px] text-warm-meta">
        {kindWord(r.kind)} · {describeScreen(r.page_path)}
        {r.created_at ? ` · sent ${timeAgo(r.created_at)}` : ''}
      </p>
      <p className="mt-1.5 break-words text-[13px] leading-snug text-warm-secondary">{memberStatusLine(r)}</p>
    </li>
  );
}
