import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CheckerApi } from '@/lib/checker-api';
import type { VerdictAndNext } from '@/lib/checker-verdict-next';
import { getOutbox, releaseOutboxHooks, type Outbox, type OutboxEntry, type OutboxHooks, type OutboxState } from '@/lib/checker-outbox';

/* The verify screen's view of the outbox (src/lib/checker-outbox.ts). The
   outbox itself outlives the screen: a save still on its way carries on after
   the checker leaves for the list. `handlers` always points at the newest
   render, so an ack reaches the screen that is open now.

   `base: true` is for the My papers screens (audit CK-02, 27 Nov 2026): they only make sure the box exists, so answers
   kept on the device are sent even when the checker never opens a verify screen, and they take the acks while no verify
   screen is open. A verify screen that closes hands the box back to them. */

export interface OutboxHandlers {
  onAck: (entry: OutboxEntry, result: VerdictAndNext | null) => void;
  onReject: (entry: OutboxEntry, error: unknown) => void;
}

export function useCheckerOutbox(
  api: CheckerApi,
  scope: string,
  userId: string | undefined,
  handlers: OutboxHandlers,
  opts: { base?: boolean } = {},
): { box: Outbox; state: OutboxState } {
  const base = Boolean(opts.base);
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  const hooks = useMemo<OutboxHooks>(
    () => ({
      api,
      onAck: (e, result) => ref.current.onAck(e, result),
      onReject: (e, err) => ref.current.onReject(e, err),
    }),
    [api],
  );
  const box = useMemo(() => getOutbox(scope, userId, hooks, { base }), [hooks, scope, userId, base]);
  // Claim the box again once mounted (a strict-mode remount, or a screen that closed in between), and give it back on close.
  useEffect(() => {
    getOutbox(scope, userId, hooks, { base });
    return () => releaseOutboxHooks(scope, userId, hooks);
  }, [hooks, scope, userId, base]);
  const state = useSyncExternalStore(box.subscribe, box.state, box.state);
  return { box, state };
}
