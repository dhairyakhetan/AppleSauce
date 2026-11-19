import { describe, expect, it } from 'vitest';
import { createFakePaperAsksApi } from '@/dummy/paper-asks-fake-api';

describe('the fake ask-for-papers api', () => {
  it('starts with two made-up people waiting, oldest first', async () => {
    const api = createFakePaperAsksApi();
    const list = await api.list();
    expect(list.map((a) => a.name)).toEqual(['Rohan Verma', 'Meera Iyer']);
    expect(await api.mine()).toBeNull();
  });

  it('asks once; tapping again says already asked and makes no second row', async () => {
    const api = createFakePaperAsksApi();
    expect(await api.ask()).toBe('asked');
    expect(await api.ask()).toBe('already_asked');
    expect((await api.list()).filter((a) => a.name === 'Asha Reviewer')).toHaveLength(1);
    expect(await api.mine()).not.toBeNull();
  });

  it('puts the new ask last, because the list is oldest first', async () => {
    const api = createFakePaperAsksApi();
    await api.ask();
    const list = await api.list();
    expect(list[list.length - 1].name).toBe('Asha Reviewer');
  });

  it('clears one on dismiss, and a cleared ask of mine can be made again', async () => {
    const api = createFakePaperAsksApi();
    const [first] = await api.list();
    await api.dismiss(first.ask_id);
    expect((await api.list()).some((a) => a.ask_id === first.ask_id)).toBe(false);
    await api.ask();
    const mine = (await api.list()).find((a) => a.name === 'Asha Reviewer')!;
    await api.dismiss(mine.ask_id);
    expect(await api.mine()).toBeNull();
    expect(await api.ask()).toBe('asked');
  });

  it('starts over on reset', async () => {
    const api = createFakePaperAsksApi();
    await api.ask();
    const [first] = await api.list();
    await api.dismiss(first.ask_id);
    api.reset();
    expect(await api.list()).toHaveLength(2);
    expect(await api.mine()).toBeNull();
  });
});
