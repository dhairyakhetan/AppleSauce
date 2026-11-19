import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { StageStrip, type StageCounts } from '@/components/PaperStatus';
import { ASSIGNMENTS_KEY, HELD_BACK_KEY, UNASSIGNED_KEY } from '@/components/hod/AssignmentsTab';
import { UNASSIGNED_SHOWN } from '@/lib/hod-desk';
import type { HodApi } from '@/lib/hod-api';
import { STAGE_PARAM, STAGE_TAB, parseStageParam, type PaperStage } from '@/lib/paper-status';

/* The strip of counts at the top of the HOD desk: Not ready, Ready, Being checked, Waiting approval, Live.
   Tapping a stage opens the list that holds it (the three before-checking stages are lists on Assignments,
   filtered with ?stage=; "Waiting approval" is the Ready to go live tab and "Live" is Live papers). Tapping the
   chosen one again goes back to the whole Assignments view.

   It reads the same queries the lists use (same keys), so opening a tab afterwards finds the answer already
   there, and one that fails shows "?" without stopping the others. */

export function HodStageStrip({ api, scope }: { api: HodApi; scope: string }) {
  const [params, setParams] = useSearchParams();
  const heldQ = useQuery({ queryKey: HELD_BACK_KEY(scope), queryFn: () => api.heldBackPapers(UNASSIGNED_SHOWN), staleTime: 10_000 });
  const freeQ = useQuery({ queryKey: UNASSIGNED_KEY(scope), queryFn: () => api.unassignedPapers(UNASSIGNED_SHOWN + 1), staleTime: 10_000 });
  const mineQ = useQuery({ queryKey: ASSIGNMENTS_KEY(scope), queryFn: () => api.assignments(), staleTime: 10_000 });
  const deskQ = useQuery({ queryKey: ['hod', scope, 'counts'], queryFn: () => api.deskCounts(), staleTime: 15_000 });

  const counts: StageCounts = {
    not_ready: heldQ.data ? heldQ.data.length : null,
    ready: freeQ.data ? Math.min(freeQ.data.length, UNASSIGNED_SHOWN) : null,
    // A paper goes whole to one checker, so the rows are the papers; counted by id in case that ever changes.
    checking: mineQ.data ? new Set(mineQ.data.map((a) => a.paper_id)).size : null,
    // Only the papers that pass all four checks; the blocked ones are listed, with reasons, in Ready to go live.
    waiting: deskQ.data ? deskQ.data.ready_ok : null,
    live: deskQ.data ? deskQ.data.live : null,
  };
  const capped: Partial<Record<PaperStage, boolean>> = {
    not_ready: (heldQ.data?.length ?? 0) >= UNASSIGNED_SHOWN,
    ready: (freeQ.data?.length ?? 0) > UNASSIGNED_SHOWN,
  };

  const tab = params.get('tab');
  const filter = parseStageParam(params.get(STAGE_PARAM));
  // Which stage looks chosen: the filter on Assignments, or the tab that is itself one stage.
  const active: PaperStage | null =
    tab === 'ready' ? 'waiting' : tab === 'live' ? 'live' : tab === 'assignments' && filter && STAGE_TAB[filter] === 'assignments' ? filter : null;

  const pick = (stage: PaperStage | null) => {
    const next = new URLSearchParams(params);
    next.delete('paper');
    if (stage === null) {
      next.set('tab', 'assignments');
      next.delete(STAGE_PARAM);
    } else {
      next.set('tab', STAGE_TAB[stage]);
      if (STAGE_TAB[stage] === 'assignments') next.set(STAGE_PARAM, stage);
      else next.delete(STAGE_PARAM);
    }
    setParams(next, { replace: true });
  };

  return <StageStrip counts={counts} capped={capped} active={active} onPick={pick} />;
}
