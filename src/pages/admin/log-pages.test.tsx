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
import { DayBars, StatsPanel } from '@/pages/admin/pipeline';
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
    expect(unknown.verb).toBe('Put a batch of papers on hold');
    expect(unknown.verb).not.toContain('_');
    expect(describeAction({ action: 'hold_batch', target_type: 'something_new' }).verb).toBe('Hold batch something new');
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
    expect(text(html)).toContain('AI check suggested a fix to question 3(b)');
  });
});

describe('pipeline panels', () => {
  const noop = () => {};

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

  it('the page is gated only by the admin check: the route and the registry are always in the tree', () => {
    const src = readFileSync('src/pages/admin/pipeline.tsx', 'utf8');
    const page = src.slice(src.indexOf('export function AdminPipelinePage'));
    expect(page).toMatch(/if \(checkingAdmin\) \{/);
    expect(page).not.toMatch(/if \((?:checkingAdmin \|\| )?(?:loading|status === 'loading')\)/);
    expect(page.indexOf('<PipelineRoute')).toBeGreaterThan(-1);
    expect(page.indexOf('<PipelineRoute')).toBeLessThan(page.indexOf('<PipelineDetailFold'));
    // The folded detail lives in components/admin/PipelineDetail.tsx, shared with /hod/pipeline.
    const detail = readFileSync('src/components/admin/PipelineDetail.tsx', 'utf8');
    expect(detail.indexOf('<PaperRegistryPanel')).toBeGreaterThan(-1);
    expect(detail.indexOf('<PaperRegistryPanel')).toBeLessThan(detail.indexOf('title="Papers library"'));
  });

  it('the old Needs attention strip and Checking panel are gone: they counted the frozen earlier-library copies and disagreed with the route', () => {
    const src = readFileSync('src/pages/admin/pipeline.tsx', 'utf8');
    expect(src).not.toContain('AttentionStrip');
    expect(src).not.toContain('title="Checking"');
    expect(src).not.toContain('Student queue');
  });

  it('the admin page hands the route the admin audience, and the HOD page the HOD one', () => {
    expect(readFileSync('src/pages/admin/pipeline.tsx', 'utf8')).toContain('audience="admin"');
    expect(readFileSync('src/pages/HodPipeline.tsx', 'utf8')).toContain('audience="hod"');
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
    const src = readFileSync('src/components/admin/PipelineDetail.tsx', 'utf8');
    expect(src).toMatch(/status=\{status === 'ok' && feedFailed \? 'error' : status\}\s+what="the activity"/);
    const html = wrap(<StatsPanel title="Activity" status="error" what="the activity" onRetry={() => {}}><p>No activity recorded yet</p></StatsPanel>);
    expect(text(html)).toContain('The activity did not load.');
    expect(text(html)).not.toContain('No activity recorded yet');
  });
});
