import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { segmentBody, reassemble, type BodySegment } from '@/lib/math-segments';
import { MathPreview } from './MathPreview';

/* Step 2 Checker, "Fix it": the owner's ask --
 *   "Edit the maths visually: tap the maths and edit it the way it looks,
 *    like a calculator, with buttons for fraction, power and root. No code
 *    on screen. Plain text stays a normal text box."
 *
 * A body is split into ordered text/maths segments (src/lib/math-segments.ts).
 * Each text segment is an auto-growing plain textbox; each maths segment is a
 * tappable "how it looks" preview that opens a small calculator-style editor
 * (MathFieldEditor.tsx, MathLive, lazy-loaded only on tap). "Show code"
 * reveals today's raw textarea for power users; switching back re-segments.
 *
 * D76: reassembling untouched segments is byte-identical to the original
 * body (see math-segments.test.ts). This component never rewrites a segment
 * it did not touch -- a text segment's own value changes only by the
 * checker's own typing, and a maths segment's `inner` changes only when
 * MathFieldEditor reports back a real edit (never on open-and-close). */

const MathFieldEditor = lazy(() => import('./MathFieldEditor'));

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  textareaClassName?: string;
  /** The "Edit a formula" tool was pressed. A number that goes up with every
   *  press (0 = none waiting). The editor then opens the formula keypad for the
   *  words selected in the box, or for the formula the question already has,
   *  and tells the caller it has handled it. */
  formulaRequest?: number;
  onFormulaHandled?: (request: number) => void;
}

export const NO_FORMULA_NOTE =
  'There is no formula in this question yet. Select the part of the words that is a formula, then press Edit a formula again.';
export const PICK_FORMULA_NOTE = 'This question has more than one formula. Tap the one you want to change.';
export const BROKEN_DOLLAR_NOTE =
  'This question has a $ sign that never closes, so the formula keypad cannot open. Fix the $ sign first, or press Ask the HOD.';

function AutoTextarea({
  value,
  onChange,
  disabled,
  ariaLabel,
  className,
  onSelection,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  /** Where the selection is, for "Edit a formula" (start and end, UTF-16 offsets). */
  onSelection?: (start: number, end: number) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onSelect={onSelection ? (e) => onSelection(e.currentTarget.selectionStart, e.currentTarget.selectionEnd) : undefined}
      disabled={disabled}
      rows={1}
      aria-label={ariaLabel}
      className={cn(
        'w-full resize-none overflow-hidden rounded-2xl bg-muted p-3 text-[16px] leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-70',
        className,
      )}
    />
  );
}

export function BodyEditor({
  value,
  onChange,
  disabled,
  textareaClassName,
  formulaRequest = 0,
  onFormulaHandled,
}: BodyEditorProps) {
  const initial = useState(() => segmentBody(value))[0];
  const [segments, setSegments] = useState<BodySegment[]>(initial.segments);
  // "Show code" is forced on when the body could not be safely segmented
  // (unbalanced delimiter) -- there is nothing visual to show, and guessing
  // would risk the byte-exact guarantee this whole feature exists to keep.
  const [codeMode, setCodeMode] = useState(initial.fallback);
  const [codeText, setCodeText] = useState(value);
  const [fellBack, setFellBack] = useState(initial.fallback);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // "Edit a formula": the last selection in a text box, what to say when there is
  // no formula to open, and the text as it was before a selection was turned
  // into a formula (so Cancel puts it back exactly).
  const lastSelection = useRef<{ index: number; start: number; end: number } | null>(null);
  const [formulaNote, setFormulaNote] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [wrapUndo, setWrapUndo] = useState<BodySegment[] | null>(null);
  const handledRequest = useRef(0);

  function commitSegments(next: BodySegment[]) {
    setSegments(next);
    onChange(reassemble(next));
  }

  /** Turn the words between start and end of text segment `index` into a formula and open it. */
  function wrapSelection(segs: BodySegment[], index: number, start: number, end: number): boolean {
    const seg = segs[index];
    if (!seg || seg.kind !== 'text' || end > seg.value.length || end <= start) return false;
    const picked = seg.value.slice(start, end);
    const inner = picked.trim();
    if (!inner) return false;
    const lead = picked.length - picked.trimStart().length;
    const trail = picked.length - picked.trimEnd().length;
    const before = seg.value.slice(0, start + lead);
    const after = seg.value.slice(end - trail);
    const math: BodySegment = { kind: 'math', open: '$', close: '$', inner, display: false };
    const next: BodySegment[] = [
      ...segs.slice(0, index),
      ...(before ? [{ kind: 'text' as const, value: before }] : []),
      math,
      ...(after ? [{ kind: 'text' as const, value: after }] : []),
      ...segs.slice(index + 1),
    ];
    setWrapUndo(segs);
    commitSegments(next);
    setOpenIndex(index + (before ? 1 : 0));
    return true;
  }

  function useWholeTextAsFormula() {
    const whole = reassemble(segments);
    if (!whole.trim()) return;
    setWrapUndo(segments);
    setFormulaNote(null);
    commitSegments([{ kind: 'math', open: '$', close: '$', inner: whole.trim(), display: false }]);
    setOpenIndex(0);
  }

  function openFormula() {
    setFormulaNote(null);
    setPicking(false);
    let segs = segments;
    if (codeMode) {
      const result = segmentBody(codeText);
      if (result.fallback) {
        setFormulaNote(BROKEN_DOLLAR_NOTE);
        return;
      }
      segs = result.segments;
      setSegments(segs);
      setFellBack(false);
      setCodeMode(false);
      onChange(codeText);
    }
    const sel = lastSelection.current;
    if (sel && sel.end > sel.start && wrapSelection(segs, sel.index, sel.start, sel.end)) {
      lastSelection.current = null;
      return;
    }
    const maths = segs.flatMap((seg, i) => (seg.kind === 'math' ? [i] : []));
    if (maths.length === 1) {
      setOpenIndex(maths[0]);
    } else if (maths.length > 1) {
      setPicking(true);
    } else {
      setFormulaNote(NO_FORMULA_NOTE);
    }
  }

  // The "Edit a formula" tool. Each press has its own number, and each is
  // handled once (React may run an effect twice in development).
  useEffect(() => {
    if (!formulaRequest || handledRequest.current === formulaRequest) return;
    handledRequest.current = formulaRequest;
    onFormulaHandled?.(formulaRequest);
    openFormula();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formulaRequest]);

  function cancelFormula() {
    setOpenIndex(null);
    if (wrapUndo) {
      // The words were only just made into a formula: put them back exactly.
      setSegments(wrapUndo);
      onChange(reassemble(wrapUndo));
      setWrapUndo(null);
    }
  }

  function toggleCode() {
    if (!codeMode) {
      // Visual -> code: show exactly the current reassembled text.
      setCodeText(reassemble(segments));
      setCodeMode(true);
      return;
    }
    // Code -> visual: re-segment from whatever the checker typed as code.
    const result = segmentBody(codeText);
    setSegments(result.segments);
    setFellBack(result.fallback);
    onChange(codeText);
    if (!result.fallback) setCodeMode(false);
    // If it's still unbalanced, stay in code mode -- nothing safe to show.
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <button
          type="button"
          onClick={toggleCode}
          disabled={disabled || (codeMode && fellBack)}
          className="rounded-full bg-muted px-3 py-1 text-[12px] font-semibold text-warm-secondary transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
        >
          {codeMode ? 'Show as maths' : 'Show code'}
        </button>
      </div>

      {fellBack && codeMode ? (
        <p className="mb-2 text-[12px] text-warm-secondary">
          This question has a $ sign that never closes, so it is shown as plain text.
        </p>
      ) : null}

      {picking ? (
        <p role="status" className="mb-2 rounded-[12px] bg-brand-subtle px-3 py-2 text-[13px] font-semibold text-foreground">
          {PICK_FORMULA_NOTE}
        </p>
      ) : null}
      {formulaNote ? (
        <div role="status" data-testid="formula-note" className="mb-2 rounded-[12px] bg-brand-subtle px-3 py-2">
          <p className="text-[13px] leading-snug text-foreground">{formulaNote}</p>
          {formulaNote === NO_FORMULA_NOTE ? (
            <button
              type="button"
              onClick={useWholeTextAsFormula}
              className="tap-44 mt-2 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-foreground transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Use the whole text as a formula
            </button>
          ) : null}
        </div>
      ) : null}

      {codeMode ? (
        <AutoTextarea
          value={codeText}
          onChange={(v) => {
            setCodeText(v);
            onChange(v);
          }}
          disabled={disabled}
          ariaLabel="The question's words, as code"
          className={cn('font-mono text-[14px]', textareaClassName)}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {segments.length === 0 ? (
            <AutoTextarea
              value=""
              onChange={(v) => commitSegments([{ kind: 'text', value: v }])}
              disabled={disabled}
              ariaLabel="The question's words"
              className={textareaClassName}
            />
          ) : (
            segments.map((seg, i) =>
              seg.kind === 'text' ? (
                <AutoTextarea
                  key={i}
                  value={seg.value}
                  onChange={(v) => {
                    const next = segments.slice();
                    next[i] = { kind: 'text', value: v };
                    commitSegments(next);
                  }}
                  disabled={disabled}
                  ariaLabel="The question's words"
                  className={textareaClassName}
                  onSelection={(start, end) => {
                    lastSelection.current = { index: i, start, end };
                  }}
                />
              ) : (
                <div key={i}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setPicking(false);
                      setOpenIndex(i);
                    }}
                    aria-label="Tap to edit this maths"
                    className={cn(
                      'tap-44 w-full rounded-[12px] border-2 border-dashed border-brand/50 bg-brand-subtle px-3 py-2 text-left transition-transform duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-70',
                      picking && 'animate-pulse border-brand ring-2 ring-brand',
                    )}
                  >
                    <MathPreview latex={seg.inner} display={seg.display} className="text-[16px] text-foreground" />
                  </button>
                  {openIndex === i ? (
                    <div className="mt-2">
                      <Suspense
                        fallback={<p className="text-[12px] text-warm-secondary">Loading the maths keypad...</p>}
                      >
                        <MathFieldEditor
                          initialLatex={seg.inner}
                          display={seg.display}
                          onDone={(latex) => {
                            setOpenIndex(null);
                            setWrapUndo(null);
                            if (latex === null) return; // untouched: keep original bytes
                            const next = segments.slice();
                            next[i] = { ...seg, inner: latex };
                            commitSegments(next);
                          }}
                          onCancel={cancelFormula}
                        />
                      </Suspense>
                    </div>
                  ) : null}
                </div>
              ),
            )
          )}
        </div>
      )}
    </div>
  );
}
