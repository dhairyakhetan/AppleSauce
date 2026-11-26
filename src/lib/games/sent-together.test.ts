import { describe, expect, it } from 'vitest';
import { sentTogether } from './rows';

describe('sent-back questions, grouped as they were sent back', () => {
  const q = (id: string, batch: string, note: string, reviewedAt: string) => ({ id, batch, note, reviewedAt });
  it('questions of one batch sent back together with one reason are one entry; any other question is its own', () => {
    const list = [
      q('a', 'B1', 'Fix the gaps.', '2026-11-26T10:00:00Z'),
      q('b', 'B1', 'Fix the gaps.', '2026-11-26T10:00:00Z'),
      q('c', 'B1', 'Wrong fact.', '2026-11-26T10:00:00Z'), // another reason
      q('d', 'B1', 'Fix the gaps.', '2026-11-26T11:00:00Z'), // another moment
      q('e', 'B2', 'Fix the gaps.', '2026-11-26T10:00:00Z'), // another batch
    ];
    expect(sentTogether(list).map((g) => g.map((x) => x.id).join(''))).toEqual(['ab', 'c', 'd', 'e']);
  });
});
