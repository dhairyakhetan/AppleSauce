import { Check, X } from 'lucide-react';
import { CHECKS, TRAIL_STAGES, checkShort, stageIndex, trailSentence, type CheckKey, type HodCheck, type TrailStage } from '@/lib/hod-publish';
import { cn } from '@/lib/utils';

/* The route trail on a paper row: Read, Checking by students, Needs you,
   Ready, Live, with the stop the paper is at highlighted. The words are the
   ones the pipeline page uses. The highlight is never the only signal: the
   current stop is bold, carries aria-current="step", and a hidden sentence
   says "step 3 of 5". Earlier stops get a tick. */

export function RouteTrail({ stage, className }: { stage: TrailStage; className?: string }) {
  const cur = stageIndex(stage);
  return (
    <div className={className} data-testid="route-trail" data-stage={stage}>
      <ol aria-label="Route" className="flex flex-wrap items-center gap-1">
        {TRAIL_STAGES.map((s, i) => (
          <li
            key={s.key}
            title={s.hint}
            aria-current={i === cur ? 'step' : undefined}
            data-state={i < cur ? 'done' : i === cur ? 'current' : 'later'}
            className={cn(
              'inline-flex h-[26px] items-center gap-1 rounded-full px-3 py-1 text-[12px] font-bold leading-none',
              i === cur ? 'bg-panel text-background' : i < cur ? 'bg-card text-warm-secondary' : 'bg-card/60 text-warm-meta',
            )}
          >
            {i < cur ? <Check className="h-3 w-3" aria-hidden /> : null}
            {s.label}
          </li>
        ))}
      </ol>
      <p className="sr-only">{trailSentence(stage)}</p>
    </div>
  );
}

/** One check as a chip: a tick or a cross and the short name, with the result also in words. */
export function CheckChip({ check }: { check: Pick<HodCheck, 'key' | 'ok'> }) {
  return (
    <li
      data-check={check.key}
      data-ok={check.ok}
      className={cn(
        'inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold',
        check.ok ? 'bg-mint text-foreground' : 'bg-destructive/10 text-destructive',
      )}
    >
      {check.ok ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
      {checkShort(check.key)}
      <span className="sr-only">{check.ok ? ': passes' : ': needs fixing'}</span>
    </li>
  );
}

export function CheckChips({ checks }: { checks: HodCheck[] }) {
  const byKey = new Map<string, HodCheck>(checks.map((c) => [c.key, c]));
  return (
    <ul aria-label="The four checks" className="flex flex-wrap gap-1.5" data-testid="check-chips">
      {CHECKS.map((c) => (
        <CheckChip key={c.key} check={{ key: c.key as CheckKey, ok: byKey.get(c.key)?.ok === true }} />
      ))}
    </ul>
  );
}
