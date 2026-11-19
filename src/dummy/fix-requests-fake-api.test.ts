import { describe, expect, it } from 'vitest';
import { createFakeFixRequestsApi } from '@/dummy/fix-requests-fake-api';

const good = { kind: 'bug' as const, title: 'The button does nothing', details: 'I pressed it.', page: '/checker' };

describe('the fake requests API', () => {
  it('starts a member request waiting for the HOD and shows it in their own list', async () => {
    const api = createFakeFixRequestsApi('member');
    const before = (await api.mine()).length;
    const id = await api.submit(good);
    const mine = await api.mine();
    expect(mine).toHaveLength(before + 1);
    expect(mine[0]).toMatchObject({ id, status: 'waiting_for_hod', raised_as: 'member', title: good.title });
  });

  it('starts an HOD request approved, so it goes straight on', async () => {
    const api = createFakeFixRequestsApi('hod');
    const id = await api.submit(good);
    const approved = await api.list('approved');
    expect(approved.find((r) => r.id === id)).toMatchObject({ status: 'approved', raised_as: 'hod' });
    expect((await api.list('waiting')).find((r) => r.id === id)).toBeUndefined();
  });

  it('refuses a short title, a missing choice and too many a day, in words', async () => {
    const api = createFakeFixRequestsApi('member');
    await expect(api.submit({ ...good, title: 'ab' })).rejects.toThrow('at least 3 letters');
    await expect(api.submit({ ...good, kind: null as never })).rejects.toThrow('Choose');
    for (let i = 0; i < 10; i += 1) await api.submit(good);
    await expect(api.submit(good)).rejects.toMatchObject({ code: '54000' });
  });

  it('counts each state and lists each group newest first', async () => {
    const api = createFakeFixRequestsApi('hod');
    const c = await api.counts();
    expect(c.waiting_for_hod).toBe((await api.list('waiting')).length);
    expect(c.approved + c.in_progress).toBe((await api.list('approved')).length);
    const waiting = await api.list('waiting');
    const times = waiting.map((r) => new Date(r.created_at ?? 0).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('approves or rejects a waiting request, a rejection needs a reason, and it cannot be decided twice', async () => {
    const api = createFakeFixRequestsApi('hod');
    const [first, second] = await api.list('waiting');
    await expect(api.decide(first.id, false, '  ')).rejects.toThrow('why this is not going ahead');
    expect(await api.decide(first.id, true, 'Yes please')).toBe('approved');
    expect(await api.decide(second.id, false, 'Not now')).toBe('rejected');
    await expect(api.decide(first.id, true, '')).rejects.toMatchObject({ code: '55000' });
    const rejected = await api.list('rejected');
    expect(rejected.find((r) => r.id === second.id)).toMatchObject({ decision_note: 'Not now', decided_by_name: 'Priya HOD' });
    await expect(api.decide('nope', true, '')).rejects.toThrow('not found');
  });

  it('starts over', async () => {
    const api = createFakeFixRequestsApi('member');
    const before = await api.counts();
    await api.submit(good);
    api.reset();
    expect(await api.counts()).toEqual(before);
  });
});
