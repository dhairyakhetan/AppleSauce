import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BodyEditor } from '@/components/checker/BodyEditor';
import { OptionsEditor } from '@/components/checker/OptionsEditor';
import { quietButton } from '@/components/hod/HodShared';
import { actionToneClass } from '@/lib/checker-button-styles';
import { marksTextInvalid } from '@/lib/hod-desk';
import { buildRowChanges, isQuestionRow, useUnsavedMark, type PreviewQuestion } from '@/lib/hod-publish';
import { toEditable, type EditableOption } from '@/lib/option-editing';
import { cn } from '@/lib/utils';

/* One editor for ANY line of the paper in the ready-to-go-live flow (owner, 25 Nov 2026: "Any sort of
   instructions anywhere should be editable. Anything in the paper should be editable ... when it's ready to go
   live"). A real question can change its words, number, marks, its own instructions and the heading shown above
   it. A heading or instruction line can change its words, or be emptied to remove it. It sends only what changed,
   through the versioned edit (hod_edit_question), so the old text stays in history.

   A heading or instruction line is not a row on the live site. `liveNote` says where its words really show (the
   caller writes them there too, see PaperSheet); with no such place the editor says plainly that the line is not
   on the live site. The first box takes the focus when the editor opens, a removed answer option can be put back
   with Undo, and typed words that are not saved count as unsaved work on the go-live screen. */

const FIELD =
  'w-full rounded-xl bg-card px-3 py-2 text-[16px] sm:text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus';

/** The plain words for each kind of line, for the label above the editor. */
export function rowKindWords(kind: string): string {
  if (kind === 'section_break') return 'Heading line';
  if (kind === 'master_instruction') return 'Instruction line for the whole paper';
  if (kind === 'section_instruction') return 'Instruction line for a part of the paper';
  if (isQuestionRow(kind)) return 'Question';
  return 'Line of the paper';
}

export function PaperRowEditor({
  row,
  busy,
  error,
  onError,
  onSave,
  onCancel,
  liveNote,
}: {
  row: PreviewQuestion;
  /** For a heading or instruction line: where its words show on the live site once saved. */
  liveNote?: string;
  busy: boolean;
  error: string | null;
  onError: (message: string | null) => void;
  /** Called with the changed keys only (possibly none). */
  onSave: (changes: Record<string, unknown>) => void;
  onCancel: () => void;
}): ReactNode {
  const isQuestion = isQuestionRow(row.kind);
  const [body, setBody] = useState(row.body);
  const [number, setNumber] = useState(row.display_number ?? '');
  const [marks, setMarks] = useState(row.marks != null ? String(row.marks) : '');
  const [instructions, setInstructions] = useState(row.instructions ?? '');
  const [heading, setHeading] = useState(row.section_label ?? '');
  const [opts, setOpts] = useState(() => toEditable(row.options_raw));
  // The options as they were before the last one was removed, so a slip can be put back.
  const [optsUndo, setOptsUndo] = useState<EditableOption[] | null>(null);
  const marksInvalid = isQuestion && marksTextInvalid(marks);
  const draft = { body, number, marks, instructions, sectionLabel: heading, options: opts };
  const built = buildRowChanges({ ...row, options: row.options_raw }, draft);
  const dirty = 'error' in built || Object.keys(built.changes).length > 0;
  useUnsavedMark(`row-${row.id}`, dirty);

  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('textarea, input')?.focus({ preventScroll: false });
  }, []);

  function changeOptions(next: EditableOption[]) {
    setOptsUndo(next.length < opts.length ? opts : null);
    setOpts(next);
  }

  function save(draftBody: string = body) {
    const out = buildRowChanges({ ...row, options: row.options_raw }, { ...draft, body: draftBody });
    if ('error' in out) {
      onError(out.error);
      return;
    }
    onError(null);
    onSave(out.changes);
  }

  return (
    <div ref={rootRef} data-testid="row-editor" data-kind={row.kind}>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-warm-label">{rowKindWords(row.kind)}</p>
      <BodyEditor value={body} onChange={setBody} disabled={busy} />
      {isQuestion ? <OptionsEditor value={opts} onChange={changeOptions} disabled={busy} /> : null}
      {isQuestion && optsUndo ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-foreground" role="status" data-testid="option-removed">
          Option removed.
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded-full px-2 font-bold text-brand-blue underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-10"
            onClick={() => {
              setOpts(optsUndo);
              setOptsUndo(null);
            }}
          >
            Undo
          </button>
        </p>
      ) : null}

      {isQuestion ? (
        <div className="mt-3 grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] font-medium text-warm-secondary">
              Question number
              <input
                value={number}
                onChange={(ev) => setNumber(ev.target.value)}
                disabled={busy}
                className="min-h-11 md:min-h-[40px] w-24 rounded-xl bg-card px-3 py-1 text-center text-[16px] sm:text-[14px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
            </label>
            <label className="flex items-center gap-2 text-[13px] font-medium text-warm-secondary">
              Marks
              <input
                inputMode="decimal"
                value={marks}
                onChange={(ev) => setMarks(ev.target.value)}
                disabled={busy}
                aria-invalid={marksInvalid || undefined}
                className={cn(
                  'min-h-11 md:min-h-[40px] w-20 rounded-xl bg-card px-3 py-1 text-center text-[16px] sm:text-[14px] tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  marksInvalid && 'ring-2 ring-destructive',
                )}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-warm-secondary">
            Heading shown above this question on the site (for example Part I or Section A)
            <input value={heading} onChange={(ev) => setHeading(ev.target.value)} disabled={busy} className={cn(FIELD, 'min-h-11 md:min-h-[40px]')} data-testid="row-heading" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-warm-secondary">
            Instructions for this question (for example Answer any three). Leave empty if there are none.
            <textarea
              value={instructions}
              onChange={(ev) => setInstructions(ev.target.value)}
              disabled={busy}
              rows={3}
              className={FIELD}
              data-testid="row-instructions"
            />
          </label>
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-warm-secondary" data-testid={liveNote ? 'row-live-note' : 'row-preview-only-note'}>
          {liveNote ?? 'This line is not shown on the live site, and there is no question under it to carry its words. Remove it to tidy the preview.'}
        </p>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn(actionToneClass('brand'), 'h-[46.5px]')}
          disabled={busy || marksInvalid || (isQuestion && !body.trim())}
          onClick={() => save()}
        >
          {busy ? 'Saving...' : 'Save'}
        </button>
        {!isQuestion && row.body.trim() !== '' ? (
          <button type="button" className={actionToneClass('dark')} disabled={busy} onClick={() => save('')} data-testid="row-remove">
            Remove this line
          </button>
        ) : null}
        <button type="button" className={quietButton} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
