import * as React from 'react';
import { ChevronDown, Pencil, Scissors, Sigma, SeparatorHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MARKS_INSIDE_HINT, MARKS_MOVE_BUTTON, findMarksInBody } from '@/lib/checker-body';
import {
  CHANGES_HEADING,
  CHANGES_NONE_WRITTEN,
  CHANGES_NOTE,
  RAW_HEADING,
  RAW_HIDE,
  RAW_NOTE,
  RAW_SHOW,
  describeEditLog,
  hasChangesToShow,
  rawReading,
} from '@/lib/checker-edit-log';
import { CHECKER_TOOLS, TOOLS_HEADING, TOOLS_IDLE_HINT, TOOLS_LEAD, type CheckerToolId } from '@/lib/checker-tools';
import { CHECKER_HELP_PATH } from '@/lib/checker-onboarding';

/* The small pieces under and above the typed words: the question and marks
   chips, the "marks are inside the text" hint, the tools row and the
   "What the computer changed" section.

   Pure presentation with no data access: the practice round uses them too. */

const INPUT =
  'min-h-[44px] rounded-[12px] bg-muted px-3 py-1 text-center text-[16px] font-semibold tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand';

/** Question number and marks, as chips. In Fix mode they turn into boxes. */
export function QuestionChips({
  number,
  marks,
  editing,
  numberDraft,
  marksDraft,
  onNumber,
  onMarks,
  marksInvalid,
  disabled,
}: {
  number: string | null;
  marks: number | null;
  editing: boolean;
  numberDraft: string;
  marksDraft: string;
  onNumber: (v: string) => void;
  onMarks: (v: string) => void;
  marksInvalid: boolean;
  disabled?: boolean;
}) {
  if (editing) {
    return (
      <div className="mb-3 flex flex-wrap items-end gap-3" data-testid="question-chips">
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-warm-secondary">
          Question number
          <input
            value={numberDraft}
            onChange={(e) => onNumber(e.target.value)}
            disabled={disabled}
            placeholder="e.g. 5"
            className={cn(INPUT, 'w-28')}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-warm-secondary">
          Marks
          <input
            inputMode="decimal"
            value={marksDraft}
            onChange={(e) => onMarks(e.target.value)}
            disabled={disabled}
            placeholder="e.g. 2"
            aria-invalid={marksInvalid || undefined}
            className={cn(INPUT, 'w-24', marksInvalid && 'ring-2 ring-destructive')}
          />
        </label>
      </div>
    );
  }
  const chip = 'inline-flex min-h-[32px] items-center rounded-full px-3.5 py-1 text-[14px] font-bold tabular-nums';
  return (
    <ul className="mb-3 flex flex-wrap gap-2" aria-label="Question number and marks" data-testid="question-chips">
      <li className={cn(chip, number ? 'bg-panel text-background' : 'border border-dashed border-warm-hairline-strong text-warm-meta')}>
        {number ? `Question ${number}` : 'No question number'}
      </li>
      <li className={cn(chip, marks != null ? 'bg-brand text-foreground' : 'border border-dashed border-warm-hairline-strong text-warm-meta')}>
        {marks != null ? `${marks} ${marks === 1 ? 'mark' : 'marks'}` : 'No marks'}
      </li>
    </ul>
  );
}

/** "The marks are inside the text": shown whenever the body still carries a
 *  marks token. The button is the same in both modes; from the check screen it
 *  also opens Fix it, so one tap does the whole job. */
export function MarksInsideHint({
  body,
  currentMarks,
  onMove,
  disabled,
}: {
  body: string;
  /** What the Marks box holds now. */
  currentMarks: string;
  onMove: () => void;
  disabled?: boolean;
}) {
  const found = findMarksInBody(body);
  if (!found) return null;
  const differs = currentMarks.trim() !== '' && Number(currentMarks) !== found.marks;
  return (
    <div role="note" data-testid="marks-inside-hint" className="mb-3 rounded-[12px] bg-brand-subtle p-3">
      <p className="text-[14px] font-semibold leading-snug text-foreground">{MARKS_INSIDE_HINT}</p>
      <p className="mt-0.5 text-[13px] leading-snug text-warm-secondary">
        It says <code className="rounded-[6px] bg-white px-1.5 py-0.5 font-mono text-[13px] text-foreground">{found.token}</code>, so the Marks box should say{' '}
        <span className="font-semibold tabular-nums text-foreground">{found.marks}</span>.
        {differs ? ` The box says ${currentMarks.trim()} now.` : ''}
      </p>
      <button
        type="button"
        onClick={onMove}
        disabled={disabled}
        data-testid="move-marks-out"
        className="tap-44 mt-2 rounded-full bg-brand px-4 py-2 text-[14px] font-bold text-foreground transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {MARKS_MOVE_BUTTON}
      </button>
    </div>
  );
}

const TOOL_ICON: Record<CheckerToolId, React.ReactNode> = {
  fix: <Pencil className="h-4 w-4 shrink-0" aria-hidden="true" />,
  split: <Scissors className="h-4 w-4 shrink-0" aria-hidden="true" />,
  formula: <Sigma className="h-4 w-4 shrink-0" aria-hidden="true" />,
  or: <SeparatorHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />,
};

/**
 * The tools, always visible and labelled in words. Each has a one-line
 * explanation on hover and keyboard focus (and as a tooltip). A tool that does
 * not apply to this question is dimmed but still answers a tap with the reason,
 * instead of a button that silently does nothing.
 */
export function ToolsRow({
  active,
  available,
  onPick,
  busy,
  helpLink = true,
}: {
  /** The tool whose mode is open, if any. */
  active: CheckerToolId | null;
  available: Record<CheckerToolId, boolean>;
  onPick: (id: CheckerToolId, available: boolean) => void;
  busy?: boolean;
  helpLink?: boolean;
}) {
  const [hint, setHint] = React.useState<CheckerToolId | null>(null);
  const shown = hint ? CHECKER_TOOLS.find((t) => t.id === hint) : null;
  return (
    <section aria-label={TOOLS_HEADING} data-tour="tools" data-testid="tools-row" className="mt-4 border-t border-warm-hairline pt-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-[13px] font-bold text-foreground">
          {TOOLS_HEADING} <span className="font-medium text-warm-secondary">{TOOLS_LEAD}</span>
        </p>
        {helpLink ? (
          <a
            href={`${CHECKER_HELP_PATH}#tools`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] font-medium text-warm-secondary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            What do these do?
          </a>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {CHECKER_TOOLS.map((t) => {
          const ok = available[t.id];
          const on = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              data-testid={`tool-${t.id}`}
              aria-pressed={on}
              aria-disabled={!ok || undefined}
              aria-describedby="tool-hint"
              title={ok ? t.hint : t.unavailable}
              disabled={busy}
              onClick={() => onPick(t.id, ok)}
              onMouseEnter={() => setHint(t.id)}
              onMouseLeave={() => setHint((h) => (h === t.id ? null : h))}
              onFocus={() => setHint(t.id)}
              onBlur={() => setHint((h) => (h === t.id ? null : h))}
              className={cn(
                'tap-44 inline-flex min-h-[44px] items-center justify-start gap-2 rounded-full border px-4 py-2 text-left text-[14px] font-semibold leading-tight transition-[transform,background-color,color] duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
                on ? 'border-transparent bg-panel text-background' : 'border-warm-hairline-strong bg-white text-foreground hover:bg-muted',
                !ok && 'opacity-55',
                busy && 'cursor-not-allowed opacity-50',
              )}
            >
              {TOOL_ICON[t.id]}
              {t.label}
            </button>
          );
        })}
      </div>
      <p id="tool-hint" role="status" className="mt-2 min-h-[2.5rem] text-pretty text-[13px] leading-snug text-warm-secondary">
        {shown ? (available[shown.id] ? shown.hint : shown.unavailable) : TOOLS_IDLE_HINT}
      </p>
    </section>
  );
}

/**
 * "What the computer changed": under the typed words, closed to begin with.
 * Lists the computer's own edits in plain language and can show its very first
 * reading of the question. Rows from before the pipeline kept these show
 * nothing at all.
 */
export function ChangesSection({ source, rawOcr }: { source: unknown; rawOcr: unknown }) {
  const [open, setOpen] = React.useState(false);
  const [showRaw, setShowRaw] = React.useState(false);
  if (!hasChangesToShow(source, rawOcr)) return null;
  const { lines, hidden, total } = describeEditLog(source);
  const raw = rawReading(rawOcr);
  return (
    <section data-tour="changes" data-testid="what-changed" className="mt-4 rounded-[12px] bg-muted">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="what-changed-body"
        className="tap-44 flex min-h-[44px] w-full items-center justify-between gap-2 rounded-[12px] px-3.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <span className="text-[14px] font-bold text-foreground">
          {CHANGES_HEADING}
          {total > 0 ? <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-[12px] font-semibold tabular-nums text-warm-secondary">{total}</span> : null}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-warm-secondary transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open ? (
        <div id="what-changed-body" className="px-3.5 pb-3.5">
          <p className="mb-2 text-pretty text-[13px] leading-snug text-warm-secondary">{CHANGES_NOTE}</p>
          {lines.length > 0 ? (
            <ul className="flex flex-col gap-1.5" aria-label={CHANGES_HEADING}>
              {lines.map((l, i) => (
                <li key={`${l.kind}-${i}`} className="flex gap-2 text-[14px] leading-snug text-foreground">
                  <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-brand" />
                  <span className="min-w-0 break-words">
                    {l.from !== null ? (
                      <>
                        {l.label}: <Word>{l.from}</Word>
                        {l.to !== null ? (
                          <>
                            {' '}
                            became <Word>{l.to}</Word>
                          </>
                        ) : null}
                      </>
                    ) : (
                      l.text
                    )}
                  </span>
                </li>
              ))}
              {hidden > 0 ? <li className="text-[13px] text-warm-secondary">and {hidden} more</li> : null}
            </ul>
          ) : (
            <p className="text-[14px] text-warm-secondary">{CHANGES_NONE_WRITTEN}</p>
          )}
          {raw !== null ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                aria-expanded={showRaw}
                data-testid="toggle-raw"
                className="tap-44 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-foreground transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {showRaw ? RAW_HIDE : RAW_SHOW}
              </button>
              {showRaw ? (
                <div className="mt-2 rounded-[10px] border border-dashed border-warm-hairline-strong bg-white p-3" data-testid="raw-reading">
                  <p className="text-[12px] font-bold text-foreground">{RAW_HEADING}</p>
                  <p className="mb-1.5 text-[12px] text-warm-secondary">{RAW_NOTE}</p>
                  <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-foreground">{raw}</pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Word({ children }: { children: React.ReactNode }) {
  return <span className="rounded-[6px] bg-white px-1.5 py-0.5 font-mono text-[13px] font-semibold text-foreground">{children}</span>;
}
