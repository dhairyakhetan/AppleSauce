import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { PartPictures } from '@/components/checker/PartPictures';
import { noPictureSummary, type PartPicture } from '@/lib/checker-pictures';

// Owner, 13 Nov 2026: "WHY DOUBLE IF NO CLIPPING FOUND". When the checked part has no clipping and no page matched,
// the part tiles and the whole-paper flip used to be two stacked boxes, both titled "Photo of the printed paper".

const screen = readFileSync(resolve(__dirname, './VerifyScreen.tsx'), 'utf8');

describe('noPictureSummary: one quiet line for the parts without a picture', () => {
  it('names one, two or many parts in plain words', () => {
    expect(noPictureSummary(['(a)'])).toBe('No separate picture for (a).');
    expect(noPictureSummary(['1(iii)', '1(iv)'])).toBe('No separate picture for 1(iii) and 1(iv).');
    expect(noPictureSummary(['(i)', '(iii)', '(iv)'])).toBe('No separate picture for (i), (iii) and (iv).');
  });

  it('is empty for an empty list, ignores blank labels, and uses no dashes', () => {
    expect(noPictureSummary([])).toBe('');
    expect(noPictureSummary(['', '  '])).toBe('');
    expect(noPictureSummary(['(a)', '(b)'])).not.toMatch(/[–—]/);
  });
});

describe('the printed side shows ONE box when the whole paper is the only picture', () => {
  it('works out the one-box case from the tiles and the page flip, and splits the parts', () => {
    expect(screen).toContain('const oneBox = tilesOn && flipShown;');
    expect(screen).toContain('const shownParts = oneBox');
    expect(screen).toContain('const missingPartLabels = oneBox');
    expect(screen).toContain('noPictureSummary(missingPartLabels)');
  });

  it('wide layout: the part-tiles box is not drawn next to the flip box', () => {
    expect(screen).toContain('{cropVisible && !oneBox ? (');
    // The single box takes the "picture" tour stop and the whole height.
    expect(screen).toContain("tourId={cropVisible && !oneBox ? undefined : 'picture'}");
    expect(screen).toContain("oneBox ? 'flex-1' : 'flex-[3_1_0%]'");
    expect(screen).toContain('{oneBoxBody}');
  });

  it('the one box holds the quiet line, the whole paper to flip, and the pictures the other parts do have', () => {
    const body = screen.slice(screen.indexOf('const oneBoxBody ='), screen.indexOf('const paperBody ='));
    expect(body).toContain('data-testid="one-photo-box"');
    expect(body).toContain('data-testid="no-part-pictures-note"');
    expect(body.indexOf('no-part-pictures-note')).toBeLessThan(body.indexOf('{flipBody}'));
    expect(body.indexOf('{flipBody}')).toBeLessThan(body.indexOf('<PartPictures'));
    expect(body).toContain('parts={shownParts}');
    // The separate "No separate picture for X" tiles are not drawn here: only parts with a picture get a tile.
    expect(body).not.toContain('parts={partPictures}');
  });

  it('phone layout: the flip section shows the one box content, still under a single heading', () => {
    expect(screen).toContain('{oneBox ? oneBoxBody : flipBody}');
    // The tiles for a stand-alone question and for parts with a crop are unchanged.
    expect(screen).toContain('tilesOn ? partsBody : cropVisible ? cropBody(false) : null');
    expect(screen).toContain('const partsBody = partPictures && !oneBox ? (');
  });

  it('never changes who is handed a question: no lease, save or advance code in the new lines', () => {
    const start = screen.indexOf('const oneBox = tilesOn && flipShown;');
    const block = screen.slice(start, start + 900) + screen.slice(screen.indexOf('const oneBoxBody ='), screen.indexOf('const paperBody ='));
    for (const forbidden of ['outbox', 'lease', 'api.', 'submit', 'advance', 'navigate']) {
      expect(block.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('the other parts that do have a picture keep their tile in the one box', () => {
  const parts: PartPicture[] = [
    { id: 'p2', label: '(ii)', path: 'p/ii.png', current: false, isParent: false, depth: 1 },
    { id: 'p5', label: '(v)', path: 'p/v.png', current: false, isParent: false, depth: 1 },
  ];
  const html = renderToStaticMarkup(
    <PartPictures
      parts={parts}
      urls={{ p2: 'https://img/ii.png', p5: 'https://img/v.png' }}
      focusId="q"
      onFocus={() => undefined}
      onEnlarge={() => undefined}
    />,
  );

  it('draws a tile with a picture for each, and no "No separate picture" tile', () => {
    expect((html.match(/data-testid="part-picture"/g) || []).length).toBe(2);
    expect((html.match(/<img /g) || []).length).toBe(2);
    expect(html).not.toContain('no-part-picture');
    expect(html).not.toContain('No separate picture');
  });
});
