/**
 * Some scanned papers are saved with a page picture turned a quarter turn
 * (found 12 Nov 2026 on paper d18e788e, pages 2 to 5): the text runs up or
 * down the picture. The pipeline records, per page, how far to turn the
 * stored picture CLOCKWISE to make it read upright, in
 * audit_paper_pages.rotation (0, 90, 180 or 270; 0 = leave it alone).
 *
 * The question's highlight box (checker-highlight.ts) is measured in the
 * STORED picture, so it has to be turned with the picture. These helpers do
 * that maths. Pure: no data code, no React.
 */

import type { HighlightBox, ImageSize } from '@/lib/checker-highlight';

export type PageRotation = 0 | 90 | 180 | 270;

/**
 * A rotation from the database. Only 0, 90, 180 and 270 (as a number or as
 * text) count; anything else, including null or a half turn written as 450,
 * is 0 so a bad value can never show a picture in an odd position.
 */
export function normaliseRotation(raw: unknown): PageRotation {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return n === 90 || n === 180 || n === 270 ? n : 0;
}

/** True for the two turns that swap the picture's width and height. */
export function swapsSides(rotation: PageRotation): boolean {
  return rotation === 90 || rotation === 270;
}

/** The picture's size once it has been turned upright. */
export function uprightSize(size: ImageSize, rotation: PageRotation): ImageSize {
  return swapsSides(rotation) ? { width: size.height, height: size.width } : { width: size.width, height: size.height };
}

/**
 * A box measured in the stored picture (fractions 0..1), as it sits after the
 * picture is turned clockwise by `rotation`. 0 returns the very same box.
 *   90 : a point (x, y) goes to (1 - y, x)
 *   180: a point (x, y) goes to (1 - x, 1 - y)
 *   270: a point (x, y) goes to (y, 1 - x)
 */
export function rotateBox(box: HighlightBox | null, rotation: PageRotation): HighlightBox | null {
  if (!box) return null;
  const { left, top, width, height } = box;
  switch (rotation) {
    case 90:
      return { left: 1 - (top + height), top: left, width: height, height: width };
    case 180:
      return { left: 1 - (left + width), top: 1 - (top + height), width, height };
    case 270:
      return { left: top, top: 1 - (left + width), width: height, height: width };
    default:
      return box;
  }
}

/** The rotation of one page from a list of pages (as paper_page_pictures returns them); 0 when the page is not in the list. */
export function rotationOfPage(pages: ReadonlyArray<{ page: number; rotation?: PageRotation }> | null | undefined, page: number | null | undefined): PageRotation {
  if (!pages || typeof page !== 'number') return 0;
  return pages.find((p) => p.page === page)?.rotation ?? 0;
}
