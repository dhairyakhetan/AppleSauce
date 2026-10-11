import { useEffect, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';
import { MathPreview } from './MathPreview';

/* The "edit it the way it looks" panel behind a tapped maths segment
 * (owner's ask: "tap the maths and edit it... with buttons for fraction,
 * power and root", never raw code). This file is the ONLY place `mathlive`
 * is imported, and it is reached only through a dynamic `import('mathlive')`
 * inside a React.lazy()'d component -- see BodyEditor.tsx, which renders
 * this component itself only once a math segment is tapped open. So the
 * mathlive chunk (its JS and its own font files) never lands in any other
 * route's bundle, and never loads on a page where the checker never taps a
 * formula. Verified by inspecting the built chunk graph (see the worklog).
 *
 * `<math-field>` is a custom element mathlive registers as a side effect of
 * being imported; it is built with `document.createElement` and mounted
 * imperatively into a plain container ref rather than written as JSX, which
 * sidesteps needing a JSX.IntrinsicElements declaration for a tag this file
 * is the only place in the app that ever creates.
 *
 * D76 round trip: MathLive normalises LaTeX as you type (spacing, bracket
 * forms), so its `getValue('latex')` can differ from the original bytes
 * EVEN WHEN THE CHECKER CHANGED NOTHING. Comparing strings would then treat
 * an untouched open+close as an edit. Instead `touchedRef` is set true only
 * by a real input/insert event from the user, and Done reports the new
 * LaTeX ONLY when that happened; otherwise it reports `null` and the
 * caller keeps the original bytes untouched. */

export interface MathFieldEditorProps {
  /** The segment's current LaTeX (without its `$`/`$$`/`\(`/`\[` delimiters). */
  initialLatex: string;
  display: boolean;
  /** `latex` when the checker actually changed the formula, `null` when they
   *  opened it and closed it again without changing anything -- the caller
   *  must keep the ORIGINAL bytes in the `null` case. */
  onDone: (latex: string | null) => void;
  onCancel: () => void;
}

interface ToolbarButton {
  label: string;
  aria: string;
  /** LaTeX template inserted at the caret/selection. `#@` = current
   *  selection (or nothing), `#?` = a placeholder the checker types into
   *  next -- both are MathLive's own insert-template syntax. */
  insert: string;
}

const TOOLBAR: ToolbarButton[] = [
  { label: 'a/b', aria: 'Fraction', insert: '\\frac{#@}{#?}' },
  { label: 'x²', aria: 'Power', insert: '#@^{#?}' },
  { label: '√', aria: 'Square root', insert: '\\sqrt{#@}' },
  { label: 'ⁿ√', aria: 'Nth root', insert: '\\sqrt[#?]{#@}' },
  { label: 'xₙ', aria: 'Subscript', insert: '#@_{#?}' },
  { label: '±', aria: 'Plus or minus', insert: '\\pm' },
  { label: '×', aria: 'Times', insert: '\\times' },
  { label: '÷', aria: 'Divide', insert: '\\div' },
  { label: 'π', aria: 'Pi', insert: '\\pi' },
  { label: 'θ', aria: 'Theta', insert: '\\theta' },
  { label: '≤', aria: 'Less than or equal to', insert: '\\leq' },
  { label: '≥', aria: 'Greater than or equal to', insert: '\\geq' },
  { label: '≠', aria: 'Not equal to', insert: '\\neq' },
];

export default function MathFieldEditor({ initialLatex, display, onDone, onCancel }: MathFieldEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mfRef = useRef<MathfieldElement | null>(null);
  const touchedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [liveLatex, setLiveLatex] = useState(initialLatex);

  useEffect(() => {
    let disposed = false;
    void import('mathlive').then(({ MathfieldElement: MfCtor }) => {
      if (disposed || !containerRef.current) return;
      // Mobile virtual keyboard policy: 'auto' shows MathLive's own math
      // keypad automatically when a touch device focuses the field, on top
      // of the fixed toolbar above -- the sensible default for a screen
      // whose whole point is editing a formula on a phone, and the same
      // policy MathLive ships by default (made explicit here rather than
      // left implicit, so a future change to that default doesn't silently
      // change this screen's behaviour).
      const mf = new MfCtor();
      mf.mathVirtualKeyboardPolicy = 'auto';
      mf.smartFence = true;
      mf.value = initialLatex;
      mf.style.width = '100%';
      mf.style.minHeight = '52px';
      mf.style.fontSize = '22px';
      mf.style.padding = '10px 12px';
      mf.style.borderRadius = '14px';
      const onInput = () => {
        touchedRef.current = true;
        setLiveLatex(mf.getValue('latex'));
      };
      mf.addEventListener('input', onInput);
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(mf);
      mfRef.current = mf;
      setReady(true);
      // Focus after mount so the OS/virtual keyboard is ready for typing
      // immediately -- matching "tap the maths and edit it" with no extra
      // tap needed to start.
      requestAnimationFrame(() => mf.focus());
    });
    return () => {
      disposed = true;
      mfRef.current?.remove();
      mfRef.current = null;
    };
    // initialLatex/display are fixed for the lifetime of one open segment
    // (BodyEditor remounts this component per segment via `key`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function press(button: ToolbarButton) {
    const mf = mfRef.current;
    if (!mf) return;
    mf.focus();
    mf.insert(button.insert, { selectionMode: 'placeholder' });
    touchedRef.current = true;
    setLiveLatex(mf.getValue('latex'));
  }

  function done() {
    onDone(touchedRef.current ? (mfRef.current?.getValue('latex') ?? initialLatex) : null);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit this maths"
      className="rounded-2xl border border-warm-hairline bg-card p-3 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <p className="mb-2 text-[12px] font-semibold text-warm-meta">Edit the maths. No code, just how it looks.</p>

      <div className="mb-2 flex flex-wrap gap-1">
        {TOOLBAR.map((b) => (
          <button
            key={b.aria}
            type="button"
            aria-label={b.aria}
            onClick={() => press(b)}
            className="tap-44 min-w-[40px] rounded-xl bg-muted px-2.5 py-1.5 text-[15px] font-semibold text-foreground transition-transform duration-150 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {b.label}
          </button>
        ))}
      </div>

      <div ref={containerRef} className="rounded-2xl bg-muted" />
      {!ready ? <p className="mt-2 text-[12px] text-warm-secondary">Loading the maths keypad...</p> : null}

      <div className="mt-2 rounded-2xl bg-brand-subtle px-3 py-2">
        <p className="mb-1 text-[11px] font-semibold text-warm-meta">How readers will see it</p>
        <MathPreview latex={liveLatex} display={display} className="text-[16px] text-foreground" />
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={done}
          className="tap-44 rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-foreground transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Done
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="tap-44 rounded-full bg-muted px-4 py-2 text-[13px] font-semibold text-warm-secondary transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
