import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  clampPageIndex,
  NO_PAGES_NOTE,
  NO_PAGES_TITLE,
  PAGES_FAILED_NOTE,
  pageLabel,
  positionLabel,
  startPageIndex,
  WHOLE_PAPER_NOTE,
  WHOLE_PAPER_TITLE,
  type PaperPage,
} from '@/lib/paper-pages';

/**
 * The whole-paper fallback: every page picture of a paper as a page-flip,
 * shown where a question has no picture of its own page. Says plainly that no
 * page matched this question, so the reader knows why they are looking at a
 * whole paper. Only a paper with no pictures at all gets the "nothing to look
 * at" message. Used by the checker, the admin queue and the HOD view.
 *
 * Pure props, no data hooks: callers pass the two reads (the paper's pages and
 * a signed link), so it runs against the real RPCs or a dummy-mode fake.
 */
export function PaperPageFlip({
  paperId,
  loadPages,
  pictureUrl,
  questionPage,
  className,
  title = WHOLE_PAPER_TITLE,
}: {
  paperId: string;
  loadPages: (paperId: string) => Promise<PaperPage[]>;
  pictureUrl: (path: string) => Promise<string | null>;
  /** The question's own page number when it is known, to open there. */
  questionPage?: number | null;
  className?: string;
  /** Heading above the pages; the default says no page matched. */
  title?: string;
}) {
  const [pages, setPages] = useState<PaperPage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPages(null);
    setFailed(false);
    loadPages(paperId)
      .then((p) => {
        if (cancelled) return;
        setPages(p);
        setIndex(startPageIndex(p, questionPage));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // loadPages is a stable member of an api object; the paper decides the reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, attempt]);

  const current = pages ? pages[clampPageIndex(index, pages.length)] : undefined;
  const [shown, setShown] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    pictureUrl(current.object_path).then((url) => {
      if (!cancelled) setShown({ path: current.object_path, url });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.object_path]);

  const box = cn('flex min-w-0 flex-col gap-2', className);

  if (failed) {
    return (
      <div className={box} role="status" data-testid="paper-pages-failed">
        <p className="text-[13px] text-warm-secondary">{PAGES_FAILED_NOTE}</p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="tap-44 self-start rounded-full bg-muted px-4 py-2 text-[13px] font-semibold text-foreground"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!pages) {
    return <div className={cn('h-40 animate-pulse rounded-2xl bg-muted', className)} aria-label="Loading the paper" role="status" />;
  }
  if (pages.length === 0) {
    return (
      <div className={cn('rounded-2xl bg-white p-6 text-center', className)} data-testid="paper-no-pages" role="note">
        <p className="text-[14px] font-semibold text-foreground">{NO_PAGES_TITLE}</p>
        <p className="mt-1 text-[13px] text-warm-secondary">{NO_PAGES_NOTE}</p>
      </div>
    );
  }

  const i = clampPageIndex(index, pages.length);
  const ready = shown && current && shown.path === current.object_path ? shown : null;
  return (
    <div className={box} data-testid="paper-page-flip">
      <div className="rounded-2xl bg-brand-subtle px-3 py-2">
        <p className="text-[14px] font-semibold leading-snug text-foreground">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-warm-secondary">{WHOLE_PAPER_NOTE}</p>
      </div>
      <div className="flex items-center justify-between gap-2" role="group" aria-label="Flip through the pages">
        <button
          type="button"
          onClick={() => setIndex(clampPageIndex(i - 1, pages.length))}
          disabled={i === 0}
          className="tap-44 rounded-full bg-muted px-4 py-2 text-[13px] font-semibold text-foreground disabled:opacity-40"
        >
          Previous
        </button>
        <p className="text-center text-[13px] font-semibold tabular-nums text-foreground" aria-live="polite">
          {pageLabel(pages, i)} <span className="font-normal text-warm-secondary">({positionLabel(pages, i)})</span>
        </p>
        <button
          type="button"
          onClick={() => setIndex(clampPageIndex(i + 1, pages.length))}
          disabled={i >= pages.length - 1}
          className="tap-44 rounded-full bg-muted px-4 py-2 text-[13px] font-semibold text-foreground disabled:opacity-40"
        >
          Next
        </button>
      </div>
      <div
        className="max-h-[56vh] w-full overflow-auto rounded-[14px] bg-white lg:max-h-[68vh]"
        tabIndex={0}
        role="region"
        aria-label="The scanned page. Scroll to move around."
      >
        {!ready ? (
          <div className="h-72 animate-pulse bg-muted" aria-label="Loading the page" role="status" />
        ) : ready.url ? (
          <img key={ready.url} src={ready.url} alt={`Page ${current?.page} of the printed paper`} draggable={false} className="block h-auto w-full" />
        ) : (
          <p className="p-6 text-center text-[13px] text-warm-secondary" role="status">
            This page could not be loaded. Try the next one.
          </p>
        )}
      </div>
    </div>
  );
}
