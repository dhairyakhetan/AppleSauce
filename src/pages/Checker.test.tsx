import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { ProfileLoadError } from '@/pages/Checker';
import { isPaperChecker } from '@/lib/checker-api';
import { checkerSignInPath, loadGate } from '@/lib/verifier-papers';

describe('the verifier home when a read fails', () => {
  it('a failed profile read shows a retry, never the blank form or the "fill in" prompt', () => {
    const html = renderToStaticMarkup(<ProfileLoadError onRetry={() => undefined} />);
    expect(html).toContain('data-testid="profile-load-error"');
    expect(html).toContain('Try again');
    expect(html).toContain('have not been changed');
    expect(html).not.toContain('Fill in my details');
    expect(html).not.toContain('my-details-form');
  });

  it('loadGate: a failed first read is an error, a failed refetch with old data is not', () => {
    expect(loadGate({ isError: false, data: undefined })).toBe('loading');
    expect(loadGate({ isError: true, data: undefined })).toBe('error');
    expect(loadGate({ isError: true, data: { grade: 9 } })).toBe('ready');
    // "No profile row yet" is a real answer (null), not a failure and not "still loading".
    expect(loadGate({ isError: false, data: null })).toBe('ready');
    expect(loadGate({ isError: false, data: [] })).toBe('ready');
  });

  it('isPaperChecker throws on an RPC error instead of saying "not a verifier"', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'network' } });
    await expect(isPaperChecker()).rejects.toBeTruthy();
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(isPaperChecker()).resolves.toBe(false);
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(isPaperChecker()).resolves.toBe(true);
  });

  it('sign-in brings a signed-out verifier back to the paper they opened', () => {
    expect(checkerSignInPath('/checker?paper=abc&verify=1')).toBe('/checker?paper=abc&verify=1');
    expect(checkerSignInPath('/checker')).toBe('/checker');
    expect(checkerSignInPath('/elsewhere?x=1')).toBe('/checker');
  });

  it('the page no longer turns an access-check failure into "not a verifier"', () => {
    const src = readFileSync('src/pages/Checker.tsx', 'utf8');
    expect(src).not.toMatch(/\.catch\(\(\) => \{\s*if \(!cancelled\) setAllowed\(false\)/);
    expect(src).toContain('We could not check your access');
  });
});
