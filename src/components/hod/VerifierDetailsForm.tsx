import { useEffect, useRef } from 'react';
import { actionToneClass } from '@/lib/checker-button-styles';
import { BOARDS } from '@/lib/hod-api';
import { PROFILE_LIMITS, type DetailsDraft } from '@/lib/verifier-profile-edit';
import { VERIFIER_GRADE_OPTIONS } from '@/lib/verifier-papers';
import { cn } from '@/lib/utils';

/* The inline form under a verifier's row on the HOD Verifiers tab: name, grade,
   school, board, valid until, and the preferred subjects as checkboxes. It is a
   plain view: every state (saving, a server refusal, a length problem) arrives
   as a prop, and the row keeps the draft. The form opens and closes in place (no
   dialog); Escape cancels; the name field takes focus when it opens. */

export interface VerifierDetailsFormProps {
  /** Prefix for element ids, unique per row. */
  idBase: string;
  /** The verifier's name, for the form's accessible label. */
  name: string;
  draft: DetailsDraft;
  onDraft: (next: DetailsDraft) => void;
  /** The subjects ticked now. */
  subjects: string[];
  /** Every subject on offer (see subjectChoices). */
  choices: string[];
  onSubjects: (next: string[]) => void;
  /** A problem the form found before sending, in plain words. */
  problem: string | null;
  /** The server's own refusal, shown as written. */
  error: string | null;
  busy: boolean;
  autoFocus?: boolean;
  onSave: () => void;
  onCancel: () => void;
  formId: string;
}

const FIELD =
  'min-h-[40px] w-full rounded-xl bg-card px-3 py-1 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60';
const LABEL = 'flex flex-col gap-1 text-[13px] font-semibold text-foreground';

export function VerifierDetailsForm(props: VerifierDetailsFormProps) {
  const { idBase, name, draft, onDraft, subjects, choices, onSubjects, problem, error, busy, autoFocus, onSave, onCancel, formId } = props;
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) nameRef.current?.focus();
  }, [autoFocus]);

  const nameLength = draft.full_name.trim().length;
  const nameTooLong = nameLength > PROFILE_LIMITS.name;
  const board = draft.board;
  const boardOptions = board && !BOARDS.includes(board) ? [board, ...BOARDS] : BOARDS;
  const picked = new Set(subjects.map((s) => s.toLowerCase()));

  function toggle(subject: string, on: boolean) {
    const rest = subjects.filter((s) => s.toLowerCase() !== subject.toLowerCase());
    onSubjects(on ? [...rest, subject] : rest);
  }

  return (
    <form
      id={formId}
      aria-label={`Details and preferred subjects for ${name}`}
      aria-busy={busy}
      className="rounded-2xl bg-card p-4 shadow-border"
      data-testid="verifier-details-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSave();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onCancel();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL} htmlFor={`${idBase}-name`}>
          Full name
          <input
            ref={nameRef}
            id={`${idBase}-name`}
            value={draft.full_name}
            onChange={(e) => onDraft({ ...draft, full_name: e.target.value })}
            className={FIELD}
            autoComplete="off"
            disabled={busy}
            aria-invalid={nameTooLong || undefined}
          />
          {nameTooLong ? (
            <span className="text-[12px] font-normal text-destructive" data-testid="name-length">
              {nameLength} of {PROFILE_LIMITS.name} characters
            </span>
          ) : null}
        </label>
        <label className={LABEL} htmlFor={`${idBase}-grade`}>
          Grade
          <select id={`${idBase}-grade`} value={draft.grade} onChange={(e) => onDraft({ ...draft, grade: e.target.value })} className={FIELD} disabled={busy}>
            <option value="">Not set</option>
            {VERIFIER_GRADE_OPTIONS.filter((o) => o.value !== null).map((o) => (
              <option key={o.value} value={o.value as number}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL} htmlFor={`${idBase}-school`}>
          School
          <input
            id={`${idBase}-school`}
            value={draft.school}
            onChange={(e) => onDraft({ ...draft, school: e.target.value })}
            className={FIELD}
            autoComplete="off"
            disabled={busy}
          />
        </label>
        <label className={LABEL} htmlFor={`${idBase}-board`}>
          Board
          <select id={`${idBase}-board`} value={board} onChange={(e) => onDraft({ ...draft, board: e.target.value })} className={FIELD} disabled={busy}>
            <option value="">Pick a board</option>
            {boardOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL} htmlFor={`${idBase}-valid`}>
          Valid until
          <input
            id={`${idBase}-valid`}
            type="date"
            value={draft.valid_until}
            onChange={(e) => onDraft({ ...draft, valid_until: e.target.value })}
            className={FIELD}
            disabled={busy}
          />
        </label>
      </div>

      <fieldset className="mt-4" disabled={busy}>
        <legend className="text-[13px] font-semibold text-foreground">Preferred subjects</legend>
        <p className="mt-0.5 text-[12px] text-warm-meta">Only you set these. Pick the subjects this verifier should be given papers in.</p>
        {choices.length === 0 ? (
          <p className="mt-2 text-[13px] text-warm-secondary">No subjects to choose from yet. They appear once verifiers hold papers.</p>
        ) : (
          <div className="mt-2 flex max-h-44 flex-wrap gap-x-4 gap-y-2 overflow-y-auto" data-testid="subject-choices">
            {choices.map((s, i) => {
              const id = `${idBase}-subject-${i}`;
              return (
                <label key={s} htmlFor={id} className={cn('flex items-center gap-2 text-[14px] text-foreground', busy && 'opacity-60')}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={picked.has(s.toLowerCase())}
                    onChange={(e) => toggle(s, e.target.checked)}
                    className="size-4 accent-foreground focus-visible:ring-2 focus-visible:ring-brand"
                  />
                  {s}
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      <p className="mt-3 text-[12px] text-warm-meta">
        Papers are given out to match these details, and never above the grade. After the valid until date no new papers are given until you refresh them.
      </p>

      {problem ? (
        <p role="alert" className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive" data-testid="details-problem">
          {problem}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive" data-testid="details-error">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={actionToneClass('dark')}>
          {busy ? 'Saving...' : 'Save'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={actionToneClass('muted')}>
          Cancel
        </button>
      </div>
    </form>
  );
}
