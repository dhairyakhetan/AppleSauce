import { useEffect, useState, type RefObject } from 'react';
import type { SentBack } from '@/lib/games/rows';
import { cn } from '@/lib/utils';
import { btn, chip, day, LINKISH, plural } from './helpers';

/* Questions an HoD sent back to this person, at the top of Write questions, with why. Opening the list marks them seen.
   It shows a few at a time ("Show more"), newest first, so a long list never fills the page. "Fix it" puts one back in
   the box, with its chapter and topic chosen. */

/** How many sent-back questions show at first, and how many more each "Show more" adds. */
export const SENT_BACK_PAGE = 5;

export interface Alerts { list?: SentBack[]; error?: string }

export function SentBackPanel({ panelRef, alerts, open, setOpen, focus, onSeen, onRetry, onFix }: {
  panelRef: RefObject<HTMLElement>;
  alerts: Alerts; open: boolean; setOpen: (o: boolean) => void;
  /** Questions to point at ("See why" after a send skipped them): shown first. */
  focus: string[];
  onSeen: (ids: string[]) => void; onRetry: () => void; onFix: (a: SentBack) => void;
}) {
  const all = alerts.list ?? [];
  const pointAt = new Set(focus);
  const list = [...all.filter((a) => pointAt.has(a.id)), ...all.filter((a) => !pointAt.has(a.id))];
  const [showing, setShowing] = useState(SENT_BACK_PAGE);
  const shown = list.slice(0, Math.max(showing, pointAt.size));
  // only the ones shown are marked seen
  const unseenShown = open ? shown.filter((a) => !a.seen).map((a) => a.id).join(',') : '';
  // the ones that were new when shown keep their "New" label while the list stays open
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!unseenShown) return;
    const ids = unseenShown.split(',');
    setFresh((f) => new Set([...f, ...ids]));
    onSeen(ids);
  }, [unseenShown, onSeen]);
  useEffect(() => { if (!open) { setFresh(new Set()); setShowing(SENT_BACK_PAGE); } }, [open]);

  if (alerts.error && !alerts.list) {
    return (
      <section ref={panelRef} tabIndex={-1} className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground outline-none" role="alert">
        <b>Couldn't check for questions sent back to you.</b> {alerts.error}{' '}
        <button type="button" className={LINKISH} onClick={onRetry}>Try again</button>
      </section>
    );
  }
  if (!all.length) return null;
  const unseen = all.filter((a) => !a.seen).length;
  const waitingFix = all.filter((a) => !a.now).length;

  return (
    <section ref={panelRef} tabIndex={-1} aria-labelledby="back-h" className="rounded-[24px] bg-brand-subtle p-4 outline-none sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="back-h" className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-foreground">
            {plural(all.length, 'question was', 'questions were')} sent back to you
            {unseen > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-[12px] font-bold text-foreground">{unseen} new</span>}
          </h2>
          {!open && <p className="text-[14px] text-warm-prose">{waitingFix ? `${plural(waitingFix, 'needs', 'need')} fixing.` : 'All of them have been sent again.'}</p>}
        </div>
        <button type="button" className={btn('card')} aria-expanded={open} aria-controls="back-list" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'See why'}</button>
      </div>
      {open && (
        <>
          <ul id="back-list" className="mt-3 flex flex-col gap-2">
            {shown.map((a) => (
              <li key={a.id} className={cn('flex flex-col gap-1 rounded-2xl bg-card p-4 text-[14px]', pointAt.has(a.id) && 'ring-2 ring-brand')}>
                <p className="text-[12px] text-warm-meta">
                  {[a.chapter_no !== null && `Chapter ${a.chapter_no}`, a.chapter].filter(Boolean).join(': ')}{a.topic && ` · ${a.topic}`}
                  {fresh.has(a.id) && <span className="ml-2 rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-bold text-foreground">New</span>}
                </p>
                <p className="text-foreground">{a.question}</p>
                <p className="font-semibold text-foreground">{a.answer}</p>
                <p className="rounded-xl bg-brand-subtle px-3 py-2 text-foreground"><b>Why:</b> {a.note}</p>
                <p className="text-[12px] text-warm-meta">
                  Sent back by {a.reviewer}{a.reviewedAt && `, ${day(a.reviewedAt)}`}.
                  {a.now && (a.now === 'approved' ? ' Since sent again, and approved.' : ' Since sent again, and waiting for an HoD.')}
                </p>
                {!a.now && <button type="button" className={chip('dark', 'mt-1 w-fit')} onClick={() => onFix(a)}>Fix it in the box</button>}
              </li>
            ))}
          </ul>
          {list.length > shown.length && (
            <button type="button" className={btn('card', 'mt-3')} onClick={() => setShowing((n) => n + SENT_BACK_PAGE)}>
              Show {Math.min(SENT_BACK_PAGE, list.length - shown.length)} more ({list.length - shown.length} left)
            </button>
          )}
        </>
      )}
    </section>
  );
}
