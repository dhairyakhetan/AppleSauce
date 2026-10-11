import type { CheckerAdminApi, CheckerAdminRow } from '@/lib/checker-admin-api';
import { looksLikeEmail } from '@/lib/email-shape';
import type { UserSearchRow } from '@/lib/checker-api';

/**
 * In-memory fake of the "add checkers by email" admin RPCs (D75), for
 * previewing /admin/checkers without a real admin sign-in. Made-up people,
 * not real Shikshaq staff or checkers.
 */
export function createFakeCheckerAdminApi(): CheckerAdminApi & { reset: () => void } {
  // The ids match the made-up verifiers in hod-fake-api.ts, so the Details
  // column joins: Asha and Nikhil are ready, Tara's details have expired and
  // Imran has none yet.
  const seed = (): CheckerAdminRow[] => [
    {
      user_id: 'c1000000-0000-4000-8000-000000000001',
      email: 'asha.reviewer@example.com',
      full_name: 'Asha Reviewer',
      added_at: new Date(Date.now() - 12 * 24 * 3600 * 1000).toISOString(),
      checked_today: 14,
      checked_total: 812,
    },
    {
      user_id: 'c1000000-0000-4000-8000-000000000002',
      email: 'nikhil.k@example.com',
      full_name: 'Nikhil K',
      added_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      checked_today: 0,
      checked_total: 47,
    },
    {
      user_id: 'c1000000-0000-4000-8000-000000000003',
      email: 'tara.bose@example.com',
      full_name: 'Tara Bose',
      added_at: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(),
      checked_today: 0,
      checked_total: 9,
    },
    {
      user_id: 'c1000000-0000-4000-8000-000000000005',
      email: 'imran.s@example.com',
      full_name: null,
      added_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      checked_today: 2,
      checked_total: 2,
    },
  ];
  let rows: CheckerAdminRow[] = seed();

  function reset() {
    rows = seed();
  }

  // Made-up accounts that have signed up but are not checkers yet.
  const accounts: { user_id: string; full_name: string | null; email: string }[] = [
    { user_id: 'd2222222-0000-4000-8000-000000000001', full_name: 'Tara Bose', email: 'tara.bose@example.com' },
    { user_id: 'd2222222-0000-4000-8000-000000000002', full_name: 'Tarun Gupta', email: 'tarun.g@example.com' },
    { user_id: 'd2222222-0000-4000-8000-000000000003', full_name: 'Meena Roy', email: 'meena.roy@example.com' },
    { user_id: 'd2222222-0000-4000-8000-000000000004', full_name: null, email: 'ravi.k@example.com' },
  ];

  return {
    async searchUsers(query: string): Promise<UserSearchRow[]> {
      const q = query.trim().toLowerCase();
      const pool = [
        ...rows.map((r) => ({ user_id: r.user_id, full_name: r.full_name, email: r.email, is_checker: true })),
        ...accounts.filter((a) => !rows.some((r) => r.email === a.email)).map((a) => ({ ...a, is_checker: false })),
      ];
      return pool
        .filter((a) => `${a.full_name ?? ''} ${a.email}`.toLowerCase().includes(q))
        .map((a) => ({ user_id: a.user_id, full_name: a.full_name, email: a.email, role: null, is_checker: a.is_checker, checker_active: a.is_checker }));
    },
    async listCheckers() {
      return rows.map((r) => ({ ...r }));
    },
    async addChecker(email: string) {
      const trimmed = email.trim();
      if (!looksLikeEmail(trimmed)) throw new Error('Enter a full email address.');
      if (rows.some((r) => r.email.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error('That email is already a checker.');
      }
      // 20% of made-up addresses simulate "no account with that email yet",
      // so the preview can show that path without a real Supabase lookup.
      if (trimmed.startsWith('nobody')) throw new Error('No account found for that email');
      const known = accounts.find((a) => a.email.toLowerCase() === trimmed.toLowerCase());
      const newRow: CheckerAdminRow = {
        user_id: known?.user_id ?? crypto.randomUUID(),
        email: trimmed,
        full_name: known?.full_name ?? null,
        added_at: new Date().toISOString(),
        checked_today: 0,
        checked_total: 0,
      };
      rows = [newRow, ...rows];
      return newRow.user_id;
    },
    async removeChecker(userId: string) {
      rows = rows.filter((r) => r.user_id !== userId);
    },
    reset,
  };
}
