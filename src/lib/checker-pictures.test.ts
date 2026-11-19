import { describe, expect, it } from 'vitest';

import { assembleQuestionContext, type ContextRow } from './checker-context';
import {
  DOUBTFUL_ALIGN_BELOW,
  PICTURE_MAY_MISS_PARTS,
  alignScore,
  isDoubtfulCrop,
  pictureHeading,
  planCheckerPicture,
  snippetObject,
  wholeCrop,
} from './checker-pictures';

const P = 'paper1';

function row(id: string, ord: number, extra: Partial<ContextRow> = {}): ContextRow {
  return {
    id,
    ord,
    display_number: null,
    number_path: null,
    body: `body of ${id}`,
    options: null,
    source: null,
    is_current: false,
    is_parent: false,
    depth: 1,
    ...extra,
  };
}

const crop = (id: string, align?: number) => ({
  snippet_object: `${P}/${id}.png`,
  ...(align === undefined ? {} : { align_score: align }),
});

describe('reading source', () => {
  it('reads the crop path and score, tolerating strings and junk', () => {
    expect(snippetObject({ snippet_object: `${P}/q.png` })).toBe(`${P}/q.png`);
    expect(snippetObject({})).toBeNull();
    expect(snippetObject(null)).toBeNull();
    expect(snippetObject({ snippet_object: '' })).toBeNull();
    expect(snippetObject({ snippet_object: '../other/q.png' })).toBeNull();
    expect(snippetObject({ snippet_object: '/abs/q.png' })).toBeNull();
    expect(alignScore({ align_score: 0.42 })).toBe(0.42);
    expect(alignScore({ align_score: '0.9' })).toBe(0.9);
    expect(alignScore({ align_score: 'x' })).toBeNull();
    expect(alignScore({})).toBeNull();
  });

  it('calls a crop doubtful only when it has a score below 0.9', () => {
    expect(DOUBTFUL_ALIGN_BELOW).toBe(0.9);
    // 0.81 was a wrong picture in the owner's sample.
    expect(isDoubtfulCrop(crop('q', 0.81))).toBe(true);
    expect(isDoubtfulCrop(crop('q', 0.89))).toBe(true);
    expect(isDoubtfulCrop(crop('q', 0.9))).toBe(false);
    expect(isDoubtfulCrop(crop('q', 0.95))).toBe(false);
    // new_ocr rows carry no score: their crop is where the text was read from.
    expect(isDoubtfulCrop(crop('q'))).toBe(false);
  });

  it('reads the whole crop and whether parts are missing from it', () => {
    expect(wholeCrop({ whole_snippet_object: `${P}/r_whole.png`, whole_snippet_members: { located: 4, members: 4, min_align: 0.6 } }))
      .toEqual({ path: `${P}/r_whole.png`, mayMissParts: false });
    expect(wholeCrop({ whole_snippet_object: `${P}/r_whole.png`, whole_snippet_members: { located: 2, members: 3 } }))
      .toEqual({ path: `${P}/r_whole.png`, mayMissParts: true });
    expect(wholeCrop({ whole_snippet_object: `${P}/r_whole.png` })).toEqual({ path: `${P}/r_whole.png`, mayMissParts: false });
    expect(wholeCrop({})).toBeNull();
  });
});

describe('planCheckerPicture, a question on its own', () => {
  it('plans no picture (so no signed URL) when there is no crop', () => {
    expect(planCheckerPicture({ id: 'q', source: {} }, null)).toBeNull();
    expect(planCheckerPicture({ id: 'q', source: null }, null)).toBeNull();
  });

  it('shows a well matched or unscored crop openly', () => {
    expect(planCheckerPicture({ id: 'q', source: crop('q', 0.93) }, null)).toEqual({
      path: `${P}/q.png`, kind: 'own', doubtful: false, mayMissParts: false,
    });
    expect(planCheckerPicture({ id: 'q', source: crop('q') }, null)?.doubtful).toBe(false);
  });

  it('never shows a badly matched crop: no picture instead', () => {
    expect(planCheckerPicture({ id: 'q', source: crop('q', 0.31) }, null)).toBeNull();
    expect(planCheckerPicture({ id: 'q', source: crop('q', 0.81) }, null)).toBeNull();
  });
});

describe('planCheckerPicture, a sub-part', () => {
  const group = (rootSource: Record<string, unknown> | null, partSource: Record<string, unknown> | null) =>
    assembleQuestionContext(
      [
        row('root', 10, { is_parent: true, depth: 0, source: rootSource }),
        row('p1', 11, { source: partSource, is_current: true }),
        row('p2', 12),
      ],
      'p1',
    );

  it('prefers the whole-question crop', () => {
    const ctx = group(
      { ...crop('root', 0.9), whole_snippet_object: `${P}/root_whole.png`, whole_snippet_members: { located: 3, members: 3 } },
      crop('p1', 0.95),
    );
    expect(planCheckerPicture({ id: 'p1', source: crop('p1', 0.95) }, ctx)).toEqual({
      path: `${P}/root_whole.png`, kind: 'whole', doubtful: false, mayMissParts: false,
    });
  });

  it('says so when the whole crop is missing some parts', () => {
    const ctx = group(
      { whole_snippet_object: `${P}/root_whole.png`, whole_snippet_members: { located: 2, members: 3, min_align: 0.6 } },
      null,
    );
    const plan = planCheckerPicture({ id: 'p1', source: null }, ctx)!;
    expect(plan.kind).toBe('whole');
    expect(plan.mayMissParts).toBe(true);
  });

  it("falls back to the parent's crop, then its own, skipping doubtful ones", () => {
    let ctx = group(crop('root', 0.92), crop('p1', 0.9));
    expect(planCheckerPicture({ id: 'p1', source: crop('p1', 0.9) }, ctx)?.path).toBe(`${P}/root.png`);

    ctx = group(crop('root', 0.4), crop('p1', 0.9));
    expect(planCheckerPicture({ id: 'p1', source: crop('p1', 0.9) }, ctx)).toEqual({
      path: `${P}/p1.png`, kind: 'own', doubtful: false, mayMissParts: false,
    });
  });

  it('shows no picture when every crop is doubtful', () => {
    const ctx = group(crop('root', 0.4), crop('p1', 0.2));
    expect(planCheckerPicture({ id: 'p1', source: crop('p1', 0.2) }, ctx)).toBeNull();
  });

  it('plans nothing when no row in the group has a crop', () => {
    expect(planCheckerPicture({ id: 'p1', source: null }, group(null, null))).toBeNull();
  });

  it('uses the whole crop when the checker is on the parent itself', () => {
    const rootSource = { ...crop('root', 0.3), whole_snippet_object: `${P}/root_whole.png` };
    const ctx = assembleQuestionContext(
      [row('root', 10, { is_parent: true, depth: 0, source: rootSource, is_current: true }), row('p1', 11)],
      'root',
    );
    expect(planCheckerPicture({ id: 'root', source: rootSource }, ctx)?.kind).toBe('whole');
  });
});

describe('copy', () => {
  it('uses plain words and no em or en dashes', () => {
    for (const s of [PICTURE_MAY_MISS_PARTS, pictureHeading(null)]) {
      expect(s).not.toMatch(/[–—]/);
    }
  });

  it('names the whole question only when the picture is of the whole question', () => {
    expect(pictureHeading(null)).toBe('The printed paper');
    expect(pictureHeading({ path: 'a', kind: 'own', doubtful: false, mayMissParts: false })).toBe('The printed paper');
    expect(pictureHeading({ path: 'a', kind: 'whole', doubtful: false, mayMissParts: false })).toBe(
      'The printed paper, whole question',
    );
  });
});
