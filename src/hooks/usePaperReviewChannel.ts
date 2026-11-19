import { useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import {
  PAPER_REVIEW_EVENT,
  PAPER_REVIEW_TOPIC,
  createDebouncer,
  firstNameOf,
  parseActivityPayload,
  shapeOnlineList,
  type OnlinePerson,
  type PaperReviewActivity,
  type PresenceMeta,
} from '@/lib/paper-review-realtime';

/**
 * W13: one private Broadcast channel shared by the checker page and the
 * paper admin page. Activity events come only from database triggers
 * (supabase/migrations/20260928180000_paper_review_realtime.sql); clients
 * may only write presence. RLS on realtime.messages admits paper checkers
 * and admins, nobody else.
 *
 * Deliberately quiet on failure: if the channel cannot connect (migration
 * not applied yet, not allowed, offline) status becomes 'unavailable', the
 * online list stays empty and the pages keep working exactly as they did
 * before realtime existed. No toast, no spinner, no retry loop beyond
 * realtime-js's own backoff, and it gives up after a few join errors.
 */

export type PaperReviewChannelStatus = 'off' | 'connecting' | 'live' | 'unavailable';

const MAX_JOIN_ERRORS = 3;

export function usePaperReviewChannel(opts: {
  enabled: boolean;
  userId: string | null | undefined;
  /** profiles.full_name; only its first word is ever sent. */
  fullName?: string | null;
  onActivity?: (event: PaperReviewActivity) => void;
}): { status: PaperReviewChannelStatus; online: OnlinePerson[] } {
  const { enabled, userId } = opts;
  const firstName = firstNameOf(opts.fullName);
  const [status, setStatus] = useState<PaperReviewChannelStatus>('off');
  const [online, setOnline] = useState<OnlinePerson[]>([]);

  const onActivityRef = useRef(opts.onActivity);
  onActivityRef.current = opts.onActivity;

  useEffect(() => {
    if (!enabled || !userId) {
      setStatus('off');
      setOnline([]);
      return;
    }

    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let joinErrors = 0;

    const teardown = () => {
      if (channel) {
        const c = channel;
        channel = null;
        void supabase.removeChannel(c).catch(() => undefined);
      }
    };

    setStatus('connecting');

    (async () => {
      try {
        // No argument: realtime-js asks supabase-js for the CURRENT session
        // token. supabase-js keeps it fresh on every token refresh itself.
        await supabase.realtime.setAuth();
        if (cancelled) return;

        const c = supabase.channel(PAPER_REVIEW_TOPIC, {
          config: { private: true, presence: { key: userId, enabled: true } },
        });
        channel = c;

        c.on('broadcast', { event: PAPER_REVIEW_EVENT }, (message) => {
          const event = parseActivityPayload((message as { payload?: unknown }).payload);
          if (event) onActivityRef.current?.(event);
        });

        c.on('presence', { event: 'sync' }, () => {
          if (cancelled) return;
          setOnline(shapeOnlineList(c.presenceState() as Record<string, PresenceMeta[]>));
        });

        c.subscribe((state) => {
          if (cancelled) return;
          if (state === 'SUBSCRIBED') {
            joinErrors = 0;
            setStatus('live');
            void c.track({ user_id: userId, first_name: firstName }).catch(() => undefined);
          } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
            joinErrors += 1;
            setStatus('unavailable');
            setOnline([]);
            if (joinErrors >= MAX_JOIN_ERRORS) teardown();
          } else if (state === 'CLOSED') {
            setStatus('unavailable');
            setOnline([]);
          }
        });
      } catch {
        if (!cancelled) {
          setStatus('unavailable');
          setOnline([]);
        }
        teardown();
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [enabled, userId, firstName]);

  return { status, online };
}

/**
 * Returns a stable `trigger()` that runs `run` debounced (wait / maxWait,
 * see createDebouncer). While the tab is hidden the run is held and happens
 * once when the tab is visible again, so a background tab does not refetch
 * on every checker action. Cleans up on unmount.
 */
export function useLiveRefresh(run: () => void, wait = 3000, maxWait = 10000): () => void {
  const runRef = useRef(run);
  runRef.current = run;

  const state = useMemo(() => {
    let heldWhileHidden = false;
    const fire = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        heldWhileHidden = true;
        return;
      }
      runRef.current();
    };
    const debouncer = createDebouncer(fire, wait, maxWait);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && heldWhileHidden) {
        heldWhileHidden = false;
        runRef.current();
      }
    };
    return { debouncer, onVisible };
  }, [wait, maxWait]);

  useEffect(() => {
    document.addEventListener('visibilitychange', state.onVisible);
    return () => {
      document.removeEventListener('visibilitychange', state.onVisible);
      state.debouncer.cancel();
    };
  }, [state]);

  return state.debouncer.trigger;
}
