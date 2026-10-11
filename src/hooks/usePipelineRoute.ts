import { useCallback, useEffect, useRef, useState } from 'react';
import type { PipelineRoute, PipelineRouteApi } from '@/lib/pipeline-route';
import { browserPollerEnv, createPoller, type Poller } from '@/lib/pipeline-route-poller';

export const ROUTE_POLL_MS = 20_000;

export interface PipelineRouteState {
  route: PipelineRoute | null;
  /** loading: the first read is out. error: the first read failed and there is nothing to show. ok: there are numbers (maybe stale, see refreshFailed). */
  status: 'loading' | 'ok' | 'error';
  /** A later read failed. The last numbers stay on screen. */
  refreshFailed: boolean;
  refreshing: boolean;
  /** When the numbers on screen were read (ms since 1970), or null. */
  updatedAt: number | null;
  refresh: () => void;
}

/** Reads the route now and every 20 seconds while the tab is visible. Keeps the previous numbers if a read fails. */
export function usePipelineRoute(api: PipelineRouteApi, intervalMs = ROUTE_POLL_MS): PipelineRouteState {
  const [route, setRoute] = useState<PipelineRoute | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const poller = useRef<Poller | null>(null);

  useEffect(() => {
    const p = createPoller<PipelineRoute>({
      fetchOnce: () => api.route(),
      intervalMs,
      env: browserPollerEnv(),
      onData: (data, at) => {
        setRoute(data);
        setUpdatedAt(at);
        setFailed(false);
      },
      onError: () => setFailed(true),
      onBusy: setRefreshing,
    });
    poller.current = p;
    p.start();
    return () => {
      p.stop();
      poller.current = null;
    };
  }, [api, intervalMs]);

  const refresh = useCallback(() => void poller.current?.refreshNow(), []);

  const status = route ? 'ok' : failed ? 'error' : 'loading';
  return { route, status, refreshFailed: failed && !!route, refreshing, updatedAt, refresh };
}
