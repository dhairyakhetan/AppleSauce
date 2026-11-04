import { Fragment, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { problemLines, type Issue } from '@/lib/games/format';
import { cn } from '@/lib/utils';
import './games.css';

/* The Questions box. A textarea can't style parts of its text, so a copy of the text sits behind it with the same font,
   padding and width: the copy is invisible except for the red underline on lines with a problem. The two scroll
   together. Moving the cursor onto an underlined line says why, under the box. */

const PLACEHOLDER = `Paste the chatbot's reply here, or write your own questions like this:

Q: Gas that green plants take in to make their food
A: Carbon dioxide
Fill: Green plants take in ___ to make their food.
Wrong: Oxygen; Nitrogen; Hydrogen
Level: easy`;

export function QuestionsBox({ value, onChange, onPaste, onTyping, issues, boxRef, caret, setCaret }: {
  value: string;
  onChange: (v: string) => void;
  /** A paste; `all` when it replaces all the text (or the box was empty). */
  onPaste: (all: boolean) => void;
  /** The line just typed on (null when the box is left): problems there wait until the cursor moves on. */
  onTyping: (line: number | null) => void;
  /** The problems to show now. */
  issues: Issue[];
  boxRef: RefObject<HTMLTextAreaElement>;
  /** The line the cursor is on (set from outside too, when a problem in the list is clicked). */
  caret: number;
  setCaret: (line: number) => void;
}) {
  const back = useRef<HTMLDivElement>(null);
  const pasted = useRef(false); // a paste is finished text: check all of it at once

  const sync = () => {
    const ta = boxRef.current;
    const b = back.current;
    if (!ta || !b) return;
    (b.firstElementChild as HTMLElement).style.width = `${ta.clientWidth}px`; // excludes the textarea's scrollbar
    b.scrollTop = ta.scrollTop;
    b.scrollLeft = ta.scrollLeft;
  };
  useLayoutEffect(sync);
  useEffect(() => {
    const ta = boxRef.current;
    if (!ta || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(sync);
    ro.observe(ta);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lineOf = (ta: HTMLTextAreaElement) => ta.value.slice(0, ta.selectionStart).split('\n').length;
  const onCaret = (ta: HTMLTextAreaElement) => setCaret(lineOf(ta));
  const marked = problemLines(issues);
  const here = issues.filter((x) => x.line === caret);

  return (
    <>
      <div className="games-editor">
        <div className="games-backdrop" ref={back} aria-hidden="true">
          <div className="games-backdrop-in">
            {value.split('\n').map((l, i) => {
              const body = l.trim();
              const nl = i > 0 ? '\n' : '';
              if (!marked.has(i + 1) || !body) return <Fragment key={i}>{nl}{l}</Fragment>;
              const lead = l.slice(0, l.indexOf(body[0]));
              return <Fragment key={i}>{nl}{lead}<span className="games-mark error">{body}</span>{l.slice(lead.length + body.length)}</Fragment>;
            })}
            {/* keeps an empty last line as tall as the textarea draws it */}
            {'​'}
          </div>
        </div>
        <textarea id="q" ref={boxRef} spellCheck={false} value={value} aria-invalid={issues.length > 0} aria-describedby="caret-note"
          onChange={(e) => {
            onChange(e.target.value);
            if (pasted.current) { pasted.current = false; onCaret(e.target); onTyping(null); } else onTyping(lineOf(e.target));
          }}
          onPaste={(e) => { pasted.current = true; const t = e.currentTarget; onPaste(t.selectionStart === 0 && t.selectionEnd === t.value.length); }}
          onFocus={(e) => onCaret(e.currentTarget)} onBlur={() => onTyping(null)}
          onScroll={sync} onSelect={(e) => onCaret(e.currentTarget)} onClick={(e) => onCaret(e.currentTarget)} onKeyUp={(e) => onCaret(e.currentTarget)}
          placeholder={PLACEHOLDER} />
      </div>
      <p id="caret-note" aria-live="polite" className={cn('min-h-[1.5em] text-[14px]', here.length ? 'text-destructive' : 'text-warm-secondary')}>
        {here.length
          ? <span key={`l${caret}`}><b>Line {caret}:</b> {here.map((x) => x.text).join(' ')}</span>
          : issues.length
            ? <span key="hint">Lines <span className="games-mark error">marked in red</span> need fixing. Put the cursor on one to see why, or read the list of questions.</span>
            : ' '}
      </p>
    </>
  );
}
