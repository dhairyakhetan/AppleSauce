import { describe, expect, it } from 'vitest';
import {
  BULK_CONCURRENCY,
  MAX_BULK,
  newlyHeld,
  progressText,
  pruneSelected,
  runBulkAssign,
  selectAllLabel,
  selectAllState,
  selectFirst,
  summariseAutoAssign,
  summariseBulk,
  toggleSelected,
} from '@/lib/hod-bulk-assign';

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ paperId: `p${i + 1}`, label: `Paper ${i + 1}` }));

describe('bulk assign: selection', () => {
  it('ticks and unticks one paper without changing the old set', () => {
    const a = new Set<string>();
    const b = toggleSelected(a, 'p1');
    expect([...b]).toEqual(['p1']);
    expect(a.size).toBe(0);
    expect(toggleSelected(b, 'p1').size).toBe(0);
  });

  it('refuses a tick past the limit but always allows an untick', () => {
    const full = selectFirst(Array.from({ length: 80 }, (_, i) => `p${i}`));
    expect(full.size).toBe(MAX_BULK);
    expect(toggleSelected(full, 'extra').has('extra')).toBe(false);
    expect(toggleSelected(full, 'p0').size).toBe(MAX_BULK - 1);
  });

  it('select all takes the list in order, up to the limit', () => {
    expect([...selectFirst(['a', 'b', 'c'])]).toEqual(['a', 'b', 'c']);
    expect([...selectFirst(['a', 'b', 'c'], 2)]).toEqual(['a', 'b']);
  });

  it('forgets papers that left the list', () => {
    const kept = pruneSelected(new Set(['a', 'b', 'c']), ['b', 'c', 'd']);
    expect([...kept]).toEqual(['b', 'c']);
  });

  it('knows none, some and all, and words the control with the count', () => {
    expect(selectAllState(0, 12)).toBe('none');
    expect(selectAllState(3, 12)).toBe('some');
    expect(selectAllState(12, 12)).toBe('all');
    // A list longer than the limit is "all" once the limit is ticked.
    expect(selectAllState(MAX_BULK, 213)).toBe('all');
    expect(selectAllLabel(12)).toBe('Select all 12');
    expect(selectAllLabel(213)).toBe(`Select the first ${MAX_BULK} of 213`);
  });
});

describe('bulk assign: running it', () => {
  it('uses the one-paper call once per paper and returns results in the order given', async () => {
    const seen: string[] = [];
    const r = await runBulkAssign(items(6), async (id) => {
      seen.push(id);
    });
    expect(seen.sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    expect(r.map((x) => x.paperId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    expect(r.every((x) => x.ok)).toBe(true);
  });

  it('never has more than four calls in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    await runBulkAssign(items(20), async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((res) => setTimeout(res, 3));
      inFlight--;
    });
    expect(BULK_CONCURRENCY).toBe(4);
    expect(peak).toBe(4);
  });

  it('keeps going after a refusal and reports each paper on its own', async () => {
    const r = await runBulkAssign(items(5), async (id) => {
      if (id === 'p2') throw new Error('Paper is above their grade');
      if (id === 'p4') throw { message: '  That person is not an active verifier ' };
    });
    expect(r.map((x) => x.ok)).toEqual([true, false, true, false, true]);
    expect(r[1].error).toBe('Paper is above their grade');
    expect(r[3].error).toBe('That person is not an active verifier');
    expect(r[1].label).toBe('Paper 2');
  });

  it('gives a plain reason when the failure has no message', async () => {
    const r = await runBulkAssign(items(1), async () => {
      throw undefined;
    });
    expect(r[0]).toMatchObject({ ok: false, error: 'That did not work.' });
  });

  it('reports progress up to the total', async () => {
    const ticks: [number, number][] = [];
    await runBulkAssign(items(5), async () => {}, { onProgress: (d, t) => ticks.push([d, t]) });
    expect(ticks).toHaveLength(5);
    expect(ticks[ticks.length - 1]).toEqual([5, 5]);
    expect(progressText(3, 12)).toBe('Assigning 3 of 12 papers...');
    expect(progressText(1, 1)).toBe('Assigning 1 of 1 paper...');
  });

  it('refuses more than 50 papers and does not call anything', async () => {
    let calls = 0;
    await expect(
      runBulkAssign(items(MAX_BULK + 1), async () => {
        calls++;
      }),
    ).rejects.toThrow(/at most 50/i);
    expect(calls).toBe(0);
  });

  it('handles an empty list', async () => {
    expect(await runBulkAssign([], async () => {})).toEqual([]);
  });
});

describe('bulk assign: the result in plain words', () => {
  const ok = (n: number) => items(n).map((i) => ({ ...i, ok: true }));

  it('all went', () => {
    const o = summariseBulk(ok(3), 'Krish');
    expect(o.tone).toBe('good');
    expect(o.headline).toBe('Gave 3 papers to Krish.');
    expect(o.failures).toEqual([]);
    expect(summariseBulk(ok(1), 'you').headline).toBe('Gave 1 paper to you.');
  });

  it('some were refused: counts, reasons by paper name, and they stay ticked', () => {
    const results = [...ok(2), { paperId: 'x', label: 'Maths X 2019', ok: false, error: 'Above their grade' }];
    const o = summariseBulk(results, 'Krish');
    expect(o.tone).toBe('mixed');
    expect(o.headline).toBe('Gave 2 of 3 papers to Krish. 1 was refused.');
    expect(o.failures).toEqual([{ label: 'Maths X 2019', reason: 'Above their grade' }]);
    expect(o.lines.join(' ')).toMatch(/still ticked/);
  });

  it('none went', () => {
    const results = items(2).map((i) => ({ ...i, ok: false, error: 'Details expired' }));
    const o = summariseBulk(results, 'Krish');
    expect(o.tone).toBe('bad');
    expect(o.headline).toBe('None of the 2 papers could be given to Krish.');
    expect(o.failures).toHaveLength(2);
  });
});

describe('auto assign: the result in plain words', () => {
  const held = (paper: string, user: string, name: string) => ({ paper_id: paper, user_id: user, name });

  it('works out who got what by comparing before and after', () => {
    const before = [held('p1', 'u1', 'Asha')];
    const after = [held('p1', 'u1', 'Asha'), held('p2', 'u1', 'Asha'), held('p3', 'u2', 'Krish'), held('p4', 'u2', 'Krish'), held('p5', 'u2', 'Krish')];
    expect(newlyHeld(before, after)).toEqual([
      { name: 'Krish', count: 3 },
      { name: 'Asha', count: 1 },
    ]);
  });

  it('counts a paper that moved to someone else for the new holder', () => {
    expect(newlyHeld([held('p1', 'u1', 'Asha')], [held('p1', 'u2', 'Krish')])).toEqual([{ name: 'Krish', count: 1 }]);
  });

  it('says how many went, to whom and how many are left', () => {
    const o = summariseAutoAssign({ gave: 4, perPerson: [{ name: 'Krish', count: 3 }, { name: 'Asha', count: 1 }], left: 2 });
    expect(o.headline).toBe('Gave out 4 papers.');
    expect(o.tone).toBe('mixed');
    expect(o.lines[0]).toBe('Krish: 3 papers, Asha: 1 paper');
    expect(o.lines[1]).toMatch(/^2 papers could not be given out by the rules, so they are still listed below/);
  });

  it('says so when nothing is left', () => {
    const o = summariseAutoAssign({ gave: 1, perPerson: [{ name: 'Asha', count: 1 }], left: 0 });
    expect(o.tone).toBe('good');
    expect(o.lines).toContain('No paper is left without a verifier.');
  });

  it('says at least when the list is longer than the screen asks for', () => {
    const o = summariseAutoAssign({ gave: 5, perPerson: [], left: 200, leftIsAtLeast: true });
    expect(o.lines.join(' ')).toMatch(/At least 200 papers could not be given out/);
  });

  it('is honest when nothing could be given out', () => {
    const o = summariseAutoAssign({ gave: 0, perPerson: [], left: 7 });
    expect(o.tone).toBe('bad');
    expect(o.headline).toBe('Nothing could be given out by the rules right now.');
    expect(o.lines.join(' ')).toMatch(/7 papers could not be given out/);
  });

  it('shows only the server count when the read-back failed', () => {
    const o = summariseAutoAssign({ gave: 3, perPerson: null, left: null });
    expect(o).toMatchObject({ tone: 'good', headline: 'Gave out 3 papers.', lines: [] });
  });
});
