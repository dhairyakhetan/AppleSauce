import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { MathText } from '@/components/papers/math-text';
import { EmptyNote, ListSkeleton, LoadError, ago, deskLink, quietButton } from '@/components/hod/HodShared';
import { actionToneClass } from '@/lib/checker-button-styles';
import type { HodApi } from '@/lib/hod-api';
import { refreshHod } from '@/lib/hod-refresh';
import { aiRedoStepWords, errorWords, type HodAiRedoItem, type HodAiRedoStep } from '@/lib/hod-publish';
import { cn } from '@/lib/utils';
import { loadGate } from '@/lib/verifier-papers';

/* "Send to AI" (owner, 19 Nov 2026): the whole "send back to the AI" flow in one place.
   A student asks from the checker ("Send back to the AI"). The question lands here, waiting for an HOD's yes or no,
   and the HOD says it right here. A yes keeps it on this list as "waiting for the AI"; a no sends it back to the HOD's
   Needs you as an ordinary help request. When the AI has read it again and redone it, it moves to "Already redone".
   Every question opens into its story: each step in its history since the student asked. Nothing is sent to the AI
   from this screen: the AI reads this list when the owner asks. */

export const AI_REDO_KEY = (scope: string) => ['hod', scope, 'ai-redo'] as const;

function labelOf(q: Pick<HodAiRedoItem, 'display_number' | 'number_path'>): string {
  return q.display_number ?? q.number_path ?? '?';
}

const STAGES = ['A student asked', 'An HOD agrees', 'The AI redoes it', 'Back with the HOD'] as const;

/** How many stages are finished for a question in this state. The next one is "now". */
function stagesDone(state: HodAiRedoItem['state']): number {
  return state === 'requested' ? 1 : state === 'approved' ? 2 : 3;
}

function Stages({ state }: { state: HodAiRedoItem['state'] }) {
  const done = stagesDone(state);
  return (
    <ol className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label="Where this question is in the flow" data-testid="ai-redo-stages">
      {STAGES.map((name, i) => {
        const status = i < done ? 'done' : i === done ? 'now' : 'next';
        return (
          <li
            key={name}
            data-status={status}
            className={cn(
              'rounded-xl px-3 py-2 text-[12px] font-semibold leading-snug',
              status === 'done' && 'bg-brand-subtle text-foreground',
              status === 'now' && 'bg-card text-foreground ring-2 ring-brand',
              status === 'next' && 'bg-card text-warm-meta',
            )}
          >
            <span className="block text-[11px] font-bold uppercase text-warm-meta">{status === 'done' ? 'Done' : status === 'now' ? 'Now' : 'Next'}</span>
            {name}
          </li>
        );
      })}
    </ol>
  );
}

function Step({ s }: { s: HodAiRedoStep }) {
  const when = new Date(s.at);
  const full = Number.isNaN(when.getTime()) ? undefined : when.toLocaleString();
  return (
    <li className="rounded-xl bg-card px-3 py-2" data-testid="ai-redo-step">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
        <span className={cn('font-semibold text-foreground', s.undone && 'line-through')}>{aiRedoStepWords(s.action)}</span>
        <span className="text-[12px] text-warm-meta" title={full}>
          {s.who ? `${s.who} · ` : ''}
          {ago(s.at)}
        </span>
      </p>
      {s.note ? <p className="mt-1 text-[13px] text-warm-secondary">{s.note}</p> : null}
      {s.before !== null && s.after !== null ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="min-w-0 rounded-lg bg-muted px-3 py-2">
            <p className="mb-1 text-[11px] font-bold uppercase text-warm-meta">Before</p>
            <MathText text={s.before} className="line-clamp-6 text-[13px] leading-relaxed text-foreground" />
          </div>
          <div className="min-w-0 rounded-lg bg-muted px-3 py-2">
            <p className="mb-1 text-[11px] font-bold uppercase text-warm-meta">After</p>
            <MathText text={s.after} className="line-clamp-6 text-[13px] leading-relaxed text-foreground" />
          </div>
        </div>
      ) : null}
      {s.undone ? <p className="mt-1 text-[12px] text-warm-meta">This step was taken back.</p> : null}
    </li>
  );
}

function Card({ item, api, scope }: { item: HodAiRedoItem; api: HodApi; scope: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = labelOf(item);
  const chips = [
    `Question ${label}`,
    item.marks != null ? `${item.marks} ${item.marks === 1 ? 'mark' : 'marks'}` : null,
    item.state === 'requested' ? 'Waiting for an HOD' : item.state === 'approved' ? 'Waiting for the AI' : 'Redone by the AI',
    item.live_copy ? 'Live Maths copy' : null,
    item.set_aside ? 'Left out so the paper can go live' : null,
  ].filter((x): x is string => Boolean(x));

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.aiRedoDecide(item.id, approve, '');
      toast.success(approve ? `Question ${label} is marked: needs AI review.` : `Question ${label} stays with the HOD as an ordinary help request.`);
      refreshHod(qc, scope, 'ai-redo');
    } catch (err) {
      setError(errorWords(err));
      // A refusal often means the list is out of date.
      refreshHod(qc, scope, 'ai-redo');
    } finally {
      setBusy(false);
    }
  }

  const storyId = `ai-redo-story-${item.id}`;

  return (
    <li className="rounded-[18px] bg-muted p-4 shadow-card" data-testid="ai-redo-item" id={`q-${item.id}`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[15px] font-bold text-foreground">{item.paper_title}</p>
        <Link to={deskLink('needs-you', item.paper_id)} className={cn(quietButton, 'h-[40px] px-4 text-[13px]')} aria-label={`Open ${item.paper_title}`}>
          Open paper
        </Link>
      </div>
      <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="About this question">
        {chips.map((c) => (
          <li key={c} className="rounded-full bg-card px-3 py-1 text-[12px] font-semibold text-warm-secondary">
            {c}
          </li>
        ))}
      </ul>
      <p className="mb-2 rounded-xl bg-brand-subtle px-3 py-2 text-[14px] text-foreground" data-testid="ai-redo-reason">
        {item.reason ? `${item.asked_by_name ?? 'A student'} said: ${item.reason}` : `${item.asked_by_name ?? 'A student'} gave no reason.`}
        {item.note ? ` The HOD added: ${item.note}` : ''}
      </p>
      <div className="mb-2 rounded-2xl bg-card px-4 py-2">
        {item.body ? <MathText text={item.body} className="line-clamp-4 text-[14px] leading-relaxed text-foreground" /> : <p className="text-[14px] text-warm-secondary">This question has no words.</p>}
      </div>

      {item.state === 'requested' ? (
        <div className="mb-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={cn(actionToneClass('brand'), 'h-[46.5px]')} disabled={busy} onClick={() => void decide(true)}>
              {busy ? 'Saving...' : 'Yes, it needs AI review'}
            </button>
            <button type="button" className={actionToneClass('dark')} disabled={busy} onClick={() => void decide(false)}>
              No, keep it with the HOD
            </button>
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="mb-2 text-[12px] text-warm-meta">
        {item.asked_at ? `Asked ${ago(item.asked_at)}` : 'Asked'}
        {item.decided_at ? ` · Agreed ${ago(item.decided_at)}${item.decided_by_name ? ` by ${item.decided_by_name}` : ''}` : ''}
      </p>

      <button
        type="button"
        className={cn(quietButton, 'h-[40px] gap-1.5 px-4 text-[13px]')}
        aria-expanded={open}
        aria-controls={storyId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide the whole story' : 'See the whole story'}
        <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div id={storyId} className="mt-3" data-testid="ai-redo-story">
          <Stages state={item.state} />
          {item.trail.length === 0 ? (
            <p className="text-[13px] text-warm-secondary">Nothing has been written down for this question yet.</p>
          ) : (
            <ol className="space-y-2" aria-label="Everything that happened to this question">
              {item.trail.map((s, i) => (
                <Step key={`${s.at}-${s.action}-${i}`} s={s} />
              ))}
            </ol>
          )}
          {item.state !== 'redone' ? (
            <p className="mt-2 text-[12px] text-warm-meta">
              {item.state === 'requested' ? 'Next: an HOD says yes or no.' : 'Next: the AI reads it again against the saved paper and redoes it. Its steps will appear here.'}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Group({ title, items, api, scope }: { title: string; items: HodAiRedoItem[]; api: HodApi; scope: string }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-4" aria-label={title}>
      <h3 className="mb-2 text-[14px] font-bold text-foreground">
        {title} <span className="font-semibold text-warm-secondary">({items.length})</span>
      </h3>
      <ul className="space-y-3">
        {items.map((it) => (
          <Card key={it.id} item={it} api={api} scope={scope} />
        ))}
      </ul>
    </section>
  );
}

export function SendToAiTab({ api, scope }: { api: HodApi; scope: string }) {
  const q = useQuery({ queryKey: AI_REDO_KEY(scope), queryFn: () => api.aiRedoList(), staleTime: 15_000 });

  // loadGate, not isLoading: offline pauses a read (isLoading stays false), so the gate waits for a real answer.
  if (loadGate(q) === 'loading') return <ListSkeleton rows={3} label="Loading the questions for the AI" />;
  if (q.isError || !q.data) return <LoadError what="The list of questions for the AI" onRetry={() => void q.refetch()} />;

  const asked = q.data.filter((x) => x.state === 'requested');
  const waiting = q.data.filter((x) => x.state === 'approved');
  const redone = q.data.filter((x) => x.state === 'redone');

  const parts = [
    asked.length ? `${asked.length} ${asked.length === 1 ? 'question is' : 'questions are'} waiting for your yes or no.` : null,
    waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'question is' : 'questions are'} waiting for the AI to read ${waiting.length === 1 ? 'it' : 'them'} again.` : null,
  ].filter((x): x is string => Boolean(x));

  return (
    <div>
      <p className="mb-3 text-[14px] text-warm-secondary">
        {parts.length === 0 ? 'Nothing is waiting.' : parts.join(' ')} A student asks to send a question back, an HOD says yes or no here, and a yes stays on this
        list until the AI has redone it. Open any question to see its whole story. Nothing is sent to the AI from this screen.
      </p>
      {q.data.length === 0 ? (
        <EmptyNote>No student has asked to send a question back to the AI yet. When one does, it shows up here for your yes or no.</EmptyNote>
      ) : (
        <>
          <Group title="Waiting for your yes or no" items={asked} api={api} scope={scope} />
          <Group title="Agreed, waiting for the AI" items={waiting} api={api} scope={scope} />
          <Group title="Already redone by the AI" items={redone} api={api} scope={scope} />
        </>
      )}
    </div>
  );
}
