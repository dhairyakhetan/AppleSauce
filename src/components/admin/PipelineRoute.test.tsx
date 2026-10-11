import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));

import { PipelineRouteView, type PipelineRouteViewProps } from '@/components/admin/PipelineRoute';
import { StopCard } from '@/components/admin/PipelineRouteParts';
import { EXAMPLE_ROUTE_RAW } from '@/lib/pipeline-route.fixture';
import { buildMainStops, normaliseRoute } from '@/lib/pipeline-route';

/* No jsdom here (see admin-shared.test.tsx), so the route renders to markup.
   PipelineRouteView is pure, so every state is a props object. Clicks walk the
   element tree of a function component and call the handler it holds. */

const NOW = 1_800_000_000_000;
const noop = () => {};
const route = normaliseRoute(EXAMPLE_ROUTE_RAW);

function view(over: Partial<PipelineRouteViewProps> = {}): string {
  const props: PipelineRouteViewProps = {
    route,
    status: 'ok',
    refreshFailed: false,
    updatedAt: NOW - 12_000,
    now: NOW,
    reducedMotion: false,
    onRetry: noop,
    onRefresh: noop,
    onShowRegistry: noop,
    ...over,
  };
  return renderToStaticMarkup(
    <StaticRouter location="/admin/pipeline">
      <PipelineRouteView {...props} />
    </StaticRouter>,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function findButton(node: ReactNode): { onClick?: () => void } | null {
  if (!isValidElement(node)) return null;
  const props = node.props as Record<string, unknown>;
  if (node.type === 'button') return props as { onClick?: () => void };
  const kids = props.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const hit = findButton(k as ReactNode);
    if (hit) return hit;
  }
  return null;
}

describe('the route with the example payload', () => {
  const html = view();
  const t = text(html);

  it('is a real ordered list with the stops and their numbers as text', () => {
    expect(html).toContain('<ol');
    expect(html).toContain('aria-label="The papers route, from the folder to live"');
    for (const id of ['folder', 'waiting', 'read', 'swarm', 'desk', 'ai', 'students', 'admin', 'approval', 'live']) {
      expect(html).toContain(`data-stop="${id}"`);
    }
    expect(html).toContain('data-stop="leftOut"');
    expect(html).toContain('data-stop="side-piles"');
  });

  it('shows the live numbers of the brief', () => {
    expect(t).toContain('8,038'); // in the folder
    expect(t).toContain('4,970'); // waiting: 4,869 + 101
    expect(t).toContain('763'); // read
    expect(t).toContain('188'); // swarm papers
    expect(t).toContain('5,151 questions cleaned');
    expect(t).toContain('403'); // on the desk
    expect(t).toContain('294'); // AI checked
    expect(t).toContain('774'); // live
    expect(t).toContain('1,135'); // the siding
  });

  it('stops carry their count on the list item, for anything that reads the DOM', () => {
    expect(html).toMatch(/data-stop="waiting" data-count="4970"/);
    expect(html).toMatch(/data-stop="live" data-count="774"/);
    expect(html).toMatch(/data-stop="leftOut" data-count="1135"/);
  });

  it('the student stop shows papers by questions left, and the checkers', () => {
    expect(t).toContain('7,403 questions left');
    expect(t).toContain('14 checkers active');
    expect(t).toContain('212 papers handed out');
    for (const band of ['1-5', '6-15', '16-40', '41+']) expect(html).toContain(`data-band="${band}"`);
    expect(t).toContain('1 to 5 left 47 papers');
    expect(t).toContain('41 or more left 65 papers');
  });

  it('the side piles read in plain words', () => {
    expect(t).toContain('Held for data fixes');
    expect(t).toContain('Held for the renderer');
    expect(t).toContain('Not yet sorted');
    expect(t).toContain('16,740 questions');
  });

  it('the left out papers are a side track, with the excluded small print on the folder', () => {
    expect(t).toContain('Side track');
    expect(t).toContain('Maths papers held back on purpose');
    expect(t).toContain('7 not real papers, not counted');
    expect(t).toContain('611 of them are already live');
  });

  it('one honest progress strip: questions cleared of the total', () => {
    expect(t).toContain('Questions: 6,210 of 14,200 cleared');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="44"');
  });

  it('stops lead to the pages that list them', () => {
    expect(html).toContain('href="/admin/checkers"');
    expect(html).toContain('href="/admin/admin-queue"');
    expect(html).toContain('href="/admin/paper-approvals"');
    expect(html).toContain('href="/admin/library"');
  });

  it('stops that filter the list are real buttons, with a label that says what they show', () => {
    expect(html).toMatch(/<button type="button"[^>]*>In the folder<span class="sr-only">\. Show every paper in the list<\/span>/);
    expect(t).toContain('Show the not started papers and the reading queue in the list');
  });

  it('says when it was updated, and has a live dot and a Refresh button', () => {
    expect(t).toContain('Updated 12 seconds ago');
    expect(html).toContain('data-live-dot="live"');
    expect(html).toContain('aria-label="Refresh the numbers now"');
    expect(html).not.toContain('data-refresh-failed');
  });

  it('the moving parts are hidden from screen readers', () => {
    const lanes = html.match(/<span aria-hidden="true" data-lane=/g) ?? [];
    expect(lanes.length).toBe(9); // 10 stops, 9 lanes
    expect(html).toContain('data-elbow');
    expect(html).toMatch(/<svg aria-hidden="true" data-elbow/);
  });

  it('parcels travel the lanes, more on busier ones', () => {
    expect(html).toContain('animate-route-dot-y');
    expect(html).toContain('lg:animate-route-dot-x');
    const dots = [...html.matchAll(/data-dots="(\d)"/g)].map((m) => Number(m[1]));
    expect(dots.length).toBe(9);
    expect(Math.max(...dots)).toBeGreaterThan(Math.min(...dots));
  });

  it('uses no em or en dashes in what it says', () => {
    expect(t).not.toMatch(/[–—]/);
  });

  it('the unit reads right for exactly one paper', () => {
    expect(t).toMatch(/\b1 paper\b/); // waiting for approval is 1
  });
});

describe('a refresh that fails', () => {
  const html = view({ refreshFailed: true, updatedAt: NOW - 95_000 });
  const t = text(html);

  it('keeps the last numbers on screen', () => {
    expect(t).toContain('8,038');
    expect(t).toContain('4,970');
    expect(html).toContain('data-stop="live"');
  });

  it('says so quietly, in a status line, and the dot turns amber', () => {
    expect(t).toContain('Could not refresh, showing the last numbers.');
    expect(html).toContain('role="status"');
    expect(html).toContain('data-live-dot="stale"');
  });

  it('still says how old the numbers are', () => {
    expect(t).toContain('Updated 1 minute ago');
  });

  it('does not show the loud error for the whole route', () => {
    expect(html).not.toContain('role="alert"');
  });
});

describe('the first read fails or is still out', () => {
  it('with nothing to show it says the route did not load and offers Try again, never zeros', () => {
    const html = view({ route: null, status: 'error', updatedAt: null });
    const t = text(html);
    expect(html).toContain('role="alert"');
    expect(t).toContain('The papers route did not load.');
    expect(t).toContain('Try again');
    expect(html).not.toContain('data-stop=');
    expect(t).not.toMatch(/\b0 papers\b/);
  });

  it('while loading it shows a skeleton and no numbers', () => {
    const html = view({ route: null, status: 'loading', updatedAt: null });
    expect(html).toContain('aria-label="Loading the papers route"');
    expect(html).not.toContain('data-stop=');
    expect(text(html)).toContain('Reading the numbers');
  });

  it('a route with nothing in it yet says what happens next', () => {
    const empty = normaliseRoute({ registry: {}, desk: {}, open: {}, checkers: {} });
    const t = text(view({ route: empty }));
    expect(t).toContain('The pipeline has not sent any papers yet');
  });
});

describe('reduced motion', () => {
  const html = view({ reducedMotion: true });
  const t = text(html);

  it('keeps every number and every word', () => {
    expect(t).toContain('8,038');
    expect(t).toContain('Questions: 6,210 of 14,200 cleared');
    expect(html).toContain('data-stop="live"');
    expect(t).toContain('Updated 12 seconds ago');
  });

  it('turns the movement off: no parcels, a still elbow, no ping on the live dot', () => {
    expect(html).not.toContain('animate-route-dot-y');
    expect(html).not.toContain('animate-route-dash');
    expect(html).not.toContain('animate-ping');
    const dots = [...html.matchAll(/data-dots="(\d)"/g)].map((m) => Number(m[1]));
    expect(dots.every((d) => d === 0)).toBe(true);
    expect(html).toContain('data-reduced-motion="true"');
  });

  it('keeps the lanes and the arrows as a static picture', () => {
    expect((html.match(/data-lane=/g) ?? []).length).toBe(9);
    expect(html).toContain('data-elbow');
  });

  it('with motion allowed the page says so', () => {
    expect(view()).toContain('data-reduced-motion="false"');
    expect(view()).toContain('animate-ping');
  });
});

describe('clicking a stop', () => {
  const stops = buildMainStops(route);
  const stop = (id: string) => stops.find((s) => s.id === id)!;

  it('a filter stop asks the page to show that state in the list', () => {
    const onShow = vi.fn();
    const card = StopCard({ stop: stop('waiting'), animate: false, onShowRegistry: onShow });
    findButton(card)?.onClick?.();
    expect(onShow).toHaveBeenCalledWith(['not_started', 'ocr_queued']);
  });

  it('the folder stop shows every paper', () => {
    const onShow = vi.fn();
    findButton(StopCard({ stop: stop('folder'), animate: false, onShowRegistry: onShow }))?.onClick?.();
    expect(onShow).toHaveBeenCalledWith([]);
  });

  it('a stop with nowhere to go has no button and no link', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/">
        <StopCard stop={stop('swarm')} animate={false} onShowRegistry={noop} />
      </StaticRouter>,
    );
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<a ');
    expect(text(html)).toContain('Cleaned by the Haiku swarm');
  });
});
