import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Row } from '@/lib/games/rows';
import { EASE_SETTLE, GAME_NAMES, LINKISH, lessMotion, lineKind, type LineKind } from './helpers';

/* What the games pages share on screen: the grouped table of rows, loading, failure and empty states, and the icon that
   becomes a check mark. The plain helpers (button looks, dates, saving a file, "Undo") are in helpers.ts. */

/** An icon that turns into a check mark for a moment after the action worked, without changing the button's size. */
export function ActionIcon({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <span className="relative inline-grid size-4 place-items-center" aria-hidden>
      <span className={cn('col-start-1 row-start-1 transition-opacity duration-150', done && 'opacity-0')}>{children}</span>
      <span className={cn('col-start-1 row-start-1 transition-opacity duration-150', !done && 'opacity-0')}><Check /></span>
    </span>
  );
}

/** The rows as they will be stored, grouped under a heading for each chapter and topic. */
export function RowsTable<R extends Row>({ rows, keyOf = (_r, i) => i, extra, rowClass, games, problem, doubts, doubtsLabel = 'Please check', onClearDoubts, oneChapter = false }: {
  rows: R[];
  /** A stable key per row, so rows that leave or arrive don't disturb the others. */
  keyOf?: (r: R, i: number) => string | number;
  /** Buttons or a note shown under a row (the HoD desk). */
  extra?: (r: R) => ReactNode;
  rowClass?: (r: R) => string;
  /** The games a row can go in (Write questions): the ones it is left out of show under it. */
  games?: (r: R, i: number) => string[];
  /** A row that needs fixing: marked red (or amber), and not sent. */
  problem?: (r: R, i: number) => 'error' | 'warn' | undefined;
  /** Things the page can't be sure are wrong, for the HoD to decide (`doubts` in format.ts), and what to call them. */
  doubts?: (r: R) => string[];
  doubtsLabel?: string;
  /** A cross on the notes that hides them (the HoD desk: until the page is opened again). */
  onClearDoubts?: (r: R) => void;
  /** The rows are one chapter, already named above them (Approve questions' chapter rows): no chapter heading. */
  oneChapter?: boolean;
}) {
  // rows rise in as they are added: on the first render one after another, briefly; later only a new row
  const first = useRef(true);
  useEffect(() => { first.current = false; }, []);
  const delay = (n: number): CSSProperties | undefined => (first.current ? { animationDelay: `${Math.min(n, 6) * 40}ms` } : undefined);
  let shown = 0;
  const out: ReactNode[] = [];
  let chapter = '';
  let topic = '';
  rows.forEach((r, i) => {
    const ch = [r.chapter_id, r.board, r.class, r.subject, r.chapter_no, r.chapter].join('\u0000');
    if (ch !== chapter || i === 0) {
      chapter = ch;
      topic = '';
      if (oneChapter) { /* named above */ } else {
      const title = r.chapter || r.chapter_no !== null ? [r.chapter_no !== null && `Chapter ${r.chapter_no}`, r.chapter].filter(Boolean).join(': ') : 'No chapter';
      const meta = [r.board, r.class && `Class ${r.class}`, r.subject].filter(Boolean).join(' · ');
      out.push(
        <div className="animate-fade-slide-up flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-3 first:pt-0" style={delay(shown++)} key={`c${i}`}>
          <span className="text-[15px] font-bold text-foreground">{title}</span>
          {meta && <span className="text-[12px] text-warm-meta">{meta}</span>}
        </div>,
      );
      }
    }
    const tp = `${r.topic_no}\u0000${r.topic}`;
    if (tp !== topic) {
      topic = tp;
      const has = r.topic || r.topic_no !== null;
      out.push(
        <div className="animate-fade-slide-up mt-1 border-b border-border pb-1 pt-2" style={delay(shown++)} key={`t${i}`}>
          <span className={cn('text-[12px] font-bold uppercase tracking-[0.06em]', has ? 'text-warm-secondary' : 'text-warm-label')}>
            {has ? [r.topic_no !== null && `Topic ${r.topic_no}`, r.topic].filter(Boolean).join(': ') : 'No topic'}
          </span>
        </div>,
      );
    }
    const bad = problem?.(r, i);
    const plays = games?.(r, i);
    // only what it is left out of: a line under every question naming all five games says nothing
    const notIn = plays && Object.values(GAME_NAMES).filter((g) => !plays.includes(g));
    const unsure = bad ? [] : doubts?.(r) ?? [];
    out.push(
      <div
        className={cn('animate-fade-slide-up grid grid-cols-[1.75rem_1fr] gap-x-2 gap-y-1 border-b border-border/70 py-2 transition-opacity duration-200 sm:grid-cols-[1.75rem_minmax(0,3fr)_minmax(0,2fr)_auto]',
          bad && 'border-l-4 pl-1', bad === 'error' && 'border-l-destructive', bad === 'warn' && 'border-l-brand', rowClass?.(r))}
        style={delay(shown++)}
        key={keyOf(r, i)}
        data-line={(r as { line?: number }).line}
      >
        <span className="pt-0.5 text-right text-[12px] tabular-nums text-warm-meta">{r.question_no}</span>
        <span className="min-w-0 break-words text-[14px] text-foreground">
          {r.question}
          {r.fill && <span className="block text-[12px] text-warm-meta">Fill: {r.fill}</span>}
        </span>
        <span className="col-start-2 min-w-0 break-words text-[14px] font-semibold text-foreground sm:col-start-auto">
          {r.answer}
          {r.also?.length > 0 && <span className="block text-[12px] font-normal text-warm-meta">Also: {r.also.join(' · ')}</span>}
          {r.wrong_options?.length > 0 && <span className="block text-[12px] font-normal text-warm-meta">Wrong: {r.wrong_options.join(' · ')}</span>}
        </span>
        {r.difficulty ? (
          <span className={cn('col-start-2 h-fit w-fit self-start rounded-full px-2 py-0.5 text-[11px] font-semibold sm:col-start-auto',
            r.difficulty === 'easy' ? 'bg-success-subtle-bg text-success-subtle-text' : r.difficulty === 'medium' ? 'bg-brand-subtle text-brand-deep' : 'bg-brand-blue-subtle text-brand-blue-deep')}>
            {r.difficulty}
          </span>
        ) : <span className="hidden sm:block" />}
        {(bad || (notIn && notIn.length > 0)) && (
          <p className="col-span-full pl-9 text-[12px] text-warm-meta sm:col-start-2">
            {bad ? <span className={bad === 'error' ? 'font-semibold text-destructive' : 'font-semibold text-brand-deep'}>Needs fixing: not sent as it is</span>
              : plays!.length ? <>Not in: {notIn!.join(' · ')}</> : 'Plays in no game'}
          </p>
        )}
        {unsure.length > 0 && (
          <div className="col-span-full ml-9 flex items-start gap-1 rounded-lg bg-brand-blue-subtle py-1 pl-2 pr-1 text-[12px] text-brand-blue-deep sm:col-start-2 sm:ml-0">
            {unsure.length === 1
              ? <p className="min-w-0 flex-1 py-0.5"><b>{doubtsLabel}:</b> {unsure[0]}</p>
              : (
                <div className="min-w-0 flex-1 space-y-1 py-0.5">
                  <p><b>{doubtsLabel}:</b></p>
                  {unsure.map((u, i) => <p key={i} className="flex gap-1.5"><span aria-hidden>{i + 1}.</span><span>{u}</span></p>)}
                </div>
              )}
            {onClearDoubts && (
              <button type="button" aria-label={`Clear: ${doubtsLabel.toLowerCase()}`} title="Clear this note (it comes back when the page is opened again)"
                onClick={() => onClearDoubts(r)}
                className="tap-44 flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
        )}
        {extra && <div className="col-span-full pl-9 sm:col-start-2">{extra(r)}</div>}
      </div>,
    );
  });
  return <div>{out}</div>;
}

/** The page's loading block: the shape of a list, not a spinner. */
export function Loading({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />)}
    </div>
  );
}

/** Something didn't load: say so plainly, with a way to try again. */
export function LoadFailed({ what, error, onRetry }: { what: string; error: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl bg-destructive/10 px-4 py-4 text-[14px] text-foreground">
      <p><b>{what} did not load.</b> {error}</p>
      <button type="button" onClick={onRetry} className={cn(LINKISH, 'mt-1')}>Try again</button>
    </div>
  );
}

/** A plain note for "nothing here yet". */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-muted px-4 py-8 text-center text-[14px] text-warm-secondary">{children}</div>;
}

/** A line's label ("Q:", "Chapter 4:") and the rest, the label a little lighter, as the Questions box shows it. */
export function Labelled({ body, kind }: { body: string; kind: LineKind | null }) {
  const label = kind ? body.match(/^[^:]{1,24}:/)?.[0] ?? '' : '';
  return <>{label && <span className="gl-label">{label}</span>}{body.slice(label.length)}</>;
}

/** Lines of the question format in the Questions box's colours (the guide's example, labels in its text). */
export function Coloured({ text }: { text: string }) {
  return <>{text.split('\n').map((l, i) => {
    const kind = lineKind(l);
    return <span key={i} className={kind ? `gl-${kind}` : undefined}>{i > 0 && '\n'}<Labelled body={l} kind={kind} /></span>;
  })}</>;
}

/**
 * Content that changes in place (a popup's steps): the box eases to the new content's height, and the new content (a
 * new `step`) rises in. Rings on its edges stay visible (a little padding inside the clip).
 */
export function Morph({ step, children, className }: { step: string; children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className={cn('games-morph -m-1 overflow-hidden p-1', className)} style={height === null ? undefined : { height: height + 8 }}>
      <div ref={inner}>
        <div key={step} className="games-morph-in">{children}</div>
      </div>
    </div>
  );
}

/**
 * The highlight behind the chosen tab of a row of tabs: it glides from the last one to `active` (the tab with
 * `data-pill={active}`). It goes inside the row, which is `relative`; the tabs sit above it (`relative z-[1]`) with no
 * background of their own when chosen. It follows the row as it wraps or resizes, and doesn't slide in on the first
 * showing. (It finds the row as its own parent, so it is right from the first showing.)
 */
export function SlidingPill({ active, className }: { active: string; className?: string }) {
  const self = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const r = self.current?.parentElement;
    if (!r) return;
    const place = () => {
      const el = r.querySelector<HTMLElement>(`[data-pill="${active}"]`);
      setBox(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null);
    };
    place();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(r);
    for (const c of r.children) ro.observe(c);
    return () => ro.disconnect();
  }, [active]);
  useEffect(() => { if (box) placed.current = true; }, [box]);
  return (
    <span ref={self} aria-hidden className={cn('pointer-events-none absolute left-0 top-0 rounded-full', placed.current && 'games-pill', !box && 'invisible', className)}
      style={box ? { transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h } : undefined} />
  );
}

/**
 * A part that opens and closes in place (a list, a reason box): it grows to its height as it opens and shrinks away as
 * it closes, starting from wherever it is, so a second click mid-way turns it around without a jump. Not on the first
 * showing, and at once with reduced motion.
 */
export function Reveal({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  // on the page while open, and while closing (until it has shrunk away)
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  const ref = useRef<HTMLDivElement>(null);
  const was = useRef(open);
  const moving = useRef(false);
  useLayoutEffect(() => {
    const before = was.current;
    was.current = open;
    if (before === open) return; // the first showing, or nothing changed
    const el = ref.current;
    if (!el) return;
    if (lessMotion() || typeof el.animate !== 'function') { if (!open) setPresent(false); return; }
    // from where it is now: its height mid-way through the last move, its full height if open, nothing if just put back
    const from = moving.current || before ? el.getBoundingClientRect().height : 0;
    for (const a of el.getAnimations()) a.cancel();
    const to = open ? el.scrollHeight : 0;
    el.style.overflow = 'hidden';
    moving.current = true;
    const a = el.animate([{ height: `${from}px`, opacity: open && !from ? 0 : 1 }, { height: `${to}px`, opacity: open ? 1 : 0 }],
      { duration: open ? 280 : 220, easing: EASE_SETTLE, fill: open ? 'none' : 'forwards', id: 'reveal' });
    a.onfinish = () => { moving.current = false; el.style.overflow = ''; if (!open) setPresent(false); };
  }, [open]);
  // flow-root: the margins inside it stay inside it, while it moves and after, so its height is the same either way and
  // nothing shifts when it settles
  return present ? <div ref={ref} className={cn('flow-root', className)}>{children}</div> : null;
}
