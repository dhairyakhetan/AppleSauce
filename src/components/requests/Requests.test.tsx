import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { RequestForm } from '@/components/requests/RequestForm';
import { MyRequestRow, ReportProblemDialog } from '@/components/requests/ReportProblemDialog';
import { RequestCard, RequestsSection } from '@/components/hod/RequestsTab';
import { createFakeFixRequestsApi } from '@/dummy/fix-requests-fake-api';
import { clearSavedDraft, normaliseRequest, type FixRequest } from '@/lib/fix-requests';

/* No jsdom here: the pieces are rendered to markup, and the wiring in the pages is checked against their
   source, as the other HOD and checker tests do. */

const wrap = (node: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
);

const make = (over: Record<string, unknown> = {}): FixRequest =>
  normaliseRequest({
    id: 'r1',
    created_at: '2026-11-12T10:00:00Z',
    raised_by_name: 'Nikhil K',
    raised_as: 'member',
    kind: 'bug',
    title: 'The Skip button does nothing',
    details: 'I press Skip and nothing happens.',
    page_path: '/checker?paper=abc&verify=1',
    status: 'waiting_for_hod',
    ...over,
  }) as FixRequest;

describe('the request form', () => {
  const html = () => {
    clearSavedDraft();
    return renderToStaticMarkup(
      wrap(<RequestForm api={createFakeFixRequestsApi('member')} scope="live" page="/checker?paper=abc&verify=1" asHod={false} onSent={() => {}} onCancel={() => {}} />),
    );
  };

  it('offers the two plain choices as a labelled group of radio buttons', () => {
    const out = html();
    expect(out).toContain('<fieldset');
    expect(out).toContain('<legend');
    expect(out.match(/type="radio"/g)).toHaveLength(2);
    expect(out).toContain('Something is broken');
    expect(out).toContain('Something should change');
  });

  it('labels the title and the details boxes and sizes them for phones', () => {
    const out = html();
    expect(out).toMatch(/<label for="[^"]+-title"[^>]*>Short title<\/label>/);
    expect(out).toMatch(/<label for="[^"]+-details"[^>]*>What happened/);
    expect(out).toContain('maxLength="120"');
    expect(out).toContain('maxLength="4000"');
    // 16px on a phone so the browser does not zoom in when a box is tapped.
    expect(out).toContain('text-[16px]');
  });

  it('fills in the screen it came from in words, without letting it be typed over', () => {
    const out = html();
    expect(out).toContain('Screen: </span>My papers, checking a question');
    expect(out).not.toContain('abc');
  });

  it('tells a member the HOD reads it first, and an HOD it goes straight to Claude', () => {
    expect(html()).toContain('Your HOD will read this first.');
    clearSavedDraft();
    const hod = renderToStaticMarkup(
      wrap(<RequestForm api={createFakeFixRequestsApi('hod')} scope="live" page="/hod?tab=requests" asHod onSent={() => {}} onCancel={() => {}} />),
    );
    expect(hod).toContain('approved at once and goes straight to Claude');
  });

  it('has a Send and a Cancel button, both big enough to tap', () => {
    const out = html();
    expect(out).toContain('>Send</button>');
    expect(out).toContain('>Cancel</button>');
    expect(out.match(/tap-44/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the Report a problem dialog', () => {
  const dialog = (view: 'form' | 'sent' | 'mine') =>
    renderToStaticMarkup(
      wrap(<ReportProblemDialog api={createFakeFixRequestsApi('member')} scope="live" page="/checker" initialView={view} onClose={() => {}} />),
    );

  it('is a modal dialog named by its heading', () => {
    clearSavedDraft();
    const out = dialog('form');
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain('aria-labelledby="report-problem-title"');
    expect(out).toMatch(/<h2 id="report-problem-title"[^>]*>Report a problem<\/h2>/);
  });

  it('opens on My requests when asked, with a way back to a new request', () => {
    const out = dialog('mine');
    expect(out).toMatch(/<h2 id="report-problem-title"[^>]*>My requests<\/h2>/);
    expect(out).toContain('New request');
  });
});

describe('a request in My requests', () => {
  it('says what became of each one in plain words', () => {
    const waiting = renderToStaticMarkup(<MyRequestRow r={make()} />);
    expect(waiting).toContain('Waiting for your HOD');
    expect(waiting).toContain('My papers, checking a question');

    const rejected = renderToStaticMarkup(<MyRequestRow r={make({ status: 'rejected', decision_note: 'Not now.' })} />);
    expect(rejected).toContain('Not taken forward');
    expect(rejected).toContain('Their reason: Not now.');

    const done = renderToStaticMarkup(<MyRequestRow r={make({ status: 'done', claude_note: 'The link works again.' })} />);
    expect(done).toContain('Done');
    expect(done).toContain('What was done: The link works again.');

    expect(renderToStaticMarkup(<MyRequestRow r={make({ status: 'in_progress' })} />)).toContain('Being fixed');
    expect(renderToStaticMarkup(<MyRequestRow r={make({ status: 'approved' })} />)).toContain('Approved');
  });
});

describe('the HOD Requests tab', () => {
  it('shows a loading state before the list arrives, with the four groups and New request', () => {
    const out = renderToStaticMarkup(wrap(<RequestsSection api={createFakeFixRequestsApi('hod')} scope="live" />));
    expect(out).toContain('aria-label="Loading requests"');
    for (const label of ['Waiting for you', 'Approved', 'Rejected', 'Done']) expect(out).toContain(label);
    expect(out).toContain('New request');
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('goes');
  });

  it('a waiting card shows who, when, what kind, the screen and the details, with Approve and Reject', () => {
    const out = renderToStaticMarkup(<RequestCard api={createFakeFixRequestsApi('hod')} request={make()} onDecided={() => {}} />);
    expect(out).toContain('The Skip button does nothing');
    expect(out).toContain('Broken');
    expect(out).toContain('from Nikhil K');
    expect(out).toContain('on My papers, checking a question');
    expect(out).toContain('I press Skip and nothing happens.');
    expect(out).toContain('Waiting for you');
    expect(out).toContain('>Approve</button>');
    expect(out).toContain('>Reject</button>');
  });

  it('an HOD who sent a waiting request themselves is told another HOD decides it, with no Approve or Reject (the database refuses it)', () => {
    const out = renderToStaticMarkup(<RequestCard api={createFakeFixRequestsApi('hod')} request={make()} onDecided={() => {}} own />);
    expect(out).toContain('another HOD has to say yes or no');
    expect(out).not.toContain('>Approve<');
    expect(out).not.toContain('>Reject<');
  });

  it('a decided card has no buttons and shows the decision and what Claude did', () => {
    const rejected = renderToStaticMarkup(
      <RequestCard api={createFakeFixRequestsApi('hod')} request={make({ status: 'rejected', decided_by_name: 'Priya', decided_at: '2026-11-12T11:00:00Z', decision_note: 'Not now.' })} onDecided={() => {}} />,
    );
    expect(rejected).not.toContain('>Approve</button>');
    expect(rejected).toContain('Rejected by Priya');
    expect(rejected).toContain('Note: Not now.');

    const done = renderToStaticMarkup(
      <RequestCard api={createFakeFixRequestsApi('hod')} request={make({ status: 'done', decided_at: '2026-11-12T11:00:00Z', claude_note: 'Fixed the link.' })} onDecided={() => {}} />,
    );
    expect(done).toContain('What was done: </span>Fixed the link.');
  });

  it('an HOD request says it went straight on, and no yes was asked for', () => {
    const out = renderToStaticMarkup(
      <RequestCard api={createFakeFixRequestsApi('hod')} request={make({ status: 'approved', raised_as: 'hod' })} onDecided={() => {}} />,
    );
    expect(out).toContain('(an HOD)');
    expect(out).toContain('went straight on to be fixed');
    expect(out).not.toContain('>Approve</button>');
  });
});

describe('the wiring in the pages', () => {
  const checker = readFileSync('src/pages/Checker.tsx', 'utf8').replace(/\r\n/g, '\n');
  const hod = readFileSync('src/pages/Hod.tsx', 'utf8');

  it('the checker Menu has Report a problem and My requests, and a small button sits on My papers', () => {
    expect(checker).toContain("setReportView('form')");
    expect(checker).toContain("setReportView('mine')");
    expect(checker).toMatch(/<Chip onClick=\{\(\) => setReportView\('form'\)\} tone="muted">\s*Report a problem\s*<\/Chip>/);
    expect(checker).toMatch(/Report a problem\s*<\/ActionButton>/);
  });

  it('the keys on the verify screen stay quiet while the dialog is open', () => {
    expect(checker).toContain('suspended={menuOpen || reportView !== null}');
  });

  it('the screen it came from is the page the person was on', () => {
    expect(checker).toContain('page={screenPath(location)}');
  });

  it('the HOD page lists the Requests tab and draws its badge from its own count', () => {
    expect(hod).toContain("key: 'requests', label: 'Requests'");
    expect(hod).toContain('requestsCountsKey(scope)');
    expect(hod).toContain('tabBadge(t.key, countsQ.data, requestsWaiting)');
  });
});
