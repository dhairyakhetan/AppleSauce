import { describe, expect, it } from 'vitest';

import type { HighlightBox } from './checker-highlight';
import { normalisePaperPages } from './paper-pages';
import { normaliseRotation, rotateBox, rotationOfPage, swapsSides, uprightSize, type PageRotation } from './page-rotation';

/* A page saved sideways records a turn (clockwise degrees). The highlight box is measured in the stored,
   sideways picture, so it must be turned with the picture or it lands on the wrong words. */

const box: HighlightBox = { left: 0.1, top: 0.2, width: 0.3, height: 0.1 };

function expectBox(actual: HighlightBox | null, want: HighlightBox) {
  expect(actual).not.toBeNull();
  expect(actual!.left).toBeCloseTo(want.left, 10);
  expect(actual!.top).toBeCloseTo(want.top, 10);
  expect(actual!.width).toBeCloseTo(want.width, 10);
  expect(actual!.height).toBeCloseTo(want.height, 10);
}

describe('normaliseRotation', () => {
  it('accepts the four quarter turns, as numbers or text', () => {
    expect(normaliseRotation(0)).toBe(0);
    expect(normaliseRotation(90)).toBe(90);
    expect(normaliseRotation(180)).toBe(180);
    expect(normaliseRotation(270)).toBe(270);
    expect(normaliseRotation('90')).toBe(90);
    expect(normaliseRotation(' 270 ')).toBe(270);
  });
  it('turns anything else into 0, so a bad value never moves a picture', () => {
    for (const bad of [null, undefined, '', 'abc', 45, 91, 360, 450, -90, 90.5, NaN, Infinity, {}, [], true, '-90', '1e2']) {
      expect(normaliseRotation(bad)).toBe(0);
    }
  });
});

describe('swapsSides and uprightSize', () => {
  it('only 90 and 270 swap width and height', () => {
    expect(swapsSides(0)).toBe(false);
    expect(swapsSides(90)).toBe(true);
    expect(swapsSides(180)).toBe(false);
    expect(swapsSides(270)).toBe(true);
  });
  it('gives the size after the turn', () => {
    expect(uprightSize({ width: 510, height: 634 }, 0)).toEqual({ width: 510, height: 634 });
    expect(uprightSize({ width: 510, height: 634 }, 90)).toEqual({ width: 634, height: 510 });
    expect(uprightSize({ width: 510, height: 634 }, 180)).toEqual({ width: 510, height: 634 });
    expect(uprightSize({ width: 510, height: 634 }, 270)).toEqual({ width: 634, height: 510 });
  });
});

describe('rotateBox', () => {
  it('turn 0 returns the very same box (a page with no turn behaves exactly as before)', () => {
    expect(rotateBox(box, 0)).toBe(box);
  });
  it('no box stays no box, for every turn', () => {
    for (const r of [0, 90, 180, 270] as PageRotation[]) expect(rotateBox(null, r)).toBeNull();
  });
  it('90 clockwise: a point (x, y) goes to (1 - y, x)', () => {
    expectBox(rotateBox(box, 90), { left: 0.7, top: 0.1, width: 0.1, height: 0.3 });
  });
  it('180: a point (x, y) goes to (1 - x, 1 - y)', () => {
    expectBox(rotateBox(box, 180), { left: 0.6, top: 0.7, width: 0.3, height: 0.1 });
  });
  it('270 clockwise: a point (x, y) goes to (y, 1 - x)', () => {
    expectBox(rotateBox(box, 270), { left: 0.2, top: 0.6, width: 0.1, height: 0.3 });
  });
  it('the top left corner of the stored picture goes where the picture turns it', () => {
    const corner: HighlightBox = { left: 0, top: 0, width: 0.1, height: 0.1 };
    expectBox(rotateBox(corner, 90), { left: 0.9, top: 0, width: 0.1, height: 0.1 }); // top right
    expectBox(rotateBox(corner, 180), { left: 0.9, top: 0.9, width: 0.1, height: 0.1 }); // bottom right
    expectBox(rotateBox(corner, 270), { left: 0, top: 0.9, width: 0.1, height: 0.1 }); // bottom left
  });
  it('a box that fills the page still fills it', () => {
    const whole: HighlightBox = { left: 0, top: 0, width: 1, height: 1 };
    for (const r of [90, 180, 270] as PageRotation[]) expectBox(rotateBox(whole, r), whole);
  });
  it('a box against an edge stays inside 0..1 and touches the matching edge', () => {
    const bottomStrip: HighlightBox = { left: 0, top: 0.9, width: 1, height: 0.1 };
    expectBox(rotateBox(bottomStrip, 90), { left: 0, top: 0, width: 0.1, height: 1 }); // the left edge
    expectBox(rotateBox(bottomStrip, 270), { left: 0.9, top: 0, width: 0.1, height: 1 }); // the right edge
    expectBox(rotateBox(bottomStrip, 180), { left: 0, top: 0, width: 1, height: 0.1 }); // the top edge
  });
  it('turns that add up to a whole turn give the box back', () => {
    const once = rotateBox(box, 90)!;
    const twice = rotateBox(once, 90)!;
    const thrice = rotateBox(twice, 90)!;
    expectBox(rotateBox(thrice, 90), box);
    expectBox(twice, rotateBox(box, 180)!);
    expectBox(thrice, rotateBox(box, 270)!);
    expectBox(rotateBox(rotateBox(box, 90), 270), box);
    expectBox(rotateBox(rotateBox(box, 180), 180), box);
  });
  it('never leaves the page, whatever the turn', () => {
    const boxes: HighlightBox[] = [
      { left: 0, top: 0, width: 0.02, height: 0.005 },
      { left: 0.98, top: 0.995, width: 0.02, height: 0.005 },
      { left: 0.25, top: 0.4, width: 0.5, height: 0.2 },
    ];
    for (const b of boxes) {
      for (const r of [0, 90, 180, 270] as PageRotation[]) {
        const t = rotateBox(b, r)!;
        expect(t.left).toBeGreaterThanOrEqual(-1e-12);
        expect(t.top).toBeGreaterThanOrEqual(-1e-12);
        expect(t.left + t.width).toBeLessThanOrEqual(1 + 1e-12);
        expect(t.top + t.height).toBeLessThanOrEqual(1 + 1e-12);
        // area is kept
        expect(t.width * t.height).toBeCloseTo(b.width * b.height, 12);
      }
    }
  });
});

describe('rotationOfPage', () => {
  const pages = [
    { page: 1, object_path: 'a' },
    { page: 2, object_path: 'b', rotation: 270 as PageRotation },
  ];
  it('reads the turn of the page asked for', () => {
    expect(rotationOfPage(pages, 2)).toBe(270);
  });
  it('is 0 for a page with no turn, a page not in the list, no list, or no page', () => {
    expect(rotationOfPage(pages, 1)).toBe(0);
    expect(rotationOfPage(pages, 9)).toBe(0);
    expect(rotationOfPage(null, 2)).toBe(0);
    expect(rotationOfPage(undefined, 2)).toBe(0);
    expect(rotationOfPage(pages, null)).toBe(0);
    expect(rotationOfPage(pages, undefined)).toBe(0);
  });
});

describe('normalisePaperPages carries the turn', () => {
  it('keeps a quarter turn and leaves a page without one in its old shape', () => {
    expect(
      normalisePaperPages([
        { page: 1, object_path: 'pages/p/1.jpg', rotation: 0 },
        { page: 2, object_path: 'pages/p/2.jpg', rotation: 270 },
        { page: 3, object_path: 'pages/p/3.jpg', rotation: null },
        { page: 4, object_path: 'pages/p/4.jpg' },
        { page: 5, object_path: 'pages/p/5.jpg', rotation: '90' },
        { page: 6, object_path: 'pages/p/6.jpg', rotation: 45 },
      ]),
    ).toEqual([
      { page: 1, object_path: 'pages/p/1.jpg' },
      { page: 2, object_path: 'pages/p/2.jpg', rotation: 270 },
      { page: 3, object_path: 'pages/p/3.jpg' },
      { page: 4, object_path: 'pages/p/4.jpg' },
      { page: 5, object_path: 'pages/p/5.jpg', rotation: 90 },
      { page: 6, object_path: 'pages/p/6.jpg' },
    ]);
  });
});
