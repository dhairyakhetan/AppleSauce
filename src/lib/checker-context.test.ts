import { describe, expect, it } from 'vitest';

import {
  assembleQuestionContext,
  contextHeading,
  partLabel,
  type ContextRow,
} from './checker-context';

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

// Question 3 with parts (i), (ii), (iii), as the RPC returns it (any order).
const Q3 = [
  row('p2', 12, { display_number: '(ii)', is_current: true }),
  row('root', 10, { display_number: '3', is_parent: true, depth: 0, body: 'Answer the following:' }),
  row('p3', 13, { display_number: '(iii)' }),
  row('p1', 11, { display_number: '(i)' }),
];

describe('assembleQuestionContext', () => {
  it('puts the parent first and the parts in paper order', () => {
    const ctx = assembleQuestionContext(Q3, 'p2')!;
    expect(ctx.parent?.id).toBe('root');
    expect(ctx.parts.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(ctx.currentId).toBe('p2');
    expect(ctx.currentIsParent).toBe(false);
  });

  it('never alters a body', () => {
    const ctx = assembleQuestionContext(Q3, 'p2')!;
    expect(ctx.parent?.body).toBe('Answer the following:');
    expect(ctx.parts[0].body).toBe('body of p1');
  });

  it('marks the parent as current when the checker is on the parent itself', () => {
    const ctx = assembleQuestionContext(Q3, 'root')!;
    expect(ctx.currentIsParent).toBe(true);
    expect(ctx.parts).toHaveLength(3);
  });

  it('works for a live_copy group with no parent row', () => {
    const ctx = assembleQuestionContext([row('a', 2), row('b', 3)], 'b')!;
    expect(ctx.parent).toBeNull();
    expect(ctx.parts.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('returns null for a standalone question, an empty result, or a stray id', () => {
    expect(assembleQuestionContext([], 'x')).toBeNull();
    expect(assembleQuestionContext(null, 'x')).toBeNull();
    expect(assembleQuestionContext([row('x', 1)], 'x')).toBeNull();
    expect(assembleQuestionContext(Q3, 'not-in-group')).toBeNull();
  });

  it('drops duplicate rows', () => {
    const ctx = assembleQuestionContext([...Q3, row('p1', 11)], 'p1')!;
    expect(ctx.parts.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('labels', () => {
  it('prefers the printed number, then the path, then the position', () => {
    expect(partLabel({ display_number: '(ii)', number_path: '3.2' }, 0)).toBe('(ii)');
    expect(partLabel({ display_number: ' ', number_path: '3.2' }, 0)).toBe('3.2');
    expect(partLabel({ display_number: null, number_path: null }, 2)).toBe('Part 3');
  });

  it('names the whole question by its number when it has one', () => {
    expect(contextHeading(assembleQuestionContext(Q3, 'p1')!)).toBe('The whole question 3');
    expect(contextHeading(assembleQuestionContext([row('a', 1), row('b', 2)], 'a')!)).toBe('The whole question');
  });
});
