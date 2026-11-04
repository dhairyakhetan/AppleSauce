import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BentoTile, FadeScroll, TilePager } from '@/components/checker/BentoParts';
import { FixFrame, PanelTabs, PrintedFrame, TypedFrame, VERIFY_TABS } from '@/components/checker/Panels';
import { IncomingCard, PaperStrip } from '@/components/checker/AdvanceBits';
import { paperStripInfo } from '@/lib/checker-card-motion';

// No browser-like environment in this project's tests, so the layout is pinned
// two ways: the pieces are rendered to markup, and the screen's wiring is read
// from its source. The no-scroll measurements were taken in a real browser
// (dummy mode at 1440x900, 1280x720, 1024x640, 768x1024 and 375x812).

const noop = () => undefined;
const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('the tiles on a tablet and up', () => {
  it('the typed tile is a region that fills its cell and has no tab pointing at it', () => {
    const html = renderToStaticMarkup(
      <TypedFrame tile tabbed={false}>
        x
      </TypedFrame>,
    );
    expect(html).toContain('role="region"');
    expect(html).not.toContain('role="tabpanel"');
    expect(html).toContain('min-h-0');
    // The long heading is for screen readers only; the chip says it in the tile.
    expect(html).toMatch(/<h3 class="[^"]*sr-only[^"]*">What the computer typed/);
  });

  it('uses radii from the scale: 20 on a phone, 18 from md up', () => {
    const html = renderToStaticMarkup(
      <>
        <TypedFrame tile>x</TypedFrame>
        <PrintedFrame tile>y</PrintedFrame>
        <FixFrame>z</FixFrame>
        <BentoTile>w</BentoTile>
      </>,
    );
    expect(html).toContain('rounded-[20px] md:rounded-[18px]');
    expect(html).not.toMatch(/rounded-\[(1[1357]|19|2[1-3]|2[5-9])px\]/);
  });

  it('the second printed tile (the whole page) has its own id and label', () => {
    const html = renderToStaticMarkup(
      <PrintedFrame tile tabbed={false} id="verify-panel-page" label="The printed page, as scanned" title="The printed page, as scanned">
        x
      </PrintedFrame>,
    );
    expect(html).toContain('id="verify-panel-page"');
    expect(html).toContain('The printed page, as scanned');
    expect(html).not.toContain('id="verify-panel-printed"');
  });

  it('a scrolling tile scrolls inside itself and shows a cue while there is more below', () => {
    const html = renderToStaticMarkup(<FadeScroll>long text</FadeScroll>);
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('h-full');
    expect(html).toContain('data-testid="scroll-cue"');
    expect(html).toContain('data-more="false"');
    expect(html).toContain('opacity-0');
    expect(renderToStaticMarkup(<FadeScroll white>x</FadeScroll>)).toContain('checker-fade-white');
  });

  it('the paper strip is one thin line in the grid and still says which paper', () => {
    const info = paperStripInfo({ subject: 'Mathematics', cls: 'X', school: 'Riverside Academy', year: '2024' }, [{ paper_id: 'a' }, { paper_id: 'b' }], 'b');
    const html = renderToStaticMarkup(<PaperStrip info={info} />);
    expect(html).toContain('flex-nowrap');
    expect(html).toContain('truncate');
    expect(html).toContain('Next paper: Riverside Academy, 2024');
  });

  it('the next-question placeholder has the same two tiles as the real card', () => {
    const html = renderToStaticMarkup(<IncomingCard pictureUrl={null} />);
    expect(html).toContain('md:grid-cols-2');
    expect(html).toContain('h-full');
    expect(html).toContain('data-panel="typed"');
    expect(html).toContain('data-panel="printed"');
  });
});

describe('the two tiles on a phone', () => {
  it('has Question and Page tabs, and marks the selected one', () => {
    for (const [value, label] of [
      ['typed', 'Question'],
      ['printed', 'Page'],
    ] as const) {
      const html = renderToStaticMarkup(<PanelTabs value={value} onChange={noop} tabs={VERIFY_TABS} className="md:hidden" />);
      expect(html).toContain('role="tablist"');
      expect(html).toContain('grid-cols-2');
      expect(html).toContain('md:hidden');
      for (const t of ['Question', 'Page']) expect(html).toContain(t);
      // The words, the tools and the editor are all in the Question tile: no Fix tab to hunt for.
      expect(html).not.toContain('verify-tab-fix');
      const selected = [...html.matchAll(/<button[^>]*aria-selected="true"[^>]*id="verify-tab-(\w+)"|<button[^>]*id="verify-tab-(\w+)"[^>]*aria-selected="true"/g)];
      expect(selected).toHaveLength(1);
      expect(html).toMatch(new RegExp(`id="verify-tab-${value}"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="verify-tab-${value}"`));
      expect(html).toContain(label);
    }
  });

  it('each tab points at a tile that is a tab panel named by it', () => {
    const html = renderToStaticMarkup(
      <>
        <TypedFrame tile>x</TypedFrame>
        <PrintedFrame tile>y</PrintedFrame>
      </>,
    );
    for (const id of ['typed', 'printed']) {
      expect(html).toMatch(new RegExp(`id="verify-panel-${id}"[^>]*role="tabpanel"[^>]*aria-labelledby="verify-tab-${id}"`));
    }
  });

  it('the pager holds all three tiles, snaps, and only the selected one can be reached', () => {
    const html = renderToStaticMarkup(
      <TilePager
        value="printed"
        onChange={noop}
        order={['typed', 'printed', 'fix']}
        reducedMotion={false}
        panes={{ typed: <i>q</i>, printed: <i>p</i>, fix: <i>f</i> }}
      />,
    );
    expect(html).toContain('checker-pager');
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('overflow-y-hidden');
    expect(html.match(/data-pane="/g)).toHaveLength(3);
    expect(html).toMatch(/data-pane="printed" data-selected="true"/);
    expect(html).toMatch(/data-pane="typed" data-selected="false" inert=""/);
    expect(html).toMatch(/data-pane="fix" data-selected="false" inert=""/);
    expect(html).not.toMatch(/data-pane="printed"[^>]*inert/);
  });

  it('snaps one tile at a time and hides the scrollbar', () => {
    const css = read('./checker-bento.css');
    expect(css).toContain('scroll-snap-type: x mandatory');
    expect(css).toContain('scroll-snap-align: start');
    expect(css).toContain('scrollbar-width: none');
  });
});

describe('the verify screen is wired as one viewport', () => {
  const screen = read('./VerifyScreen.tsx');
  const page = read('../../pages/Checker.tsx');

  it('chooses the grid or the phone tiles from matchMedia, never both at once', () => {
    expect(screen).toContain('useBentoWide()');
    expect(screen).toContain('if (wide) {');
    expect(read('./BentoParts.tsx')).toContain('(min-width: ${BENTO_MIN_WIDTH}px)');
  });

  it('the grid is two equal columns of tiles with 12px gaps, the words left and the paper right', () => {
    expect(screen).toContain('grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3');
    expect(screen).toContain('data-testid="bento-left"');
    expect(screen).toContain('data-testid="bento-right"');
    expect(screen).toContain('data-testid="flags-tile"');
    expect(screen).toContain('data-testid="page-strip"');
  });

  it('the question, the picture and the fix form scroll inside their tiles', () => {
    expect((screen.match(/<FadeScroll/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // The tile row can shrink to nothing: a long question never pushes the actions away.
    expect(screen).toContain('min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]');
  });

  it('the action bar sits outside the scrolling tiles and is always on screen', () => {
    const grid = screen.indexOf('The tiles take everything between the top tile and the action bar');
    expect(grid).toBeGreaterThan(0);
    expect(screen.indexOf('{actionBar}')).toBeGreaterThan(grid);
    expect(screen).toContain("data-testid={testId ?? 'action-bar'}");
    expect(screen).toContain('shrink-0 rounded-[20px]');
  });

  it('a phone gets Question and Page, and Fix it edits in the Question tile', () => {
    expect(screen).toContain('tabs={VERIFY_TABS}');
    expect(screen).toContain("order={['typed', 'printed']}");
    expect(screen).toMatch(/setMode\('fix'\);\s+setPanel\('typed'\)/);
    expect(screen).toMatch(/setMode\('split'\);\s+setPanel\('typed'\)/);
    expect(screen).not.toContain("setPanel('fix')");
  });

  it('keeps every action and chip the screen had', () => {
    for (const piece of [
      'data-testid="verify-header"',
      'data-testid="save-error"',
      '<SaveStatusChip',
      '<PaperStrip info={stripInfo} />',
      'The words did not come through',
      'Looks right',
      'Fix it',
      'Ask the HOD',
      'Skip this question',
      'data-testid="question-meta"',
    ]) {
      expect(screen, piece).toContain(piece);
    }
  });

  it('a picture opens full screen on tap, and nothing is answered behind it', () => {
    expect(screen).toContain('<ImageLightbox');
    expect(screen).toContain('aria-label="Enlarge the printed question"');
    expect(screen).toContain('if (submitting || tourOpen || lightbox) return;');
    expect(read('./BentoParts.tsx')).toContain("e.key === 'Escape'");
    expect(read('./BentoParts.tsx')).toContain('object-contain');
  });

  it('the page gets its own full-viewport shell, with its small controls moved into the top tile', () => {
    expect(page).toContain('h-[100dvh] min-h-0 overflow-hidden');
    expect(page).toContain('toolbar={menuButton}');
    // The site header is not shown on this screen, so nothing reserves room for it.
    expect(page).not.toContain('pt-[68px]');
    expect(page).not.toContain('lg:pt-[72px]');
    expect(page).toContain('p-2.5 lg:p-3');
    expect(page).toContain('data-testid="back-to-my-papers"');
    expect(page).toContain('<h1 className="sr-only">My papers</h1>');
    expect(screen).toContain('{toolbar ?');
  });

  it('the top tile is one calm row: a back arrow, the paper, progress, the unsaved chip and one Menu button', () => {
    const top = screen.slice(screen.indexOf('const topTile'), screen.indexOf('const actionBarShell'));
    for (const piece of ['role="progressbar"', '<SaveStatusChip compact', 'onClick={onExit}', 'ArrowLeft', 'data-tour="paper"', '{toolbar ?', 'flex-nowrap']) {
      expect(top, piece).toContain(piece);
    }
    // Every other way out lives in the Menu, not in the tile.
    for (const gone of ['onClick={onList ?? onExit}', 'Back to admin', 'HOD desk', 'Today ', 'My papers']) {
      expect(top, gone).not.toContain(gone);
    }
    // Only the title may shrink and cut off, and it carries the whole name as its tooltip.
    expect(top).toContain('title={currentPaperLabel}');
    expect((top.match(/truncate/g) || []).length).toBe(2);
  });

  it('the back arrow is a plain icon button with a tooltip and a name', () => {
    expect(screen).toContain("aria-label=\"Back to this paper's questions\"");
    expect(screen).toContain("title=\"Back to this paper's questions\"");
  });

  it('has no dash characters in its words', () => {
    const words = [screen, read('./BentoParts.tsx'), read('./Panels.tsx'), read('../../pages/Checker.tsx')]
      .join('\n')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /['">][^'"<>]*[–—][^'"<>]*['"<]/.test(l));
    expect(words).toEqual([]);
  });
});
