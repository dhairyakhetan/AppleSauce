import { useEffect, useState, type ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { PaperPageFlip } from '@/components/checker/PaperPageFlip';
import type { HodApi } from '@/lib/hod-api';
import { cn } from '@/lib/utils';

/* Small pieces the HOD tabs share. */

/** "3 minutes ago", or "" when the time is missing or unreadable. */
export function ago(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : formatDistanceToNow(d, { addSuffix: true });
}

export function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl bg-muted px-4 py-3" title={hint}>
      <p className="text-[12px] font-semibold text-warm-secondary">{label}</p>
      <p className="mt-0.5 text-[22px] font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-muted px-4 py-8 text-center text-[14px] text-warm-secondary">{children}</p>;
}

export function ListSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="animate-pulse space-y-2" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-20 rounded-2xl bg-muted" />
      ))}
    </div>
  );
}

export function LoadError({ onRetry, what }: { onRetry: () => void; what: string }) {
  return (
    <div role="alert" className="rounded-2xl bg-destructive/10 px-4 py-4 text-[14px] text-foreground">
      <p>{what} did not load.</p>
      <button type="button" onClick={onRetry} className="tap-44 mt-1 font-semibold text-brand-blue">
        Try again
      </button>
    </div>
  );
}

/**
 * The picture beside an escalated question: the question's own crop, else its
 * page, else the whole paper as a page-flip. Never "judge from the words".
 */
export function QuestionPicture({
  api,
  paperId,
  path,
  page,
  className,
}: {
  api: Pick<HodApi, 'pictureUrl' | 'paperPages'>;
  paperId: string;
  /** Storage path of the crop or of the question's page, when one exists. */
  path: string | null;
  page: number | null;
  className?: string;
}) {
  const [state, setState] = useState<{ path: string; url: string | null } | null>(null);
  // The HOD can always open the whole paper: escalations are often "the
  // picture is of a different question", so the crop alone cannot settle them.
  const [whole, setWhole] = useState(false);
  useEffect(() => {
    setWhole(false);
  }, [path, paperId]);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api.pictureUrl(path).then((url) => {
      if (!cancelled) setState({ path, url });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (!path) {
    return <PaperPageFlip paperId={paperId} loadPages={api.paperPages} pictureUrl={api.pictureUrl} questionPage={page} className={className} />;
  }
  if (!state || state.path !== path) {
    return <div className={cn('h-40 animate-pulse rounded-2xl bg-muted', className)} role="status" aria-label="Loading the picture" />;
  }
  if (!state.url) {
    // The stored picture is gone: fall back to the whole paper rather than nothing.
    return <PaperPageFlip paperId={paperId} loadPages={api.paperPages} pictureUrl={api.pictureUrl} questionPage={page} className={className} />;
  }
  const toggle = (
    <button
      type="button"
      onClick={() => setWhole((w) => !w)}
      className="tap-44 self-start rounded-full bg-muted px-3.5 py-1.5 text-[13px] font-semibold text-foreground"
    >
      {whole ? "Back to this question's picture" : 'See the whole paper'}
    </button>
  );
  if (whole) {
    return (
      <div className={cn('flex min-w-0 flex-col gap-2', className)}>
        <PaperPageFlip paperId={paperId} loadPages={api.paperPages} pictureUrl={api.pictureUrl} questionPage={page} title="The whole paper" />
        {toggle}
      </div>
    );
  }
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="max-h-[56vh] w-full overflow-auto rounded-2xl bg-white p-2">
        <img src={state.url} alt={page ? `Page ${page} of the printed paper, where this question is` : 'The printed question'} className="mx-auto block h-auto max-w-full" />
      </div>
      {toggle}
    </div>
  );
}
