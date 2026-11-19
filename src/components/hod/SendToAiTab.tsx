import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MathText } from '@/components/papers/math-text';
import { EmptyNote, ListSkeleton, LoadError, ago, deskLink, quietButton } from '@/components/hod/HodShared';
import type { HodApi } from '@/lib/hod-api';
import type { HodAiRedoItem } from '@/lib/hod-publish';
import { cn } from '@/lib/utils';

/* "Send to AI" (owner, 19 Nov 2026): one place to see every question an HOD has said the AI should read again, with
   the student's reason. A student asks from the checker ("Send back to the AI"); an HOD says yes in Needs you; a yes
   lands here. Nothing is sent to the AI from this screen: the AI reads this list when the owner asks, redoes each
   question and the question comes back to the HOD. Questions already redone are listed underneath. Read only. */

export const AI_REDO_KEY = (scope: string) => ['hod', scope, 'ai-redo'] as const;

function labelOf(q: Pick<HodAiRedoItem, 'display_number' | 'number_path'>): string {
  return q.display_number ?? q.number_path ?? '?';
}

function Card({ item }: { item: HodAiRedoItem }) {
  const label = labelOf(item);
  const chips = [
    `Question ${label}`,
    item.marks != null ? `${item.marks} ${item.marks === 1 ? 'mark' : 'marks'}` : null,
    item.state === 'approved' ? 'Waiting for the AI' : 'Redone by the AI',
    item.set_aside ? 'Set aside so the paper can go live' : null,
  ].filter((x): x is string => Boolean(x));

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
      <p className="text-[12px] text-warm-meta">
        {item.asked_at ? `Asked ${ago(item.asked_at)}` : 'Asked'}
        {item.decided_at ? ` · Agreed ${ago(item.decided_at)}${item.decided_by_name ? ` by ${item.decided_by_name}` : ''}` : ''}
      </p>
    </li>
  );
}

function Group({ title, items }: { title: string; items: HodAiRedoItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-4" aria-label={title}>
      <h3 className="mb-2 text-[14px] font-bold text-foreground">
        {title} <span className="font-semibold text-warm-secondary">({items.length})</span>
      </h3>
      <ul className="space-y-3">
        {items.map((it) => (
          <Card key={it.id} item={it} />
        ))}
      </ul>
    </section>
  );
}

export function SendToAiTab({ api, scope }: { api: HodApi; scope: string }) {
  const q = useQuery({ queryKey: AI_REDO_KEY(scope), queryFn: () => api.aiRedoList(), staleTime: 15_000 });

  if (q.isLoading) return <ListSkeleton rows={3} label="Loading the questions for the AI" />;
  if (q.isError || !q.data) return <LoadError what="The list of questions for the AI" onRetry={() => void q.refetch()} />;

  const waiting = q.data.filter((x) => x.state === 'approved');
  const redone = q.data.filter((x) => x.state === 'redone');

  return (
    <div>
      <p className="mb-3 text-[14px] text-warm-secondary">
        {waiting.length === 0
          ? 'Nothing is waiting for the AI.'
          : waiting.length === 1
            ? '1 question is waiting for the AI to read it again.'
            : `${waiting.length} questions are waiting for the AI to read them again.`}{' '}
        A question lands here when a student asks to send it back and an HOD says yes. Nothing is sent from this screen.
      </p>
      {q.data.length === 0 ? (
        <EmptyNote>No question has been approved for the AI yet. When you say yes to a student's request in Needs you, it shows up here.</EmptyNote>
      ) : (
        <>
          <Group title="Waiting for the AI" items={waiting} />
          <Group title="Already redone by the AI" items={redone} />
        </>
      )}
    </div>
  );
}
