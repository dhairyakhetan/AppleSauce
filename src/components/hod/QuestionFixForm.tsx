import { useState, type ReactNode } from 'react';
import { BodyEditor } from '@/components/checker/BodyEditor';
import { OptionList } from '@/components/checker/OptionList';
import { quietButton } from '@/components/hod/HodShared';
import { actionToneClass } from '@/lib/checker-button-styles';
import { marksTextInvalid } from '@/lib/hod-desk';
import { buildQuestionChanges } from '@/lib/hod-publish';
import type { RawOption } from '@/lib/checker-options';
import { cn } from '@/lib/utils';

/* The Fix form, shared by Needs you and the preview flow: the words, the
   question number and the marks. It sends only what changed, through the
   versioned edit (the old text stays in history), and the words go out exactly
   as typed. Options are shown read-only so a flag about them can be checked. */

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
  const marksInvalid = marksTextInvalid(marks);

  function build(then: (changes: Record<string, unknown>) => void) {
    const built = buildQuestionChanges(target, { body, number, marks });
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
      <OptionList options={Array.isArray(target.options) ? (target.options as RawOption[]) : null} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] font-medium text-warm-secondary">
          Question number
          <input
            value={number}
            onChange={(ev) => setNumber(ev.target.value)}
            disabled={busy}
            className="min-h-[40px] w-24 rounded-xl bg-card px-3 py-1 text-center text-[14px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
              'min-h-[40px] w-20 rounded-xl bg-card px-3 py-1 text-center text-[14px] tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand',
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
