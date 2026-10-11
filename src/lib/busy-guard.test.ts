import { describe, expect, it } from 'vitest';

import { createBusyGuard } from './busy-guard';
import { notSavedMessage } from './paper-edit';
import { buildTimeline } from './question-timeline';

describe('createBusyGuard', () => {
  it('ignores a second call with the same key while the first is running', async () => {
    const guard = createBusyGuard();
    let calls = 0;
    let release!: () => void;
    const slow = () =>
      new Promise<void>((res) => {
        calls += 1;
        release = res;
      });

    const first = guard.run('merge:a', slow);
    const second = await guard.run('merge:a', slow);
    expect(second.ran).toBe(false);
    expect(calls).toBe(1);
    expect(guard.isBusy('merge:a')).toBe(true);

    release();
    expect((await first).ran).toBe(true);
    expect(guard.isBusy('merge:a')).toBe(false);
  });

  it('lets different keys run together and lets a key run again after it settles', async () => {
    const guard = createBusyGuard();
    const [a, b] = await Promise.all([guard.run('hide:1', async () => 1), guard.run('hide:2', async () => 2)]);
    expect(a).toEqual({ ran: true, value: 1 });
    expect(b).toEqual({ ran: true, value: 2 });
    expect((await guard.run('hide:1', async () => 3)).value).toBe(3);
  });

  it('frees the key when the action throws', async () => {
    const guard = createBusyGuard();
    await expect(
      guard.run('undo:9', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(guard.isBusy('undo:9')).toBe(false);
  });
});

describe('notSavedMessage', () => {
  it('shows the server sentence, not a generic line', () => {
    expect(notSavedMessage({ message: 'Time allowed must be a whole number of minutes from 1 to 600' })).toBe(
      'Not saved: Time allowed must be a whole number of minutes from 1 to 600',
    );
  });

  it('falls back plainly when there is no message', () => {
    expect(notSavedMessage(new Error(''))).toBe('Not saved. Nothing was changed.');
    expect(notSavedMessage(null)).toBe('Not saved. Nothing was changed.');
  });
});

describe('timeline paper-level events', () => {
  it('marks scope = paper rows as paper level and leaves old rows alone', () => {
    const base = { actor_kind: 'admin', actor_name: 'A', detail: null, before: null, after: null };
    const t = buildTimeline([
      { ...base, at: '2026-09-30T10:00:00Z', action: 'admin_reapply_paper_to_live', scope: 'paper' },
      { ...base, at: '2026-09-30T11:00:00Z', action: 'checker_fix' },
    ]);
    expect(t[0].paperLevel).toBe(true);
    expect(t[0].what).toContain('whole paper');
    expect(t[1].paperLevel).toBe(false);
  });
});
