import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { createFakeHodApi } from '@/dummy/hod-fake-api';
import type { BulkResult } from '@/lib/hod-bulk-assign';
import { checkBulk, didLand, landedFlags, NOT_LANDED_HELP, notLandedMessage, notLandedReason, UNCHECKED_NOTE, type HeldRow } from '@/lib/hod-give-check';

/* After a give or a move the HOD screen reads the assignments back and looks for the paper under the chosen person.
   These are the rules of that look, and the plain words said when the paper is not there. */

const list: HeldRow[] = [
  { paper_id: 'p1', user_id: 'asha', status: 'assigned' },
  { paper_id: 'p2', user_id: 'asha', status: 'queued' },
  { paper_id: 'p3', user_id: 'bela', status: 'assigned' },
  { paper_id: 'p4', user_id: 'bela', status: 'other' },
];

describe('didLand', () => {
  it('is true when the paper sits with that person, working on it or waiting its turn', () => {
    expect(didLand(list, { paperId: 'p1', userId: 'asha' })).toBe(true);
    expect(didLand(list, { paperId: 'p2', userId: 'asha' })).toBe(true);
  });
  it('is false when the paper is with someone else', () => {
    expect(didLand(list, { paperId: 'p3', userId: 'asha' })).toBe(false);
  });
  it('is false when the paper is nowhere in the list', () => {
    expect(didLand(list, { paperId: 'p9', userId: 'asha' })).toBe(false);
    expect(didLand([], { paperId: 'p1', userId: 'asha' })).toBe(false);
  });
  it('is false when the row has some other status', () => {
    expect(didLand(list, { paperId: 'p4', userId: 'bela' })).toBe(false);
  });
  it('a moved paper must be under the new person, not the old one', () => {
    expect(didLand(list, { paperId: 'p1', userId: 'bela' })).toBe(false);
  });
});

describe('landedFlags', () => {
  it('answers each intended give in order', () => {
    expect(
      landedFlags(list, [
        { paperId: 'p1', userId: 'asha' },
        { paperId: 'p3', userId: 'asha' },
        { paperId: 'p2', userId: 'asha' },
      ]),
    ).toEqual([true, false, true]);
  });
  it('an empty list of gives gives an empty answer', () => {
    expect(landedFlags(list, [])).toEqual([]);
  });
});

describe('the red message', () => {
  it('names the person and says nothing was lost', () => {
    expect(notLandedMessage('Asha')).toBe(
      'The system said it gave this paper to Asha, but Asha does not have it. Nothing was lost. Try again, or tell the person who looks after the website.',
    );
    expect(notLandedMessage('Asha')).toContain(NOT_LANDED_HELP);
  });
  it('reads correctly when the HOD gave the paper to themself', () => {
    expect(notLandedMessage('you')).toContain('gave this paper to you, but you do not have it.');
  });
  it('uses no dash and no jargon', () => {
    const text = `${notLandedMessage('Asha')} ${notLandedReason('Asha')} ${UNCHECKED_NOTE}`;
    expect(text).not.toMatch(/[–—]/);
    expect(text).not.toMatch(/rpc|database|sql|null|undefined/i);
  });
});

describe('checkBulk', () => {
  const ok = (paperId: string): BulkResult => ({ paperId, label: `Paper ${paperId}`, ok: true });
  const refused = (paperId: string): BulkResult => ({ paperId, label: `Paper ${paperId}`, ok: false, error: 'Above their grade' });

  it('everything landed: the usual success result, no red message', () => {
    const c = checkBulk([ok('p1'), ok('p2')], list, 'asha', 'Asha');
    expect(c.alert).toBeNull();
    expect(c.outcome.tone).toBe('good');
    expect(c.outcome.headline).toBe('Gave 2 papers to Asha.');
    expect(c.results.every((r) => r.ok)).toBe(true);
  });

  it('a refusal the server itself reported keeps its usual wording, no red message', () => {
    const c = checkBulk([ok('p1'), refused('p9')], list, 'asha', 'Asha');
    expect(c.alert).toBeNull();
    expect(c.outcome.headline).toBe('Gave 1 of 2 papers to Asha. 1 was refused.');
  });

  it('counts how many really landed and how many did not', () => {
    const c = checkBulk([ok('p1'), ok('p3'), ok('p2'), ok('p9')], list, 'asha', 'Asha');
    expect(c.alert).toBe(c.outcome.headline);
    expect(c.outcome.headline).toBe('2 of 4 papers really landed with Asha. 2 did not land: the system said it gave them, but Asha does not have them.');
    expect(c.outcome.tone).toBe('mixed');
    expect(c.outcome.lines).toContain(NOT_LANDED_HELP);
    expect(c.outcome.failures.map((f) => f.label)).toEqual(['Paper p3', 'Paper p9']);
    expect(c.outcome.failures[0].reason).toBe(notLandedReason('Asha'));
    // They stay in the not-ok group, so the screen keeps them ticked and in the list.
    expect(c.results.filter((r) => !r.ok).map((r) => r.paperId)).toEqual(['p3', 'p9']);
  });

  it('says refused and not landed apart', () => {
    const c = checkBulk([ok('p1'), ok('p3'), refused('p9')], list, 'asha', 'Asha');
    expect(c.outcome.headline).toBe('1 of 3 papers really landed with Asha. 1 was refused by the server. 1 did not land: the system said it gave it, but Asha does not have it.');
    expect(c.outcome.failures).toHaveLength(2);
  });

  it('none landed is red', () => {
    const c = checkBulk([ok('p3')], list, 'asha', 'Asha');
    expect(c.outcome.tone).toBe('bad');
    expect(c.outcome.headline).toBe('0 of 1 paper really landed with Asha. 1 did not land: the system said it gave it, but Asha does not have it.');
    expect(c.alert).not.toBeNull();
  });

  it('a paper the server refused is never counted as landed even if it is in the list', () => {
    const c = checkBulk([refused('p1')], list, 'asha', 'Asha');
    expect(c.results[0].ok).toBe(false);
    expect(c.alert).toBeNull();
  });

  it('when the read-back failed it claims nothing more than the server said, and says it could not check', () => {
    const c = checkBulk([ok('p1'), refused('p9')], null, 'asha', 'Asha');
    expect(c.alert).toBeNull();
    expect(c.outcome.lines).toContain(UNCHECKED_NOTE);
    expect(c.outcome.headline).toBe('Gave 1 of 2 papers to Asha. 1 was refused.');
    const none = checkBulk([refused('p9')], null, 'asha', 'Asha');
    expect(none.outcome.lines).not.toContain(UNCHECKED_NOTE);
  });

  it('works for a whole bulk run of 50', () => {
    const many = Array.from({ length: 50 }, (_, i) => ok(`q${i}`));
    const held: HeldRow[] = many.slice(0, 30).map((r) => ({ paper_id: r.paperId, user_id: 'asha', status: 'assigned' }));
    const c = checkBulk(many, held, 'asha', 'Asha');
    expect(c.outcome.headline).toContain('30 of 50 papers really landed with Asha. 20 did not land');
  });
});

describe('against the practice desk', () => {
  it('a give that really happened is found in the read-back', async () => {
    const api = createFakeHodApi();
    const [paper] = await api.unassignedPapers(5);
    const who = (await api.team()).find((m) => m.active)!;
    await api.assignPaper(paper.paper_id, who.user_id);
    expect(didLand(await api.assignments(), { paperId: paper.paper_id, userId: who.user_id })).toBe(true);
  });

  it('a give that says yes and does nothing is caught, and the paper stays in the free list', async () => {
    const api = createFakeHodApi();
    api.silentGive = true;
    const [paper] = await api.unassignedPapers(5);
    const who = (await api.team()).find((m) => m.active)!;
    await api.assignPaper(paper.paper_id, who.user_id); // no error: the server "said yes"
    expect(didLand(await api.assignments(), { paperId: paper.paper_id, userId: who.user_id })).toBe(false);
    expect((await api.unassignedPapers(50)).some((p) => p.paper_id === paper.paper_id)).toBe(true);
  });

  it('a move that says yes and does nothing is caught: the paper is still with the old holder', async () => {
    const api = createFakeHodApi();
    const held = (await api.assignments())[0];
    const to = (await api.team()).find((m) => m.active && m.user_id !== held.user_id)!;
    api.silentGive = true;
    await api.assignPaper(held.paper_id, to.user_id);
    const after = await api.assignments();
    expect(didLand(after, { paperId: held.paper_id, userId: to.user_id })).toBe(false);
    expect(didLand(after, { paperId: held.paper_id, userId: held.user_id })).toBe(true);
  });
});
