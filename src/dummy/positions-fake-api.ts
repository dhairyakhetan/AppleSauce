import type { ChangeResult, GrantResult, PositionHolder, PositionKey, PositionsApi, RevokeResult } from '@/lib/positions';
import { looksLikeEmail } from '@/lib/email-shape';

/**
 * In-memory fake of the Positions functions, for previewing the section without
 * signing in. Made-up people. It follows the same rules as the database: an
 * admin cannot remove or change themselves, the owner cannot be removed, and the
 * last admin stays. An address that has no made-up account becomes a pending
 * grant, exactly as the real function does.
 */

export const FAKE_YOU = 'admin@example.com';
export const FAKE_OWNER = 'owner@example.com';

const days = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();

interface Person {
  user_id: string;
  email: string;
  full_name: string | null;
  roles: Map<PositionKey, string>;
}

export function createFakePositionsApi(): PositionsApi & { reset: () => void } {
  let people: Person[] = [];
  let pending: { email: string; role: PositionKey; since: string }[] = [];

  // Accounts that exist but hold nothing yet: granting one of these applies at once.
  const spare: { user_id: string; email: string; full_name: string | null }[] = [
    { user_id: 'a3000000-0000-4000-8000-000000000001', email: 'meena.roy@example.com', full_name: 'Meena Roy' },
    { user_id: 'a3000000-0000-4000-8000-000000000002', email: 'ravi.k@example.com', full_name: null },
  ];

  function seed() {
    const mk = (n: number, email: string, full_name: string | null, roles: [PositionKey, number][]): Person => ({
      user_id: `a2000000-0000-4000-8000-00000000000${n}`,
      email,
      full_name,
      roles: new Map(roles.map(([r, d]) => [r, days(d)])),
    });
    people = [
      mk(1, FAKE_OWNER, 'Olivia Owner', [['admin', 300]]),
      mk(2, FAKE_YOU, 'You (made-up admin)', [['admin', 120]]),
      mk(3, 'devi.admin@example.com', 'Devi Admin', [['admin', 30]]),
      mk(4, 'rina.sen@example.com', 'Rina Sen', [['hod', 40]]),
      mk(5, 'asha.reviewer@example.com', 'Asha Reviewer', [['verifier', 12]]),
      mk(6, 'nikhil.k@example.com', 'Nikhil K', [['verifier', 3], ['reviewer', 2]]),
      mk(7, 'tara.bose@example.com', 'Tara Bose', [['reviewer', 18]]),
    ];
    pending = [{ email: 'aditi.new@example.com', role: 'verifier', since: days(1) }];
  }
  seed();

  const find = (email: string) => people.find((p) => p.email.toLowerCase() === email.trim().toLowerCase());
  const adminCount = () => people.filter((p) => p.roles.has('admin')).length;

  function guardAdminRemoval(p: Person) {
    if (p.email === FAKE_YOU) throw new Error('You cannot remove or change your own admin position. Ask another admin.');
    if (adminCount() <= 1) throw new Error('The last admin cannot be removed.');
    if (p.email === FAKE_OWNER) throw new Error('The owner admin account cannot be removed or changed.');
  }

  return {
    async list(): Promise<PositionHolder[]> {
      const held: PositionHolder[] = people.flatMap((p) =>
        [...p.roles].map(([role, since]) => ({
          role,
          user_id: p.user_id,
          email: p.email,
          full_name: p.full_name,
          since,
          is_pending: false,
          is_owner: p.email === FAKE_OWNER,
          is_you: p.email === FAKE_YOU,
        })),
      );
      const waiting: PositionHolder[] = pending.map((g) => ({
        role: g.role,
        user_id: null,
        email: g.email,
        full_name: null,
        since: g.since,
        is_pending: true,
        is_owner: false,
        is_you: false,
      }));
      return [...held, ...waiting];
    },

    async grant(email: string, role: PositionKey): Promise<GrantResult> {
      const e = email.trim().toLowerCase();
      if (!looksLikeEmail(e)) throw new Error('Enter a full email address.');
      let person = find(e);
      if (!person) {
        const account = spare.find((s) => s.email === e);
        if (account) {
          person = { ...account, roles: new Map() };
          people = [...people, person];
        }
      }
      if (person) {
        if (person.roles.has(role)) throw new Error('That person already holds that position.');
        person.roles.set(role, new Date().toISOString());
        return 'granted';
      }
      if (pending.some((g) => g.email === e && g.role === role)) {
        throw new Error('That grant is already waiting for their first Google sign-in.');
      }
      pending = [...pending, { email: e, role, since: new Date().toISOString() }];
      return 'pending';
    },

    async revoke(email: string, role: PositionKey): Promise<RevokeResult> {
      const person = find(email);
      if (person?.roles.has(role)) {
        if (role === 'admin') guardAdminRemoval(person);
        person.roles.delete(role);
        if (person.roles.size === 0) people = people.filter((p) => p !== person);
        return 'removed';
      }
      const e = email.trim().toLowerCase();
      if (pending.some((g) => g.email === e && g.role === role)) {
        pending = pending.filter((g) => !(g.email === e && g.role === role));
        return 'pending_removed';
      }
      throw new Error('They do not hold that position.');
    },

    async change(email: string, from: PositionKey, to: PositionKey): Promise<ChangeResult> {
      if (from === to) throw new Error('Pick a different position to change to.');
      const person = find(email);
      if (person?.roles.has(from)) {
        if (person.roles.has(to)) throw new Error('That person already holds that position.');
        if (from === 'admin') guardAdminRemoval(person);
        person.roles.delete(from);
        person.roles.set(to, new Date().toISOString());
        return 'changed';
      }
      const e = email.trim().toLowerCase();
      if (pending.some((g) => g.email === e && g.role === from)) {
        if (pending.some((g) => g.email === e && g.role === to)) {
          throw new Error('That grant is already waiting for their first Google sign-in.');
        }
        pending = [...pending.filter((g) => !(g.email === e && g.role === from)), { email: e, role: to, since: new Date().toISOString() }];
        return 'pending_changed';
      }
      throw new Error('They do not hold that position.');
    },

    reset: seed,
  };
}
