import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from '@/integrations/supabase/client';
import { createFakePipelineRouteApi } from '@/dummy/pipeline-route-fake-api';
import { EXAMPLE_ROUTE_RAW, UNSYNCED_ROUTE_RAW } from '@/lib/pipeline-route.fixture';
import {
  bytesWords,
  buildMainStops,
  buildSideStops,
  buildSiding,
  COMPUTER_LABEL,
  dataAsOf,
  easeOutCubic,
  fetchPipelineRoute,
  frozenTotal,
  laneMotion,
  maxFlow,
  normaliseRoute,
  plural,
  questionsProgress,
  STALE_AFTER_MS,
  tweenValue,
  unitWord,
  updatedWords,
} from '@/lib/pipeline-route';

const route = () => normaliseRoute(EXAMPLE_ROUTE_RAW);

describe('normaliseRoute', () => {
  it('keeps the numbers the database gave', () => {
    const r = route();
    expect(r.registry.total).toBe(8038);
    expect(r.registry.byState.not_started).toBe(4869);
    expect(r.registry.frozenByState.live).toBe(1259);
    expect(r.registry.swarmRead).toEqual({ papers: 74, deskWithoutSwarm: 2 });
    expect(r.noPdf).toEqual({ auditPapers: 514, liveOnly: 1 });
    // the cumulative counts are gone for good
    expect(r.registry).not.toHaveProperty('readTotal');
    expect(r.registry).not.toHaveProperty('aiReadTotal');
    expect(r.open.questionsByPile.kid).toBe(9291);
    expect(r.open.studentBands['41+']).toBe(88);
    expect(r.checkers.activeVerifiers).toBe(1);
    expect(r.checking).toEqual({ questions: 9291, papers: 318 });
    expect(r.needsYou).toEqual({ questions: 223, papers: 13, escalatedQuestions: 0, adminQuestions: 223 });
    expect(r.ready).toEqual({ papers: 2, canGoLive: 1, leftOutQuestions: 12 });
    expect(r.live).toEqual({ total: 1506, hidden: 5, onRoute: 129 });
    expect(r.trust?.threshold).toBe(100);
    expect(r.trust?.levels).toHaveLength(6);
    expect(r.pictures?.awaitingRoutePictures).toBe(3382);
    expect(r.drive?.totalPdfs).toBe(6880);
  });

  it('a key the database left out is 0, never undefined or NaN', () => {
    const r = route();
    expect(r.registry.byState.fully_checked).toBe(0);
    expect(r.registry.byState.live).toBe(0);
    expect(r.registry.frozenByState.fully_checked).toBe(4);
    const bare = normaliseRoute({ registry: {}, desk: {}, open: {}, checkers: {} });
    expect(bare.registry.total).toBe(0);
    expect(Object.values(bare.registry.byState).every((n) => n === 0)).toBe(true);
    expect(Object.values(bare.open.papersByPile).every((n) => n === 0)).toBe(true);
    expect(bare.open.studentBands['1-5']).toBe(0);
    expect(bare.generatedAt).toBeNull();
  });

  it('a whole section the database did not send is null, so its stop shows ? and not 0', () => {
    const bare = normaliseRoute({ registry: {}, desk: {}, open: {}, checkers: {} });
    expect(bare.checking).toBeNull();
    expect(bare.needsYou).toBeNull();
    expect(bare.ready).toBeNull();
    expect(bare.live).toBeNull();
    expect(bare.trust).toBeNull();
    expect(bare.pictures).toBeNull();
    expect(bare.drive).toBeNull();
    expect(bare.registry.swarmRead).toBeNull();
    expect(bare.noPdf).toBeNull();
    expect(bare.synced).toEqual({ deskSyncedAt: null, driveSyncedAt: null, registryChangedAt: null });
  });

  it('a PDF count row without a total is not a count, and an unknown storage size is not 0 bytes', () => {
    const noTotal = normaliseRoute({ ...EXAMPLE_ROUTE_RAW, drive: { classified: 5 } });
    expect(noTotal.drive).toBeNull();
    const noSizes = normaliseRoute({ ...EXAMPLE_ROUTE_RAW, pictures: { queued_papers: 1 } });
    expect(noSizes.pictures?.storageUsedBytes).toBeNull();
    expect(noSizes.pictures?.storageCapBytes).toBeNull();
  });

  it('never lets a bad value through: strings, negatives, fractions and junk', () => {
    const r = normaliseRoute({
      registry: { total: '12', excluded: -3, by_state: { live: 'x', loaded: 4.9, not_started: null } },
      desk: { papers: Infinity },
      open: { questions_by_pile: { kid: '7' } },
      checkers: { active_verifiers: NaN },
    });
    expect(r.registry.total).toBe(12);
    expect(r.registry.excluded).toBe(0);
    expect(r.registry.byState.live).toBe(0);
    expect(r.registry.byState.loaded).toBe(4);
    expect(r.registry.byState.not_started).toBe(0);
    expect(r.desk.papers).toBe(0);
    expect(r.open.questionsByPile.kid).toBe(7);
    expect(r.checkers.activeVerifiers).toBe(0);
  });

  it('a payload that is not the route throws, so the page keeps its last numbers instead of showing zeros', () => {
    expect(() => normaliseRoute(null)).toThrow();
    expect(() => normaliseRoute('nope')).toThrow();
    expect(() => normaliseRoute({})).toThrow();
    expect(() => normaliseRoute({ registry: {}, desk: {}, open: {} })).toThrow();
    expect(() => normaliseRoute([])).toThrow();
  });
});

describe('fetchPipelineRoute', () => {
  const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
  beforeEach(() => rpc.mockReset());

  it('calls the route function and normalises what comes back', async () => {
    rpc.mockResolvedValue({ data: EXAMPLE_ROUTE_RAW, error: null });
    const r = await fetchPipelineRoute();
    expect(rpc).toHaveBeenCalledWith('admin_pipeline_route');
    expect(r.registry.total).toBe(8038);
  });

  it('a refusal (42501) is thrown, never turned into an empty route', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });
    await expect(fetchPipelineRoute()).rejects.toMatchObject({ code: '42501' });
  });

  it('an empty answer with no error is also a failure', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchPipelineRoute()).rejects.toThrow();
  });
});

describe('the stops', () => {
  const by = (audience: 'admin' | 'hod' = 'admin', r = route()) => Object.fromEntries(buildMainStops(r, audience).map((s) => [s.id, s]));

  it('there are seven main stops, in the order of the HOD desk route, numbered 1 to 7', () => {
    const stops = buildMainStops(route());
    expect(stops.map((s) => s.id)).toEqual(['computer', 'read', 'pictures', 'students', 'needsYou', 'ready', 'live']);
    expect(stops.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(stops.every((s) => s.track === 'main')).toBe(true);
  });

  it('the first stop is the PDFs saved on the main computer, labelled exactly so, and counts the PDFs the computer has', () => {
    expect(COMPUTER_LABEL).toBe('the main computer');
    const computer = by().computer;
    expect(computer.title).toBe('PDFs saved on the main computer');
    expect(computer.count).toBe(6880);
    expect(computer.unit).toBe('PDF');
    expect(computer.facts).toContain('6,445 sorted by class and subject');
    expect(computer.facts).toContain('434 not sorted yet');
    expect(computer.facts).toContain('9.3 GB in all');
    expect(computer.facts.join(' ')).not.toContain('not real papers');
  });

  it('papers with no PDF are a separate small count and never added to the PDF number', () => {
    const computer = by().computer;
    expect(computer.count).toBe(6880);
    expect(computer.figures).toEqual([
      { label: 'Papers with no PDF here, not counted above', value: '515', note: '514 on the checking desk, 1 live on the site only' },
    ]);
    const none = normaliseRoute({ ...EXAMPLE_ROUTE_RAW, no_pdf: { audit_papers: 0, live_only: 0 } });
    expect(by('admin', none).computer.figures?.[0].note).toBeUndefined();
    const unsent = normaliseRoute({ ...EXAMPLE_ROUTE_RAW, no_pdf: undefined });
    expect(by('admin', unsent).computer.figures).toEqual([]);
  });

  it('until the computer count has been synced it is ?, never the desk list, and says so', () => {
    const computer = by('admin', normaliseRoute(UNSYNCED_ROUTE_RAW)).computer;
    expect(computer.count).toBeNull();
    expect(computer.facts[0]).toContain('has not counted the PDFs on the main computer yet');
  });

  it('Read by the AI counts the swarm only, each paper once where it is now', () => {
    const read = by().read;
    expect(read.count).toBe(74);
    expect(read.figures).toEqual([
      { label: "OCR'd, waiting for the AI", value: '1,189' },
      { label: "Still waiting to be OCR'd", value: '4,990' },
      { label: 'On the checking desk, not read by the AI', value: '2' },
    ]);
    // each paper of the new route sits in exactly one registry stage, so the stage counts add up to the list
    const inStages = Object.values(route().registry.byState).reduce((n, v) => n + v, 0);
    expect(inStages).toBe(4869 + 121 + 1189 + 73 + 3);
    // no cumulative headline and no old AI-check number
    expect(read.figures?.map((f) => f.label).join(' ')).not.toMatch(/Also read|Checked by the AI/);
  });

  it('a swarm count the database did not send is ?, not 0', () => {
    const read = by('admin', normaliseRoute({ ...EXAMPLE_ROUTE_RAW, registry: { ...EXAMPLE_ROUTE_RAW.registry, swarm_read: undefined } })).read;
    expect(read.count).toBeNull();
    expect(read.figures?.map((f) => f.label)).toEqual(["OCR'd, waiting for the AI", "Still waiting to be OCR'd"]);
  });

  it('Pictures waiting counts papers with pictures queued, with the size, and the pictures not yet queued', () => {
    const r = normaliseRoute({ ...EXAMPLE_ROUTE_RAW, pictures: { ...EXAMPLE_ROUTE_RAW.pictures, queued_papers: 3, queued_pictures: 120, queued_bytes: 52428800 } });
    const pics = by('admin', r).pictures;
    expect(pics.count).toBe(3);
    expect(pics.sideBySide).toEqual([
      { label: 'Papers', value: '3' },
      { label: 'Pictures', value: '120' },
      { label: 'Size', value: '50 MB' },
    ]);
    expect(pics.figures).toEqual([{ label: 'More, once their questions are sorted', value: '3,382 (702 MB)' }]);
    expect(pics.facts).toEqual(['Storage: 579 MB of 900 MB used']);
  });

  it('a picture backlog the desk has not sent is ?, not 0', () => {
    const pics = by('admin', normaliseRoute(UNSYNCED_ROUTE_RAW)).pictures;
    expect(pics.count).toBeNull();
    expect(pics.meaning).toContain('has not sent the picture numbers yet');
  });

  it('Checking by students counts open questions, with the trust counter and the four bands', () => {
    const students = by().students;
    expect(students.count).toBe(9291);
    expect(students.unit).toBe('question');
    expect(students.facts).toEqual(['318 papers with questions open', '1 checker active', '1 paper handed out']);
    expect(students.bands?.map((b) => [b.label, b.count])).toEqual([
      ['1 to 5 left', 29],
      ['6 to 15 left', 72],
      ['16 to 40 left', 129],
      ['41 or more left', 88],
    ]);
    expect(students.trust?.headline).toBe('AI trust: 0 of 100 checks');
    expect(students.trust?.percent).toBe(0);
    expect(students.trust?.levels[0]).toMatchObject({ label: 'High confidence, says fix', state: 'Not trusted yet, 0 checked', trusted: false });
    expect(students.trust?.levels).toHaveLength(6);
  });

  it('the trust counter fills as checks come in and says what reaching it does', () => {
    const r = normaliseRoute({ ...EXAMPLE_ROUTE_RAW, trust: { ...EXAMPLE_ROUTE_RAW.trust, checks_done: 100, reached: true } });
    const trust = by('admin', r).students.trust;
    expect(trust?.percent).toBe(100);
    expect(trust?.reached).toBe(true);
    expect(trust?.headline).toBe('AI trust: 100 of 100 checks, reached');
    expect(trust?.meaning).toContain('can pass clean questions by itself');
    const past = normaliseRoute({ ...EXAMPLE_ROUTE_RAW, trust: { ...EXAMPLE_ROUTE_RAW.trust, checks_done: 250, reached: true } });
    expect(by('admin', past).students.trust?.headline).toBe('AI trust: 100 of 100 checks, reached');
    const half = normaliseRoute({ ...EXAMPLE_ROUTE_RAW, trust: { ...EXAMPLE_ROUTE_RAW.trust, checks_done: 40 } });
    expect(by('admin', half).students.trust?.percent).toBe(40);
  });

  it('Needs you is the escalated plus the admin pile, open questions only', () => {
    const needs = by().needsYou;
    expect(needs.count).toBe(223);
    expect(needs.facts).toEqual(['13 papers to open', '0 sent up by students', '223 only an HOD or admin can settle']);
  });

  it('Ready to go live counts papers, how many pass all four checks and the questions left out', () => {
    const ready = by().ready;
    expect(ready.count).toBe(2);
    expect(ready.figures).toEqual([
      { label: 'Can go live now', value: '1 paper' },
      { label: 'Questions left out', value: '12' },
    ]);
  });

  it('Live splits the route from the earlier library', () => {
    const live = by().live;
    expect(live.count).toBe(1506);
    expect(live.figures).toEqual([
      { label: 'Made on this route', value: '129' },
      { label: 'From the earlier library', value: '1,377' },
      { label: 'Hidden, not visible', value: '5' },
    ]);
  });

  it('a section the database did not send makes its stop ?, never 0', () => {
    const r = normaliseRoute({ registry: {}, desk: {}, open: {}, checkers: {} });
    const stops = by('admin', r);
    for (const id of ['pictures', 'students', 'needsYou', 'ready', 'live']) expect(stops[id].count).toBeNull();
  });

  it('the siding is the frozen states, and it never joins the route counts', () => {
    const r = route();
    expect(frozenTotal(r)).toBe(1259 + 255 + 254 + 4 + 4 + 3 + 3 + 1);
    const siding = buildSiding(r);
    expect(siding.track).toBe('siding');
    expect(siding.step).toBeNull();
    expect(siding.count).toBe(1783);
    expect(siding.facts[0]).toBe('1,259 of them are already live');
    expect(siding.meaning).toContain('earlier library');
    // live on the route is the published count, not the registry's frozen live rows
    expect(by().live.count).toBe(1506);
  });

  it('three side stops: data, renderer, not yet sorted', () => {
    const side = buildSideStops(route());
    expect(side.map((s) => [s.id, s.title, s.count])).toEqual([
      ['data', 'Waiting for data fixes', 11],
      ['renderer', 'Waiting for a layout fix', 0],
      ['none', 'Not yet sorted', 158],
    ]);
    expect(side.every((s) => s.action === null)).toBe(true);
  });

  it('admins and HODs can both filter the paper list from the first stop: the list is on both pipeline pages', () => {
    expect(by('admin').computer.action).toMatchObject({ kind: 'filter', states: [] });
    expect(by('hod').computer.action).toMatchObject({ kind: 'filter', states: [] });
  });

  it('every link on the route opens a tab of the HOD desk, for admins and HODs alike', () => {
    for (const audience of ['admin', 'hod'] as const) {
      const stops = by(audience);
      expect(stops.students.action).toMatchObject({ kind: 'link', href: '/hod?tab=assignments' });
      expect(stops.needsYou.action).toMatchObject({ kind: 'link', href: '/hod?tab=needs-you' });
      expect(stops.ready.action).toMatchObject({ kind: 'link', href: '/hod?tab=ready' });
      expect(stops.live.action).toMatchObject({ kind: 'link', href: '/hod?tab=live' });
      expect(stops.students.trust?.href).toBe('/hod?tab=ai-trust');
      expect(stops.read.action).toBeNull();
      expect(stops.pictures.action).toBeNull();
      for (const s of Object.values(stops)) {
        if (s.action?.kind === 'link') expect(s.action.href.startsWith('/admin')).toBe(false);
      }
    }
  });

  it('no stop uses an em or en dash in its words', () => {
    const r = route();
    const all = [...buildMainStops(r), buildSiding(r), ...buildSideStops(r)];
    const words = all
      .flatMap((s) => [
        s.title,
        s.meaning,
        ...s.facts,
        s.action?.label ?? '',
        ...(s.bands?.map((b) => b.label) ?? []),
        ...(s.figures?.flatMap((f) => [f.label, f.value]) ?? []),
        ...(s.trust ? [s.trust.headline, s.trust.meaning, ...s.trust.levels.flatMap((l) => [l.label, l.state])] : []),
      ])
      .join(' ');
    expect(words).not.toMatch(/[–—]/);
  });

  it('plural and unit words read right for one and many', () => {
    expect(plural(1, 'question')).toBe('1 question');
    expect(plural(0, 'question')).toBe('0 questions');
    expect(plural(26665, 'question')).toBe('26,665 questions');
    expect(unitWord('PDF', 1)).toBe('PDF');
    expect(unitWord('PDF', 6880)).toBe('PDFs');
    expect(unitWord('paper', 0)).toBe('papers');
  });

  it('sizes are written in MB, and GB from a gigabyte up', () => {
    expect(bytesWords(52428800)).toBe('50 MB');
    expect(bytesWords(1048576 * 5.5)).toBe('5.5 MB');
    expect(bytesWords(9971689088)).toBe('9.3 GB');
  });
});

describe('freshness: when the desk last sent numbers, apart from when the browser read the page', () => {
  const NOW = Date.parse('2026-10-12T06:00:00.000Z');

  it('is the newest of the desk sync, the PDF count and the last registry change', () => {
    const d = dataAsOf(route(), NOW);
    expect(d.at).toBe('2026-10-12T05:30:00.000Z');
    expect(d.ago).toBe('30 minutes ago');
    expect(d.stale).toBe(false);
    expect(d.when).toMatch(/^12 Oct, \d{1,2}:\d{2} [AP]M$/);
  });

  it('when only the registry has changed it says the old time and calls it stale', () => {
    const d = dataAsOf(normaliseRoute(UNSYNCED_ROUTE_RAW), NOW);
    expect(d.at).toBe('2026-10-08T23:24:22.000Z');
    expect(d.stale).toBe(true);
    expect(d.ago).toBe('3 days ago');
  });

  it('is called stale after a day and a half and not before', () => {
    const at = Date.parse('2026-10-11T00:00:00.000Z');
    const r = normaliseRoute({ ...EXAMPLE_ROUTE_RAW, synced: { desk_synced_at: new Date(at).toISOString(), drive_synced_at: null, registry_changed_at: null } });
    expect(dataAsOf(r, at + STALE_AFTER_MS - 1000).stale).toBe(false);
    expect(dataAsOf(r, at + STALE_AFTER_MS + 1000).stale).toBe(true);
  });

  it('with no sync time at all there is nothing to show, and it counts as stale', () => {
    const r = normaliseRoute({ registry: {}, desk: {}, open: {}, checkers: {} });
    expect(dataAsOf(r, NOW)).toEqual({ at: null, when: '', ago: '', stale: true });
  });
});

describe('questions progress', () => {
  it('cleared of total, as a whole percent', () => {
    expect(questionsProgress(route())).toEqual({ cleared: 171, total: 14929, percent: 1 });
  });
  it('no questions on the desk is 0 percent, never NaN', () => {
    const r = normaliseRoute({ registry: {}, desk: {}, open: {}, checkers: {} });
    expect(questionsProgress(r)).toEqual({ cleared: 0, total: 0, percent: 0 });
  });
  it('cleared never passes the total', () => {
    const r = normaliseRoute({ ...EXAMPLE_ROUTE_RAW, desk: { questions: 10, questions_passed: 30 } });
    expect(questionsProgress(r)).toEqual({ cleared: 10, total: 10, percent: 100 });
  });
});

describe('lane motion', () => {
  it('nothing flowing means a still lane', () => {
    expect(laneMotion(0, 8000)).toEqual({ dots: 0, seconds: 0 });
    expect(laneMotion(5, 0)).toEqual({ dots: 0, seconds: 0 });
  });

  it('more papers means more parcels and a quicker crossing, but always calm', () => {
    const small = laneMotion(1, 8038);
    const mid = laneMotion(294, 8038);
    const big = laneMotion(8038, 8038);
    expect(small.dots).toBeLessThan(big.dots);
    expect(small.seconds).toBeGreaterThan(big.seconds);
    expect(mid.dots).toBeGreaterThanOrEqual(small.dots);
    expect(mid.dots).toBeLessThanOrEqual(big.dots);
    for (const m of [small, mid, big]) {
      expect(m.dots).toBeGreaterThanOrEqual(1);
      expect(m.dots).toBeLessThanOrEqual(4);
      expect(m.seconds).toBeGreaterThanOrEqual(3);
      expect(m.seconds).toBeLessThanOrEqual(7);
    }
  });

  it('a count above the yardstick is clamped, not wild', () => {
    expect(laneMotion(99999, 100)).toEqual(laneMotion(100, 100));
  });

  it('maxFlow is the biggest stop', () => {
    expect(maxFlow(buildMainStops(route()))).toBe(9291);
    // a stop whose number did not arrive is not a flow
    expect(maxFlow(buildMainStops(normaliseRoute({ registry: {}, desk: {}, open: {}, checkers: {} })))).toBe(0);
    expect(maxFlow([])).toBe(0);
  });
});

describe('tween', () => {
  it('starts at from, lands exactly on to, and moves in between', () => {
    expect(tweenValue(100, 200, 0)).toBe(100);
    expect(tweenValue(100, 200, 1)).toBe(200);
    expect(tweenValue(100, 200, 2)).toBe(200);
    const mid = tweenValue(100, 200, 0.5);
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(200);
  });

  it('counts down as well as up, in whole numbers', () => {
    const v = tweenValue(4869, 4860, 0.4);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeLessThan(4869);
    expect(v).toBeGreaterThan(4860);
  });

  it('is non-decreasing in progress when going up', () => {
    let last = -1;
    for (let i = 0; i <= 20; i++) {
      const v = tweenValue(0, 500, i / 20);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it('easing is clamped to 0..1', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(5)).toBe(1);
  });
});

describe('updatedWords', () => {
  it('reads plainly at every scale', () => {
    expect(updatedWords(0)).toBe('just now');
    expect(updatedWords(4_000)).toBe('just now');
    expect(updatedWords(12_000)).toBe('12 seconds ago');
    expect(updatedWords(59_000)).toBe('59 seconds ago');
    expect(updatedWords(60_000)).toBe('1 minute ago');
    expect(updatedWords(5 * 60_000)).toBe('5 minutes ago');
    expect(updatedWords(3_600_000)).toBe('1 hour ago');
    expect(updatedWords(3 * 3_600_000)).toBe('3 hours ago');
  });
  it('a clock that ran backwards is just now, not negative', () => {
    expect(updatedWords(-5000)).toBe('just now');
  });
});

describe('the dummy route API', () => {
  it('returns a valid route that drifts on every read', async () => {
    const api = createFakePipelineRouteApi('full', 0);
    const a = await api.route();
    let changed = false;
    for (let i = 0; i < 12 && !changed; i++) {
      const b = await api.route();
      changed = b.registry.byState.not_started !== a.registry.byState.not_started || b.registry.swarmRead?.papers !== a.registry.swarmRead?.papers;
    }
    expect(a.registry.total).toBe(8038);
    expect(changed).toBe(true);
  });

  it('error mode never loads; flaky fails every third read after the first', async () => {
    await expect(createFakePipelineRouteApi('error', 0).route()).rejects.toThrow();
    const flaky = createFakePipelineRouteApi('flaky', 0);
    await flaky.route();
    await flaky.route();
    await expect(flaky.route()).rejects.toThrow();
    await expect(flaky.route()).resolves.toBeTruthy();
  });

  it('unsynced mode leaves out the picture and PDF numbers, so their stops can show ?', async () => {
    const r = await createFakePipelineRouteApi('unsynced', 0).route();
    expect(r.pictures).toBeNull();
    expect(r.drive).toBeNull();
    expect(r.registry.total).toBe(8038);
  });

  it('stale mode last synced four days ago', async () => {
    const r = await createFakePipelineRouteApi('stale', 0).route();
    expect(dataAsOf(r, Date.now()).stale).toBe(true);
    expect(dataAsOf(r, Date.now()).ago).toBe('4 days ago');
  });

  it('empty mode is a route with nothing in it', async () => {
    const r = await createFakePipelineRouteApi('empty', 0).route();
    expect(r.registry.total).toBe(0);
    expect(r.desk.papers).toBe(0);
  });
});
