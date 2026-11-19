/**
 * Where a question sits on the printed page, as a box to draw over the page
 * picture. Owner, 11 Oct 2026: "The printed page needs to be highlighted in
 * the box". Only drawn when the position is trustworthy; otherwise the page is
 * shown with no box and nothing is claimed.
 *
 * What the pipeline writes (audit_questions.source, db/001_audit_schema.sql):
 *   page   1-based page number
 *   bbox   [x0, y0, x1, y1] in PIXELS of the OCR render, at `dpi`
 *          (the pipeline's default is 200)
 *   dpi    the render resolution the bbox is measured at
 * The page picture the site shows is a separate JPEG of the same page, so the
 * box has to be turned into fractions of the page. That needs the page's size
 * in the bbox's own pixels. Three sources, best first:
 *   1. bbox_norm            four fractions 0..1 (not written today)
 *   2. page_width/page_height (or page_size [w, h]) in the bbox's pixels
 *   3. A4 or US Letter inferred from the picture's own shape and the dpi. This
 *      is the fallback for rows written before the pipeline recorded page_width.
 *      It only applies when the picture is clearly A4 or Letter portrait, and
 *      only when every corner of the box then lies on the page.
 * Anything else gives null: no box.
 *
 * A crop that matched the question badly (checker-pictures.ts: align_score
 * below the doubtful line) came from the same alignment as the box, so the box
 * is dropped with it. An unverified page is never shown at all (checker-page.ts).
 *
 * Pure, no imports of data code, so the practice round and tests can use it.
 */

import { isDoubtfulCrop } from '@/lib/checker-pictures';
import { pageIsVerified } from '@/lib/checker-page';

type Source = Record<string, unknown> | null | undefined;

/** Fractions of the page picture, each 0..1. */
export interface HighlightBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

const A4 = { w: 8.2677, h: 11.6929 };
const LETTER = { w: 8.5, h: 11 };
/** How far a picture's shape may be from A4 or Letter and still count as one. */
const SHAPE_TOLERANCE = 0.025;
/** A corner may sit this far past the inferred page edge (scan margins). */
const EDGE_SLACK = 1.03;
/** Breathing room added around the box, as a fraction of the page. */
const PAD = 0.006;

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function four(v: unknown): [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const nums = v.map(num);
  if (nums.some((n) => n === null)) return null;
  return nums as [number, number, number, number];
}

/** The raw bbox, when it is four numbers describing a real rectangle. */
export function readBBox(source: Source): [number, number, number, number] | null {
  const b = four(source?.bbox);
  if (!b) return null;
  const [x0, y0, x1, y1] = b;
  if (x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0) return null;
  return b;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function toBox(x0: number, y0: number, x1: number, y1: number): HighlightBox | null {
  const left = clamp01(x0 - PAD);
  const top = clamp01(y0 - PAD);
  const right = clamp01(x1 + PAD);
  const bottom = clamp01(y1 + PAD);
  const width = right - left;
  const height = bottom - top;
  if (width < 0.02 || height < 0.005) return null; // a speck is not a question
  if (width * height > 0.97) return null; // the whole page is no highlight
  return { left, top, width, height };
}

/** The page's size in the bbox's pixel space, or null when it cannot be known. */
function pageSizeInBBoxPixels(source: Source, image: ImageSize | null): { w: number; h: number; inferred: boolean } | null {
  const w = num(source?.page_width);
  const h = num(source?.page_height);
  if (w && h && w > 0 && h > 0) return { w, h, inferred: false };
  const size = source?.page_size;
  if (Array.isArray(size) && size.length === 2) {
    const sw = num(size[0]);
    const sh = num(size[1]);
    if (sw && sh && sw > 0 && sh > 0) return { w: sw, h: sh, inferred: false };
  }
  const dpi = num(source?.dpi);
  if (!dpi || dpi < 50 || dpi > 1200 || !image || image.width <= 0 || image.height <= 0) return null;
  const aspect = image.width / image.height;
  const shape = [A4, LETTER].find((p) => Math.abs(aspect - p.w / p.h) <= SHAPE_TOLERANCE);
  return shape ? { w: shape.w * dpi, h: shape.h * dpi, inferred: true } : null;
}

/**
 * The box to draw on the whole-page picture of this question, or null.
 * `image` is the picture's natural size (known once it has loaded).
 */
export function questionHighlight(source: Source, image: ImageSize | null): HighlightBox | null {
  if (!source) return null;
  if (!pageIsVerified(source)) return null;
  if (isDoubtfulCrop(source)) return null;

  const norm = four(source.bbox_norm);
  if (norm) {
    const [x0, y0, x1, y1] = norm;
    if (x0 < 0 || y0 < 0 || x1 > 1 || y1 > 1 || x1 <= x0 || y1 <= y0) return null;
    return toBox(x0, y0, x1, y1);
  }

  const bbox = readBBox(source);
  if (!bbox) return null;
  const page = pageSizeInBBoxPixels(source, image);
  if (!page) return null;
  const [x0, y0, x1, y1] = bbox;
  const slack = page.inferred ? EDGE_SLACK : 1.001;
  if (x1 > page.w * slack || y1 > page.h * slack) return null; // the box does not fit this page: wrong dpi or page
  return toBox(x0 / page.w, y0 / page.h, x1 / page.w, y1 / page.h);
}

export const HIGHLIGHT_NOTE = 'The orange box is where the computer found this question. It may be a little off, so read the whole area.';
export const NO_HIGHLIGHT_NOTE = 'Find this question on the page and read it there.';
