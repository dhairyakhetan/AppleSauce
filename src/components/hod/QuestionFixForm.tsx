import { useState, type ReactNode } from 'react';
import { BodyEditor } from '@/components/checker/BodyEditor';
import { OptionsEditor } from '@/components/checker/OptionsEditor';
import { quietButton } from '@/components/hod/HodShared';
import { actionToneClass } from '@/lib/checker-button-styles';
import { marksTextInvalid } from '@/lib/hod-desk';
import { buildQuestionChanges } from '@/lib/hod-publish';
import { toEditable, type EditableOption } from '@/lib/option-editing';
import { cn } from '@/lib/utils';

/* The Fix form, shared by Needs you and the preview flow: the words, the
   question number, the marks and the answer options. It sends only what changed,
   through the versioned edit (the old text stays in history), and the words go out
   exactly as typed. The options can be changed, added, removed and moved (owner,
   25 Nov 2026: "I can't edit the options"). A removed option can be put back with Undo until the form is saved. */

export interface FixTarget {
  body: string;
  display_number: string | null;
  marks: number | null;
  options?: unknown;
}

export function QuestionFixForm({
  target,
  busy,
  error,
  onError,
  primaryLabel,
  onSave,
  secondary,
  onCancel,
}: {
  target: FixTarget;
  busy: boolean;
  error: string | null;
  onError: (message: string | null) => void;
  primaryLabel: string;
  /** Called with the changed keys only (possibly none). */
  onSave: (changes: Record<string, unknown>) => void;
  /** An optional second way to save, for example "Save, keep open". */
  secondary?: { label: string; onSave: (changes: Record<string, unknown>) => void };
  onCancel: () => void;
}): ReactNode {
  const [body, setBody] = useState(target.body);
  const [number, setNumber] = useState(target.display_number ?? '');
  const [marks, setMarks] = useState(target.marks != null ? String(target.marks) : '');
  const [opts, setOpts] = useState(() => toEditable(target.options));
  const [optsUndo, setOptsUndo] = useState<EditableOption[] | null>(null);
  const marksInvalid = marksTextInvalid(marks);

  function build(then: (changes: Record<string, unknown>) => void) {
    const built = buildQuestionChanges(target, { body, number, marks, options: opts });
    if ('error' in built) {
      onError(built.error);
      return;
    }
    onError(null);
    then(built.changes);
  }

  return (
    <div>
      <BodyEditor value={body} onChange={setBody} disabled={busy} />
      <OptionsEditor
        value={opts}
        onChange={(next) => {
          setOptsUndo(next.length < opts.length ? opts : null);
          setOpts(next);
        }}
        disabled={busy}
      />
      {optsUndo ? (
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
      <div className="mt-3 flex flex-wrap items-center gap-3">
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
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={cn(actionToneClass('brand'), 'h-[46.5px]')} disabled={busy || marksInvalid || !body.trim()} onClick={() => build(onSave)}>
          {busy ? 'Saving...' : primaryLabel}
        </button>
        {secondary ? (
          <button type="button" className={actionToneClass('dark')} disabled={busy || marksInvalid || !body.trim()} onClick={() => build(secondary.onSave)}>
            {secondary.label}
          </button>
        ) : null}
        <button type="button" className={quietButton} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
