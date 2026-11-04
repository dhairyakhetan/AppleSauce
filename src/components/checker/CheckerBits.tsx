import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { MathText } from '@/components/papers/math-text';
import { OptionList } from '@/components/checker/OptionList';
import { cn } from '@/lib/utils';
import type { CheckerApi } from '@/lib/checker-api';
import { describeLanes, NOT_FOR_STUDENT_LINE } from '@/lib/checker-lanes';
import type { WholeQuestionRow } from '@/lib/checker-context';
import { canSplitAt, splitOrPlan, SPLIT_OR_NOTE } from '@/lib/checker-body';
import { CHIP } from '@/lib/checker-button-styles';

/* Small pieces the verify screen and the page around it share: a signed
   picture link, the "how to check" guidance, the dialog shell, the whole-question
   view and the chip button. Moved out of pages/Checker.tsx unchanged. */

/**
 * A short-lived signed URL for one object, re-asked whenever `key` changes.
 * undefined = still looking (or nothing to look for yet), null = no object or
 * it failed. One per picture: the crop and the page load side by side.
 */
export function useSignedUrl(api: CheckerApi, key: string, path: string): string | null | undefined {
  const [state, setState] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    if (!path) {
      setState({ key, url: null });
      return;
    }
    let cancelled = false;
    // A rejection takes the same road as "no picture", not a skeleton forever.
    api
      .pictureUrl(path)
      .catch(() => null)
      .then((url) => {
        if (!cancelled) setState({ key, url });
      });
    return () => {
      cancelled = true;
    };
    // `path` is part of `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, api]);
  if (!key || !state || state.key !== key) return undefined;
  return state.url;
}

/**
 * Signed links for several pictures at once (one per part of a whole question).
 * `key` names the set; an empty key asks for nothing. Each id is undefined while
 * its link is on the way, then a URL, or null when it is missing or failed.
 */
export function useSignedUrls(api: CheckerApi, key: string, paths: Record<string, string>): Record<string, string | null | undefined> {
  const [state, setState] = useState<{ key: string; urls: Record<string, string | null> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    for (const [id, path] of Object.entries(paths)) {
      api
        .pictureUrl(path)
        .catch(() => null)
        .then((url) => {
          if (cancelled) return;
          setState((prev) => ({ key, urls: { ...(prev && prev.key === key ? prev.urls : {}), [id]: url } }));
        });
    }
    return () => {
      cancelled = true;
    };
    // `paths` is part of `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, api]);
  if (!key || !state || state.key !== key) return {};
  return state.urls;
}

const HIDE_TIPS_KEY = 'shikshaq.checker.hide-tips';

function readTipsHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDE_TIPS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeTipsHidden(hidden: boolean) {
  try {
    if (hidden) window.localStorage.setItem(HIDE_TIPS_KEY, '1');
    else window.localStorage.removeItem(HIDE_TIPS_KEY);
  } catch {
    /* private mode or blocked storage: the choice just lasts this visit */
  }
}

/**
 * "How to check": quiet guidance, deliberately NOT a card. The comparison
 * (the stored question against the printed page) is what the checker is
 * here for; this only says how to go about it. So it has no fill and no
 * border, a small muted label with an info icon, and body-small secondary
 * text. One block per lane the question is in (checker-lanes.ts); lanes a
 * student is asked to settle come first, lanes that ask nothing of a student
 * are one muted line. A flag with no lane still shows its fallback sentence.
 * `line` is the older picture-aware single sentence, used when there is no
 * picture to read lanes against. A checker who knows the routine can hide it
 * (remembered on this device, default shown).
 */
export function CheckGuidance({
  summary,
  line,
  detail,
  className,
}: {
  summary?: ReturnType<typeof describeLanes> | null;
  line?: string | null;
  detail?: string | null;
  /** Replaces the default bottom margin. */
  className?: string;
}) {
  const [hidden, setHidden] = useState(readTipsHidden);
  const asked = summary ? summary.blocks.filter((b) => b.asked) : [];
  const quiet = summary ? summary.blocks.filter((b) => !b.asked) : [];
  const unmapped = summary ? summary.unmapped : [];
  const note = summary ? summary.note : null;
  const hasLine = Boolean(line);
  if (asked.length === 0 && unmapped.length === 0 && quiet.length === 0 && !hasLine) return null;
  // One lane and nothing else: the lane's name rides in the label line.
  const soloLane = asked.length === 1 && unmapped.length === 0 && !hasLine ? asked[0] : null;
  const toggle = () => {
    setHidden(!hidden);
    writeTipsHidden(!hidden);
  };
  return (
    <section aria-label="How to check" className={className ?? 'mb-4'} data-testid="check-guidance">
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-warm-meta">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{soloLane ? `How to check: ${soloLane.title}` : 'How to check'}</span>
        </p>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!hidden}
          className="tap-44 shrink-0 rounded-full px-2 py-1 text-[13px] font-medium text-warm-secondary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {hidden ? 'Show tips' : 'Hide tips'}
        </button>
      </div>
      {hidden ? null : (
        <div className="mt-1 flex flex-col gap-2">
          {hasLine ? (
            <div>
              <p className="text-[13px] leading-snug text-warm-secondary">{line}</p>
              {detail ? <p className="mt-0.5 text-[12px] text-warm-meta">What the computer noticed: {detail}</p> : null}
            </div>
          ) : null}
          {asked.map((b) => (
            <div key={b.lane.id} data-lane={b.lane.id}>
              {soloLane ? null : <p className="text-[13px] font-semibold leading-snug text-warm-secondary">{b.title}</p>}
              <p className="text-[13px] leading-snug text-warm-secondary">{b.text}</p>
              {b.detail ? <p className="mt-0.5 text-[12px] text-warm-meta">What the computer noticed: {b.detail}</p> : null}
            </div>
          ))}
          {unmapped.map((u) => (
            <p key={u.code} className="text-[13px] leading-snug text-warm-secondary">
              {u.sentence}
            </p>
          ))}
          {quiet.length > 0 ? (
            <p className="text-[12px] leading-snug text-warm-meta">
              {NOT_FOR_STUDENT_LINE}
            </p>
          ) : null}
          {note ? <p className="text-[12px] text-warm-meta">What the computer noticed: {note}</p> : null}
        </div>
      )}
    </section>
  );
}

/* Shaped like what it replaces: a picture box and a question box. */
export function CheckerSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Loading the next question" role="status">
      <div className="h-48 animate-pulse rounded-2xl bg-muted lg:h-72" />
      <div className="flex flex-col gap-3">
        <div className="h-16 animate-pulse rounded-2xl bg-muted" />
        <div className="h-32 animate-pulse rounded-2xl bg-muted" />
      </div>
    </div>
  );
}

export function Callout({ tone, title, children }: { tone: 'warn'; title: string; children: React.ReactNode }) {
  return (
    <div role="note" className={cn('mb-3 rounded-[10px] p-3', tone === 'warn' && 'bg-destructive/10')}>
      <p className="text-[14px] font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-[13px] leading-snug text-warm-secondary">{children}</p>
    </div>
  );
}

/* What the two halves will be, before the checker commits to a split. */
export function SplitPreview({ body, at }: { body: string; at: number | null }) {
  if (at === null) {
    return <p className="mt-2 text-[13px] text-warm-meta">Nothing chosen yet.</p>;
  }
  if (!canSplitAt(body, at)) {
    return (
      <p className="mt-2 text-[13px] text-destructive">
        Tap inside the words, between the two questions. Both parts need some words.
      </p>
    );
  }
  const { first, second, orSeparator } = splitOrPlan(body, at);
  const tail = Array.from(first.trimEnd()).slice(-60).join('');
  const head = Array.from(second.trimStart()).slice(0, 60).join('');
  return (
    <>
      <div className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2">
        <div className="rounded-xl bg-muted p-2">
          <p className="font-semibold text-foreground">First question ends with</p>
          <p className="break-words text-warm-secondary">...{tail}</p>
        </div>
        <div className="rounded-xl bg-muted p-2">
          <p className="font-semibold text-foreground">Second question starts with</p>
          <p className="break-words text-warm-secondary">{head}...</p>
        </div>
      </div>
      {orSeparator ? (
        <p className="mt-2 text-[13px] leading-snug text-warm-secondary" data-testid="split-or-note">
          {SPLIT_OR_NOTE}
        </p>
      ) : null}
    </>
  );
}

/* A dialog: Escape and the backdrop close it, focus goes inside, Tab stays
   inside, and focus goes back to the button that opened it when it closes. */
export function Modal({
  onClose,
  labelledBy,
  children,
}: {
  onClose: () => void;
  labelledBy: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Read during the first render, before an autoFocus inside the dialog can
  // move focus: this is the button that opened it. Restored once, on close.
  const openerRef = useRef<HTMLElement | null>(null);
  if (openerRef.current === null && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    openerRef.current = document.activeElement;
  }
  useEffect(() => {
    const opener = openerRef.current;
    return () => {
      if (opener && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const focusable = Array.from(el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!active || !el.contains(active) || active === el) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-card p-5 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/* W11: the whole question a part belongs to. The owner (12 Oct 2026): "you should
   be showing me the entire paper question in the left pane, not just the
   sub-part". So the verify screen lays the question out from its stem down, every
   part in order and all visible; the part being checked is the one editable card
   among them (PartCard), and every other row is this: read-only and calm, with no
   box of its own, just a thin rule at its left, so the eye goes to the checked
   part. Bodies are shown as stored, through MathText. */
export function ContextPart({
  row,
  focused = false,
  onFocus,
}: {
  row: WholeQuestionRow;
  /** The highlight pair is on this row (a view aid only). */
  focused?: boolean;
  /** Tapping the row moves the highlight pair here. Never changes which question is checked. */
  onFocus?: () => void;
}) {
  // The printed label, unless the body already starts with it ("(a)" over "(a) Name the...").
  const showLabel = row.label !== '' && !(row.body ?? '').trimStart().startsWith(row.label);
  const tappable = Boolean(onFocus);
  return (
    <div
      data-testid={row.isParent ? 'context-stem' : 'context-part'}
      data-part-id={row.id}
      data-focused={focused ? 'true' : undefined}
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      aria-pressed={tappable ? focused : undefined}
      aria-label={tappable ? (row.isParent ? 'Show the picture of the question' : `Show the picture of ${row.label || 'this part'}`) : undefined}
      onClick={onFocus}
      onKeyDown={
        onFocus
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onFocus();
              }
            }
          : undefined
      }
      className={cn(
        'mb-3 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        row.isParent ? 'rounded-[6px]' : 'rounded-r-[6px] border-l-2 pl-3',
        row.isParent ? '' : focused ? 'border-brand' : 'border-warm-hairline',
        focused && 'bg-brand-subtle py-1 pr-2',
        row.isParent && focused && 'px-2',
        tappable && 'cursor-pointer',
      )}
      style={row.isParent ? undefined : { marginLeft: Math.min(Math.max(row.depth - 1, 0), 3) * 12 }}
    >
      {showLabel ? <p className="mb-0.5 text-[12px] font-semibold text-warm-meta">{row.label}</p> : null}
      <MathText text={row.body ?? ''} className={cn('break-words leading-relaxed', row.isParent ? 'text-[16px] text-foreground' : 'text-[15px] text-warm-secondary')} />
      <OptionList options={row.options} />
    </div>
  );
}

export function Chip({
  onClick,
  pressed,
  tone,
  children,
}: {
  onClick: () => void;
  pressed?: boolean;
  tone: 'brand' | 'muted';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(CHIP, tone === 'brand' ? 'bg-brand-subtle text-foreground' : 'bg-muted text-warm-secondary')}
    >
      {children}
    </button>
  );
}

