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

describe('the verifier home after a paper is done (Nov 2026)', () => {
  const src = readFileSync('src/pages/Checker.tsx', 'utf8');

  it('the counts are asked again every time the page opens, not served from before the last answers', () => {
    const stats = src.slice(src.indexOf("queryKey: ['checker-my-stats', scope]"), src.indexOf('if (accessFailed)'));
    expect(stats).toContain("refetchOnMount: 'always'");
  });

  it('opening a paper or going back to the list does not repeat the "is this a verifier?" check', () => {
    const effect = src.slice(src.indexOf('hereRef.current = here;'), src.indexOf('function retryAccess'));
    expect(effect).toContain('checkerSignInPath(hereRef.current)');
    expect(effect).toContain('[signedIn, authLoading, navigate, api, dummy, accessAttempt]');
    expect(effect).not.toContain('dummy, here,');
  });
});

describe('the verify screen Menu (one button in the top tile)', () => {
  const src = readFileSync('src/pages/Checker.tsx', 'utf8');
  const menu = src.slice(src.indexOf('id="checker-menu-title"'));

  it('the top tile gets only the Menu button, with the desks and counts moved inside it', () => {
    expect(src).toContain('toolbar={menuButton}');
    expect(src).toContain('aria-label="Menu"');
    expect(src).not.toContain('toolbar={header}');
  });

  it('the Menu holds the counts, Back to my papers, Back to admin, the HOD desk, the practice round and the rules', () => {
    for (const piece of ['{counts}', 'data-testid="back-to-my-papers"', 'Back to admin', 'HOD desk', 'Practice round', 'Rules and shortcuts']) {
      expect(menu, piece).toContain(piece);
    }
    // Back to my papers closes the Menu before it goes, so the Menu is not left open on the list.
    expect(menu).toMatch(/setMenuOpen\(false\);\s+toList\(\);/);
  });

  it('the day counts keep their testid and show Today and Total', () => {
    expect(src).toContain('data-testid="my-counts"');
    expect(src).toContain('Today ${statsQuery.data.today_count}');
    expect(src).toContain('Total ${statsQuery.data.total_count}');
  });

  it('the global site header is switched off for the verify screen by the shell', () => {
    const shell = readFileSync('src/components/layout/AppShell.tsx', 'utf8');
    expect(shell).toContain('isChromelessLocation(location.pathname, location.search)');
  });
});

