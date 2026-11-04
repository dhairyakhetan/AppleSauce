import { useEffect, useId, useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { actionToneClass } from '@/lib/checker-button-styles';
import { errorWords, fieldDirty, fieldPayload, fieldProblem, type FieldDef } from '@/lib/hod-publish';
import { cn } from '@/lib/utils';

/* One field of a paper's header, saved on its own: the label, the box, a Save
   button that only lights up when the text differs from what is saved, and a
   status line that says "Saved" (or the server's own words when it refuses).
   The same row edits a paper before it goes live (hod_update_publish_meta) and
   one that is live (hod_edit_live_paper); the caller supplies `save`. */

function FieldRow({
  def,
  saved,
  save,
  onSaved,
  hint,
}: {
  def: FieldDef;
  /** The value as the server holds it, as text. */
  saved: string;
  save: (field: string, value: string) => Promise<void>;
  onSaved: () => void;
  hint?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // A fresh value from the server (after a save, or another change) replaces the box.
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const dirty = fieldDirty(def, draft, saved);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!dirty || busy) return;
    const problem = fieldProblem(def, draft);
    if (problem) {
      setError(problem);
      setDone(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await save(def.key, fieldPayload(def, draft));
      setDone(true);
      onSaved();
    } catch (err) {
      setError(errorWords(err, 'That was not saved. Nothing was changed. Try again.'));
      setDone(false);
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded-xl bg-card px-3 text-[16px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand';
  const describedBy = [hint || def.hint ? `${id}-hint` : null, error ? `${id}-err` : null, done && !dirty ? `${id}-ok` : null].filter(Boolean).join(' ') || undefined;

  return (
    <form onSubmit={(ev) => void submit(ev)} className="rounded-2xl bg-muted p-3" data-testid="header-field" data-field={def.key}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-foreground">
        {def.label}
        {def.required ? <span className="font-normal text-warm-meta"> (required)</span> : null}
      </label>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-56">
          {def.kind === 'longtext' ? (
            <textarea
              id={id}
              value={draft}
              rows={4}
              disabled={busy}
              onChange={(ev) => {
                setDraft(ev.target.value);
                setDone(false);
              }}
              aria-describedby={describedBy}
              aria-invalid={error ? true : undefined}
              className={cn(input, 'py-2 leading-snug')}
            />
          ) : def.kind === 'yesno' ? (
            <select
              id={id}
              value={draft}
              disabled={busy}
              onChange={(ev) => {
                setDraft(ev.target.value);
                setDone(false);
              }}
              aria-describedby={describedBy}
              className={cn(input, 'min-h-[44px]')}
            >
              <option value="">Not set</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input
              id={id}
              value={draft}
              disabled={busy}
              inputMode={def.kind === 'number' ? 'decimal' : undefined}
              placeholder={def.placeholder}
              onChange={(ev) => {
                setDraft(ev.target.value);
                setDone(false);
              }}
              aria-describedby={describedBy}
              aria-invalid={error ? true : undefined}
              className={cn(input, 'min-h-[44px]', def.kind === 'number' && 'tabular-nums')}
            />
          )}
        </div>
        <button type="submit" className={cn(actionToneClass('dark'), 'min-h-[44px]')} disabled={!dirty || busy}>
          {busy ? 'Saving...' : 'Save'}
        </button>
      </div>
      {hint || def.hint ? (
        <p id={`${id}-hint`} className="mt-1 text-[12px] text-warm-meta">
          {hint ?? def.hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      {done && !dirty && !error ? (
        <p id={`${id}-ok`} role="status" className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-foreground" data-testid="field-saved">
          <Check className="h-3.5 w-3.5" aria-hidden />
          Saved
        </p>
      ) : null}
    </form>
  );
}

export function HeaderEditor({
  fields,
  values,
  save,
  onSaved,
  hints,
}: {
  fields: FieldDef[];
  /** Saved values by field key, as text. */
  values: Record<string, string>;
  save: (field: string, value: string) => Promise<void>;
  onSaved: () => void;
  /** A replacement hint for a field, by key. */
  hints?: Record<string, string>;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className={f.kind === 'longtext' ? 'md:col-span-2' : undefined}>
          <FieldRow def={f} saved={values[f.key] ?? ''} save={save} onSaved={onSaved} hint={hints?.[f.key]} />
        </div>
      ))}
    </div>
  );
}
