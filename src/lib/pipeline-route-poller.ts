/* The refresh loop behind the papers route, with no React in it so it can be
   tested with fake timers.

   Rules (owner: "completely continuously updated"):
   - the first read happens at once, even in a background tab;
   - after that it reads every `intervalMs` while the tab is visible, and stops
     the timer while it is hidden (a hidden tab does no work);
   - coming back to the tab, or focusing the window, reads straight away and
     restarts the timer;
   - one read at a time: a read already in flight is never doubled up, and two
     triggers close together (visibility plus focus fire together) read once;
   - a read that fails reports the error and keeps the timer going, so the next
     tick can recover on its own. What to show meanwhile is the caller's job:
     the page keeps the last numbers. */

export interface PollerEnv {
  isVisible(): boolean;
  /** Called when the tab becomes visible or hidden. Returns an unsubscribe. */
  onVisibilityChange(cb: () => void): () => void;
  /** Called when the window gains focus. Returns an unsubscribe. */
  onFocus(cb: () => void): () => void;
}

export interface Poller {
  start(): void;
  stop(): void;
  /** Read now (the Refresh button). Resolves when the read has finished. */
  refreshNow(): Promise<void>;
}

export interface PollerOptions<T> {
  fetchOnce: () => Promise<T>;
  intervalMs: number;
  env: PollerEnv;
  onData: (data: T, at: number) => void;
  onError: (error: unknown) => void;
  /** Called with true when a read starts and false when it ends. */
  onBusy?: (busy: boolean) => void;
  now?: () => number;
  /** Two automatic triggers closer together than this read once. */
  minGapMs?: number;
}

export function createPoller<T>(opts: PollerOptions<T>): Poller {
  const { fetchOnce, intervalMs, env, onData, onError, onBusy } = opts;
  const now = opts.now ?? Date.now;
  const minGap = opts.minGapMs ?? 2000;

  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
  let lastStart = -Infinity;
  let running = false;
  const unsubs: Array<() => void> = [];

  function read(): Promise<void> {
    if (inFlight) return inFlight;
    lastStart = now();
    onBusy?.(true);
    inFlight = (async () => {
      try {
        const data = await fetchOnce();
        if (running) onData(data, now());
      } catch (e) {
        if (running) onError(e);
      } finally {
        inFlight = null;
        if (running) onBusy?.(false);
      }
    })();
    return inFlight;
  }

  /** An automatic trigger: skipped when a read just started. */
  function readIfDue() {
    if (!running || inFlight) return;
    if (now() - lastStart < minGap) return;
    void read();
  }

  function startTimer() {
    if (timer !== null) return;
    timer = setInterval(() => {
      if (env.isVisible()) readIfDue();
    }, intervalMs);
  }

  function stopTimer() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  function onShown() {
    if (env.isVisible()) {
      readIfDue();
      startTimer();
    } else {
      stopTimer();
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      void read();
      if (env.isVisible()) startTimer();
      unsubs.push(env.onVisibilityChange(onShown));
      unsubs.push(
        env.onFocus(() => {
          if (env.isVisible()) readIfDue();
        }),
      );
    },
    stop() {
      running = false;
      stopTimer();
      while (unsubs.length) unsubs.pop()?.();
    },
    refreshNow() {
      return running ? read() : Promise.resolve();
    },
  };
}

/** The browser's own environment. */
export function browserPollerEnv(): PollerEnv {
  return {
    isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    onVisibilityChange(cb) {
      document.addEventListener('visibilitychange', cb);
      return () => document.removeEventListener('visibilitychange', cb);
    },
    onFocus(cb) {
      window.addEventListener('focus', cb);
      return () => window.removeEventListener('focus', cb);
    },
  };
}
