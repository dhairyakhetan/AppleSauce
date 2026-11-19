import { refreshHod } from '@/lib/hod-refresh';
import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { actionToneClass } from '@/lib/checker-button-styles';
import type { FixRequestsApi } from '@/lib/fix-requests-api';
import {
  DETAILS_MAX,
  EMPTY_DRAFT,
  REQUESTS_QUERY_ROOT,
  clearSavedDraft,
  readSavedDraft,
  saveDraft,
  HOD_NEW_REQUEST_NOTE,
  KIND_CHOICES,
  MEMBER_NEW_REQUEST_NOTE,
  TITLE_MAX,
  describeScreen,
  draftProblem,
  requestErrorWords,
  type RequestDraft,
} from '@/lib/fix-requests';
import { cn } from '@/lib/utils';

/* The form for a bug or edit request. Used in the dialog a checker opens ("Report a problem") and in
   the HOD desk's "New request". Two choices (something is broken, something should change), a short
   title, the details, and the screen it came from, which is filled in and cannot be typed over.

   What was typed is remembered until it is sent, so closing the box by accident (Escape, a tap beside
   it) does not lose it. */

export function RequestForm({
  api,
  scope,
  page,
  asHod,
  onSent,
  onCancel,
}: {
  api: FixRequestsApi;
  /** Keeps real and dummy data apart in the query cache. */
  scope: string;
  /** The path and query of the screen the request came from. */
  page: string;
  /** An HOD's request goes straight on, and the form says so. */
  asHod: boolean;
  onSent: () => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const uid = useId();
  const [draft, setDraft] = useState<RequestDraft>(() => readSavedDraft() ?? EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function change(next: RequestDraft) {
    setDraft(next);
    saveDraft(next);
    setError(null);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = draftProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.submit({ kind: draft.kind!, title: draft.title.trim(), details: draft.details.trim(), page });
      clearSavedDraft();
      setDraft(EMPTY_DRAFT);
      void qc.invalidateQueries({ queryKey: [REQUESTS_QUERY_ROOT, scope] });
      // The HOD's Requests tab and its badge; nothing else on the desk changes when a request is raised.
      refreshHod(qc, scope, 'requests');
      onSent();
    } catch (err) {
      setError(requestErrorWords(err));
    } finally {
      setBusy(false);
    }
  }

  const titleId = `${uid}-title`;
  const detailsId = `${uid}-details`;
  const errorId = `${uid}-error`;

  return (
    <form onSubmit={(e) => void send(e)} className="flex flex-col gap-4" noValidate data-testid="request-form">
      <p className="text-pretty text-[13px] leading-snug text-warm-secondary">{asHod ? HOD_NEW_REQUEST_NOTE : MEMBER_NEW_REQUEST_NOTE}</p>

      <fieldset className="flex flex-col gap-2" disabled={busy}>
        <legend className="mb-1 text-[13px] font-semibold text-foreground">What is it about?</legend>
        {KIND_CHOICES.map((c) => (
          <label key={c.kind} className="relative block cursor-pointer">
            <input
              type="radio"
              name={`${uid}-kind`}
              value={c.kind}
              checked={draft.kind === c.kind}
              onChange={() => change({ ...draft, kind: c.kind })}
              className="peer sr-only"
            />
            <span
              className={cn(
                'tap-44 block rounded-2xl bg-muted px-4 py-3 transition-colors duration-150',
                'peer-checked:bg-brand-subtle peer-checked:ring-2 peer-checked:ring-brand peer-focus-visible:ring-2 peer-focus-visible:ring-focus',
              )}
            >
              <span className="block text-[14px] font-bold text-foreground">{c.label}</span>
              <span className="mt-0.5 block text-[12px] text-warm-secondary">{c.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={titleId} className="text-[13px] font-semibold text-foreground">
          Short title
        </label>
        <input
          id={titleId}
          type="text"
          value={draft.title}
          maxLength={TITLE_MAX}
          disabled={busy}
          onChange={(e) => change({ ...draft, title: e.target.value })}
          placeholder="For example: the Skip button does nothing"
          autoComplete="off"
          className="h-11 w-full rounded-full bg-muted px-4 text-[16px] text-foreground outline-none placeholder:text-warm-label focus-visible:ring-2 focus-visible:ring-focus sm:text-[14px]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={detailsId} className="text-[13px] font-semibold text-foreground">
          What happened, or what would you like instead?
        </label>
        <textarea
          id={detailsId}
          value={draft.details}
          maxLength={DETAILS_MAX}
          rows={5}
          disabled={busy}
          onChange={(e) => change({ ...draft, details: e.target.value })}
          placeholder="Say it in your own words. What did you press, and what did you expect?"
          className="w-full rounded-2xl bg-muted p-3 text-[16px] text-foreground outline-none placeholder:text-warm-label focus-visible:ring-2 focus-visible:ring-focus sm:text-[14px]"
        />
      </div>

      <p className="text-[13px] text-warm-secondary" data-testid="request-screen">
        <span className="font-semibold text-foreground">Screen: </span>
        {describeScreen(page)}
      </p>

      {error ? (
        <p id={errorId} role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} aria-describedby={error ? errorId : undefined} className={actionToneClass('brand')}>
          {busy ? 'Sending...' : 'Send'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={actionToneClass('muted')}>
          Cancel
        </button>
      </div>
    </form>
  );
}
