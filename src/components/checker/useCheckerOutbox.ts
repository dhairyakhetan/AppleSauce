import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CheckerApi } from '@/lib/checker-api';
import type { VerdictAndNext } from '@/lib/checker-verdict-next';
import { getOutbox, type Outbox, type OutboxEntry, type OutboxState } from '@/lib/checker-outbox';

/* The verify screen's view of the outbox (src/lib/checker-outbox.ts). The
   outbox itself outlives the screen: a save still on its way carries on after
   the checker leaves for the list. `handlers` always points at the newest
   render, so an ack reaches the screen that is open now. */

export interface OutboxHandlers {
  onAck: (entry: OutboxEntry, result: VerdictAndNext | null) => void;
  onReject: (entry: OutboxEntry, error: unknown) => void;
}

export function useCheckerOutbox(
  api: CheckerApi,
  scope: string,
  userId: string | undefined,
  handlers: OutboxHandlers,
): { box: Outbox; state: OutboxState } {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  const box = useMemo(
    () =>
      getOutbox(scope, userId, {
        api,
        onAck: (e, result) => ref.current.onAck(e, result),
        onReject: (e, err) => ref.current.onReject(e, err),
      }),
    [api, scope, userId],
  );
  const state = useSyncExternalStore(box.subscribe, box.state, box.state);
  return { box, state };
}
