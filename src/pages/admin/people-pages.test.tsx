import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { ReactElement } from 'react';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));
vi.mock('@/lib/admin-debug', () => ({
  useAdminDebugToggle: () => ({ on: false, canToggle: false, toggle: () => {} }),
  useAdminDebugOn: () => false,
}));

const recordAdminAction = vi.fn();
vi.mock('@/lib/audit', () => ({ recordAdminAction: (...a: unknown[]) => recordAdminAction(...a) }));

import { VerifierListBody } from '@/pages/admin/checkers';
import { HodListBody, ReviewerListBody } from '@/components/admin/HodSection';
import { TeamBody, VerifierStatsList } from '@/pages/admin/team';
import { QuestionTimeline } from '@/components/admin/QuestionTimeline';
import { grantHod, revokeHod } from '@/lib/hod-admin-actions';
import type { CheckerAdminRow } from '@/lib/checker-admin-api';
import type { HodAdminApi, HodRow, HodVerifierProfile } from '@/lib/hod-api';
import type { ReviewerRow } from '@/lib/teacher-review-api';
import type { PaperProgressRow, TeamStatsRow } from '@/lib/team-dashboard-api';

const html = (el: ReactElement) => renderToStaticMarkup(<StaticRouter location="/">{el}</StaticRouter>);
const text = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

const checker = (id: string, name: string): CheckerAdminRow => ({
  user_id: id,
  email: `${id}@example.com`,
  full_name: name,
  added_at: new Date(Date.now() - 86400_000).toISOString(),
  checked_today: 1,
  checked_total: 5,
});

const profile = (id: string, over: Partial<HodVerifierProfile>): HodVerifierProfile => ({
  user_id: id,
  email: null,
  name: null,
  active: true,
  full_name: id,
  grade: 10,
  school: 'S',
  board: 'ICSE',
  valid_until: '2027-03-31',
  expired: false,
  missing: false,
  preferred_subjects: [],
  requested_subjects: [],
  requested_at: null,
  ...over,
});

const noop = () => {};

describe('verifier list', () => {
  it('shows the error with Try again, and never the empty copy, when the read failed', () => {
    const out = html(<VerifierListBody rows={null} error profiles={null} onRetry={noop} onDetails={noop} onRemove={noop} />);
    expect(text(out)).toContain('The verifier list did not load.');
    expect(out).toContain('Try again');
    expect(out).not.toContain('There are no verifiers yet');
  });

  it('says there are none only after a read that worked and found nobody', () => {
    const out = html(<VerifierListBody rows={[]} error={false} profiles={[]} onRetry={noop} onDetails={noop} onRemove={noop} />);
    expect(text(out)).toContain('There are no verifiers yet');
    expect(out).not.toContain('did not load');
  });

  it('joins details to each verifier and lists missing and expired first', () => {
    const rows = [checker('ready1', 'Ready Person'), checker('expired1', 'Expired Person'), checker('missing1', 'Missing Person')];
    const profiles = [profile('ready1', {}), profile('expired1', { expired: true })];
    const out = html(<VerifierListBody rows={rows} error={false} profiles={profiles} onRetry={noop} onDetails={noop} onRemove={noop} />);
    // The desktop grid comes first in the markup: missing, then expired, then ready.
    const order = ['Missing Person', 'Expired Person', 'Ready Person'].map((n) => out.indexOf(n));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(out).toContain('Missing');
    expect(out).toContain('Expired');
    expect(out).toContain('Ready');
    expect(out).toContain('Add details');
  });

  it('says details are not known, not missing, when the profiles could not be read', () => {
    const out = html(<VerifierListBody rows={[checker('a', 'A Person')]} error={false} profiles={null} onRetry={noop} onDetails={noop} onRemove={noop} />);
    expect(out).toContain('Not known');
    expect(out).not.toContain('>Missing<');
  });

  it('keeps the rows and shows the error beside them when a later read fails', () => {
    const out = html(<VerifierListBody rows={[checker('a', 'A Person')]} error profiles={[]} onRetry={noop} onDetails={noop} onRemove={noop} />);
    expect(out).toContain('A Person');
    expect(text(out)).toContain('did not load');
  });
});

describe('HODs and teacher reviewers', () => {
  const hod: HodRow = { user_id: 'h1', email: 'hod@example.com', name: 'Meena Roy', active: true, granted_at: null };

  it('shows an error, not "No HOD yet", when the HOD list failed', () => {
    const out = html(<HodListBody hods={null} error onRetry={noop} onRemove={noop} />);
    expect(text(out)).toContain('The HOD list did not load.');
    expect(out).not.toContain('No HOD yet');
    expect(text(html(<HodListBody hods={[]} error={false} onRetry={noop} onRemove={noop} />))).toContain('No HOD yet');
  });

  it('lists active HODs only, each with a Remove', () => {
    const out = html(<HodListBody hods={[hod, { ...hod, user_id: 'h2', name: 'Gone Person', active: false }]} error={false} onRetry={noop} onRemove={noop} />);
    expect(out).toContain('Meena Roy');
    expect(out).not.toContain('Gone Person');
    expect(out).toContain('Remove');
  });

  it('lists teacher reviewers with who, when added and whether active; only active rows can be removed', () => {
    const active: ReviewerRow = { user_id: 'r1', email: 'nila@example.com', name: 'Nila Das', active: true, granted_at: new Date(Date.now() - 3 * 86400_000).toISOString() };
    const gone: ReviewerRow = { user_id: 'r2', email: 'old@example.com', name: 'Old Reviewer', active: false, granted_at: null };
    const out = html(<ReviewerListBody reviewers={[gone, active]} error={false} onRetry={noop} onRemove={noop} />);
    expect(out).toContain('Nila Das');
    expect(out).toContain('Active');
    expect(out).toContain('Removed');
    // active first
    expect(out.indexOf('Nila Das')).toBeLessThan(out.indexOf('Old Reviewer'));
    expect(out.match(/>Remove</g)?.length).toBe(2); // desktop grid + phone card, for the one active row
    expect(text(out)).toContain('Not recorded');
  });

  it('shows an error, not the empty copy, when the reviewer list failed', () => {
    const out = html(<ReviewerListBody reviewers={null} error onRetry={noop} onRemove={noop} />);
    expect(text(out)).toContain('The teacher reviewer list did not load.');
    expect(out).not.toContain('No teacher reviewers yet');
  });
});

describe('HOD audit', () => {
  beforeEach(() => recordAdminAction.mockReset());
  const api = (): HodAdminApi & { added: string[]; removed: string[] } => {
    const added: string[] = [];
    const removed: string[] = [];
    return {
      added,
      removed,
      listHods: async () => [],
      addHod: async (e) => {
        added.push(e);
        return 'new-hod-id';
      },
      removeHod: async (id) => {
        removed.push(id);
      },
    };
  };
  const actor = { id: 'admin-1', name: 'Kanishk' };

  it('adds by email through admin_add_hod, then records grant_hod', async () => {
    const a = api();
    const id = await grantHod(a, 'tara@example.com', actor);
    expect(id).toBe('new-hod-id');
    expect(a.added).toEqual(['tara@example.com']);
    expect(recordAdminAction).toHaveBeenCalledWith({
      actorId: 'admin-1',
      actorName: 'Kanishk',
      action: 'grant_hod',
      targetType: 'hod',
      targetId: 'new-hod-id',
      targetLabel: 'tara@example.com',
    });
  });

  it('removes through admin_remove_hod with the user id, then records revoke_hod', async () => {
    const a = api();
    await revokeHod(a, { user_id: 'h1', email: 'hod@example.com', name: 'Meena', active: true, granted_at: null }, actor);
    expect(a.removed).toEqual(['h1']);
    expect(recordAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'revoke_hod', targetType: 'hod', targetId: 'h1', targetLabel: 'hod@example.com' }));
  });

  it('records nothing when the write fails, and nothing in dummy mode (no actor)', async () => {
    const failing: HodAdminApi = { ...api(), addHod: async () => { throw new Error('nope'); } };
    await expect(grantHod(failing, 'x@example.com', actor)).rejects.toThrow('nope');
    expect(recordAdminAction).not.toHaveBeenCalled();
    await grantHod(api(), 'y@example.com', null);
    expect(recordAdminAction).not.toHaveBeenCalled();
  });
});

const stat = (over: Partial<TeamStatsRow>): TeamStatsRow => ({
  user_id: 'u1',
  name: 'Ananya Roy',
  questions_checked: 10,
  passed: 7,
  fixed: 2,
  asked_help: 1,
  skipped: 3,
  papers_completed: 2,
  median_seconds: 42,
  admin_overturns: 1,
  ...over,
});
const paper = (i: number): PaperProgressRow => ({
  audit_paper_id: `p${i}`,
  live_bank_paper_id: null,
  subject: 'Mathematics',
  cls: 'X',
  school: `School ${i}`,
  open_doubts: 1,
  cleared: 1,
  total: 2,
  pct_done: 50,
  last_activity: null,
  workers: [],
});

const teamProps = {
  range: '7d' as const,
  heldRange: null,
  paperLimit: 30,
  questionQuery: '',
  onQuestionQuery: noop,
  onLookup: noop,
  onRetry: noop,
  onRange: noop,
  onShowMore: noop,
};

describe('verifier progress page body', () => {
  it('shows an error panel with Try again, not "Nobody checked", when the first read failed', () => {
    const out = html(<TeamBody {...teamProps} settled loadError stats={[]} progress={[]} />);
    expect(text(out)).toContain('The verifier progress did not load.');
    expect(out).toContain('Try again');
    expect(text(out)).not.toContain('Nobody');
    expect(text(out)).not.toContain('No papers in the pipeline');
  });

  it('says nobody checked a question only after a read that worked', () => {
    const out = html(<TeamBody {...teamProps} settled loadError={false} stats={[]} progress={[]} />);
    expect(text(out)).toContain('Nobody checked a question in the last 7 days');
    expect(out).not.toContain('did not load');
  });

  it('keeps the last good numbers and says which range they belong to when a refresh fails', () => {
    const out = html(<TeamBody {...teamProps} range="30d" heldRange="7d" settled loadError stats={[stat({})]} progress={[]} />);
    expect(text(out)).toContain('The numbers for 30 days did not load.');
    expect(text(out)).toContain('Showing the numbers for 7 days below.');
    expect(out).toContain('Ananya Roy');
  });

  it('shows five columns, folds the rest into a More line, and has no empty-label column', () => {
    const out = html(<VerifierStatsList stats={[stat({})]} maxChecked={10} />);
    for (const h of ['Verifier', 'Checked', 'Passed', 'Fixed', 'Changed by admin']) expect(out).toContain(h);
    expect(out).not.toContain('Overturned');
    expect(out).not.toContain('Time per question');
    expect(out).toContain('aria-expanded="false"');
  });

  it('the table roles nest properly: the list between the table and its rows is a rowgroup', () => {
    const out = html(<VerifierStatsList stats={[stat({})]} maxChecked={10} />);
    expect(out).toMatch(/role="table"[\s\S]*<ul role="rowgroup"[^>]*>\s*<li[^>]*role="row"/);
  });

  it('the paper list heading matches the order the server sends: most doubts first', () => {
    const out = html(<TeamBody {...teamProps} settled loadError={false} stats={[stat({})]} progress={[paper(1)]} />);
    expect(text(out)).toContain('Papers, most doubts left first');
    expect(text(out)).not.toContain('fewest doubts');
  });

  it('caps the paper list at 30 and offers the rest', () => {
    const progress = Array.from({ length: 47 }, (_, i) => paper(i));
    const out = html(<TeamBody {...teamProps} settled loadError={false} stats={[stat({})]} progress={progress} />);
    expect(text(out)).toContain('Showing 30 of 47 papers');
    expect(text(out)).toContain('Show 17 more');
    expect(out).toContain('School 29');
    expect(out).not.toContain('School 30');
  });

  it('has no per-card prompt button any more', () => {
    const out = html(<TeamBody {...teamProps} settled loadError={false} stats={[stat({})]} progress={[paper(1)]} />);
    expect(out).not.toContain('Look up a question in this paper');
    expect(text(out)).toContain('Look up a question by its id');
  });
});

describe('question history', () => {
  it('tells a failed read from an empty history', () => {
    const failed = html(<QuestionTimeline rows={[]} error onRetry={noop} />);
    expect(text(failed)).toContain("This question's history did not load.");
    expect(text(failed)).not.toContain('Nothing logged yet');
    const empty = html(<QuestionTimeline rows={[]} />);
    expect(text(empty)).toContain('Nothing logged yet');
    expect(text(empty)).not.toContain('did not load');
  });

  it('shows a loading state while the read is under way', () => {
    expect(html(<QuestionTimeline rows={[]} loading />)).toContain('Loading the history');
  });
});
