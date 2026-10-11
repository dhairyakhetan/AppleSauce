import { useState } from 'react';
import { History, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AdminStatusPill } from '@/pages/admin/AdminTable';
import { adminFlagLines, OCR_ONLY_REMINDER } from '@/lib/paper-edit';
import {
  changesFromDraft,
  draftOf,
  writeErrorWords,
  type ApprovalApi,
  type Draft,
  type QuestionState,
  type ReviewRow,
} from '@/lib/admin-approval-shape';
import { QuestionBody } from '@/components/admin/approval/QuestionBody';
import { QuestionVersions } from '@/components/admin/approval/QuestionVersions';

/* One question on the approval review page: drawn the way a visitor sees it,
   with its check state, an inline editor (each save is a new version, logged
   with the admin's name) and its Versions list. Question text in the editor
   is the stored text, byte for byte; nothing here cleans or retypes it. */

const STATE_PILL: Record<QuestionState, { status: 'live' | 'pending' | 'paused'; label: string }> = {
  passed: { status: 'live', label: 'Passed' },
  open: { status: 'pending', label: 'Open' },
  set_aside: { status: 'paused', label: 'Set aside' },
};

export function ReviewQuestionCard({
  row,
  label,
  depth,
  api,
  onSaved,
  canResolve = false,
  passOnly = false,
  now,
}: {
  row: ReviewRow;
  /** The number shown on the badge (display number, else the printed path). */
  label: string | null;
  depth: number;
  api: Pick<ApprovalApi, 'editQuestion' | 'questionHistory' | 'revertQuestion' | 'setQuestionState'>;
  onSaved: () => void;
  /** Pass / Set aside / Reopen are offered only while the paper waits for approval. */
  canResolve?: boolean;
  /** The paper is already approved: an open question can still be passed, but not set aside or reopened. */
  passOnly?: boolean;
  now?: Date;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(row));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [versionsKey, setVersionsKey] = useState(0);
  const pill = STATE_PILL[row.state];
  const isOnSite = Boolean(row.live_bank_question_id);
  const why = row.state === 'open' ? adminFlagLines(row.flag_reasons, row.flag_detail) : [];
  const qName = label ? `question ${label}` : 'this question';
  const [asideOpen, setAsideOpen] = useState(false);
  const [asideNote, setAsideNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  async function resolve(state: 'pass' | 'set_aside' | 'reopen') {
    if (state === 'set_aside' && !asideNote.trim()) {
      setResolveError('Say why it is set aside. The note is shown in the history.');
      return;
    }
    setResolving(true);
    setResolveError(null);
    try {
      await api.setQuestionState(row.id, state, state === 'set_aside' ? asideNote.trim() : '');
      setAsideOpen(false);
      setAsideNote('');
      setVersionsKey((k) => k + 1);
      onSaved();
    } catch (e) {
      setResolveError(writeErrorWords(e, 'That did not go through. Nothing was changed. Try again.'));
    } finally {
      setResolving(false);
    }
  }

  function startEdit() {
    setDraft(draftOf(row));
    setNote('');
    setError(null);
    setEditing(true);
  }

  async function save() {
    const changes = changesFromDraft(row, draft);
    if (changes === 'bad-marks') {
      setError('Marks must be a number, like 2 or 1.5. Leave it empty if the paper prints none.');
      return;
    }
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.editQuestion(row.id, row.version, changes, note.trim());
      setEditing(false);
      setVersionsKey((k) => k + 1);
      onSaved();
    } catch (e) {
      setError(writeErrorWords(e, 'Your change was not saved. Nothing on the site changed. Try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li
      id={`q-${row.id}`}
      style={depth > 0 ? { marginLeft: `${Math.min(depth, 3) * 16}px` } : undefined}
      className={cn(
        'min-w-0 rounded-[18px] bg-muted p-[16px]',
        depth > 0 && 'border-l-2 border-border pl-3',
        row.state === 'open' && 'ring-2 ring-inset ring-brand',
      )}
    >
      {editing ? (
        <div>
          {isOnSite ? (
            <p role="note" className="mb-3 rounded-[12px] bg-brand-subtle px-3 py-2 text-[13px] font-semibold text-brand-deep">
              This question is on the live site. Saving changes it for visitors at once. Versions can put the earlier text back.
            </p>
          ) : null}
          <p className="mb-2 text-[13px] text-warm-secondary">{OCR_ONLY_REMINDER}</p>
          <div className="grid grid-cols-2 gap-2 sm:max-w-[320px]">
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-warm-secondary">
              Question number
              <input
                value={draft.number}
                onChange={(e) => setDraft({ ...draft, number: e.target.value })}
                className="min-h-10 rounded-xl bg-card px-3 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-warm-secondary">
              Marks
              <input
                inputMode="decimal"
                value={draft.marks}
                onChange={(e) => setDraft({ ...draft, marks: e.target.value })}
                className="min-h-10 rounded-xl bg-card px-3 text-[14px] tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </label>
          </div>
          <label className="mt-2 flex flex-col gap-1 text-[12px] font-semibold text-warm-secondary">
            Question text
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={Math.min(14, Math.max(4, draft.body.split('\n').length + 1))}
              className="rounded-xl bg-card px-3 py-2 font-mono text-[14px] leading-[1.55] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </label>
          {draft.options.length > 0 ? (
            <fieldset className="mt-2">
              <legend className="mb-1 text-[12px] font-semibold text-warm-secondary">Answer choices</legend>
              <div className="space-y-1.5">
                {draft.options.map((o, i) => (
                  <label key={i} className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-center text-[13px] font-bold text-warm-label">
                      {o.label ? `(${o.label})` : `${i + 1}.`}
                    </span>
                    <input
                      aria-label={o.label ? `Choice ${o.label}` : `Choice ${i + 1}`}
                      value={o.text}
                      onChange={(e) => {
                        const options = draft.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x));
                        setDraft({ ...draft, options });
                      }}
                      className="min-h-10 min-w-0 flex-1 rounded-xl bg-card px-3 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <label className="mt-2 flex flex-col gap-1 text-[12px] font-semibold text-warm-secondary">
            Why (optional, shown in the history)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              placeholder="For example: the scan misread 7 as 1"
              className="min-h-10 rounded-xl bg-card px-3 text-[14px] text-foreground outline-none placeholder:text-warm-label focus-visible:ring-2 focus-visible:ring-brand"
            />
          </label>
          {error ? (
            <p role="alert" className="mt-2 text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="inline-flex min-h-11 items-center rounded-full bg-panel px-5 text-[13px] font-bold text-background transition-transform duration-150 active:scale-[0.96] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {saving ? 'Saving...' : isOnSite ? 'Save and update the site' : 'Save as a new version'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
              className="inline-flex min-h-11 items-center rounded-full bg-card px-5 text-[13px] font-bold text-warm-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <QuestionBody
          number={label}
          marks={row.marks}
          instructions={row.instructions}
          body={row.body}
          options={row.options}
          figure={row.figure}
          chips={
            <>
              <AdminStatusPill status={pill.status} label={pill.label} />
              <span className="rounded-full bg-card px-2 py-0.5 text-[12px] font-semibold tabular-nums text-warm-secondary shadow-border">
                v{row.version}
              </span>
            </>
          }
        />
      )}

      {why.length ? (
        <ul className="mt-2 space-y-0.5 rounded-[12px] bg-brand-subtle px-3 py-2 text-[13px] text-brand-deep">
          {why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {row.state === 'set_aside' ? (
        <p className="mt-2 text-[13px] text-warm-secondary">
          Set aside{row.set_aside_reason ? `: ${row.set_aside_reason}` : '.'} Visitors see a short card saying this question is
          being checked, with no text.
        </p>
      ) : null}

      {!editing && canResolve && !(passOnly && row.state !== 'open') ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {row.state === 'open' ? (
            <>
              <button
                type="button"
                disabled={resolving}
                onClick={() => void resolve('pass')}
                aria-label={`Pass ${qName}`}
                className="inline-flex min-h-10 items-center rounded-full bg-mint px-3.5 text-[13px] font-bold text-success-subtle-text transition-transform duration-150 hover:brightness-95 active:scale-[0.96] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Pass
              </button>
              {passOnly ? null : (
                <button
                  type="button"
                  disabled={resolving}
                  aria-expanded={asideOpen}
                  onClick={() => {
                    setAsideOpen((v) => !v);
                    setResolveError(null);
                  }}
                  aria-label={`Set ${qName} aside`}
                  className="inline-flex min-h-10 items-center rounded-full bg-destructive/10 px-3.5 text-[13px] font-bold text-destructive transition-transform duration-150 hover:bg-destructive/15 active:scale-[0.96] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Set aside
                </button>
              )}
            </>
          ) : passOnly ? null : (
            <button
              type="button"
              disabled={resolving}
              onClick={() => void resolve('reopen')}
              aria-label={`Reopen ${qName}`}
              className="inline-flex min-h-10 items-center rounded-full bg-card px-3.5 text-[13px] font-bold text-warm-secondary transition-transform duration-150 hover:bg-warm-hairline active:scale-[0.96] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Reopen
            </button>
          )}
          {resolving ? <span className="text-[13px] text-warm-meta">Saving...</span> : null}
          {passOnly && row.state === 'open' ? (
            <span className="text-[13px] text-warm-secondary">This paper is approved, so a question can be passed but not set aside.</span>
          ) : null}
        </div>
      ) : null}
      {asideOpen && row.state === 'open' ? (
        <div className="mt-2 rounded-[14px] bg-card p-3">
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-warm-secondary">
            Why is it set aside? (shown in the history)
            <input
              value={asideNote}
              onChange={(e) => setAsideNote(e.target.value)}
              maxLength={300}
              placeholder="For example: the scan is torn here"
              className="min-h-10 rounded-xl bg-muted px-3 text-[14px] text-foreground outline-none placeholder:text-warm-label focus-visible:ring-2 focus-visible:ring-brand"
            />
          </label>
          <p className="mt-1 text-[12px] text-warm-meta">Visitors see a short placeholder card instead of this question.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={resolving}
              onClick={() => void resolve('set_aside')}
              className="inline-flex min-h-10 items-center rounded-full bg-panel px-4 text-[13px] font-bold text-background transition-transform duration-150 active:scale-[0.96] disabled:opacity-60"
            >
              {resolving ? 'Setting aside...' : 'Set aside'}
            </button>
            <button
              type="button"
              disabled={resolving}
              onClick={() => setAsideOpen(false)}
              className="inline-flex min-h-10 items-center rounded-full bg-muted px-4 text-[13px] font-semibold text-warm-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {resolveError ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {resolveError}
        </p>
      ) : null}

      {!editing ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={startEdit}
            aria-label={`Edit ${qName}`}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-card px-3.5 text-[13px] font-bold text-foreground transition-transform duration-150 hover:bg-warm-hairline active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Edit
          </button>
          <button
            type="button"
            aria-expanded={showVersions}
            aria-label={`${showVersions ? 'Hide versions of' : 'Versions of'} ${qName}`}
            onClick={() => setShowVersions((v) => !v)}
            className={cn(
              'inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              showVersions ? 'bg-panel text-background' : 'bg-card text-foreground hover:bg-warm-hairline',
            )}
          >
            <History className="h-3.5 w-3.5" aria-hidden />
            Versions
          </button>
        </div>
      ) : null}

      {showVersions ? (
        <div className="mt-3">
          <QuestionVersions
            api={api}
            questionId={row.id}
            questionLabel={label}
            figure={row.figure}
            reloadKey={versionsKey}
            onRestored={() => onSaved()}
            now={now}
          />
        </div>
      ) : null}
    </li>
  );
}
