import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn() } }));

import { reportLoadError, resetLoadErrorWindow, unwrap } from './load-error';

describe('load-error', () => {
  beforeEach(() => {
    toastError.mockClear();
    resetLoadErrorWindow();
  });

  it('shows a visible toast with a Retry action when a read fails', () => {
    const retry = vi.fn();
    expect(reportLoadError('t.one', new Error('boom'), { what: 'subjects', retry })).toBe(true);
    expect(toastError).toHaveBeenCalledTimes(1);
    const [msg, opts] = toastError.mock.calls[0];
    expect(msg).toBe("Couldn't load subjects");
    opts.action.onClick();
    expect(retry).toHaveBeenCalled();
  });

  it('shows one toast per context, not one per repeat', () => {
    reportLoadError('t.two', new Error('x'), { what: 'footer text' });
    expect(reportLoadError('t.two', new Error('x'), { what: 'footer text' })).toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(reportLoadError('t.other', new Error('x'), { what: 'guides' })).toBe(true);
  });

  it('offers no Retry button when there is nothing to re-run', () => {
    reportLoadError('t.three', new Error('x'), { what: 'papers' });
    expect(toastError.mock.calls[0][1].action).toBeUndefined();
  });

  it('unwrap throws the error and passes data through otherwise', () => {
    expect(() => unwrap({ data: null, error: { message: 'nope' } })).toThrow();
    expect(unwrap({ data: [1, 2], error: null })).toEqual([1, 2]);
  });
});
