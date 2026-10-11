import { useState } from 'react';
import { ActionButton } from '@/components/checker/CheckerButtons';
import { BOARDS, profileInputProblem, type HodVerifierProfile, type ProfileInput } from '@/lib/hod-api';
import { gradeSelectValue, VERIFIER_GRADE_OPTIONS } from '@/lib/verifier-papers';

/* The form an HOD or admin fills in for a verifier: name, grade, school and
   board, valid until a date (31 Mar 2027 by default). Used on the HOD
   Verifiers tab and straight after an admin adds a verifier. The server
   decides which papers a verifier can be given from these four facts, and
   never gives a paper above their grade. */

export const DEFAULT_VALID_UNTIL = '2027-03-31';

type Initial = Partial<Pick<HodVerifierProfile, 'full_name' | 'name' | 'grade' | 'school' | 'board' | 'valid_until'>>;

export function VerifierProfileForm({
  initial,
  busy,
  saveLabel = 'Save details',
  onSave,
  onCancel,
  cancelLabel = 'Cancel',
}: {
  initial: Initial;
  busy: boolean;
  saveLabel?: string;
  onSave: (input: ProfileInput) => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const [fullName, setFullName] = useState(initial.full_name ?? initial.name ?? '');
  const [grade, setGrade] = useState(gradeSelectValue(initial.grade ?? null));
  const [school, setSchool] = useState(initial.school ?? '');
  const [board, setBoard] = useState(initial.board ?? '');
  const [validUntil, setValidUntil] = useState(initial.valid_until ?? DEFAULT_VALID_UNTIL);
  const [problem, setProblem] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = profileInputProblem({ full_name: fullName, grade, school, board, valid_until: validUntil });
    setProblem(p);
    if (p) return;
    onSave({ full_name: fullName.trim(), grade: Number(grade), school: school.trim(), board: board.trim(), valid_until: validUntil });
  }

  const field = 'min-h-[40px] w-full rounded-xl bg-card px-3 py-1 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand';
  const label = 'flex flex-col gap-1 text-[13px] font-semibold text-foreground';

  return (
    <form onSubmit={submit} className="rounded-2xl bg-muted p-4" data-testid="profile-form" aria-label="Verifier details">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={field} autoComplete="off" />
        </label>
        <label className={label}>
          Grade
          <select value={grade} onChange={(e) => setGrade(e.target.value)} className={field}>
            <option value="">Pick a grade</option>
            {VERIFIER_GRADE_OPTIONS.filter((o) => o.value !== null).map((o) => (
              <option key={o.value} value={o.value as number}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          School
          <input value={school} onChange={(e) => setSchool(e.target.value)} className={field} autoComplete="off" />
        </label>
        <label className={label}>
          Board
          <select value={board} onChange={(e) => setBoard(e.target.value)} className={field}>
            <option value="">Pick a board</option>
            {board && !BOARDS.includes(board) ? <option value={board}>{board}</option> : null}
            {BOARDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Valid until
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={field} />
        </label>
      </div>
      <p className="mt-2 text-[12px] text-warm-meta">
        Papers are given out to match these details, and never above the grade. After the valid until date no new papers are given until you refresh them.
      </p>
      {problem ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {problem}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="tap-44 rounded-full bg-brand px-5 py-2 text-[14px] font-bold text-foreground disabled:opacity-40">
          {busy ? 'Saving...' : saveLabel}
        </button>
        <ActionButton tone="muted" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </ActionButton>
      </div>
    </form>
  );
}
