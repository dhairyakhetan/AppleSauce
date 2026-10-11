import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { createFakeGamesApi } from '@/dummy/games-fake-api';
import { format } from '@/lib/games/format';

/* Dummy mode's stand-in for the `games` schema keeps the database's rules, so what people try in dummy mode is what
   the real pages will do. */

const rows = (text: string) => format(text).rows;
const HEAT = `Board: CBSE
Class: 7
Subject: Science
Chapter 4: Heat
Topic 2: Transfer of Heat
`;

describe('the dummy games database', () => {
  it('numbers new questions after the ones already in the topic, and skips repeats', async () => {
    const api = createFakeGamesApi(false);
    // already approved (case, spaces and a full stop at the end don't count), and the same question twice in one send
    const r = await api.sendBatch([
      ...rows(`${HEAT}Material that lets heat pass through it easily. | Conductor\nLiquid that rises in a thermometer | Mercury`),
      ...rows(`${HEAT}liquid that rises in a  thermometer | Mercury`),
    ]);
    expect(r).toMatchObject({ sent: 1, already: 2, sentBack: 0 });
    expect(r.batchIds).toHaveLength(1);
    const waiting = (await api.loadForHod()).questions.filter((q) => q.status === 'pending' && q.chapter_id === 'CBSE07SCI04');
    expect(waiting.map((q) => q.id)).toEqual(['CBSE07SCI04T02Q007']); // 5 approved and 1 sent back before it
  });

  it("doesn't take back a sent-back question unchanged, and points to why", async () => {
    const api = createFakeGamesApi(false);
    const [back] = await api.mySentBack();
    const r = await api.sendBatch(rows(`${HEAT}${back.question} | ${back.answer}`));
    expect(r).toMatchObject({ sent: 0, sentBack: 1, sentBackIds: [back.id], batchIds: [] });
    const fixed = await api.sendBatch(rows(`${HEAT}Heat flows through a solid from its hotter end to its colder end by this process | Conduction`));
    expect(fixed.sent).toBe(1);
  });

  it('lets only HoDs and admins approve, and only admins manage the team', async () => {
    const api = createFakeGamesApi(false);
    api.setRole('member');
    await expect(api.loadForHod()).rejects.toThrow(/HoD/);
    await expect(api.loadPeople()).rejects.toThrow(/admin/);
    api.setRole(null);
    expect(await api.myRole()).toBeNull();
    await expect(api.sendBatch([])).rejects.toThrow(/sign in/);
  });

  it('approves, sends back with a reason, and keeps a sent-back question back while its copy waits', async () => {
    const api = createFakeGamesApi(false);
    const bank = await api.loadForHod();
    const pending = bank.questions.filter((q) => q.status === 'pending');
    const before = await api.approvedCount();
    const r = await api.saveStatus([pending[0].id], 'approved');
    expect(r.changed).toEqual([pending[0].id]);
    expect(r.approved).toBe(before + 1);
    await expect(api.saveStatus([pending[1].id], 'rejected', '  ')).rejects.toThrow(/why/);
    // the same thing twice changes nothing
    expect((await api.saveStatus([pending[0].id], 'approved')).changed).toEqual([]);

    const [back] = await api.mySentBack();
    await api.sendBatch(rows(`${HEAT}${back.question} | A different answer`));
    const kept = await api.saveStatus([back.id], 'pending');
    expect(kept).toMatchObject({ changed: [], skipped: [back.id] });
  });

  it('keeps the owner an admin and stops admins removing themselves', async () => {
    const api = createFakeGamesApi(false);
    await expect(api.setPersonRole('asha.rao@example.com', 'member')).rejects.toThrow(/owner/);
    await expect(api.removePerson('you@example.com')).rejects.toThrow(/yourself/);
    await api.setPersonRole('New.Person@Example.com ', 'hod');
    expect((await api.loadPeople()).find((p) => p.email === 'new.person@example.com')?.role).toBe('hod');
  });
});
