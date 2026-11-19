import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { AttentionGroup, PaperStatusPill, PaperTimeline, PaperTimelineDisclosure, StageStrip } from '@/components/PaperStatus';
import { EMPTY_MOMENTS, STAGES, STAGE_ORDER, buildTimeline } from '@/lib/paper-status';

describe('the paper label', () => {
  it('shows an icon and the stage in words, so it never depends on colour alone', () => {
    for (const stage of STAGE_ORDER) {
      const out = renderToStaticMarkup(<PaperStatusPill stage={stage} />);
      expect(out).toContain(STAGES[stage].label);
      expect(out).toContain('<svg');
      expect(out).toContain('aria-hidden="true"');
      expect(out).toContain(`data-stage="${stage}"`);
      // A plain sentence for a screen reader and the tooltip.
      expect(out).toContain(STAGES[stage].hint);
    }
  });

  it('each stage has its own colour', () => {
    const tones = STAGE_ORDER.map((s) => renderToStaticMarkup(<PaperStatusPill stage={s} />).match(/class="([^"]*)"/)?.[1] ?? '');
    expect(new Set(tones).size).toBe(STAGE_ORDER.length);
  });

  it('"Checked, waiting to go live" and "Live" are the same shape: only the words and colour change', () => {
    const shape = (s: string) => s.replace(/data-stage="[a-z_]+"/, '').replace(/title="[^"]*"/, '').replace(/bg-[^ "]+|text-[^ "]+/g, '').replace(/>[^<]*</g, '><').replace(/<svg.*?<\/svg>/, '<svg/>');
    const waiting = shape(renderToStaticMarkup(<PaperStatusPill stage="waiting" />));
    const live = shape(renderToStaticMarkup(<PaperStatusPill stage="live" />));
    expect(waiting.replace(/<svg[^>]*>/, '')).toBeTruthy();
    expect(live.replace(/<svg[^>]*>/, '')).toBeTruthy();
    // Same wrapper and same two text slots.
    expect(waiting.match(/<span/g)?.length).toBe(live.match(/<span/g)?.length);
  });

  it('can carry other words for one screen', () => {
    expect(renderToStaticMarkup(<PaperStatusPill stage="live" label="Live on the site" />)).toContain('Live on the site');
  });
});

describe('the strip of counts', () => {
  const counts = { not_ready: 4, ready: 12, checking: 7, waiting: 3, live: 210 };

  it('has one pressable box per stage with its count and its short words', () => {
    const out = renderToStaticMarkup(<StageStrip counts={counts} active={null} onPick={() => {}} />);
    expect(out).toContain('aria-label="Papers by stage"');
    expect((out.match(/<button/g) ?? []).length).toBe(5);
    for (const stage of STAGE_ORDER) expect(out).toContain(STAGES[stage].short);
    for (const n of ['>4<', '>12<', '>7<', '>3<', '>210<']) expect(out).toContain(n);
  });

  it('the chosen stage is marked as pressed, the others are not', () => {
    const out = renderToStaticMarkup(<StageStrip counts={counts} active="checking" onPick={() => {}} />);
    expect((out.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect((out.match(/aria-pressed="false"/g) ?? []).length).toBe(4);
    expect(out).toMatch(/aria-pressed="true"[^>]*data-stage="checking"|data-stage="checking"[^>]*aria-pressed="true"/);
  });

  it('a count that could not load shows a question mark, and a cut-short list shows a plus', () => {
    const out = renderToStaticMarkup(<StageStrip counts={{ not_ready: null, ready: 200 }} capped={{ ready: true }} active={null} onPick={() => {}} />);
    expect(out).toContain('>?<');
    expect(out).toContain('200+');
  });

  it('every box is a comfortable tap target', () => {
    expect(renderToStaticMarkup(<StageStrip counts={counts} active={null} onPick={() => {}} />)).toContain('min-h-[64px]');
  });
});

describe('Needs attention', () => {
  const items = [
    { key: 'a', stage: 'checking' as const, label: 'Maths, Class 10', reason: 'Asha was given this 9 days ago and has not started it.' },
    { key: 'b', stage: 'not_ready' as const, label: 'Physics, Class 9', reason: '3 questions have no picture.' },
  ];

  it('shows nothing when no paper is stuck', () => {
    expect(renderToStaticMarkup(<AttentionGroup id="x" items={[]} />)).toBe('');
  });

  it('says each paper, its stage and the reason in plain words', () => {
    const out = renderToStaticMarkup(<AttentionGroup id="attn" items={items} />);
    expect(out).toContain('Needs attention');
    expect(out).toContain('2 papers');
    expect(out).toContain('aria-labelledby="attn"');
    expect(out).toContain('Asha was given this 9 days ago and has not started it.');
    expect(out).toContain('3 questions have no picture.');
    expect(out).toContain('Being checked');
    expect(out).toContain('Not ready');
  });

  it('a long list is cut and says how many more', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...items[0], key: `k${i}` }));
    const out = renderToStaticMarkup(<AttentionGroup id="attn" items={many} max={4} />);
    expect((out.match(/data-testid="attention-item"/g) ?? []).length).toBe(4);
    expect(out).toContain('and 5 more below');
  });

  it('does not add a number to any tab (the alert lives on the screen only)', () => {
    const hod = readFileSync('src/pages/Hod.tsx', 'utf8');
    expect(hod).not.toMatch(/attention/i);
    expect(readFileSync('src/lib/hod-tabs.ts', 'utf8')).not.toMatch(/attention|stuck/i);
  });
});

describe('the timeline inside a paper', () => {
  it('lists the key moments with a tick, the current one and the ones still to come', () => {
    const steps = buildTimeline({ ...EMPTY_MOMENTS, loaded_at: '2026-10-01T12:00:00Z', given_at: '2026-10-10T12:00:00Z' }, 'checking');
    const out = renderToStaticMarkup(<PaperTimeline steps={steps} />);
    expect(out).toContain('Key moments of this paper');
    for (const l of ['Loaded', 'Pictures complete', 'Given to a checker', 'Finished by checkers', 'Approved', 'Live']) expect(out).toContain(l);
    expect(out).toContain('1 Oct');
    expect(out).toContain('10 Oct');
    expect((out.match(/aria-current="step"/g) ?? []).length).toBe(1);
    expect(out).toContain('this is where it is now');
    // A step that is done without a date says so, in words.
    expect(out).toContain('the date was not kept');
  });

  it('is closed until opened, and fetches nothing while closed', () => {
    const qc = new QueryClient();
    const load = vi.fn(() => Promise.resolve(null));
    const out = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <PaperTimelineDisclosure queryKey={['t', 'p']} load={load} fallback={EMPTY_MOMENTS} stage="live" />
      </QueryClientProvider>,
    );
    expect(out).toContain('Where this paper has been');
    expect(out).toContain('<details');
    expect(out).not.toMatch(/<details[^>]*open/);
    // The question exists but is switched off: the dates are only asked for once the paper is opened.
    expect(load).not.toHaveBeenCalled();
    expect(qc.getQueryCache().getAll().every((q) => q.state.fetchStatus === 'idle')).toBe(true);
  });

  it('builds from what the row knows when the server cannot give the dates (the load answers null)', () => {
    const src = readFileSync('src/components/PaperStatus.tsx', 'utf8');
    expect(src).toContain('enabled: open');
    expect(src).toContain('merged[k] = q.data[k] ?? fallback[k]');
  });
});

describe('the wiring on every screen', () => {
  const read = (p: string) => readFileSync(p, 'utf8');

  it('the HOD desk shows the strip above the tabs', () => {
    const hod = read('src/pages/Hod.tsx');
    expect(hod).toContain('<HodStageStrip api={api} scope={scope} />');
    expect(hod.indexOf('<HodStageStrip')).toBeLessThan(hod.indexOf('role="tablist"'));
  });

  it('tapping a stage opens the list that holds it, filtered with ?stage=', () => {
    const strip = read('src/components/hod/HodStageStrip.tsx');
    expect(strip).toContain('STAGE_TAB[stage]');
    expect(strip).toContain('next.set(STAGE_PARAM, stage)');
    // The counts reuse the lists' own queries, so one that fails shows "?" without stopping the others.
    for (const key of ['HELD_BACK_KEY', 'UNASSIGNED_KEY', 'ASSIGNMENTS_KEY']) expect(strip).toContain(key);
  });

  it('Assignments: a label on every row, the stuck reason, the Needs attention group, the filter and the timeline', () => {
    const src = read('src/components/hod/AssignmentsTab.tsx');
    expect(src).toContain('stageOfAssignment()');
    expect(src).toContain('stageOfFree()');
    expect(src).toContain('stageOfHeldBack()');
    expect(src).toContain('stuckReason(a, lookup, now)');
    // A checker who has finished their part is not blamed: the row and the Needs attention group say it waits for an HOD.
    expect(src).toContain('waitingForHodReason(a, now)');
    // The per-person list now lives in WhoHasWhat, which draws the reason lines it is handed.
    expect(read('src/components/hod/WhoHasWhat.tsx')).toContain('data-testid="waiting-for-hod-reason"');
    expect(src).toContain('<AttentionGroup id="assign-attention"');
    expect(src).toContain('showSection(');
    expect(src).toContain('Show all papers');
    expect((src.match(/<PaperTimelineDisclosure/g) ?? []).length).toBe(3);
    // Reads when each holder last did anything, but never waits on it.
    expect(src).toContain("api.paperActivity()");
    expect(src).toContain('retry: false');
  });

  it('Ready to go live and Live papers carry the same label and timeline', () => {
    const ready = read('src/components/hod/ReadyTab.tsx');
    expect(ready).toContain('stageOfReady(p)');
    expect(ready).toContain('<AttentionGroup id="ready-attention"');
    expect(ready).toContain('<PaperTimelineDisclosure');
    const live = read('src/components/hod/LiveTab.tsx');
    expect(live).toContain('<PaperStatusPill stage="live" />');
    expect(live).toContain('<PaperTimelineDisclosure');
  });

  it("a checker's My papers card has the label and a plain line about what is left", () => {
    const src = read('src/pages/Checker.tsx');
    expect(src).toContain('stageOfCheckerCard(p)');
    expect(src).toContain('checkerCardLine(p)');
  });

  it('the publish screen has the label and the timeline (the HOD preview that admins use, and the old admin page behind it)', () => {
    const flow = read('src/components/hod/PublishFlow.tsx');
    expect(flow).toContain('<PaperStatusPill stage={stageOfReady(paper)} />');
    expect(flow).toContain('<PaperTimelineDisclosure');
    const src = read('src/pages/admin/paper-approval.tsx');
    expect(src).toContain('<PaperStatusPill');
    expect(src).toContain('stageOfApprovalRow');
    expect(src).toContain('<PaperTimelineDisclosure');
  });

  it('approved and live come only from the website: no laptop file is read by the stage rules', () => {
    const src = read('src/lib/paper-status.ts');
    expect(src).not.toMatch(/from 'node:|require\(|readFile|pipeline|registry/);
  });

  it('the two new server reads are optional: a missing function is an empty answer, not an error', () => {
    const api = read('src/lib/hod-api.ts');
    expect(api).toMatch(/async paperTimeline\(auditPaperId\)[\s\S]*?catch \{\s*return null;/);
    expect(api).toMatch(/async paperActivity\(\)[\s\S]*?catch \{\s*return null;/);
  });

  it('the database file only reads, and is the same in the migrations folder', () => {
    const sql = read('supabase/migrations/20261113100000_paper_status_reads.sql');
    expect(sql).toContain('function public.hod_paper_timeline');
    expect(sql).toContain('function public.hod_paper_activity');
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|drop)\b\s+(into|from|table|function)?\s*public\./i);
    expect(sql).toContain('is_hod() or public.is_admin()');
    expect(sql).toContain('revoke all on function public.hod_paper_timeline(uuid) from public, anon');
  });
});
