import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MathText } from '@/components/papers/math-text';
import { OptionList } from '@/components/checker/OptionList';
import { BackLink, EmptyNote, ListSkeleton, LoadError, Notice, QuestionPicture, ago, deskLink, quietButton } from '@/components/hod/HodShared';
import { QuestionFixForm } from '@/components/hod/QuestionFixForm';
import { RouteTrail } from '@/components/hod/RouteTrail';
import { actionToneClass } from '@/lib/checker-button-styles';
import { adminFlagLines } from '@/lib/paper-edit';
import type { RawOption } from '@/lib/checker-options';
import type { HodApi } from '@/lib/hod-api';
import {
  canSendBack,
  errorWords,
  trailByPaper,
  waitingOn,
  whyItNeedsYou,
  type HodNeedsQuestion,
  type HodNeedsYouPaper,
} from '@/lib/hod-publish';
import { cn } from '@/lib/utils';

/* "Needs you": the questions only an HOD can settle, grouped by paper. The list
   shows each paper with how many are waiting and where it is on the route. Open a
   paper to see its questions one by one, each with the printed picture (or the
   whole paper when no page matched) and four ways to settle it: Pass, Fix, Send
   back to students, Set aside. After each one the card folds into a line with
   Undo, which puts the question back as it was. The question text is shown as
   stored and sent only when changed, exactly as typed. */

export const NEEDS_YOU_KEY = (scope: string) => ['hod', scope, 'needs-you'] as const;
export const NEEDS_YOU_QUESTIONS_KEY = (scope: string, paperId: string) => ['hod', scope, 'needs-you', paperId] as const;
export const TRAIL_KEY = (scope: string) => ['hod', scope, 'trail'] as const;

type Panel = null | 'fix' | 'back' | 'aside';

interface Settled {
  q: HodNeedsQuestion;
  what: string;
}

function labelOf(q: Pick<HodNeedsQuestion, 'display_number' | 'number_path'>): string {
  return q.display_number ?? q.number_path ?? '?';
}

function QuestionCard({
  q,
  api,
  onSettled,
  onChanged,
}: {
  q: HodNeedsQuestion;
  api: HodApi;
  onSettled: (what: string) => void;
  onChanged: () => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const label = labelOf(q);
  const why = adminFlagLines(q.flag_reasons, null);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (done) onSettled(done);
    } catch (err) {
      setError(errorWords(err));
      // A refusal often means the card is out of date.
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setPanel(null);
    setError(null);
    setNote('');
  }

  const chips = [
    q.display_number ? `Question ${q.display_number}` : null,
    q.marks != null ? `${q.marks} ${q.marks === 1 ? 'mark' : 'marks'}` : null,
    q.page ? `Page ${q.page}` : null,
    q.review_bucket === 'escalated' ? 'Sent up by a student' : 'The computer could not settle it',
  ].filter((x): x is string => Boolean(x));

  return (
    <li className="rounded-[18px] bg-muted p-4" data-testid="needs-question" id={`q-${q.id}`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[15px] font-bold text-foreground">Question {label}</p>
        {q.escalated_at ? <p className="text-[12px] text-warm-meta">Sent {ago(q.escalated_at)}</p> : null}
      </div>
      <p className="mb-3 rounded-xl bg-brand-subtle px-3 py-2 text-[14px] text-foreground" data-testid="why-needs-you">
        {whyItNeedsYou(q)}
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="min-w-0">
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="About this question">
            {chips.map((c) => (
              <li key={c} className="rounded-full bg-card px-3 py-1 text-[12px] font-semibold text-warm-secondary">
                {c}
              </li>
            ))}
          </ul>
          {q.instructions ? (
            <div className="mb-2 rounded-2xl bg-card px-4 py-2">
              <MathText text={q.instructions} className="text-[14px] italic leading-relaxed text-warm-secondary" />
            </div>
          ) : null}
          {panel === 'fix' ? (
            <QuestionFixForm
              target={{ body: q.body, display_number: q.display_number, marks: q.marks, options: q.options_raw }}
              busy={busy}
              error={error}
              onError={setError}
              primaryLabel="Save and pass"
              onCancel={cancel}
              onSave={(changes) =>
                void run(async () => {
                  if (Object.keys(changes).length > 0) await api.editQuestion(q.id, q.version, changes, '');
                  await api.setQuestionState(q.id, 'pass');
                }, `Question ${label} fixed and passed.`)
              }
              secondary={{
                label: 'Save, keep open',
                onSave: (changes) =>
                  void run(async () => {
                    if (Object.keys(changes).length === 0) {
                      setSaved('Nothing to save yet. Change the words, number or marks first.');
                      return;
                    }
                    await api.editQuestion(q.id, q.version, changes, '');
                    setSaved('Saved. Pass it when it reads right.');
                    setPanel(null);
                    onChanged();
                  }),
              }}
            />
          ) : (
            <div className="rounded-2xl bg-card p-4">
              <MathText text={q.body} className="break-words text-[16px] leading-relaxed text-foreground" />
              <OptionList options={Array.isArray(q.options_raw) ? (q.options_raw as RawOption[]) : null} />
            </div>
          )}
          {why.length > 0 ? (
            <ul className="mt-2 space-y-0.5 rounded-[12px] bg-card px-3 py-2 text-[13px] text-warm-secondary">
              {why.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <QuestionPicture
          api={api}
          paperId={q.paper_id}
          path={q.snippet_path ?? q.page_path}
          page={q.page}
          className="min-w-0 lg:sticky lg:top-24 lg:self-start"
        />
      </div>

      {panel === 'back' || panel === 'aside' ? (
        <div className="mt-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-foreground">
            {panel === 'back' ? 'A note for the students (optional)' : 'Why is it being left out? (required)'}
            <textarea
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              rows={2}
              disabled={busy}
              className="w-full rounded-xl bg-card p-3 text-[16px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </label>
        </div>
      ) : null}

      {saved ? (
        <p role="status" className="mt-2 text-[13px] text-foreground">
          {saved}
        </p>
      ) : null}
      {error && panel !== 'fix' ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {panel === null ? (
          <>
            <button
              type="button"
              className={cn(actionToneClass('brand'), 'h-[46.5px]')}
              disabled={busy || !q.body.trim()}
              onClick={() => void run(() => api.setQuestionState(q.id, 'pass'), `Question ${label} passed.`)}
            >
              {busy ? 'Saving...' : 'Pass'}
            </button>
            <button type="button" className={actionToneClass('dark')} disabled={busy} onClick={() => { setSaved(null); setPanel('fix'); }}>
              Fix
            </button>
            {canSendBack(q) ? (
              <button type="button" className={cn(actionToneClass('brand'), 'h-[46.5px]')} disabled={busy} onClick={() => setPanel('back')}>
                Send back to students
              </button>
            ) : null}
            <button type="button" className={quietButton} disabled={busy} onClick={() => setPanel('aside')}>
              Set aside
            </button>
          </>
        ) : panel === 'fix' ? null : (
          <>
            {panel === 'back' ? (
              <button
                type="button"
                className={cn(actionToneClass('brand'), 'h-[46.5px]')}
                disabled={busy}
                onClick={() => void run(() => api.sendBack(q.id, note.trim()), `Question ${label} sent back to the students.`)}
              >
                {busy ? 'Sending...' : 'Send it back'}
              </button>
            ) : (
              <button
                type="button"
                className={actionToneClass('dark')}
                disabled={busy || note.trim() === ''}
                onClick={() => void run(() => api.setQuestionState(q.id, 'set_aside', note.trim()), `Question ${label} left out.`)}
              >
                {busy ? 'Saving...' : 'Leave it out'}
              </button>
            )}
            <button type="button" className={quietButton} disabled={busy} onClick={cancel}>
              Cancel
            </button>
          </>
        )}
      </div>
      {panel === null && !q.body.trim() ? (
        <p className="mt-2 text-[12px] text-warm-meta">Pass is off because this question has no text. Fix it to add the words, or leave it out.</p>
      ) : null}
      {panel === null && q.review_bucket !== 'escalated' ? (
        <p className="mt-2 text-[12px] text-warm-meta">A student did not send this one up, so it cannot go back to them. Pass it, fix it or leave it out.</p>
      ) : null}
    </li>
  );
}

function SettledLine({ s, busy, onUndo }: { s: Settled; busy: boolean; onUndo: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] bg-mint px-4 py-3" data-testid="settled-line">
      <p className="text-[14px] font-semibold text-foreground">{s.what}</p>
      <button
        type="button"
        className="tap-44 rounded-full bg-card px-4 py-2 text-[14px] font-bold text-foreground transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
        disabled={busy}
        onClick={onUndo}
      >
        {busy ? 'Putting it back...' : 'Undo'}
      </button>
    </li>
  );
}

function PaperQuestions({ api, scope, paperId, paper }: { api: HodApi; scope: string; paperId: string; paper: HodNeedsYouPaper | null }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: NEEDS_YOU_QUESTIONS_KEY(scope, paperId),
    queryFn: () => api.needsYouQuestions(paperId),
    staleTime: 0,
    refetchOnMount: true,
  });
  const trailQ = useQuery({ queryKey: TRAIL_KEY(scope), queryFn: () => api.paperTrail(), staleTime: 30_000 });
  const stage = trailByPaper(trailQ.data ?? []).get(paperId)?.stage ?? 'needs_you';
  const [settled, setSettled] = useState<Record<string, Settled>>({});
  const [undoing, setUndoing] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['hod', scope] });

  const server = useMemo(() => q.data ?? [], [q.data]);
  const merged = useMemo(() => {
    const ids = new Set(server.map((x) => x.id));
    const done = Object.values(settled).filter((s) => !ids.has(s.q.id));
    return [...server.map((x) => ({ q: x, settled: null as Settled | null })), ...done.map((s) => ({ q: s.q, settled: s }))].sort((a, b) => a.q.ord - b.q.ord);
  }, [server, settled]);

  async function undo(s: Settled) {
    setUndoing(s.q.id);
    setUndoError(null);
    try {
      await api.setQuestionState(s.q.id, 'reopen');
      setSettled((m) => {
        const next = { ...m };
        delete next[s.q.id];
        return next;
      });
      toast.success(`Question ${labelOf(s.q)} is back in the list.`);
      refresh();
    } catch (err) {
      setUndoError(errorWords(err));
      toast.error(`Question ${labelOf(s.q)} could not be put back. ${errorWords(err)}`);
    } finally {
      setUndoing(null);
    }
  }

  const title = paper?.title ?? 'This paper';
  const openCount = server.length;
  return (
    <div>
      <BackLink to={deskLink('needs-you')}>All papers waiting for you</BackLink>
      <div className="mb-3 rounded-[18px] bg-muted p-4">
        <h2 className="text-balance text-[18px] font-bold text-foreground">{title}</h2>
        {paper ? (
          <p className="mt-0.5 text-[13px] text-warm-secondary">
            {[paper.school, paper.cls ? `Class ${paper.cls}` : null].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        <RouteTrail stage={stage} className="mt-3" />
      </div>
      {q.isLoading ? (
        <ListSkeleton label="Loading the questions" />
      ) : q.isError ? (
        <LoadError what="The questions" onRetry={() => void q.refetch()} />
      ) : (
        <>
          {undoError ? (
            <p role="alert" className="mb-3 rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-destructive">
              {undoError}
            </p>
          ) : null}
          {openCount === 0 ? (
            <div className="mb-3 space-y-2">
              <Notice tone="good">
                {merged.length > 0 ? 'Nothing else on this paper needs you.' : 'Nothing on this paper needs you.'} If every question is settled it moves on to
                Ready to go live.
              </Notice>
              <div className="flex flex-wrap gap-2">
                <Link to={deskLink('ready', paperId)} className={cn(actionToneClass('brand'), 'h-[46.5px]')}>
                  Open it in Ready to go live
                </Link>
                <Link to={deskLink('needs-you')} className={quietButton}>
                  Back to the list
                </Link>
              </div>
            </div>
          ) : (
            <p className="mb-3 text-[13px] text-warm-secondary" data-testid="needs-count">
              {openCount === 1 ? '1 question is waiting for you.' : `${openCount} questions are waiting for you.`}
            </p>
          )}
          <ul className="space-y-3">
            {merged.map(({ q: item, settled: s }) =>
              s ? (
                <SettledLine key={item.id} s={s} busy={undoing === item.id} onUndo={() => void undo(s)} />
              ) : (
                <QuestionCard
                  key={item.id}
                  q={item}
                  api={api}
                  onChanged={refresh}
                  onSettled={(what) => {
                    setSettled((m) => ({ ...m, [item.id]: { q: item, what } }));
                    toast.success(what);
                    refresh();
                  }}
                />
              ),
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function PaperList({ api, scope }: { api: HodApi; scope: string }) {
  const q = useQuery({ queryKey: NEEDS_YOU_KEY(scope), queryFn: () => api.needsYouPapers(), staleTime: 0, refetchOnMount: true });
  const trailQ = useQuery({ queryKey: TRAIL_KEY(scope), queryFn: () => api.paperTrail(), staleTime: 30_000 });
  const trail = useMemo(() => trailByPaper(trailQ.data ?? []), [trailQ.data]);
  if (q.isLoading) return <ListSkeleton label="Loading the papers that need you" />;
  if (q.isError) return <LoadError what="The papers that need you" onRetry={() => void q.refetch()} />;
  const list = q.data ?? [];
  if (list.length === 0) {
    return (
      <EmptyNote>
        Nothing is waiting for you. When students send a question up, or the computer cannot settle one, its paper appears here.
      </EmptyNote>
    );
  }
  const total = list.reduce((n, p) => n + waitingOn(p), 0);
  return (
    <div>
      <p className="mb-3 text-[13px] text-warm-secondary" data-testid="needs-summary">
        {total === 1 ? '1 question' : `${total} questions`} on {list.length === 1 ? '1 paper' : `${list.length} papers`} need you. Open a paper to settle its questions.
      </p>
      <ul className="space-y-3">
        {list.map((p) => (
          <li key={p.audit_paper_id} className="rounded-[18px] bg-muted p-4" data-testid="needs-paper">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-foreground">{p.title}</p>
                <p className="mt-0.5 text-[12px] text-warm-meta">
                  {[p.school, p.cls ? `Class ${p.cls}` : null, p.is_live ? 'Already live' : null].filter(Boolean).join(' · ')}
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="What is waiting">
                  {p.escalated > 0 ? (
                    <li className="rounded-full bg-brand-subtle px-3 py-1 text-[12px] font-semibold tabular-nums text-foreground">
                      {p.escalated} sent up by students
                    </li>
                  ) : null}
                  {p.admin_bucket > 0 ? (
                    <li className="rounded-full bg-card px-3 py-1 text-[12px] font-semibold tabular-nums text-foreground">
                      {p.admin_bucket} the computer could not settle
                    </li>
                  ) : null}
                  <li className="rounded-full bg-card px-3 py-1 text-[12px] tabular-nums text-warm-secondary">of {p.total} questions</li>
                </ul>
              </div>
              <Link to={deskLink('needs-you', p.audit_paper_id)} className={cn(actionToneClass('brand'), 'h-[46.5px] shrink-0')} aria-label={`Open ${p.title}`}>
                Open
              </Link>
            </div>
            <RouteTrail stage={trail.get(p.audit_paper_id)?.stage ?? 'needs_you'} className="mt-3" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NeedsYouTab({ api, scope }: { api: HodApi; scope: string }) {
  const [params] = useSearchParams();
  const paperId = params.get('paper');
  const listQ = useQuery({ queryKey: NEEDS_YOU_KEY(scope), queryFn: () => api.needsYouPapers(), staleTime: 15_000 });
  if (paperId) {
    const paper = (listQ.data ?? []).find((p) => p.audit_paper_id === paperId) ?? null;
    return <PaperQuestions api={api} scope={scope} paperId={paperId} paper={paper} />;
  }
  return <PaperList api={api} scope={scope} />;
}
