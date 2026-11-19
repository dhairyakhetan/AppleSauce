import { describe, expect, it } from 'vitest';

import { HIGHLIGHT_NOTE, NO_HIGHLIGHT_NOTE, questionHighlight, readBBox } from './checker-highlight';

/* The box on the printed page is only drawn when it can be trusted. A box in
   the wrong place is worse than none: the verifier reads the wrong area and
   "fixes" correct words to match it. */

const A4_IMAGE = { width: 595, height: 842 }; // an A4 picture
const verified = { page: 3, page_verified: true };

describe('readBBox', () => {
  it('accepts four numbers describing a rectangle', () => {
    expect(readBBox({ bbox: [10, 20, 110, 220] })).toEqual([10, 20, 110, 220]);
    expect(readBBox({ bbox: ['10', '20', '110', '220'] })).toEqual([10, 20, 110, 220]);
  });
  it('rejects anything else', () => {
    for (const bbox of [undefined, null, [], [1, 2, 3], [1, 2, 3, 4, 5], [5, 5, 5, 9], [5, 5, 9, 5], [-1, 0, 5, 5], ['a', 1, 2, 3], 'x', { x: 1 }]) {
      expect(readBBox({ bbox } as never)).toBeNull();
    }
    expect(readBBox(null)).toBeNull();
  });
});

describe('questionHighlight: when it draws', () => {
  it('draws a box from bbox and dpi when the picture is A4 shaped', () => {
    // 72 dpi A4 is about 595 x 842 pixels.
    const box = questionHighlight({ ...verified, dpi: 72, bbox: [60, 100, 540, 200] }, A4_IMAGE)!;
    expect(box).not.toBeNull();
    expect(box.left).toBeCloseTo(60 / 595.3 - 0.006, 2);
    expect(box.top).toBeCloseTo(100 / 842 - 0.006, 2);
    expect(box.width).toBeCloseTo(480 / 595.3 + 0.012, 2);
    expect(box.height).toBeCloseTo(100 / 842 + 0.012, 2);
    for (const v of Object.values(box)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('works at the pipeline default of 200 dpi', () => {
    const box = questionHighlight({ ...verified, dpi: 200, bbox: [200, 400, 1400, 700] }, { width: 1000, height: 1414 })!;
    expect(box).not.toBeNull();
    expect(box.left).toBeCloseTo(200 / 1653.5 - 0.006, 2);
  });

  it('recognises US Letter too', () => {
    const box = questionHighlight({ ...verified, dpi: 100, bbox: [100, 100, 700, 300] }, { width: 850, height: 1100 });
    expect(box).not.toBeNull();
  });

  it('uses the page size when the pipeline wrote it, whatever the picture looks like', () => {
    const box = questionHighlight({ ...verified, page_width: 1000, page_height: 2000, bbox: [100, 200, 900, 400] }, { width: 300, height: 300 })!;
    expect(box.left).toBeCloseTo(0.1 - 0.006, 3);
    expect(box.top).toBeCloseTo(0.1 - 0.006, 3);
    const viaPair = questionHighlight({ ...verified, page_size: [1000, 2000], bbox: [100, 200, 900, 400] }, null)!;
    expect(viaPair.width).toBeCloseTo(0.8 + 0.012, 3);
  });

  it('uses fractions when the pipeline wrote them', () => {
    const box = questionHighlight({ ...verified, bbox_norm: [0.1, 0.2, 0.9, 0.4] }, null)!;
    expect(box.left).toBeCloseTo(0.094, 3);
    expect(box.height).toBeCloseTo(0.212, 3);
  });
});

describe('questionHighlight: when it says nothing', () => {
  it('draws nothing when the page was not verified', () => {
    expect(questionHighlight({ page: 3, dpi: 72, bbox: [60, 100, 540, 200] }, A4_IMAGE)).toBeNull();
    expect(questionHighlight({ page: 3, page_verified: false, dpi: 72, bbox: [60, 100, 540, 200] }, A4_IMAGE)).toBeNull();
  });

  it('draws nothing when the crop matched badly (the box came from the same match)', () => {
    expect(questionHighlight({ ...verified, align_score: 0.41, dpi: 72, bbox: [60, 100, 540, 200] }, A4_IMAGE)).toBeNull();
    expect(questionHighlight({ ...verified, align_score: 0.95, dpi: 72, bbox: [60, 100, 540, 200] }, A4_IMAGE)).not.toBeNull();
  });

  it('draws nothing without a bbox, or with no way to know the page size', () => {
    expect(questionHighlight(verified, A4_IMAGE)).toBeNull();
    expect(questionHighlight({ ...verified, bbox: [60, 100, 540, 200] }, A4_IMAGE)).toBeNull(); // no dpi
    expect(questionHighlight({ ...verified, dpi: 72, bbox: [60, 100, 540, 200] }, null)).toBeNull(); // picture not loaded
    expect(questionHighlight(null, A4_IMAGE)).toBeNull();
  });

  it('draws nothing when the picture is not A4 or Letter shaped and no page size was written', () => {
    expect(questionHighlight({ ...verified, dpi: 72, bbox: [60, 100, 540, 200] }, { width: 800, height: 600 })).toBeNull();
    expect(questionHighlight({ ...verified, dpi: 72, bbox: [60, 100, 540, 200] }, { width: 600, height: 1200 })).toBeNull();
  });

  it('draws nothing when the box does not fit on the page (the dpi is wrong)', () => {
    // At 72 dpi an A4 page is 595 wide: a box out to x = 1500 cannot be on it.
    expect(questionHighlight({ ...verified, dpi: 72, bbox: [60, 100, 1500, 200] }, A4_IMAGE)).toBeNull();
    expect(questionHighlight({ ...verified, page_width: 1000, page_height: 1000, bbox: [0, 0, 1200, 500] }, null)).toBeNull();
  });

  it('draws nothing for a speck or for the whole page', () => {
    expect(questionHighlight({ ...verified, dpi: 72, bbox: [100, 100, 101, 101] }, A4_IMAGE)).toBeNull();
    expect(questionHighlight({ ...verified, dpi: 72, bbox: [0, 0, 595, 842] }, A4_IMAGE)).toBeNull();
  });

  it('rejects bad fractions', () => {
    expect(questionHighlight({ ...verified, bbox_norm: [0.5, 0.5, 0.4, 0.9] }, null)).toBeNull();
    expect(questionHighlight({ ...verified, bbox_norm: [0, 0, 1.2, 0.5] }, null)).toBeNull();
  });
});

describe('copy', () => {
  it('has no em or en dashes', () => {
    expect(HIGHLIGHT_NOTE + NO_HIGHLIGHT_NOTE).not.toMatch(/[–—]/);
  });
});
