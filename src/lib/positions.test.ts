import { describe, expect, it } from 'vitest';
import {
  POSITIONS,
  changeTargets,
  changedWords,
  grantedWords,
  groupByPosition,
  positionErrorWords,
  protectedReason,
  type PositionHolder,
} from '@/lib/positions';
import { FAKE_OWNER, FAKE_YOU, createFakePositionsApi } from '@/dummy/positions-fake-api';

const holder = (over: Partial<PositionHolder>): PositionHolder => ({
  role: 'verifier',
  user_id: 'u1',
  email: 'a@example.com',
  full_name: null,
  since: '2026-10-01T00:00:00Z',
  is_pending: false,
  is_owner: false,
  is_you: false,
  ...over,
});

describe('positions logic', () => {
  it('names four positions in a fixed order', () => {
    expect(POSITIONS.map((p) => p.key)).toEqual(['admin', 'hod', 'verifier', 'reviewer']);
  });

  it('groups by position, people first then pending, each A to Z', () => {
    const g = groupByPosition([
      holder({ role: 'hod', email: 'z@example.com' }),
      holder({ role: 'hod', email: 'b@example.com', is_pending: true, user_id: null }),
      holder({ role: 'hod', email: 'a@example.com' }),
    ]);
    expect(g.hod.map((h) => h.email)).toEqual(['a@example.com', 'z@example.com', 'b@example.com']);
    expect(g.admin).toEqual([]);
  });

  it('switches off Remove and Change only for you and the owner, and only on the admin position', () => {
    expect(protectedReason({ role: 'admin', is_you: true, is_owner: false })).toMatch(/This is you/);
    expect(protectedReason({ role: 'admin', is_you: false, is_owner: true })).toMatch(/owner/);
    expect(protectedReason({ role: 'admin', is_you: false, is_owner: false })).toBeNull();
    expect(protectedReason({ role: 'verifier', is_you: true, is_owner: true })).toBeNull();
  });

  it('offers only positions the person does not hold yet', () => {
    const rows = [holder({ role: 'verifier' }), holder({ role: 'reviewer' })];
    expect(changeTargets(rows, 'A@example.com', 'verifier').map((p) => p.key)).toEqual(['admin', 'hod']);
  });

  it('says plainly when a grant is waiting for a first Google sign-in', () => {
    expect(grantedWords('pending', 'x@example.com', 'admin')).toMatch(/no account yet.*an admin.*first time they sign in with Google/);
    expect(grantedWords('granted', 'x@example.com', 'hod')).toMatch(/is now a hod/i);
    expect(changedWords('pending_changed', 'x@example.com', 'verifier')).toMatch(/instead, from their first Google sign-in/);
  });

  it('shows the server refusals as written and hides anything raw', () => {
    expect(positionErrorWords(new Error('The last admin cannot be removed.'), 'x')).toBe('The last admin cannot be removed.');
    expect(positionErrorWords({ message: 'Not authorized' }, 'x')).toMatch(/not allowed/);
    expect(positionErrorWords({ message: 'relation "x" does not exist' }, 'fallback')).toBe('fallback');
  });

  it('keeps em and en dashes out of the copy', () => {
    const all = JSON.stringify([POSITIONS, grantedWords('pending', 'a@b.co', 'verifier'), changedWords('changed', 'a@b.co', 'admin')]);
    expect(all).not.toMatch(/[–—]/);
  });
});

describe('the dummy positions fake follows the database rules', () => {
  it('records an unknown email as pending and applies a known account at once', async () => {
    const api = createFakePositionsApi();
    expect(await api.grant('Brand.New@Example.com ', 'hod')).toBe('pending');
    expect(await api.grant('meena.roy@example.com', 'reviewer')).toBe('granted');
    const rows = await api.list();
    expect(rows.find((r) => r.email === 'brand.new@example.com')?.is_pending).toBe(true);
    await expect(api.grant('brand.new@example.com', 'hod')).rejects.toThrow(/already waiting/);
    await expect(api.grant('meena.roy@example.com', 'reviewer')).rejects.toThrow(/already holds/);
    await expect(api.grant('nonsense', 'hod')).rejects.toThrow(/full email/);
  });

  it('never lets an admin remove or change themselves, nor the owner', async () => {
    const api = createFakePositionsApi();
    await expect(api.revoke(FAKE_YOU, 'admin')).rejects.toThrow(/your own admin position/);
    await expect(api.change(FAKE_YOU, 'admin', 'hod')).rejects.toThrow(/your own admin position/);
    await expect(api.revoke(FAKE_OWNER, 'admin')).rejects.toThrow(/owner admin account/);
    await expect(api.change(FAKE_OWNER, 'admin', 'verifier')).rejects.toThrow(/owner admin account/);
    const rows = await api.list();
    expect(rows.filter((r) => r.role === 'admin' && !r.is_pending).length).toBe(3);
  });

  it('removes an ordinary admin, and keeps the owner standing', async () => {
    const api = createFakePositionsApi();
    expect(await api.revoke('devi.admin@example.com', 'admin')).toBe('removed');
    await expect(api.revoke(FAKE_OWNER, 'admin')).rejects.toThrow(/owner admin account/);
  });

  it('changes a position in one step, and leaves things alone when the new one is already held', async () => {
    const api = createFakePositionsApi();
    expect(await api.change('asha.reviewer@example.com', 'verifier', 'hod')).toBe('changed');
    let rows = await api.list();
    expect(rows.some((r) => r.email === 'asha.reviewer@example.com' && r.role === 'hod')).toBe(true);
    expect(rows.some((r) => r.email === 'asha.reviewer@example.com' && r.role === 'verifier')).toBe(false);
    // Nikhil holds both verifier and reviewer: a change to the held one is refused and nothing moves.
    await expect(api.change('nikhil.k@example.com', 'verifier', 'reviewer')).rejects.toThrow(/already holds/);
    rows = await api.list();
    expect(rows.some((r) => r.email === 'nikhil.k@example.com' && r.role === 'verifier')).toBe(true);
  });

  it('changes and cancels pending grants', async () => {
    const api = createFakePositionsApi();
    expect(await api.change('aditi.new@example.com', 'verifier', 'admin')).toBe('pending_changed');
    expect(await api.revoke('aditi.new@example.com', 'admin')).toBe('pending_removed');
    await expect(api.revoke('aditi.new@example.com', 'admin')).rejects.toThrow(/do not hold/);
  });
});
