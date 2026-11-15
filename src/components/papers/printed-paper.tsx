import type { ReactNode } from 'react';
import { MathText } from '@/components/papers/math-text';
import { optionHasOwnLabel, partIndent, showIncompleteNote } from '@/lib/bank-paper-display';

/* The public paper page, drawn the way the paper is printed: a centred header
   (school, exam, class and subject, time allowed and maximum marks), the
   general instructions, centred section titles, and numbered questions with
   the number hanging in the left margin and the marks in brackets on the
   right, like the examiner's own sheet. The HOD publish preview
   (src/components/hod/PaperSheet.tsx) is the model for the look; it cannot be
   shared as is because it carries the desk's own controls, so this matches it
   on the reader's surface.

   These are look-only pieces: BankPaper.tsx still decides what is shown, and
   every word of a question goes through MathText exactly as stored, never
   altered. Nothing here reads data or touches the sign-in gate, the capture
   shield or the print rule; those stay on the page that uses these. The serif
   is the system's own (`font-paper`, tailwind.config.ts), so nothing is
   downloaded. */

/** The sheet itself: a cream page lifted off the dark reading ground. */
export function PaperSurface({ children }: { children: ReactNode }) {
  return (
    <article
      aria-label="Question paper"
      data-testid="paper-surface"
      className="-mx-2 mt-4 w-auto max-w-3xl rounded-[12px] bg-card px-3.5 py-6 shadow-[0_18px_40px_rgba(0,0,0,.45)] ring-1 ring-black/5 sm:mx-auto sm:w-full sm:px-10 sm:py-10"
    >
      {children}
    </article>
  );
}

/** The paper's header: who set it, which exam, how long, how many marks. A fact
 *  the paper did not record is left out, never filled in with a guess. */
export function PaperHeader({
  source,
  headline,
  sub,
  time,
  marks,
  generalInstructions,
  incompleteNote,
}: {
  /** The school, or the board's own name, or null when none is known. */
  source: string | null;
  /** "Pre-board Examination 2023-24" (the exam and the year, whichever exist). */
  headline: string;
  /** "Class X · Maths · ICSE". */
  sub: string;
  /** "2 hours 30 minutes", or null. */
  time: string | null;
  /** Maximum marks, or null when the paper recorded none. */
  marks: number | null;
  generalInstructions: string | null;
  incompleteNote: string | null;
}) {
  // With no exam name or year, the class line becomes the title so the sheet always has one.
  const title = headline || sub;
  const subline = headline ? sub : '';
  return (
    <>
      <header
        data-testid="paper-header"
        className="animate-card-blur-in border-b-2 border-foreground pb-4 text-center font-paper text-foreground motion-reduce:animate-none"
      >
        {source ? <p className="text-[13px] font-bold uppercase tracking-[0.12em]">{source}</p> : null}
        {title ? <h2 className="mt-1 text-balance text-[22px] font-bold leading-tight sm:text-[26px]">{title}</h2> : null}
        {subline ? <p className="mt-1 text-[15px]">{subline}</p> : null}
        {time || marks ? (
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-left text-[14px]">
            {time ? (
              <p data-testid="paper-time">
                <span className="font-bold">Time allowed:</span> {time}
              </p>
            ) : (
              <span />
            )}
            {marks ? (
              <p className="tabular-nums" data-testid="paper-max-marks">
                <span className="font-bold">Maximum marks:</span> {marks}
              </p>
            ) : null}
          </div>
        ) : null}
      </header>
      {generalInstructions ? (
        <section aria-label="General instructions" data-testid="paper-instructions" className="border-b border-border py-4 font-paper">
          <h3 className="mb-1 text-[12px] font-bold uppercase tracking-[0.1em] text-warm-secondary">General instructions</h3>
          <MathText text={generalInstructions} className="text-[14px] leading-[1.6] text-foreground" />
        </section>
      ) : null}
      {showIncompleteNote(incompleteNote) ? (
        <p className="border-b border-border py-3 font-sans text-[12px] italic leading-[1.5] text-muted-foreground">{incompleteNote}</p>
      ) : null}
    </>
  );
}

/** A printed section title ("Section A"), centred above its first question. */
export function SectionTitle({ label }: { label: string }) {
  return (
    <li className="pt-5 text-center font-paper">
      <h3 className="text-[14px] font-bold uppercase tracking-[0.12em] text-foreground">{label}</h3>
    </li>
  );
}

/** The divider between two choices ("OR"), as printed. Presentation only. */
export function OrDivider() {
  return (
    <li aria-hidden="true" className="flex items-center gap-3 py-1 font-paper">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[13px] font-bold uppercase tracking-[0.12em] text-foreground">OR</span>
      <span className="h-px flex-1 bg-border" />
    </li>
  );
}

/** One question. From the `sm` breakpoint up it is laid out as printed: the
 *  number hangs in the left margin, the marks sit in brackets on the right, and
 *  what the question holds (instructions, words, options, picture) fills the
 *  middle. On a phone the margin would eat a third of the line, so the number
 *  and the marks share one small line above the question (number left, marks
 *  and the report flag right) and the words, options and pictures take the
 *  full width of the sheet. `marks` is null when the paper already prints its
 *  own "[3]" inside the words, so the same number never shows twice. `aside`
 *  is the small control beside the marks (the report flag); `below` spans the
 *  full row (the report form, once opened). The DOM order is always number,
 *  words, marks, so a screen reader reads it the same at every width. */
export function QuestionRow({
  id,
  depth = 0,
  number,
  marks,
  aside,
  below,
  children,
}: {
  id: string;
  /** 0 for a top-level question; a printed sub-part nests under its parent. */
  depth?: number;
  number: string | null;
  marks: number | null;
  aside?: ReactNode;
  below?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li
      id={`q-${id}`}
      data-testid="paper-question"
      style={partIndent(depth)}
      className="min-w-0 animate-card-blur-in py-2.5 font-paper text-foreground motion-reduce:animate-none"
    >
      <div
        className={`grid items-start gap-x-3 ${
          number
            ? 'grid-cols-[1fr_auto] sm:grid-cols-[minmax(2.25rem,max-content)_minmax(0,1fr)_auto]'
            : 'grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1fr)_auto]'
        }`}
      >
        {number ? (
          <span className="col-start-1 row-start-1 text-[15px] font-bold leading-[1.6] tabular-nums" data-testid="paper-question-number">
            {number}
          </span>
        ) : null}
        <div className={`col-span-2 row-start-2 min-w-0 sm:row-start-1 ${number ? 'sm:col-span-1 sm:col-start-2' : 'sm:col-span-1 sm:col-start-1'}`}>
          {children}
        </div>
        <div
          className={`-my-2.5 col-start-2 row-start-1 flex flex-row items-center justify-end sm:my-0 sm:-mr-2 sm:flex-col sm:items-end ${
            number ? 'sm:col-start-3' : 'sm:col-start-2'
          }`}
        >
          {marks !== null ? (
            <span className="whitespace-nowrap text-[14px] font-semibold leading-[1.7] tabular-nums sm:pr-2" data-testid="paper-question-marks">
              <span aria-hidden="true">[{marks}]</span>
              <span className="sr-only">{marks === 1 ? '1 mark' : `${marks} marks`}</span>
            </span>
          ) : null}
          {aside}
        </div>
      </div>
      {below}
    </li>
  );
}

/** The choices of a multiple-choice question, verbatim. Most already begin
 *  with their own printed letter, so no marker is added to those; an option
 *  with none gets a small dot so the choices still read as a list. */
export function OptionList({ keyPrefix, options }: { keyPrefix: string; options: string[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1.5 pl-1" data-testid="paper-options">
      {options.map((opt, i) => (
        <li key={`${keyPrefix}-opt-${i}`} className="flex gap-2">
          {optionHasOwnLabel(opt) ? null : <span aria-hidden="true" className="mt-[11px] h-1 w-1 flex-none rounded-full bg-warm-label" />}
          <MathText text={opt} className="text-[15px] leading-[1.6] text-foreground" />
        </li>
      ))}
    </ul>
  );
}

/** The small helper line above a question: its chapter, kind, suggested time
 *  or alternative label. Quiet sans text, not a row of coloured pills, so the
 *  page still reads as a paper. Renders nothing when there is nothing to say. */
export function QuestionMeta({ parts }: { parts: Array<string | null | undefined | false> }) {
  const shown = parts.filter((p): p is string => Boolean(p));
  if (shown.length === 0) return null;
  return (
    <p className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-warm-label" data-testid="paper-question-meta">
      {shown.join(' · ')}
    </p>
  );
}
