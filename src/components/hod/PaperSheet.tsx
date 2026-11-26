import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { MathText } from '@/components/papers/math-text';
import { OptionList, OrDivider, PaperHeader, QuestionMeta, QuestionRow, SectionTitle } from '@/components/papers/printed-paper';
import { PaperRowEditor, rowKindWords } from '@/components/hod/PaperRowEditor';
import { deskLink, quietButton } from '@/components/hod/HodShared';
import { actionToneClass } from '@/lib/checker-button-styles';
import { alternativeRuns, formatPaperTime, marksShownInText, paperHeaderLines, partIndent, sectionHeadings, showIncompleteNote } from '@/lib/bank-paper-display';
import { displayBodyWithoutDuplicateNumber } from '@/lib/checker-body';
import { paperSourceName } from '@/lib/school-display';
import type { HodApi } from '@/lib/hod-api';
import {
  MARK_WORDS,
  canLeaveOut,
  errorWords,
  headingRun,
  isConflict,
  isRealQuestion,
  leftOutText,
  liveOptionTexts,
  marksMismatch,
  planLine,
  questionDepths,
  savedWords,
  useUnsavedMark,
  withLineInFront,
  type HodPreview,
  type LinePlan,
  type PreviewQuestion,
} from '@/lib/hod-publish';
import { instructionsAreSaved, instructionsText, leadingInstructionRows } from '@/lib/paper-instructions';
import { cn } from '@/lib/utils';

/* The paper as the live page draws it (owner audit, 26 Nov 2026: "the preview does not look like the live page").
   It is built from the live page's own parts (src/components/papers/printed-paper.tsx): the printed header, the
   General instructions, a centred section title above the first question of each heading, OR between the choices
   of an OR group, the number in the margin, the marks in brackets, the options with their own letters and the maths
   drawn. Question words go through MathText exactly as stored, never altered.

   On top of that sit the desk's own controls, only while the paper is not live: Edit on every question, heading and
   line, Leave it out, Put it back. A heading or instruction line the computer read is not a row on the live site;
   when its words already show on the live page (as a heading or a question's instructions) it is not drawn twice,
   and when they do not, it is drawn as a quiet note "Not shown on the live site" whose Edit puts the words where the
   live page reads them (the questions' heading box, a question's instructions, or the General instructions). */

/** What the desk is doing about ready pictures that have no public copy yet (see PublishFlow). */
export type PictureWork = 'running' | 'failed' | 'unavailable' | null;

/** The words under a ready picture that has no public copy yet. Never red: the picture is fine, it is only being copied. */
export function pictureNote(work: PictureWork | undefined): string {
  if (work === 'running') return 'Getting this picture ready for the site...';
  if (work === 'failed') return 'This picture could not be copied to the site just now. Use Try again at the top of the paper.';
  return 'This picture is ready. It is copied to the site when the paper is opened here.';
}

const EDIT_BUTTON =
  'inline-flex min-h-11 md:min-h-10 items-center rounded-full bg-muted px-3.5 font-sans text-[13px] font-bold text-foreground transition-transform duration-150 hover:bg-warm-hairline active:scale-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const editButtonId = (rowId: string) => `edit-${rowId}`;

/** After an editor closes: the row comes back into view and the focus returns to its Edit button, not the top of the page. */
function backToRow(rowId: string) {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => {
    const button = document.getElementById(editButtonId(rowId));
    const row = document.getElementById(`q-${rowId}`);
    // The middle of the screen, so it never ends up under the fixed site header or the step bar.
    (button ?? row)?.scrollIntoView?.({ block: 'center' });
    button?.focus({ preventScroll: true });
  }, 30);
}

function labelOf(q: Pick<PreviewQuestion, 'display_number' | 'number_path'>): string {
  return q.display_number ?? q.number_path ?? '?';
}

/** The small marks the desk puts on a question (never on the live page): still open, checked by the AI only, scanner
 *  junk, picture not copied. */
function DeskChips({ q }: { q: PreviewQuestion }) {
  const unstaged = q.has_picture && !q.picture_staged && !q.figure_path;
  const aiOnly = q.ai_only === true && q.state !== 'set_aside';
  if (q.state !== 'open' && !q.scanner_junk && !unstaged && !aiOnly) return null;
  return (
    <p className="mb-1.5 flex flex-wrap gap-1.5 font-sans" data-testid="desk-chips">
      {q.state === 'open' ? <span className="rounded-full bg-brand px-2 py-0.5 text-[12px] font-bold text-foreground">{MARK_WORDS.open.chip}</span> : null}
      {aiOnly ? (
        <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-[12px] font-bold text-foreground" data-testid="ai-only-chip" title="Passed by the AI with no person checking">
          {MARK_WORDS.ai_only.chip}
        </span>
      ) : null}
      {q.scanner_junk ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[12px] font-bold text-destructive">{MARK_WORDS.junk.chip}</span> : null}
      {unstaged ? <span className="rounded-full bg-muted px-2 py-0.5 text-[12px] font-bold text-foreground">{MARK_WORDS.pictures.chip}</span> : null}
    </p>
  );
}

/** A picture the checkers kept: shown from the private store exactly as it will look, with a small plain note. */
function UnstagedPicture({ api, path, label, work }: { api: Pick<HodApi, 'pictureUrl'>; path: string | null; label: string; work?: PictureWork }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api.pictureUrl(path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return (
    <figure className="mt-2.5" data-testid="unstaged-picture">
      {url ? <img src={url} alt={`Figure for question ${label}`} loading="lazy" decoding="async" className="max-h-[300px] w-auto max-w-full rounded-[12px] bg-card p-2 shadow-border" /> : null}
      <figcaption className="mt-1 font-sans text-[12px] text-warm-secondary" role={work === 'failed' ? 'status' : undefined}>
        {pictureNote(work)}
      </figcaption>
    </figure>
  );
}

function SheetQuestion({
  q,
  depth,
  api,
  paperId,
  editable,
  onChanged,
  pictureWork,
  current,
  leaveOutAny = false,
}: {
  pictureWork?: PictureWork;
  /** The database accepts Leave it out on every question of this paper (preview paper.leave_out_any). */
  leaveOutAny?: boolean;
  q: PreviewQuestion;
  depth: number;
  api: HodApi;
  paperId: string;
  editable: boolean;
  onChanged: () => void;
  /** The question a "Show me" is pointing at right now. */
  current: boolean;
}) {
  const [mode, setMode] = useState<null | 'fix' | 'aside'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // Someone else saved first: when the fresh copy arrives, the editor is opened again on their words.
  const [editorKey, setEditorKey] = useState(0);
  const reloadOnFresh = useRef(false);
  useEffect(() => {
    if (!reloadOnFresh.current) return;
    reloadOnFresh.current = false;
    setEditorKey((k) => k + 1);
  }, [q.version]);
  useUnsavedMark(`aside-${q.id}`, mode === 'aside' && note.trim() !== '');
  const asideRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (mode === 'aside') asideRef.current?.focus();
  }, [mode]);
  const label = labelOf(q);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode(null);
      setNote('');
      toast.success(done);
      onChanged();
      backToRow(q.id);
    } catch (err) {
      if (isConflict(err)) reloadOnFresh.current = true;
      setError(errorWords(err));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error ? (
    <p role="alert" className="mt-2 font-sans text-[13px] text-destructive">
      {error}
    </p>
  ) : null;

  if (mode === 'fix') {
    return (
      <li id={`q-${q.id}`} style={partIndent(depth)} className="rounded-[14px] bg-muted p-3 font-sans" data-testid="sheet-question-editing">
        <PaperRowEditor
          key={`${q.id}-${editorKey}`}
          row={q}
          busy={busy}
          error={error}
          onError={setError}
          onCancel={() => {
            setMode(null);
            setError(null);
            backToRow(q.id);
          }}
          onSave={(changes) => {
            if (Object.keys(changes).length === 0) {
              setMode(null);
              backToRow(q.id);
              return;
            }
            void run(() => api.editQuestion(q.id, q.version, changes, ''), savedWords(q));
          }}
        />
      </li>
    );
  }

  if (q.state === 'set_aside') {
    return (
      <QuestionRow
        id={q.id}
        depth={depth}
        number={q.display_number}
        marks={null}
        below={
          <div className="font-sans">
            {editable ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  id={editButtonId(q.id)}
                  className={cn(actionToneClass('brand'), 'h-[46.5px]')}
                  disabled={busy}
                  onClick={() => void run(() => api.setQuestionState(q.id, 'reopen'), `Question ${label} is back in the paper.`)}
                >
                  {busy ? 'Putting it back...' : 'Put it back'}
                </button>
              </div>
            ) : null}
            {errorLine}
          </div>
        }
      >
        <div className="rounded-[10px] border border-dashed border-warm-label bg-muted p-3 font-sans" data-testid="sheet-left-out">
          <p className="text-[14px] font-semibold text-foreground">Question {label} is left out.</p>
          <p className="text-[13px] text-warm-secondary">
            {q.set_aside_reason ? `Why: ${q.set_aside_reason}. ` : ''}It will not go live with the paper. Visitors see a short note in its place.
          </p>
        </div>
      </QuestionRow>
    );
  }

  const unstaged = q.has_picture && !q.picture_staged && !q.figure_path;
  const options = liveOptionTexts(q.options_raw);
  const marks = q.marks !== null && !marksShownInText(q.marks, q.body) ? q.marks : null;
  return (
    <QuestionRow
      id={q.id}
      depth={depth}
      number={q.display_number}
      marks={marks}
      below={
        <div className="font-sans">
          {q.state === 'open' ? (
            <p className="mt-2 text-[13px] text-foreground">
              This one still needs a decision.{' '}
              <Link to={deskLink('needs-you', paperId)} className="font-bold text-brand-blue underline underline-offset-2">
                Settle it in Needs you
              </Link>
            </p>
          ) : null}
          {editable ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                id={editButtonId(q.id)}
                className={EDIT_BUTTON}
                onClick={() => {
                  setMode('fix');
                  setError(null);
                }}
                aria-label={`Edit question ${label}`}
              >
                Edit
              </button>
              {canLeaveOut(q, leaveOutAny) ? (
                <button
                  type="button"
                  className={cn(EDIT_BUTTON, 'text-warm-secondary')}
                  onClick={() => setMode(mode === 'aside' ? null : 'aside')}
                  aria-expanded={mode === 'aside'}
                  aria-label={`Leave question ${label} out`}
                >
                  Leave it out
                </button>
              ) : null}
            </div>
          ) : null}
          {mode === 'aside' ? (
            <div className="mt-2 rounded-[14px] bg-muted p-3" data-testid="leave-out-form">
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-warm-secondary">
                Why is it being left out?
                <input
                  ref={asideRef}
                  value={note}
                  onChange={(ev) => setNote(ev.target.value)}
                  disabled={busy}
                  className="min-h-11 rounded-xl bg-card px-3 text-[16px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus sm:text-[14px] md:min-h-10"
                />
              </label>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={actionToneClass('dark')}
                  disabled={busy || note.trim() === ''}
                  onClick={() => void run(() => api.setQuestionState(q.id, 'set_aside', note.trim()), `Question ${label} is left out.`)}
                >
                  {busy ? 'Saving...' : 'Leave it out'}
                </button>
                <button
                  type="button"
                  className={quietButton}
                  disabled={busy}
                  onClick={() => {
                    setMode(null);
                    setNote('');
                    backToRow(q.id);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {errorLine}
        </div>
      }
    >
      <div
        className={cn(current && 'rounded-[10px] ring-2 ring-brand ring-offset-4 ring-offset-card')}
        data-testid="sheet-question"
        data-current={current || undefined}
      >
        <DeskChips q={q} />
        {/* The paper's own word for this OR choice, small, as the live page shows it. */}
        <QuestionMeta parts={[q.alternative_label]} />
        {q.instructions ? <MathText text={q.instructions} className="mb-1.5 text-[14px] italic leading-[1.55] text-warm-secondary" /> : null}
        {q.body.trim() ? (
          <MathText text={displayBodyWithoutDuplicateNumber(q.body, q.display_number)} className="text-[15px] leading-[1.6] text-foreground" />
        ) : (
          <p className="font-sans text-[14px] italic text-warm-label">This question has no words.</p>
        )}
        {options.length > 0 ? <OptionList keyPrefix={q.id} options={options} /> : null}
        {q.figure_path ? (
          <figure className="mt-2.5" data-testid="sheet-figure">
            <img
              src={api.figureUrl(q.figure_path) ?? undefined}
              alt={`Figure for question ${label}`}
              loading="lazy"
              decoding="async"
              className="max-h-[300px] w-auto max-w-full rounded-[12px] bg-card p-2 shadow-border"
            />
          </figure>
        ) : null}
        {unstaged ? <UnstagedPicture api={api} path={q.figure_storage_path} label={label} work={pictureWork} /> : null}
      </div>
    </QuestionRow>
  );
}

/** Save several versioned edits one after another. Stops at the first refusal and says how far it got. */
async function editAll(api: HodApi, edits: { q: PreviewQuestion; changes: Record<string, unknown> }[]): Promise<void> {
  let done = 0;
  for (const e of edits) {
    try {
      await api.editQuestion(e.q.id, e.q.version, e.changes, '');
      done++;
    } catch (err) {
      if (done === 0) throw err;
      const words = errorWords(err);
      throw Object.assign(new Error(`${done} of ${edits.length} saved, then this stopped: ${words}`), { code: (err as { code?: unknown })?.code });
    }
  }
}

/** A heading as the live page draws it, with an Edit that changes the heading box of every question under it. */
function SheetHeading({
  label,
  runIds,
  coveringLines,
  byId,
  api,
  editable,
  onChanged,
}: {
  label: string;
  runIds: string[];
  /** The heading lines the computer read that say the same words (kept in step so they do not show up again). */
  coveringLines: PreviewQuestion[];
  byId: Map<string, PreviewQuestion>;
  api: HodApi;
  editable: boolean;
  onChanged: () => void;
}) {
  const key = `heading-${runIds[0]}`;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUnsavedMark(key, editing && value.trim() !== label.trim());
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function save() {
    const v = value.trim();
    const edits: { q: PreviewQuestion; changes: Record<string, unknown> }[] = [];
    for (const id of runIds) {
      const q = byId.get(id);
      if (q && (q.section_label ?? '').trim() !== v) edits.push({ q, changes: { section_label: v === '' ? null : v } });
    }
    for (const line of coveringLines) if (line.body !== v) edits.push({ q: line, changes: { body: v } });
    if (edits.length === 0) {
      setEditing(false);
      backToRow(key);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await editAll(api, edits);
      setEditing(false);
      toast.success(v === '' ? 'Heading taken off the live paper.' : 'Heading saved.');
      onChanged();
      backToRow(key);
    } catch (err) {
      setError(
        isConflict(err) ? 'Someone else saved one of these questions first, so not everything was saved. Press Cancel, then edit the heading again.' : errorWords(err),
      );
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li id={`q-${key}`} className="rounded-[14px] bg-muted p-3 font-sans" data-testid="heading-editing">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-foreground">
          Heading on the live site, above {runIds.length === 1 ? 'the 1 question under it' : `the ${runIds.length} questions under it`}
          <input
            ref={inputRef}
            value={value}
            onChange={(ev) => setValue(ev.target.value)}
            disabled={busy}
            className="min-h-11 rounded-xl bg-card px-3 text-[16px] font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus sm:text-[14px]"
          />
        </label>
        <p className="mt-1 text-[12px] text-warm-meta">Leave it empty to show no heading here.</p>
        {error ? (
          <p role="alert" className="mt-2 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={cn(actionToneClass('brand'), 'h-[46.5px]')} disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            className={quietButton}
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setValue(label);
              setError(null);
              backToRow(key);
            }}
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }
  return (
    <>
      <SectionTitle label={label} />
      {editable ? (
        <li id={`q-${key}`} className="flex justify-center" data-testid="heading-edit">
          <button
            type="button"
            id={editButtonId(key)}
            className={EDIT_BUTTON}
            onClick={() => {
              setValue(label);
              setEditing(true);
            }}
            aria-label={`Edit the heading ${label}`}
          >
            Edit heading
          </button>
        </li>
      ) : null}
    </>
  );
}

/** Where saving a line puts its words on the live site, in plain words (null: nowhere). */
function liveNoteFor(plan: LinePlan, byId: Map<string, PreviewQuestion>): string | undefined {
  if (plan.target === 'heading') {
    const n = plan.questionIds.length;
    return `Saving shows these words on the live site as the heading above ${n === 1 ? 'the 1 question' : `the ${n} questions`} under this line. Remove this line drops it from the preview instead.`;
  }
  if (plan.target === 'instruction') {
    const q = byId.get(plan.questionIds[0]);
    return `Saving shows these words on the live site above question ${q ? labelOf(q) : '?'}, as its instructions.`;
  }
  if (plan.target === 'general') return "Saving adds these words to the paper's General instructions on the live site.";
  return undefined;
}

/** A heading or instruction line whose words are not on the live page yet: a quiet note, never pretending. */
function SheetLine({
  q,
  plan,
  byId,
  generalInstructions,
  paperId,
  api,
  editable,
  onChanged,
}: {
  q: PreviewQuestion;
  plan: LinePlan;
  byId: Map<string, PreviewQuestion>;
  generalInstructions: string | null;
  paperId: string;
  api: HodApi;
  editable: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const reloadOnFresh = useRef(false);
  useEffect(() => {
    if (!reloadOnFresh.current) return;
    reloadOnFresh.current = false;
    setEditorKey((k) => k + 1);
  }, [q.version]);
  const isHeading = q.kind === 'section_break';
  const empty = q.body.trim() === '';

  async function remove() {
    const old = q.body;
    const version = await api.editQuestion(q.id, q.version, { body: '' }, '');
    toast.success('Line removed from the preview.', {
      action: {
        label: 'Undo',
        onClick: () => {
          void api
            .editQuestion(q.id, version, { body: old }, '')
            .then(() => {
              toast.success('Line put back.');
              onChanged();
            })
            .catch((err) => toast.error(errorWords(err, 'Could not put the line back. Nothing was changed.')));
        },
      },
    });
  }

  async function pushLive(words: string) {
    if (plan.target === 'heading') {
      const edits = plan.questionIds
        .map((id) => byId.get(id))
        .filter((x): x is PreviewQuestion => Boolean(x) && (x!.section_label ?? '').trim() !== words.trim())
        .map((x) => ({ q: x, changes: { section_label: words } }));
      await editAll(api, edits);
    } else if (plan.target === 'instruction') {
      const target = byId.get(plan.questionIds[0]);
      if (target) await api.editQuestion(target.id, target.version, { instructions: withLineInFront(words, target.instructions) }, '');
    } else if (plan.target === 'general') {
      const now = (generalInstructions ?? '').trim();
      await api.updatePublishMeta(paperId, 'general_instructions', now === '' ? words : `${generalInstructions}\n${words}`);
    }
  }

  async function save(changes: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      if (changes.body === '') {
        await remove();
      } else {
        const words = typeof changes.body === 'string' ? changes.body : q.body;
        if (Object.keys(changes).length > 0) await api.editQuestion(q.id, q.version, changes, '');
        if (plan.target !== 'none' && words.trim() !== '') {
          await pushLive(words);
          toast.success('Line saved. It now shows on the live site.');
        } else if (Object.keys(changes).length > 0) {
          toast.success('Line saved.');
        }
      }
      setEditing(false);
      onChanged();
      backToRow(q.id);
    } catch (err) {
      if (isConflict(err)) reloadOnFresh.current = true;
      setError(errorWords(err));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li id={`q-${q.id}`} className="rounded-[14px] bg-muted p-3 font-sans" data-testid="sheet-line-editing">
        <PaperRowEditor
          key={`${q.id}-${editorKey}`}
          row={q}
          busy={busy}
          error={error}
          onError={setError}
          liveNote={liveNoteFor(plan, byId)}
          onSave={(c) => void save(c)}
          onCancel={() => {
            setEditing(false);
            setError(null);
            backToRow(q.id);
          }}
        />
      </li>
    );
  }
  // Not on the live site, so a live paper's preview does not show it. While the paper can be edited, even an emptied
  // line stays as a small way back.
  if (!editable) return null;
  return (
    <li id={`q-${q.id}`} className="my-1 rounded-[12px] border border-dashed border-warm-hairline px-3 py-2 font-sans" data-testid="sheet-line" data-kind={q.kind}>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-warm-label">
        {rowKindWords(q.kind)} the computer read. Not shown on the live site.
      </p>
      {empty ? (
        <p className="mt-1 text-[13px] italic text-warm-secondary">An empty line (taken out of the preview).</p>
      ) : (
        <MathText text={q.body} className={cn('mt-1 text-[14px] leading-[1.55] text-warm-secondary', isHeading ? 'font-bold uppercase' : 'italic')} />
      )}
      {!empty && plan.target === 'none' ? (
        <p className="mt-1 text-[12px] text-warm-meta">There is no question under this line, so its words cannot show on the live site.</p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          id={editButtonId(q.id)}
          className={EDIT_BUTTON}
          onClick={() => setEditing(true)}
          aria-label={isHeading ? 'Edit this heading line' : 'Edit this line'}
        >
          {plan.target === 'none' || empty ? 'Edit' : 'Edit and show it on the site'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** The paper's General instructions, drawn as the live page draws them, with an Edit button (saved through the same box as the Details step). */
function GeneralInstructionsBlock({
  api,
  paperId,
  text,
  editable,
  onChanged,
  children,
}: {
  api: HodApi;
  paperId: string;
  text: string | null;
  editable: boolean;
  onChanged: () => void;
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUnsavedMark('general-instructions', editing && value !== (text ?? ''));
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (editing) areaRef.current?.focus();
  }, [editing]);

  function close() {
    setEditing(false);
    backToRow('general-instructions');
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updatePublishMeta(paperId, 'general_instructions', value);
      toast.success('General instructions saved.');
      close();
      onChanged();
    } catch (err) {
      setError(errorWords(err, 'Could not save the instructions. Nothing was changed.'));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <section aria-label="General instructions" id="q-general-instructions" className="border-b border-border py-4 font-sans" data-testid="general-instructions-editing">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-foreground">
          General instructions, as printed on the paper
          <textarea
            ref={areaRef}
            value={value}
            onChange={(ev) => setValue(ev.target.value)}
            rows={8}
            disabled={busy}
            className="w-full rounded-xl bg-muted p-3 text-[16px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-focus sm:text-[14px]"
          />
        </label>
        {error ? (
          <p role="alert" className="mt-2 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={cn(actionToneClass('brand'), 'h-[46.5px]')} disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            className={quietButton}
            disabled={busy}
            onClick={() => {
              setValue(text ?? '');
              setError(null);
              close();
            }}
          >
            Cancel
          </button>
        </div>
      </section>
    );
  }
  return (
    <section aria-label="General instructions" id="q-general-instructions" className="border-b border-border py-4 font-paper" data-testid="general-instructions">
      {children}
      {editable ? (
        <div className="mt-2 font-sans">
          <button
            type="button"
            id={editButtonId('general-instructions')}
            className={EDIT_BUTTON}
            onClick={() => {
              setValue(text ?? '');
              setEditing(true);
            }}
          >
            {text ? 'Edit the general instructions' : 'Add general instructions'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

const INSTRUCTIONS_HEADING = 'mb-1 text-[12px] font-bold uppercase tracking-[0.1em] text-warm-secondary';

export function PaperSheet({
  preview,
  api,
  editable,
  onChanged,
  pictureWork,
  editInstructions = true,
  currentId = null,
}: {
  preview: HodPreview;
  api: HodApi;
  /** Questions can be fixed or put back only while the paper is not live. */
  editable: boolean;
  onChanged: () => void;
  /** What the desk is doing about ready pictures without a public copy yet; shown as a small neutral note. */
  pictureWork?: PictureWork;
  /** False where the General instructions already have their own box on the same screen (the Details step), so there is one editor, not two. */
  editInstructions?: boolean;
  /** The question a "Show me" is pointing at, ringed so it stands out. */
  currentId?: string | null;
}) {
  const { paper, questions, counts } = preview;
  const h = paper.header;
  const depths = useMemo(() => questionDepths(questions), [questions]);
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const real = useMemo(() => questions.filter(isRealQuestion), [questions]);
  const leftOut = leftOutText(counts.set_aside);
  const mismatch = marksMismatch(h, paper.marks_from_questions);
  // Some papers keep their general instructions as the first lines of the list, with nothing in the box.
  const topLines = useMemo(() => leadingInstructionRows(questions), [questions]);
  const topLinesSaved = instructionsAreSaved(h.general_instructions, topLines);
  const topLineIds = useMemo(() => new Set(topLinesSaved ? topLines.map((r) => r.id) : []), [topLines, topLinesSaved]);
  // With the box empty the top lines are drawn in the General instructions place above, so not again below.
  const shownAbove = useMemo(() => new Set(h.general_instructions ? [] : topLines.map((r) => r.id)), [h.general_instructions, topLines]);
  // The live page's own layout rules, over the real questions in paper order.
  const headings = useMemo(() => sectionHeadings(real.map((q) => ({ i: q.id, sec: q.section_label }))), [real]);
  const orFollowers = useMemo(() => {
    const out = new Set<string>();
    for (const ids of alternativeRuns(real.map((q) => ({ i: q.id, ag: q.alternative_group ?? null }))).values()) ids.slice(1).forEach((id) => out.add(id));
    return out;
  }, [real]);
  const plans = useMemo(() => {
    const out = new Map<string, LinePlan>();
    for (const q of questions) if (!isRealQuestion(q)) out.set(q.id, planLine(questions, q.id, h.general_instructions));
    return out;
  }, [questions, h.general_instructions]);
  // A heading line whose words the live heading already shows travels with that heading when it is edited.
  const coveringLines = useMemo(() => {
    const out = new Map<string, PreviewQuestion[]>();
    for (const [lineId, plan] of plans) {
      if (plan.target !== 'heading' || !plan.covered) continue;
      const first = plan.questionIds[0];
      out.set(first, [...(out.get(first) ?? []), byId.get(lineId)!]);
    }
    return out;
  }, [plans, byId]);

  const [savingTop, setSavingTop] = useState(false);
  async function saveTopLines() {
    setSavingTop(true);
    try {
      await api.updatePublishMeta(paper.audit_paper_id, 'general_instructions', instructionsText(topLines));
      toast.success('Saved as the general instructions.');
      onChanged();
    } catch (e) {
      toast.error(errorWords(e, 'Could not save the instructions. Nothing was changed.'));
    } finally {
      setSavingTop(false);
    }
  }
  const { headline, sub } = paperHeaderLines({ exam: h.exam, year: h.year, cls: h.cls, subject: h.subject ?? '', board: h.board });
  const time = formatPaperTime(h.allowed_time_minutes);
  const missing = [
    h.school ? null : 'school',
    h.allowed_time_minutes || h.time_not_printed ? null : 'time allowed',
    h.marks ? null : 'maximum marks',
  ].filter((x): x is string => Boolean(x));
  const instructionsEditable = editable && editInstructions;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Paper summary" data-testid="sheet-summary">
        <span className="rounded-full bg-muted px-3 py-1 text-[12px] font-semibold tabular-nums text-foreground">{counts.total} questions</span>
        <span className="rounded-full bg-muted px-3 py-1 text-[12px] font-semibold tabular-nums text-foreground">{counts.passed} passed</span>
        {counts.open > 0 ? <span className="rounded-full bg-brand px-3 py-1 text-[12px] font-bold tabular-nums text-foreground">{counts.open} still open</span> : null}
        {leftOut ? (
          <span className="rounded-full bg-brand-subtle px-3 py-1 text-[12px] font-bold tabular-nums text-foreground" data-testid="left-out-count">
            {leftOut}
          </span>
        ) : null}
        {paper.page_count > 0 ? <span className="text-[12px] text-warm-meta">{paper.page_count} printed pages</span> : null}
      </div>
      {mismatch ? (
        <p role="note" className="mb-3 rounded-2xl bg-brand-subtle px-4 py-3 text-[14px] text-foreground" data-testid="marks-mismatch">
          {mismatch}
        </p>
      ) : null}
      {missing.length > 0 ? (
        <p role="note" className="mb-3 rounded-2xl bg-muted px-4 py-3 text-[14px] text-foreground" data-testid="header-missing">
          The live page leaves out what the paper has no value for. Not filled in yet: {missing.join(', ')}. Add {missing.length === 1 ? 'it' : 'them'} on the
          Details step.
        </p>
      ) : null}

      <article
        aria-label="The paper as visitors will read it"
        className="mx-auto w-full max-w-3xl rounded-[12px] bg-card px-3.5 py-6 shadow-card ring-1 ring-black/5 sm:px-10 sm:py-10"
        data-testid="paper-surface"
      >
        <PaperHeader
          source={paperSourceName(h.school)}
          headline={headline}
          sub={sub}
          time={time}
          marks={h.marks && h.marks > 0 ? h.marks : null}
          generalInstructions={null}
          incompleteNote={null}
        />

        {h.general_instructions ? (
          <GeneralInstructionsBlock api={api} paperId={paper.audit_paper_id} text={h.general_instructions} editable={instructionsEditable} onChanged={onChanged}>
            <h3 className={INSTRUCTIONS_HEADING}>General instructions</h3>
            <MathText text={h.general_instructions} className="text-[14px] leading-[1.6] text-foreground" />
            {editable && !editInstructions ? <p className="mt-1 font-sans text-[12px] text-warm-meta">Change them in the General instructions box above.</p> : null}
          </GeneralInstructionsBlock>
        ) : topLines.length > 0 ? (
          <GeneralInstructionsBlock api={api} paperId={paper.audit_paper_id} text={instructionsText(topLines)} editable={instructionsEditable} onChanged={onChanged}>
            <h3 className={INSTRUCTIONS_HEADING} data-testid="top-lines-instructions">
              General instructions
            </h3>
            <ul className="list-disc pl-5">
              {topLines.map((r) => (
                <li key={r.id}>
                  <MathText text={r.body} className="text-[14px] leading-[1.6] text-foreground" />
                </li>
              ))}
            </ul>
            <div className="mt-3 rounded-2xl bg-brand-subtle p-3 font-sans text-[13px] text-foreground">
              <p>
                These are the first lines of the paper. The paper's General instructions box is empty, so the live page shows no instructions and the checks
                count it as having none.
                {editable ? ' Save these lines in the box to fix that.' : ''}
              </p>
              {editable ? (
                <button type="button" className={cn(actionToneClass('dark'), 'mt-2')} disabled={savingTop} onClick={() => void saveTopLines()}>
                  {savingTop ? 'Saving...' : 'Use these as the general instructions'}
                </button>
              ) : null}
            </div>
          </GeneralInstructionsBlock>
        ) : instructionsEditable ? (
          <GeneralInstructionsBlock api={api} paperId={paper.audit_paper_id} text={null} editable={instructionsEditable} onChanged={onChanged}>
            <p className="font-sans text-[13px] italic text-warm-secondary">
              No general instructions on this paper yet. If the printed paper has some, add them here or on the Details step.
            </p>
          </GeneralInstructionsBlock>
        ) : null}
        {showIncompleteNote(h.incomplete_note) ? (
          <p className="border-b border-border py-3 font-sans text-[12px] italic leading-[1.5] text-muted-foreground" data-testid="sheet-incomplete-note">
            {h.incomplete_note}
          </p>
        ) : null}

        <ol className="mt-2 grid grid-cols-1 gap-1" aria-label="Questions">
          {questions.map((q) => {
            // Already shown, word for word, as the saved general instructions above.
            if (topLineIds.has(q.id)) return null;
            if (shownAbove.has(q.id)) return null;
            if (!isRealQuestion(q)) {
              const plan = plans.get(q.id)!;
              // Its words already show on the live page (as a heading or instructions): edited there, not drawn twice.
              if (plan.covered) return null;
              return (
                <SheetLine
                  key={q.id}
                  q={q}
                  plan={plan}
                  byId={byId}
                  generalInstructions={h.general_instructions}
                  paperId={paper.audit_paper_id}
                  api={api}
                  editable={editable}
                  onChanged={onChanged}
                />
              );
            }
            const heading = headings.get(q.id);
            return (
              <Fragment key={q.id}>
                {heading ? (
                  <SheetHeading
                    label={heading}
                    runIds={headingRun(questions, q.id)}
                    coveringLines={coveringLines.get(q.id) ?? []}
                    byId={byId}
                    api={api}
                    editable={editable}
                    onChanged={onChanged}
                  />
                ) : null}
                {orFollowers.has(q.id) ? <OrDivider /> : null}
                <SheetQuestion
                  q={q}
                  depth={depths.get(q.id) ?? 0}
                  api={api}
                  paperId={paper.audit_paper_id}
                  editable={editable}
                  onChanged={onChanged}
                  pictureWork={pictureWork}
                  current={currentId === q.id}
                  leaveOutAny={paper.leave_out_any}
                />
              </Fragment>
            );
          })}
        </ol>
      </article>
    </div>
  );
}
