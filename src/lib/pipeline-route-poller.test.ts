import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPoller, type PollerEnv } from '@/lib/pipeline-route-poller';

/* The refresh loop, with fake timers and a fake tab. */

function fakeEnv(visible = true) {
  const state = { visible };
  const visCbs = new Set<() => void>();
  const focusCbs = new Set<() => void>();
  const env: PollerEnv = {
    isVisible: () => state.visible,
    onVisibilityChange: (cb) => {
      visCbs.add(cb);
      return () => visCbs.delete(cb);
    },
    onFocus: (cb) => {
      focusCbs.add(cb);
      return () => focusCbs.delete(cb);
    },
  };
  return {
    env,
    setVisible(v: boolean) {
      state.visible = v;
      visCbs.forEach((cb) => cb());
    },
    focus() {
      focusCbs.forEach((cb) => cb());
    },
    listeners: () => visCbs.size + focusCbs.size,
  };
}

function setup(visible = true, fetchImpl?: () => Promise<number>) {
  const tab = fakeEnv(visible);
  let n = 0;
  const fetchOnce = vi.fn(fetchImpl ?? (async () => ++n));
  const onData = vi.fn();
  const onError = vi.fn();
  const poller = createPoller<number>({ fetchOnce, intervalMs: 20_000, env: tab.env, onData, onError });
  return { tab, fetchOnce, onData, onError, poller };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createPoller', () => {
  it('reads at once, then every 20 seconds while the tab is visible', async () => {
    const { poller, fetchOnce, onData } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith(1, expect.any(Number));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchOnce).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(fetchOnce).toHaveBeenCalledTimes(4);
    poller.stop();
  });

  it('does no timed reads while the tab is hidden', async () => {
    const { poller, fetchOnce, tab } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    tab.setVisible(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('coming back to the tab reads straight away and the timer carries on', async () => {
    const { poller, fetchOnce, tab } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    tab.setVisible(false);
    await vi.advanceTimersByTimeAsync(60_000);
    tab.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchOnce).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchOnce).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('a page opened in a background tab still reads once, then waits', async () => {
    const { poller, fetchOnce, tab } = setup(false);
    poller.start();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
    tab.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchOnce).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('focusing the window reads again, but visibility plus focus together read once', async () => {
    const { poller, fetchOnce, tab } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
    tab.setVisible(true);
    tab.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchOnce).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('a read that fails reports it, keeps the timer, and recovers on the next tick', async () => {
    let call = 0;
    const { poller, onData, onError } = setup(true, async () => {
      call += 1;
      if (call === 2) throw new Error('boom');
      return call;
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onData).toHaveBeenCalledTimes(2);
    expect(onData).toHaveBeenLastCalledWith(3, expect.any(Number));
    poller.stop();
  });

  it('never runs two reads at once', async () => {
    let release: (n: number) => void = () => {};
    const { poller, fetchOnce, onData } = setup(true, () => new Promise<number>((r) => (release = r)));
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
    void poller.refreshNow();
    expect(fetchOnce).toHaveBeenCalledTimes(1);
    release(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).toHaveBeenCalledWith(7, expect.any(Number));
    poller.stop();
  });

  it('Refresh now reads even when a read just happened', async () => {
    const { poller, fetchOnce } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await poller.refreshNow();
    expect(fetchOnce).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('stop ends the timer, drops the listeners and ignores a late answer', async () => {
    let release: (n: number) => void = () => {};
    const { poller, fetchOnce, onData, tab } = setup(true, () => new Promise<number>((r) => (release = r)));
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.listeners()).toBe(2);
    poller.stop();
    expect(tab.listeners()).toBe(0);
    release(9);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(onData).not.toHaveBeenCalled();
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });
});
