import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { actionToneClass } from '@/lib/checker-button-styles';
import { errorWords, fieldDirty, fieldPayload, fieldProblem, useUnsavedMark, type FieldDef } from '@/lib/hod-publish';
import { cn } from '@/lib/utils';

/* A paper's header fields. Two ways to save:
   - 'each' (Live papers): every field is its own small form with its own Save button and "Saved" line.
   - 'all' (the go-live Details step): the boxes are filled in freely and one "Save all changes" button saves every
     box that changed (owner audit, 26 Nov 2026: thirteen Save buttons were easy to miss). Boxes typed in but not
     saved count as unsaved work, so the page asks before moving on.
   A tick box ("This paper prints no time") saves the moment it is ticked, in both ways.
   The same rows edit a paper before it goes live (hod_update_publish_meta) and one that is live
   (hod_edit_live_paper); the caller supplies `save`. */

const INPUT = 'w-full rounded-xl bg-card px-3 text-[16px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus';

/** The box for one field. Shared by both ways of saving. */
function FieldInput({
  id,
  def,
  value,
  busy,
  describedBy,
  invalid,
  onChange,
}: {
  id: string;
  def: FieldDef;
  value: string;
  busy: boolean;
  describedBy?: string;
  invalid?: boolean;
  onChange: (v: string) => void;
}) {
  if (def.kind === 'longtext') {
    return (
      <textarea
        id={id}
        value={value}
        rows={4}
        disabled={busy}
        onChange={(ev) => onChange(ev.target.value)}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        className={cn(INPUT, 'py-2 leading-snug')}
      />
    );
  }
  if (def.kind === 'yesno') {
    return (
      <select id={id} value={value} disabled={busy} onChange={(ev) => onChange(ev.target.value)} aria-describedby={describedBy} className={cn(INPUT, 'min-h-[44px]')}>
        {def.noUnset ? null : <option value="">Not set</option>}
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  return (
    <input
      id={id}
      value={value}
      disabled={busy}
      inputMode={def.kind === 'number' ? 'decimal' : undefined}
      placeholder={def.placeholder}
      onChange={(ev) => onChange(ev.target.value)}
      aria-describedby={describedBy}
      aria-invalid={invalid ? true : undefined}
      className={cn(INPUT, 'min-h-[44px]', def.kind === 'number' && 'tabular-nums')}
    />
  );
}

function SavedLine({ id }: { id: string }) {
  return (
    <p id={id} role="status" className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-foreground" data-testid="field-saved">
      <Check className="h-3.5 w-3.5" aria-hidden />
      Saved
    </p>
  );
}

/** A plain tick box that saves at once ("This paper prints no time"). No Yes/No, no separate Save. */
function TickRow({ def, saved, save, onSaved, hint }: { def: FieldDef; saved: string; save: (field: string, value: string) => Promise<void>; onSaved: () => void; hint?: string }) {
  const id = useId();
  const [checked, setChecked] = useState(saved === 'true');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    setChecked(saved === 'true');
  }, [saved]);

  async function change(next: boolean) {
    setChecked(next);
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await save(def.key, next ? 'true' : 'false');
      setDone(true);
      onSaved();
    } catch (err) {
      setChecked(!next);
      setError(errorWords(err, 'That was not saved. Nothing was changed. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-muted p-3 shadow-card" data-testid="header-field" data-field={def.key}>
      <label htmlFor={id} className="flex min-h-11 items-start gap-3 text-[14px] font-semibold text-foreground">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={(ev) => void change(ev.target.checked)}
          aria-describedby={hint || def.hint ? `${id}-hint` : undefined}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--brand))]"
          data-testid="header-tick"
        />
        <span>{def.label}</span>
      </label>
      {hint || def.hint ? (
        <p id={`${id}-hint`} className="mt-1 text-[12px] text-warm-meta">
          {hint ?? def.hint}
        </p>
      ) : null}
      {busy ? <p className="mt-1 text-[13px] text-warm-secondary">Saving...</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      {done && !busy && !error ? <SavedLine id={`${id}-ok`} /> : null}
    </div>
  );
}

/** One field saved on its own (Live papers). */
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

  const describedBy = [hint || def.hint ? `${id}-hint` : null, error ? `${id}-err` : null, done && !dirty ? `${id}-ok` : null].filter(Boolean).join(' ') || undefined;

  return (
    <form onSubmit={(ev) => void submit(ev)} className="rounded-2xl bg-muted shadow-card p-3" data-testid="header-field" data-field={def.key}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-foreground">
        {def.label}
        {def.required ? <span className="font-normal text-warm-meta"> (required)</span> : null}
      </label>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <FieldInput
            id={id}
            def={def}
            value={draft}
            busy={busy}
            describedBy={describedBy}
            invalid={Boolean(error)}
            onChange={(v) => {
              setDraft(v);
              setDone(false);
            }}
          />
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
      {done && !dirty && !error ? <SavedLine id={`${id}-ok`} /> : null}
    </form>
  );
}

/** "Save 3 changes" / "Save all changes". */
export function saveAllLabel(count: number): string {
  if (count <= 0) return 'Save all changes';
  return count === 1 ? 'Save 1 change' : `Save ${count} changes`;
}

/** Every box at once, with one Save button (the go-live Details step). */
function AllFieldsForm({
  fields,
  values,
  save,
  onSaved,
  hints,
}: {
  fields: FieldDef[];
  values: Record<string, string>;
  save: (field: string, value: string) => Promise<void>;
  onSaved: () => void;
  hints?: Record<string, string>;
}) {
  const formId = useId();
  const boxes = fields.filter((f) => f.kind !== 'tick');
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(boxes.map((f) => [f.key, values[f.key] ?? ''])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const lastValues = useRef(values);

  // A fresh value from the server replaces a box only when nobody is typing in it.
  useEffect(() => {
    const before = lastValues.current;
    lastValues.current = values;
    setDrafts((cur) => {
      const next = { ...cur };
      for (const f of boxes) {
        const was = before[f.key] ?? '';
        if (!fieldDirty(f, cur[f.key] ?? '', was)) next[f.key] = values[f.key] ?? '';
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const changed = boxes.filter((f) => fieldDirty(f, drafts[f.key] ?? '', values[f.key] ?? ''));
  useUnsavedMark('header-fields', changed.length > 0);

  async function saveAll(ev: FormEvent) {
    ev.preventDefault();
    if (busy || changed.length === 0) return;
    const problems: Record<string, string> = {};
    for (const f of changed) {
      const p = fieldProblem(f, drafts[f.key] ?? '');
      if (p) problems[f.key] = p;
    }
    setErrors(problems);
    if (Object.keys(problems).length > 0) {
      setStatus({ tone: 'bad', text: 'Fix the boxes marked in red first. Nothing was saved.' });
      return;
    }
    setBusy(true);
    setStatus(null);
    let saved = 0;
    try {
      for (const f of changed) {
        try {
          await save(f.key, fieldPayload(f, drafts[f.key] ?? ''));
          saved++;
        } catch (err) {
          setErrors({ [f.key]: errorWords(err, 'That was not saved. Try again.') });
          setStatus({
            tone: 'bad',
            text: saved > 0 ? `${saved} of ${changed.length} changes saved. "${f.label}" was not saved; see the box in red.` : `Nothing was saved. See the box in red.`,
          });
          return;
        }
      }
      setStatus({ tone: 'ok', text: saved === 1 ? '1 change saved.' : `${saved} changes saved.` });
      toast.success(saved === 1 ? 'Details saved.' : `${saved} details saved.`);
    } finally {
      setBusy(false);
      if (saved > 0) onSaved();
    }
  }

  return (
    <form onSubmit={(ev) => void saveAll(ev)} data-testid="header-all" aria-describedby={status ? `${formId}-status` : undefined}>
      <div className="grid gap-2 md:grid-cols-2">
        {fields.map((f) => {
          if (f.kind === 'tick') {
            return (
              <div key={f.key} className="md:col-span-2">
                <TickRow def={f} saved={values[f.key] ?? ''} save={save} onSaved={onSaved} hint={hints?.[f.key]} />
              </div>
            );
          }
          const id = `${formId}-${f.key}`;
          const err = errors[f.key];
          const isChanged = changed.includes(f);
          return (
            <div
              key={f.key}
              className={cn('rounded-2xl bg-muted p-3 shadow-card', f.kind === 'longtext' && 'md:col-span-2', isChanged && 'ring-2 ring-brand')}
              data-testid="header-field"
              data-field={f.key}
              data-changed={isChanged || undefined}
            >
              <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-foreground">
                {f.label}
                {f.required ? <span className="font-normal text-warm-meta"> (required)</span> : null}
                {isChanged ? <span className="font-normal text-warm-secondary"> (changed, not saved yet)</span> : null}
              </label>
              <FieldInput
                id={id}
                def={f}
                value={drafts[f.key] ?? ''}
                busy={busy}
                describedBy={[hints?.[f.key] || f.hint ? `${id}-hint` : null, err ? `${id}-err` : null].filter(Boolean).join(' ') || undefined}
                invalid={Boolean(err)}
                onChange={(v) => {
                  setDrafts((cur) => ({ ...cur, [f.key]: v }));
                  setStatus(null);
                }}
              />
              {hints?.[f.key] || f.hint ? (
                <p id={`${id}-hint`} className="mt-1 text-[12px] text-warm-meta">
                  {hints?.[f.key] ?? f.hint}
                </p>
              ) : null}
              {err ? (
                <p id={`${id}-err`} role="alert" className="mt-1 text-[13px] text-destructive">
                  {err}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="sticky bottom-3 z-20 mt-3 flex flex-wrap items-center gap-3 rounded-[18px] bg-card p-3 shadow-border" data-testid="save-all-bar">
        <button type="submit" className={cn(actionToneClass('brand'), 'h-[46.5px]')} disabled={busy || changed.length === 0} data-testid="save-all">
          {busy ? 'Saving...' : saveAllLabel(changed.length)}
        </button>
        <p id={`${formId}-status`} role="status" className={cn('min-w-0 flex-1 text-[13px]', status?.tone === 'bad' ? 'text-destructive' : 'text-warm-secondary')}>
          {status ? (
            status.tone === 'ok' ? (
              <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                <Check className="h-3.5 w-3.5" aria-hidden />
                {status.text}
              </span>
            ) : (
              status.text
            )
          ) : changed.length > 0 ? (
            `${changed.length === 1 ? '1 box is' : `${changed.length} boxes are`} changed and not saved yet.`
          ) : (
            'Everything here is saved.'
          )}
        </p>
      </div>
    </form>
  );
}

export function HeaderEditor({
  fields,
  values,
  save,
  onSaved,
  hints,
  mode = 'each',
}: {
  fields: FieldDef[];
  /** Saved values by field key, as text. */
  values: Record<string, string>;
  save: (field: string, value: string) => Promise<void>;
  onSaved: () => void;
  /** A replacement hint for a field, by key. */
  hints?: Record<string, string>;
  /** 'each': a Save button per field (Live papers). 'all': one "Save all changes" button (the go-live Details step). */
  mode?: 'each' | 'all';
}) {
  if (mode === 'all') return <AllFieldsForm fields={fields} values={values} save={save} onSaved={onSaved} hints={hints} />;
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className={f.kind === 'longtext' || f.kind === 'tick' ? 'md:col-span-2' : undefined}>
          {f.kind === 'tick' ? (
            <TickRow def={f} saved={values[f.key] ?? ''} save={save} onSaved={onSaved} hint={hints?.[f.key]} />
          ) : (
            <FieldRow def={f} saved={values[f.key] ?? ''} save={save} onSaved={onSaved} hint={hints?.[f.key]} />
          )}
        </div>
      ))}
    </div>
  );
}
