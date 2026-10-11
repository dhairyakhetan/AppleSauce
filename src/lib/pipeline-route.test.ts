import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from '@/integrations/supabase/client';
import { createFakePipelineRouteApi } from '@/dummy/pipeline-route-fake-api';
import { EXAMPLE_ROUTE_RAW } from '@/lib/pipeline-route.fixture';
import {
  buildMainStops,
  buildSideStops,
  buildSiding,
  easeOutCubic,
  fetchPipelineRoute,
  frozenTotal,
  laneMotion,
  maxFlow,
  normaliseRoute,
  plural,
  questionsProgress,
  tweenValue,
  updatedWords,
} from '@/lib/pipeline-route';

const route = () => normaliseRoute(EXAMPLE_ROUTE_RAW);

describe('normaliseRoute', () => {
  it('keeps the numbers the database gave', () => {
    const r = route();
    expect(r.registry.total).toBe(8038);
    expect(r.registry.byState.not_started).toBe(4869);
    expect(r.registry.frozenByState.live).toBe(611);
    expect(r.desk.swarmQuestions).toBe(5151);
    expect(r.open.questionsByPile.kid).toBe(7403);
    expect(r.open.studentBands['41+']).toBe(65);
    expect(r.checkers.activeVerifiers).toBe(14);
  });

  it('a key the database left out is 0, never undefined or NaN', () => {
    const r = route();
    expect(r.registry.byState.fully_checked).toBe(0);
    expect(r.registry.frozenByState.fully_checked).toBe(4);
    const bare = normaliseRoute({ registry: {}, desk: {}, open: {}, checkers: {} });
    expect(bare.registry.total).toBe(0);
    expect(Object.values(bare.registry.byState).every((n) => n === 0)).toBe(true);
    expect(Object.values(bare.open.papersByPile).every((n) => n === 0)).toBe(true);
    expect(bare.open.studentBands['1-5']).toBe(0);
    expect(bare.generatedAt).toBeNull();
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

  it('calls the admin route function and normalises what comes back', async () => {
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
  it('there are ten main stops, in route order, numbered 1 to 10', () => {
    const stops = buildMainStops(route());
    expect(stops.map((s) => s.id)).toEqual(['folder', 'waiting', 'read', 'swarm', 'desk', 'ai', 'students', 'admin', 'approval', 'live']);
    expect(stops.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stops.every((s) => s.track === 'main')).toBe(true);
  });

  it('each stop counts what the brief says', () => {
    const by = Object.fromEntries(buildMainStops(route()).map((s) => [s.id, s]));
    expect(by.folder.count).toBe(8038);
    expect(by.waiting.count).toBe(4869 + 101);
    expect(by.read.count).toBe(763);
    expect(by.swarm.count).toBe(188);
    expect(by.desk.count).toBe(403);
    expect(by.ai.count).toBe(294);
    expect(by.students.count).toBe(295);
    expect(by.admin.count).toBe(41);
    expect(by.approval.count).toBe(1);
    expect(by.live.count).toBe(774);
  });

  it('the small print: excluded papers, swarm questions, student questions, checkers', () => {
    const by = Object.fromEntries(buildMainStops(route()).map((s) => [s.id, s]));
    expect(by.folder.facts).toEqual(['7 not real papers, not counted']);
    expect(by.swarm.facts).toEqual(['5,151 questions cleaned']);
    expect(by.students.facts).toEqual(['7,403 questions left', '14 checkers active', '212 papers handed out']);
    expect(by.admin.facts).toEqual(['295 questions left']);
    expect(by.waiting.facts).toEqual(['4,869 not started', '101 in the reading queue']);
  });

  it('a folder with nothing excluded says nothing about it', () => {
    const r = normaliseRoute({ ...EXAMPLE_ROUTE_RAW, registry: { ...EXAMPLE_ROUTE_RAW.registry, excluded: 0 } });
    expect(buildMainStops(r)[0].facts).toEqual([]);
  });

  it('the student stop carries the four bands, in order', () => {
    const students = buildMainStops(route()).find((s) => s.id === 'students');
    expect(students?.bands?.map((b) => [b.label, b.count])).toEqual([
      ['1 to 5 left', 47],
      ['6 to 15 left', 77],
      ['16 to 40 left', 106],
      ['41 or more left', 65],
    ]);
  });

  it('approval adds awaiting approval and fully checked', () => {
    const r = normaliseRoute({
      ...EXAMPLE_ROUTE_RAW,
      registry: { ...EXAMPLE_ROUTE_RAW.registry, by_state: { awaiting_approval: 3, fully_checked: 2 } },
    });
    expect(buildMainStops(r).find((s) => s.id === 'approval')?.count).toBe(5);
  });

  it('the siding is the sum of the frozen states, and it never joins the main counts', () => {
    const r = route();
    expect(frozenTotal(r)).toBe(611 + 255 + 254 + 4 + 4 + 3 + 3 + 1);
    const siding = buildSiding(r);
    expect(siding.track).toBe('siding');
    expect(siding.step).toBeNull();
    expect(siding.count).toBe(1135);
    expect(siding.facts[0]).toBe('611 of them are already live');
    // live on the route is the unfrozen live count only
    expect(buildMainStops(r).find((s) => s.id === 'live')?.count).toBe(774);
  });

  it('three side stops: data, renderer, not yet sorted', () => {
    const side = buildSideStops(route());
    expect(side.map((s) => [s.id, s.title, s.count])).toEqual([
      ['data', 'Held for data fixes', 188],
      ['renderer', 'Held for the renderer', 6],
      ['none', 'Not yet sorted', 402],
    ]);
    expect(side.every((s) => s.action === null)).toBe(true);
  });

  it('actions: filter stops filter the list, list pages are links, the rest lead nowhere', () => {
    const by = Object.fromEntries(buildMainStops(route()).map((s) => [s.id, s.action]));
    expect(by.folder).toMatchObject({ kind: 'filter', states: [] });
    // the stop's count is not started plus the reading queue, so the list behind it shows both
    expect(by.waiting).toMatchObject({ kind: 'filter', states: ['not_started', 'ocr_queued'] });
    expect(by.read).toMatchObject({ kind: 'filter', states: ['ocr_done'] });
    expect(by.ai).toMatchObject({ kind: 'filter', states: ['ai_checked'] });
    expect(by.students).toMatchObject({ kind: 'link', href: '/admin/checkers' });
    expect(by.admin).toMatchObject({ kind: 'link', href: '/admin/admin-queue' });
    expect(by.approval).toMatchObject({ kind: 'link', href: '/admin/paper-approvals' });
    expect(by.live).toMatchObject({ kind: 'link', href: '/admin/library' });
    expect(by.swarm).toBeNull();
    expect(by.desk).toBeNull();
  });

  it('no stop uses an em or en dash in its words', () => {
    const r = route();
    const all = [...buildMainStops(r), buildSiding(r), ...buildSideStops(r)];
    const words = all.flatMap((s) => [s.title, s.meaning, ...s.facts, s.action?.label ?? '', ...(s.bands?.map((b) => b.label) ?? [])]).join(' ');
    expect(words).not.toMatch(/[–—]/);
  });

  it('plural reads right for one and many', () => {
    expect(plural(1, 'question')).toBe('1 question');
    expect(plural(0, 'question')).toBe('0 questions');
    expect(plural(26665, 'question')).toBe('26,665 questions');
  });
});

describe('questions progress', () => {
  it('cleared of total, as a whole percent', () => {
    expect(questionsProgress(route())).toEqual({ cleared: 6210, total: 14200, percent: 44 });
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
    expect(maxFlow(buildMainStops(route()))).toBe(8038);
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
      changed = b.registry.byState.not_started !== a.registry.byState.not_started || b.desk.swarmQuestions !== a.desk.swarmQuestions;
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

  it('empty mode is a route with nothing in it', async () => {
    const r = await createFakePipelineRouteApi('empty', 0).route();
    expect(r.registry.total).toBe(0);
    expect(r.desk.papers).toBe(0);
  });
});
