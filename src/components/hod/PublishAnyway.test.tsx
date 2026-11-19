import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { PublishAnywayBox } from '@/components/hod/PublishFlow';
import { LIVE_KEY, LiveTab } from '@/components/hod/LiveTab';
import { createFakeHodApi } from '@/dummy/hod-fake-api';
import { GL } from '@/dummy/hod-golive-fake';
import { OVERRIDE_NOT_ON_WORDS, overrideWhyOff } from '@/lib/hod-publish';

/* The Publish anyway box and the marker in Live papers, rendered to markup (no jsdom, node env) and checked against
   source text for what a static render cannot show (the call order and the wording of the page). */

const noop = () => undefined;
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const box = (over: Partial<Parameters<typeof PublishAnywayBox>[0]> = {}) =>
  renderToStaticMarkup(
    <PublishAnywayBox
      ticked={false}
      reason=""
      error={null}
      busy={false}
      canOverride={false}
      whyOff={overrideWhyOff({ ticked: false, reason: '', leftOut: 0, confirmedLeftOut: false })}
      onTick={noop}
      onReason={noop}
      onPublish={noop}
      {...over}
    />,
  );

describe('the Publish anyway box', () => {
  it('starts with the box unticked, no reason field, and the button off with its reason said', () => {
    const out = box();
    expect(out).toContain('Or publish anyway');
    expect(out).toContain('I know this paper has a problem. I want to publish it anyway.');
    expect(out).not.toContain('data-testid="publish-anyway-reason"');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Publish anyway<\/button>/);
    expect(out).toContain('Tick the box to say you know about the problem.');
    expect(out).toContain('Visitors will not see anything different.');
  });

  it('asks the owner\'s question once the box is ticked, and counts what is still needed', () => {
    const out = box({ ticked: true, reason: 'abc', whyOff: overrideWhyOff({ ticked: true, reason: 'abc', leftOut: 0, confirmedLeftOut: false }) });
    expect(out).toContain('Why are you publishing with this problem? This is saved in the paper&#x27;s history.');
    expect(out).toContain('data-testid="publish-anyway-reason"');
    expect(out).toContain('7 more characters needed.');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Publish anyway<\/button>/);
  });

  it('turns the button on when the tick and a good reason are there', () => {
    const out = box({ ticked: true, reason: 'Exam is tomorrow', canOverride: true, whyOff: '' });
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Publish anyway<\/button>/);
    expect(out).toContain('Your name and reason go in the paper&#x27;s history.');
  });

  it('says plainly when it is not switched on yet, as an alert', () => {
    const out = box({ ticked: true, reason: 'Exam is tomorrow', canOverride: true, error: OVERRIDE_NOT_ON_WORDS });
    expect(out).toContain('role="alert"');
    expect(out).toContain('Publish anyway is not switched on yet. Nothing was published and nothing was changed.');
  });

  it('shows Publishing... and locks the controls while it works', () => {
    const out = box({ ticked: true, reason: 'Exam is tomorrow', canOverride: true, busy: true });
    expect(out).toContain('Publishing...');
    expect(out).toMatch(/<input[^>]*disabled=""/);
  });
});

describe('the page', () => {
  const src = read('./PublishFlow.tsx');

  it('puts the box right under the red "Not yet. Fix these first" list, before the left-out tick', () => {
    const blocked = src.indexOf('data-testid="publish-blocked"');
    const anyway = src.indexOf('<PublishAnywayBox', blocked);
    const leftOut = src.indexOf('data-testid="left-out-confirm"');
    expect(blocked).toBeGreaterThan(-1);
    expect(anyway).toBeGreaterThan(blocked);
    expect(anyway).toBeLessThan(leftOut);
    expect(src).toContain('Not yet. Fix {failed.length === 1');
  });

  it('asks again in a plain confirm box before it publishes, and saves nothing until the person says yes', () => {
    expect(src).toContain("title: 'Publish this paper with a problem?'");
    expect(src).toContain("confirmLabel: 'Publish anyway'");
    expect(src.indexOf("title: 'Publish this paper with a problem?'")).toBeLessThan(src.indexOf('api.publishAnyway('));
    expect(src).toContain('if (!ok) return;');
  });

  it('words every failure through overrideErrorWords and leaves the normal Publish call alone', () => {
    expect(src).toContain('setOverrideError(overrideErrorWords(err));');
    expect(src).toContain('api.approvePaper(paperId, note, leftOutCount > 0 ? confirmedLeftOut : undefined)');
  });

  it('tells the person on the done screen that the reason is saved', () => {
    expect(src).toContain("Published anyway. Your reason is saved in the paper's history.");
  });
});

describe('the marker in Live papers', () => {
  function renderLive(api: ReturnType<typeof createFakeHodApi>) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return Promise.all([api.livePapers(), api.overrideMarks()]).then(([rows, marks]) => {
      qc.setQueryData(LIVE_KEY('t'), rows);
      qc.setQueryData(['hod', 't', 'override-marks'], marks ?? []);
      return renderToStaticMarkup(
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <LiveTab api={api} scope="t" />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
  }

  it('shows a small honest marker on a paper that was published anyway, with who, why and what was skipped', async () => {
    const api = createFakeHodApi();
    await api.publishAnyway(GL.econ2, 'The exam is tomorrow', undefined, true);
    const out = await renderLive(api);
    expect(out).toContain('data-testid="override-mark"');
    expect(out).toContain('Published anyway');
    expect(out).toContain('by You');
    expect(out).toContain('Why: The exam is tomorrow');
    expect(out).toContain('Checks skipped: Pictures are in place; Paper details are complete; No scanner junk left.');
    expect(out.match(/data-testid="override-mark"/g)).toHaveLength(1);
  });

  it('shows no marker at all when nothing was published anyway, or before the database file is pasted', async () => {
    expect(await renderLive(createFakeHodApi())).not.toContain('override-mark');
  });

  it('the public paper page has nothing about it', () => {
    for (const f of ['../../pages/BankPaper.tsx']) {
      let src = '';
      try {
        src = read(f);
      } catch {
        continue;
      }
      expect(src).not.toMatch(/publish_override|published anyway|override/i);
    }
  });
});
