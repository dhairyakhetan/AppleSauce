import { useCallback, useEffect, useState } from 'react';
import { REASON_MAX, reasonCounter, reasonProblem, UNDO_SECONDS } from '@/lib/hod-send-to-ai';
import { cn } from '@/lib/utils';

/* The small pieces the three new HOD buttons share (27 Nov 2026): a reason box that is required, length-limited and
   shows a counter, and the short Undo line after a send. */

/** A required reason: the box, a hint when it is too short, and "12 / 500" under it. The text is kept as typed. */
export function ReasonBox({
  id,
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  // Say what is missing only once something has been typed: an empty box is already marked "required" in the label.
  const problem = value.trim().length > 0 ? reasonProblem(value) : null;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-semibold text-foreground">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        rows={3}
        maxLength={REASON_MAX}
        disabled={disabled}
        placeholder={placeholder}
        required
        aria-describedby={`${id}-counter`}
        className="w-full rounded-xl bg-card p-3 text-[16px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
      <div className="flex items-start justify-between gap-3 text-[12px]">
        <span className={cn(problem ? 'text-destructive' : 'text-warm-meta')} data-testid="reason-hint">
          {problem ?? 'Required.'}
        </span>
        <span id={`${id}-counter`} className="shrink-0 tabular-nums text-warm-meta" data-testid="reason-counter">
          {reasonCounter(value)}
        </span>
      </div>
    </div>
  );
}

/** Counts down from `seconds` after `start()`; `left` is 0 when there is nothing to undo any more. */
export function useUndoWindow(seconds: number = UNDO_SECONDS) {
  const [until, setUntil] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (until === null) {
      setLeft(0);
      return;
    }
    const tick = () => {
      const remaining = Math.ceil((until - Date.now()) / 1000);
      if (remaining <= 0) {
        setUntil(null);
        setLeft(0);
      } else {
        setLeft(remaining);
      }
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [until]);
  const start = useCallback(() => setUntil(Date.now() + seconds * 1000), [seconds]);
  const stop = useCallback(() => setUntil(null), []);
  return { left, start, stop };
}

/** "Sent to the AI. Undo (8s)": the few seconds in which a send can be taken back for real. */
export function UndoStrip({ text, left, busy, onUndo }: { text: string; left: number; busy: boolean; onUndo: () => void }) {
  return (
    <div
      role="status"
      data-testid="undo-strip"
      className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[18px] bg-mint px-4 py-3"
    >
      <p className="min-w-0 text-[14px] font-semibold text-foreground">{text}</p>
      <button
        type="button"
        data-testid="undo-send"
        className="tap-44 rounded-full bg-card px-4 py-2 text-[14px] font-bold tabular-nums text-foreground transition-transform duration-150 active:scale-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-disabled"
        disabled={busy}
        onClick={onUndo}
      >
        {busy ? 'Taking it back...' : `Undo (${left}s)`}
      </button>
    </div>
  );
}
