import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));
vi.mock('@/lib/admin-debug', () => ({
  useAdminDebugToggle: () => ({ on: false, canToggle: false, toggle: () => {} }),
  useAdminDebugOn: () => false,
}));

import { AuditPanel } from '@/pages/admin/audit';
import { ActivityItem } from '@/pages/admin/activity';
import { AttentionStrip, DayBars, StatsPanel } from '@/pages/admin/pipeline';
import { describeAction } from '@/lib/audit-describe';
import { AUDIT_LIMIT, type AuditRow } from '@/lib/audit-api';
import { createFakeAuditApi } from '@/dummy/audit-fake-api';
import { createFakePipelineApi } from '@/dummy/pipeline-fake-api';
import type { ActivityRow } from '@/lib/activity-api';

/* No jsdom here, so these render the presentational pieces to markup. The
   state each page is in (loading, error, empty, success) is decided by the
   props, which is what lets an injected failing api be proven without a DOM. */

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const wrap = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

const AUDIT_ROW: AuditRow = {
  id: 'a1',
  actor_name: 'Priya Sharma',
  action: 'grant_checker',
  target_type: 'checker',
  target_label: 'dev.kumar@example.com',
  reason: null,
  created_at: '2026-10-07T09:00:00Z',
};

describe('audit page states', () => {
  const noop = () => {};
  it('a failed load shows the error with Try again and never the "no actions" copy', () => {
    const html = wrap(<AuditPanel rows={null} loadError onRetry={noop} searchQuery="" onSearch={noop} />);
    expect(text(html)).toContain('The admin actions did not load.');
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain('Try again');
    expect(text(html)).not.toContain('No admin actions recorded yet');
  });

  it('before the first read finishes it shows a skeleton, not an empty log', () => {
    const html = wrap(<AuditPanel rows={null} loadError={false} onRetry={noop} searchQuery="" onSearch={noop} />);
    expect(html).toContain('role="status"');
    expect(text(html)).not.toContain('No admin actions recorded yet');
  });

  it('a successful empty read says so, and a search with no match offers to clear it', () => {
    expect(text(wrap(<AuditPanel rows={[]} loadError={false} onRetry={noop} searchQuery="" onSearch={noop} />))).toContain(
      'No admin actions recorded yet',
    );
    const html = wrap(<AuditPanel rows={[AUDIT_ROW]} loadError={false} onRetry={noop} searchQuery="zzz" onSearch={noop} />);
    expect(text(html)).toContain('No entries match "zzz"');
    expect(text(html)).toContain('Clear search');
  });

  it('lists the entries with one absolute time format and no audit footer', () => {
    const html = wrap(<AuditPanel rows={[AUDIT_ROW]} loadError={false} onRetry={noop} searchQuery="" onSearch={noop} />);
    expect(text(html)).toContain('Added a verifier');
    expect(text(html)).toContain('Priya Sharma');
    expect(text(html)).toMatch(/\d{1,2} \w{3}(?: \d{4})?, \d{1,2}:\d{2} (am|pm)/);
    expect(text(html)).not.toContain('Open audit log');
    expect(text(html)).toContain('1 entry');
  });

  it('says so at the cap', () => {
    const many = Array.from({ length: AUDIT_LIMIT }, (_, i) => ({ ...AUDIT_ROW, id: `r${i}` }));
    const html = wrap(<AuditPanel rows={many} loadError={false} onRetry={noop} searchQuery="" onSearch={noop} />);
    expect(text(html)).toContain(`latest ${AUDIT_LIMIT}`);
    expect(text(html)).toContain(`Showing the latest ${AUDIT_LIMIT} entries`);
  });

  it('names the actions the Verifiers page records, and never shows a snake_case code', () => {
    expect(describeAction({ action: 'grant_hod', target_type: 'hod' }).verb).toBe('Made someone an HOD');
    expect(describeAction({ action: 'revoke_hod', target_type: 'hod' }).verb).toBe('Removed an HOD');
    expect(describeAction({ action: 'grant_checker', target_type: 'checker' }).verb).toBe('Added a verifier');
    const unknown = describeAction({ action: 'hold_batch', target_type: 'paper_batch' });
    expect(unknown.verb).toBe('Hold batch paper batch');
    expect(unknown.verb).not.toContain('_');
  });

  it('the fixture api reaches the full, empty and error states', async () => {
    expect((await createFakeAuditApi('full', 0).list(500)).length).toBeGreaterThan(5);
    expect(await createFakeAuditApi('empty', 0).list(500)).toEqual([]);
    await expect(createFakeAuditApi('error', 0).list(500)).rejects.toThrow();
  });

  it('reads an explicit column list, never select(*)', () => {
    const src = readFileSync('src/lib/audit-api.ts', 'utf8');
    expect(src).toContain("'id, actor_name, action, target_type, target_label, reason, created_at'");
    expect(src).not.toMatch(/select\(\s*['"]\*['"]/);
  });
});

describe('activity rows', () => {
  const base: ActivityRow = {
    at: '2026-10-02T10:00:00Z',
    stream: 'log',
    event_id: '1',
    actor_user_id: 'c0ffee00-0000-4000-8000-000000000001',
    actor_label: null,
    actor_kind: 'checker',
    action: 'checker_pass',
    table_name: 'audit_questions',
    row_id: null,
    paper_id: null,
    question_id: 'd1000000-0000-4000-8000-000000000001',
    version: 3,
    detail: null,
    question_label: '3(b)',
    paper_title: 'ICSE Class 10 Maths, 2025',
  };
  const open = () => {};

  it('reads as a sentence by role, links the person to their log, and keeps ids out of the headline', () => {
    const html = wrap(<ActivityItem group={{ head: base, also: [] }} onOpen={open} />);
    const t = text(html);
    expect(t).toContain('A student checker said question 3(b) matches the page');
    expect(t).toContain('Draft question 3(b)');
    expect(t).toContain('ICSE Class 10 Maths, 2025');
    expect(html).toContain('href="/admin/checker-log/c0ffee00-0000-4000-8000-000000000001"');
    expect(t).toContain('History');
    expect(t).not.toContain('Check:');
  });

  it('marks a row that was taken back', () => {
    expect(text(wrap(<ActivityItem group={{ head: { ...base, undone: true }, also: [] }} onOpen={open} />))).toContain('(undone)');
    expect(text(wrap(<ActivityItem group={{ head: base, also: [] }} onOpen={open} />))).not.toContain('(undone)');
  });

  it('shows the other streams as a small "also recorded" line', () => {
    const also: ActivityRow = { ...base, stream: 'version', event_id: '2', action: 'version_update' };
    expect(text(wrap(<ActivityItem group={{ head: base, also: [also] }} onOpen={open} />))).toContain('Also recorded: changed question 3(b)');
  });

  it('one time format, with the relative time as the hover title', () => {
    const html = wrap(<ActivityItem group={{ head: base, also: [] }} onOpen={open} />);
    expect(html).toMatch(/<time[^>]*title="[^"]*ago[^"]*"/);
    expect(text(html)).toMatch(/2 Oct(?: \d{4})?, \d{1,2}:\d{2} (am|pm)/);
  });

  it('a machine has no log link', () => {
    const ai: ActivityRow = { ...base, actor_user_id: null, actor_label: 'ai:sonnet', actor_kind: 'ai', action: 'check_fix' };
    const html = wrap(<ActivityItem group={{ head: ai, also: [] }} onOpen={open} />);
    expect(html).not.toContain('/admin/checker-log/');
    expect(text(html)).toContain('AI check (Sonnet) suggested a fix to question 3(b)');
  });
});

describe('pipeline panels', () => {
  const noop = () => {};

  it('a stats number that did not load is "?", never 0, and offers Try again', async () => {
    const html = wrap(
      <AttentionStrip stats={null} status="error" notStarted={46} registryStatus="ok" onShowNotStarted={noop} onRetry={noop} />,
    );
    const t = text(html);
    expect(t).toContain('Needs attention');
    expect(t).toContain('46');
    expect((t.match(/\?/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(t).toContain('The queue numbers did not load.');
    expect(t).toContain('Try again');
  });

  it('the strip is a set of links to the lists behind the numbers', async () => {
    const stats = await createFakePipelineApi('full', 0).stats();
    const html = wrap(
      <AttentionStrip stats={stats} status="ok" notStarted={46} registryStatus="ok" onShowNotStarted={noop} onRetry={noop} />,
    );
    expect(html).toContain('href="/admin/admin-queue"');
    expect(html).toContain('href="/admin/team"');
    const t = text(html);
    expect(t).toContain('Not started');
    expect(t).toContain('46');
    expect(t).toContain('35'); // the admin queue in the fixture
    expect(t).toContain('640'); // the student queue
    expect(t).not.toContain('Did not load');
  });

  it('while the numbers load, tiles show a placeholder, not a number', () => {
    const html = wrap(
      <AttentionStrip stats={null} status="loading" notStarted={null} registryStatus="loading" onShowNotStarted={noop} onRetry={noop} />,
    );
    expect(html).toContain('role="status"');
    expect(text(html)).not.toContain(' 0 ');
  });

  it('a stats panel has its own skeleton, its own error and its own success', () => {
    const body = <p>the numbers</p>;
    const loading = text(wrap(<StatsPanel title="Papers library" status="loading" what="the library numbers" onRetry={noop}>{body}</StatsPanel>));
    expect(loading).not.toContain('the numbers');
    const error = wrap(<StatsPanel title="Papers library" status="error" what="the library numbers" onRetry={noop}>{body}</StatsPanel>);
    expect(text(error)).toContain('The library numbers did not load.');
    expect(error).toContain('role="alert"');
    expect(text(error)).not.toContain('the numbers');
    const ok = text(wrap(<StatsPanel title="Papers library" status="ok" what="the library numbers" onRetry={noop}>{body}</StatsPanel>));
    expect(ok).toContain('the numbers');
  });

  it('the page is gated only by the admin check: the strip and the registry are always in the tree', () => {
    const src = readFileSync('src/pages/admin/pipeline.tsx', 'utf8');
    const page = src.slice(src.indexOf('export function AdminPipelinePage'));
    expect(page).toMatch(/if \(checkingAdmin\) \{/);
    expect(page).not.toMatch(/if \((?:checkingAdmin \|\| )?(?:loading|status === 'loading')\)/);
    expect(page.indexOf('<AttentionStrip')).toBeGreaterThan(-1);
    expect(page.indexOf('<AttentionStrip')).toBeLessThan(page.indexOf('<PaperRegistryPanel'));
    expect(page.indexOf('<PaperRegistryPanel')).toBeLessThan(page.indexOf('title="Papers library"'));
  });

  it('New scans has no list behind it, so it is a plain tile and the strip does not claim otherwise', async () => {
    const stats = await createFakePipelineApi('full', 0).stats();
    const html = wrap(<AttentionStrip stats={stats} status="ok" notStarted={46} registryStatus="ok" onShowNotStarted={() => {}} onRetry={() => {}} />);
    const scans = html.slice(html.indexOf('New scans') - 200);
    expect(scans).toContain('papers read from fresh scans');
    // the three tiles with a list behind them: Not started (button) and the two links
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect((html.match(/<a /g) ?? []).length).toBe(2);
    expect(text(html)).not.toContain('Each number opens');
  });

  it('a tile that is a button holds only phrasing content: no div or p inside the button', async () => {
    const stats = await createFakePipelineApi('full', 0).stats();
    for (const props of [{ status: 'ok' as const }, { status: 'loading' as const }]) {
      const html = wrap(
        <AttentionStrip stats={props.status === 'ok' ? stats : null} status={props.status} notStarted={46} registryStatus={props.status}
          onShowNotStarted={() => {}} onRetry={() => {}} />,
      );
      for (const button of html.match(/<button[\s\S]*?<\/button>/g) ?? []) {
        expect(button).not.toMatch(/<(div|p|h\d|ul)[ >]/);
      }
    }
  });

  it('the last bar of a chart is labelled with its date, not "today"', () => {
    const points = [
      { day: '2026-10-01', papers_added: 1, desk_papers: 0, questions_cleared: 0 },
      { day: '2026-10-12', papers_added: 2, desk_papers: 0, questions_cleared: 0 },
    ];
    const t = text(wrap(<DayBars points={points} field="papers_added" label="Papers added" barClass="x" />));
    expect(t).toContain('1 Oct');
    expect(t).toContain('12 Oct');
    expect(t).not.toContain('today');
  });

  it('a failed activity log shows the error with Try again, not "No activity recorded yet"', () => {
    const src = readFileSync('src/pages/admin/pipeline.tsx', 'utf8');
    expect(src).toMatch(/status=\{status === 'ok' && feedFailed \? 'error' : status\}\s+what="the activity"/);
    const html = wrap(<StatsPanel title="Activity" status="error" what="the activity" onRetry={() => {}}><p>No activity recorded yet</p></StatsPanel>);
    expect(text(html)).toContain('The activity did not load.');
    expect(text(html)).not.toContain('No activity recorded yet');
  });
});
