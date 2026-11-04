import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { QuestionBody } from '@/components/admin/approval/QuestionBody';
import { MathText } from '@/components/papers/math-text';
import { QuestionFixForm } from '@/components/hod/QuestionFixForm';
import { deskLink, quietButton } from '@/components/hod/HodShared';
import { actionToneClass } from '@/lib/checker-button-styles';
import { displaySchool } from '@/lib/school-display';
import type { HodApi } from '@/lib/hod-api';
import { errorWords, leftOutText, marksMismatch, questionDepths, type HodPreview, type PreviewQuestion } from '@/lib/hod-publish';
import { cn } from '@/lib/utils';

/* The paper as a printed sheet: school and exam at the top, time and marks,
   the general instructions, then every question with its picture and tables.
   Question words go through MathText exactly as stored. Questions that were
   left out show as a plain placeholder with a way to put them back; a question
   with scanner junk gets a Fix button so it can be cleaned in place. */

/** 150 -> "2 hours 30 minutes"; 45 -> "45 minutes"; null -> null. */
export function formatMinutes(m: number | null): string | null {
  if (m === null || !Number.isFinite(m) || m <= 0) return null;
  const h = Math.floor(m / 60);
  const rest = Math.round(m % 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ');
}

function labelOf(q: Pick<PreviewQuestion, 'display_number' | 'number_path'>): string {
  return q.display_number ?? q.number_path ?? '?';
}

/** A picture the checkers kept that has not reached the site yet: shown from the private bucket, with a plain note. */
function UnstagedPicture({ api, path, label }: { api: Pick<HodApi, 'pictureUrl'>; path: string | null; label: string }) {
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
    <div className="mt-2 rounded-[12px] bg-destructive/10 p-2" data-testid="unstaged-picture">
      <p className="mb-1 text-[13px] font-semibold text-destructive">The picture for question {label} is not on the site yet.</p>
      {url ? <img src={url} alt={`Picture for question ${label}, not on the site yet`} className="max-h-[240px] w-auto max-w-full rounded-[10px] bg-white p-1" /> : null}
    </div>
  );
}

function SheetQuestion({
  q,
  depth,
  api,
  paperId,
  editable,
  onChanged,
}: {
  q: PreviewQuestion;
  depth: number;
  api: HodApi;
  paperId: string;
  editable: boolean;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<null | 'fix' | 'aside'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const label = labelOf(q);
  const indent = depth > 0 ? { marginLeft: `${Math.min(depth, 3) * 16}px` } : undefined;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode(null);
      setNote('');
      onChanged();
    } catch (err) {
      setError(errorWords(err));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (q.state === 'set_aside') {
    return (
      <li id={`q-${q.id}`} style={indent} className="rounded-[14px] border border-dashed border-warm-label bg-muted p-3" data-testid="sheet-left-out">
        <p className="text-[14px] font-semibold text-foreground">Question {label} is left out.</p>
        <p className="text-[13px] text-warm-secondary">
          {q.set_aside_reason ? `Why: ${q.set_aside_reason}. ` : ''}It will not go live with the paper.
        </p>
        {editable ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={cn(actionToneClass('brand'), 'h-[46.5px]')} disabled={busy} onClick={() => void run(() => api.setQuestionState(q.id, 'reopen'))}>
              {busy ? 'Putting it back...' : 'Put it back'}
            </button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
      </li>
    );
  }

  const unstaged = q.has_picture && !q.picture_staged && !q.figure_path;
  return (
    <li id={`q-${q.id}`} style={indent} className={cn('min-w-0 rounded-[14px] p-3', q.state === 'open' || q.scanner_junk ? 'bg-brand-subtle' : 'bg-transparent')} data-testid="sheet-question">
      {mode === 'fix' ? (
        <QuestionFixForm
          target={{ body: q.body, display_number: q.display_number, marks: q.marks, options: q.options }}
          busy={busy}
          error={error}
          onError={setError}
          primaryLabel="Save the fix"
          onCancel={() => {
            setMode(null);
            setError(null);
          }}
          onSave={(changes) => {
            if (Object.keys(changes).length === 0) {
              setMode(null);
              return;
            }
            void run(() => api.editQuestion(q.id, q.version, changes, ''));
          }}
        />
      ) : (
        <>
          <QuestionBody
            number={q.display_number ?? q.number_path}
            marks={q.marks}
            instructions={q.instructions}
            body={q.body}
            options={q.options}
            figure={null}
            chips={
              <>
                {q.state === 'open' ? <span className="rounded-full bg-brand px-2 py-0.5 text-[12px] font-bold text-foreground">Still open</span> : null}
                {q.scanner_junk ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[12px] font-bold text-destructive">Scanner junk</span> : null}
              </>
            }
          />
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
          {unstaged ? <UnstagedPicture api={api} path={q.figure_storage_path} label={label} /> : null}
          {q.state === 'open' ? (
            <p className="mt-2 text-[13px] text-foreground">
              This one still needs a decision.{' '}
              <Link to={deskLink('needs-you', paperId)} className="font-bold text-brand-blue underline underline-offset-2">
                Settle it in Needs you
              </Link>
            </p>
          ) : null}
          {editable && q.state !== 'section' ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="inline-flex min-h-10 items-center rounded-full bg-card px-3.5 text-[13px] font-bold text-foreground transition-transform duration-150 hover:bg-warm-hairline active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setMode('fix');
                  setError(null);
                }}
                aria-label={`Fix the words of question ${label}`}
              >
                Fix the words
              </button>
              {q.scanner_junk ? (
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center rounded-full bg-card px-3.5 text-[13px] font-bold text-warm-secondary transition-transform duration-150 hover:bg-warm-hairline active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <div className="mt-2 rounded-[14px] bg-card p-3">
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-warm-secondary">
                Why is it being left out?
                <input
                  value={note}
                  onChange={(ev) => setNote(ev.target.value)}
                  disabled={busy}
                  className="min-h-10 rounded-xl bg-muted px-3 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </label>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={actionToneClass('dark')}
                  disabled={busy || note.trim() === ''}
                  onClick={() => void run(() => api.setQuestionState(q.id, 'set_aside', note.trim()))}
                >
                  {busy ? 'Saving...' : 'Leave it out'}
                </button>
                <button type="button" className={quietButton} disabled={busy} onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
        </>
      )}
    </li>
  );
}

export function PaperSheet({
  preview,
  api,
  editable,
  onChanged,
}: {
  preview: HodPreview;
  api: HodApi;
  /** Questions can be fixed or put back only while the paper is not live. */
  editable: boolean;
  onChanged: () => void;
}) {
  const { paper, questions, counts } = preview;
  const h = paper.header;
  const depths = useMemo(() => questionDepths(questions), [questions]);
  const time = formatMinutes(h.allowed_time_minutes);
  const leftOut = leftOutText(counts.set_aside);
  const mismatch = marksMismatch(h, paper.marks_from_questions);
  const school = h.school ? displaySchool(h.school) : null;
  const headline = [h.exam, h.year].filter(Boolean).join(' ');
  const sub = [h.cls ? `Class ${h.cls}` : null, h.subject, h.board].filter(Boolean).join(' · ');

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

      <article aria-label="The paper as visitors will read it" className="mx-auto max-w-3xl rounded-[12px] bg-white px-4 py-6 shadow-md ring-1 ring-black/5 sm:px-10 sm:py-10">
        <header className="border-b-2 border-neutral-800 pb-4 text-center font-serif text-neutral-900">
          {school ? <p className="text-[13px] font-bold uppercase tracking-[0.12em]">{school}</p> : <p className="text-[13px] italic text-neutral-500">School not set</p>}
          {headline ? <h3 className="mt-1 text-balance text-[22px] font-bold">{headline}</h3> : null}
          {sub ? <p className="mt-1 text-[15px]">{sub}</p> : null}
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 text-left text-[14px]">
            <p>
              <span className="font-bold">Time allowed:</span> {time ?? <span className="italic text-neutral-500">not set</span>}
            </p>
            <p className="tabular-nums">
              <span className="font-bold">Maximum marks:</span> {h.marks ?? <span className="italic text-neutral-500">not set</span>}
            </p>
          </div>
        </header>

        {h.general_instructions ? (
          <section aria-label="General instructions" className="border-b border-neutral-300 py-4 font-serif">
            <h4 className="mb-1 text-[13px] font-bold uppercase tracking-[0.08em] text-neutral-700">General instructions</h4>
            <MathText text={h.general_instructions} className="text-[14px] leading-[1.6] text-neutral-900" />
          </section>
        ) : (
          <p className="border-b border-neutral-300 py-4 text-[13px] italic text-neutral-500">No general instructions on this paper yet.</p>
        )}

        <ol className="mt-4 flex flex-col gap-3 font-serif" aria-label="Questions">
          {questions.map((q) => {
            if (q.kind === 'section_break' || q.state === 'section') {
              return (
                <li key={q.id} className="pt-3 text-center text-[14px] font-bold uppercase tracking-[0.1em] text-neutral-800">
                  {q.body || q.section_label || 'Section'}
                </li>
              );
            }
            if (q.kind !== 'question') {
              return (
                <li key={q.id}>
                  <MathText text={q.body} className="text-[14px] italic leading-[1.55] text-neutral-700" />
                </li>
              );
            }
            return <SheetQuestion key={q.id} q={q} depth={depths.get(q.id) ?? 0} api={api} paperId={paper.audit_paper_id} editable={editable} onChanged={onChanged} />;
          })}
        </ol>
      </article>
    </div>
  );
}
