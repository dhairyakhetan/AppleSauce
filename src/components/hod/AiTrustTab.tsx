import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EmptyNote, ListSkeleton, LoadError } from '@/components/hod/HodShared';
import {
  barLabel,
  barPosition,
  buildTrustGrid,
  checksNeeded,
  DECISION_HINT,
  DECISION_LABEL,
  formatRate,
  LEVEL_LABEL,
  meterStatus,
  switchState,
  trustConfirm,
  trustExplainer,
  trustStatus,
  type TrustCell,
  type TrustRow,
} from '@/lib/ai-trust';
import type { HodApi } from '@/lib/hod-api';
import { useConfirm } from '@/components/ui/use-confirm';
import { cn } from '@/lib/utils';

/* "AI trust": for each confidence level and each kind of AI decision, how
   often verifiers agreed with no change, against the bar (97% over the
   minimum number of checks, read from the rows, never written here). The HOD
   sees the numbers; only an admin gets the switch. Verifiers never see any of
   this: the AI's confidence would bias them. */

export const AI_TRUST_KEY = (scope: string) => ['hod', scope, 'ai-trust'] as const;

const CHIP_TONE = {
  people: 'bg-muted text-warm-secondary',
  trusted: 'bg-mint text-foreground',
  auto_off: 'bg-destructive/10 text-foreground',
} as const;

function Meter({ row }: { row: TrustRow }) {
  const { fill, bar } = barPosition(row);
  const met = row.rate !== null && row.rate >= row.min_rate;
  const status = meterStatus(row);
  return (
    <div>
      {/* The label sits on the tick. Near the right edge it ends at the tick instead of centring on it, so it never leaves the card. */}
      <div className="relative h-4" aria-hidden>
        <span
          className={cn('absolute top-0 whitespace-nowrap text-[12px] font-semibold text-foreground', bar >= 80 ? '-translate-x-full pr-1' : '-translate-x-1/2')}
          style={{ left: `${bar}%` }}
        >
          {barLabel(row)}
        </span>
      </div>
      <div
        className="relative h-2.5 w-full rounded-full bg-card"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fill}
        aria-label={`Agreed ${formatRate(row.rate)} of the time, the bar is ${Math.round(row.min_rate * 100)}%`}
      >
        <div className={cn('h-full rounded-full', met ? 'bg-emerald-500' : 'bg-brand')} style={{ width: `${fill}%` }} />
        <div className="absolute -top-1 w-0.5 bg-foreground" style={{ left: `${bar}%`, height: '1.125rem' }} aria-hidden />
      </div>
      <p className={cn('mt-1 text-[12px] font-semibold', met ? 'text-[#24603D]' : 'text-warm-meta')} data-testid="trust-meter-status">
        {status}
      </p>
    </div>
  );
}

function Cell({ cell, canSwitch, api, scope }: { cell: TrustCell; canSwitch: boolean; api: HodApi; scope: string }) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const row = cell.total;
  const title = `${LEVEL_LABEL[cell.level]}, ${DECISION_LABEL[cell.decision]}`;
  if (!row) {
    return (
      <div className="rounded-[18px] bg-muted p-4">
        <p className="text-[14px] font-bold text-foreground">{title}</p>
        <p className="mt-0.5 text-[13px] text-warm-secondary">{DECISION_HINT[cell.decision]}</p>
        <p className="mt-2 text-[13px] text-warm-secondary">No data yet.</p>
      </div>
    );
  }
  const status = trustStatus(row);
  const sw = switchState(row);

  async function flip() {
    if (!row) return;
    // Trusting stops people checking this level, so it says so first. Stopping puts people back on it: one tap.
    if (sw.action === 'trust') {
      const c = trustConfirm(row);
      const ok = await confirm({ title: c.title, description: c.description, confirmLabel: c.confirmLabel, cancelLabel: 'Not yet' });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await api.setAiTrust(row.level, row.decision, sw.action === 'trust');
      toast.success(sw.action === 'trust' ? 'This level is now trusted.' : 'This level goes to people again.');
      void qc.invalidateQueries({ queryKey: AI_TRUST_KEY(scope) });
    } catch (err) {
      toast.error(err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Could not change that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[18px] bg-muted p-4" data-testid="trust-cell" data-level={cell.level} data-decision={cell.decision}>
      <div>
        <p className="text-[14px] font-bold text-foreground">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-warm-secondary" data-testid="trust-hint">
          {DECISION_HINT[cell.decision]}
        </p>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[34px] font-bold leading-none tabular-nums text-foreground" aria-label={`Agreed ${formatRate(row.rate)}`}>
          {row.rate === null ? '-' : formatRate(row.rate)}
        </span>
        <span className="text-[13px] text-warm-secondary">verifiers agreed, no change</span>
      </div>
      <p className="text-[13px] tabular-nums text-foreground">{checksNeeded(row)}</p>
      <Meter row={row} />
      <p className="text-[13px] text-warm-secondary">
        Waiting with verifiers: <span className="font-semibold tabular-nums text-foreground">{row.waiting}</span>
      </p>
      <span className={cn('inline-flex w-fit rounded-full px-3 py-1 text-[12px] font-bold', CHIP_TONE[status.kind])} data-testid="trust-status">
        {status.label}
      </span>
      {canSwitch ? (
        <div>
          <button
            type="button"
            onClick={() => void flip()}
            disabled={busy || sw.disabled}
            aria-describedby={sw.reason ? `why-${cell.level}-${cell.decision}` : undefined}
            className={cn('tap-44 rounded-full px-4 py-2 text-[14px] font-bold disabled:opacity-50', sw.action === 'stop' ? 'bg-panel text-background' : 'bg-brand text-foreground')}
          >
            {busy ? 'Saving...' : sw.label}
          </button>
          {sw.reason ? (
            <p id={`why-${cell.level}-${cell.decision}`} className="mt-1 text-[12px] leading-snug text-warm-meta">
              {sw.reason}
            </p>
          ) : null}
        </div>
      ) : null}
      {confirmDialog}
      {cell.subjects.length > 0 ? (
        <details className="group rounded-xl bg-card">
          <summary className="tap-44 flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[13px] font-semibold text-foreground [&::-webkit-details-marker]:hidden">
            By subject ({cell.subjects.length})
            <ChevronDown aria-hidden className="h-4 w-4 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <ul className="space-y-1 px-3 pb-3 text-[13px]">
            {cell.subjects.map((s) => (
              <li key={s.subject} className="flex flex-wrap items-baseline justify-between gap-x-3" data-testid="trust-subject">
                <span className="font-semibold text-foreground">{s.subject}</span>
                <span className="tabular-nums text-warm-secondary">
                  {formatRate(s.rate)} · {s.checked} checked · {s.waiting} waiting
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function AiTrustTab({ api, scope, canSwitchTrust: canSwitch }: { api: HodApi; scope: string; canSwitchTrust: boolean }) {
  const q = useQuery({ queryKey: AI_TRUST_KEY(scope), queryFn: () => api.aiTrust(), staleTime: 15_000, refetchOnMount: true });
  const bar = q.data?.[0];
  return (
    <div>
      <p className="mb-4 rounded-2xl bg-brand-subtle px-4 py-3 text-[14px] leading-snug text-foreground" data-testid="trust-explainer">
        {trustExplainer(bar?.min_checked, bar?.min_rate, bar?.spot_check_every)}
      </p>
      {q.isLoading ? (
        <ListSkeleton rows={3} label="Loading the AI trust meter" />
      ) : q.isError ? (
        <LoadError what="The AI trust meter" onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyNote>No AI decisions have been checked yet.</EmptyNote>
      ) : (
        <div className="space-y-4">
          {buildTrustGrid(q.data ?? []).map((line) => (
            <div key={line[0].level} className="grid gap-3 md:grid-cols-2">
              {line.map((cell) => (
                <Cell key={`${cell.level}-${cell.decision}`} cell={cell} canSwitch={canSwitch} api={api} scope={scope} />
              ))}
            </div>
          ))}
          {!canSwitch ? <p className="text-[13px] text-warm-secondary">Only an admin can switch a level to trusted.</p> : null}
        </div>
      )}
    </div>
  );
}
