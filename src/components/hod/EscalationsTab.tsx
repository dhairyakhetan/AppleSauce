import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MathText } from '@/components/papers/math-text';
import { BodyEditor } from '@/components/checker/BodyEditor';
import { OptionList } from '@/components/checker/OptionList';
import { EmptyNote, ListSkeleton, LoadError, QuestionPicture, ago } from '@/components/hod/HodShared';
import { actionToneClass } from '@/lib/checker-button-styles';
import { checkerErrorAdvice } from '@/lib/checker-errors';
import { paperLabel } from '@/lib/checker-progress';
import { buildEscalationFix, marksTextInvalid } from '@/lib/hod-desk';
import type { HodApi, HodEscalation } from '@/lib/hod-api';
import { cn } from '@/lib/utils';

/* "Escalated to me": every question a verifier sent up with Ask the HOD. Each
   card shows who asked, what they said, the picture (or the whole paper when
   no page matched) and four ways to settle it. Pass and Fix use the same
   versioned functions a checker uses, so a stale card is refused, not
   overwritten. The question text is shown as stored and sent only when the reviewer
   changed it, exactly as typed. */

export const ESCALATIONS_KEY = (scope: string) => ['hod', scope, 'escalations'] as const;

type Panel = null | 'fix' | 'back' | 'aside';

function EscalationCard({ e, api, onDone }: { e: HodEscalation; api: HodApi; onDone: (text: string) => void }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [body, setBody] = useState(e.body);
  const [number, setNumber] = useState(e.display_number ?? '');
  const [marks, setMarks] = useState(e.marks != null ? String(e.marks) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = e.display_number ?? e.number_path ?? '?';
  const marksInvalid = marksTextInvalid(marks);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone(done);
    } catch (err) {
      const advice = checkerErrorAdvice(err);
      const raw = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
      setError(advice.moveOn || !raw ? advice.message : raw);
    } finally {
      setBusy(false);
    }
  }

  function saveFix() {
    const built = buildEscalationFix(e, { body, number, marks });
    if ('error' in built) {
      setError(built.error);
      return;
    }
    void run(() => api.fix(e.id, e.version, built.patch), `Question ${label} fixed and settled.`);
  }

  return (
    <li className="rounded-[18px] bg-muted p-4" data-testid="escalation-card">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[15px] font-bold text-foreground">
          Question {label} <span className="font-normal text-warm-secondary">in {paperLabel(e)}</span>
        </p>
        <p className="text-[12px] text-warm-meta">
          Sent by <span className="font-semibold text-foreground">{e.escalated_by_name ?? 'a verifier'}</span>
          {e.escalated_at ? ` ${ago(e.escalated_at)}` : ''}
        </p>
      </div>
      <p className="mb-3 rounded-xl bg-brand-subtle px-3 py-2 text-[14px] text-foreground">
        <span className="font-semibold">They said: </span>
        {e.reason ?? 'No reason given.'}
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="min-w-0">
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="About this question" data-testid="escalation-meta">
            {[e.display_number ? `Question ${e.display_number}` : null, e.marks != null ? `${e.marks} ${e.marks === 1 ? 'mark' : 'marks'}` : null, e.subject, e.cls ? `Class ${e.cls}` : null, e.school, e.year, e.page ? `Page ${e.page}` : null]
              .filter((x): x is string => Boolean(x))
              .map((c) => (
                <li key={c} className="rounded-full bg-card px-3 py-1 text-[12px] font-semibold text-warm-secondary">
                  {c}
                </li>
              ))}
          </ul>
          {e.instructions ? (
            <div className="mb-2 rounded-2xl bg-card px-4 py-2">
              <MathText text={e.instructions} className="text-[14px] italic leading-relaxed text-warm-secondary" />
            </div>
          ) : null}
          {panel === 'fix' ? (
            <div>
              <BodyEditor value={body} onChange={setBody} disabled={busy} />
              <OptionList options={e.options} />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[13px] font-medium text-warm-secondary">
                  Question number
                  <input
                    value={number}
                    onChange={(ev) => setNumber(ev.target.value)}
                    className="min-h-[40px] w-24 rounded-xl bg-card px-3 py-1 text-center text-[14px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                </label>
                <label className="flex items-center gap-2 text-[13px] font-medium text-warm-secondary">
                  Marks
                  <input
                    inputMode="decimal"
                    value={marks}
                    onChange={(ev) => setMarks(ev.target.value)}
                    aria-invalid={marksInvalid || undefined}
                    className={cn(
                      'min-h-[40px] w-20 rounded-xl bg-card px-3 py-1 text-center text-[14px] tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand',
                      marksInvalid && 'ring-2 ring-destructive',
                    )}
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-card p-4">
              <MathText text={e.body} className="break-words text-[16px] leading-relaxed text-foreground" />
              <OptionList options={e.options} />
            </div>
          )}
        </div>
        <QuestionPicture api={api} paperId={e.paper_id} path={e.snippet_path ?? e.page_path} page={e.page} className="min-w-0 lg:sticky lg:top-24 lg:self-start" />
      </div>

      {panel === 'back' || panel === 'aside' ? (
        <div className="mt-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-foreground">
            {panel === 'back' ? 'A note for the verifiers (optional)' : 'Why is it being set aside? (required)'}
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

      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {panel === null ? (
          <>
            <button type="button" className={actionToneClass('mint')} disabled={busy || !e.body.trim()} onClick={() => void run(() => api.pass(e.id, e.version), `Question ${label} passed.`)}>
              {busy ? 'Saving...' : 'Pass'}
            </button>
            <button type="button" className={actionToneClass('dark')} disabled={busy} onClick={() => setPanel('fix')}>
              Fix
            </button>
            <button type="button" className={actionToneClass('brand')} disabled={busy} onClick={() => setPanel('back')}>
              Send back
            </button>
            <button type="button" className={actionToneClass('muted')} disabled={busy} onClick={() => setPanel('aside')}>
              Set aside
            </button>
          </>
        ) : (
          <>
            {panel === 'fix' ? (
              <button type="button" className={actionToneClass('mint')} disabled={busy || marksInvalid || !body.trim()} onClick={saveFix}>
                {busy ? 'Saving...' : 'Save and settle'}
              </button>
            ) : panel === 'back' ? (
              <button
                type="button"
                className={actionToneClass('brand')}
                disabled={busy}
                onClick={() => void run(() => api.sendBack(e.id, note.trim()), `Question ${label} sent back to the verifiers.`)}
              >
                {busy ? 'Sending...' : 'Send it back'}
              </button>
            ) : (
              <button
                type="button"
                className={actionToneClass('dark')}
                disabled={busy || note.trim() === ''}
                onClick={() => void run(() => api.setAside(e.id, note.trim()), `Question ${label} set aside.`)}
              >
                {busy ? 'Saving...' : 'Set it aside'}
              </button>
            )}
            <button
              type="button"
              className={actionToneClass('muted')}
              disabled={busy}
              onClick={() => {
                setPanel(null);
                setError(null);
                setNote('');
                setBody(e.body);
                setNumber(e.display_number ?? '');
                setMarks(e.marks != null ? String(e.marks) : '');
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function EscalationsTab({ api, scope }: { api: HodApi; scope: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ESCALATIONS_KEY(scope), queryFn: () => api.escalations(), staleTime: 0, refetchOnMount: true });
  if (q.isLoading) return <ListSkeleton label="Loading escalated questions" />;
  if (q.isError) return <LoadError what="The escalated questions" onRetry={() => void q.refetch()} />;
  const list = q.data ?? [];
  if (list.length === 0) return <EmptyNote>Nothing is waiting for you. When a verifier presses Ask the HOD, the question appears here.</EmptyNote>;
  return (
    <ul className="space-y-3">
      {list.map((e) => (
        <EscalationCard
          key={e.id}
          e={e}
          api={api}
          onDone={(text) => {
            toast.success(text);
            void qc.invalidateQueries({ queryKey: ['hod', scope] });
          }}
        />
      ))}
    </ul>
  );
}
