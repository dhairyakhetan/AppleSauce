import { supabase } from '@/integrations/supabase/client';
import { adminSearchUsers, type UserSearchRow } from '@/lib/checker-api';

/**
 * Client wrapper for the "add checkers by email" admin page
 * (pipeline-plan Step 2, #7), against three RPCs a parallel migration is
 * adding (not yet in the generated types, hence the `as never` casts --
 * the same pattern checker-api.ts uses for the rest of the checker RPCs):
 *
 *   admin_add_checker(p_email text) returns uuid
 *   admin_remove_checker(p_user_id uuid) returns void
 *   admin_list_checker_accounts() returns table(user_id uuid, email text,
 *     full_name text, added_at timestamptz, checked_today int, checked_total int)
 *
 * This is a DIFFERENT RPC from checker-api.ts's adminListCheckers(), which
 * calls the older admin_list_checkers() (active, granted_at, passed_count/
 * fixed_count/split_count/escalated_count) that src/pages/admin/paper-review.tsx
 * still depends on, including revoked checkers so they can be reactivated.
 * The two return different shapes and must not be merged.
 *
 * This module does not assume anything about HOW those RPCs decide who is
 * a checker (a role column, a membership table, a grant list) -- it only
 * calls them and shapes their result, so it does not need to change if the
 * migration author picks a different storage shape than one might guess.
 */

export interface CheckerAdminRow {
  user_id: string;
  email: string;
  full_name: string | null;
  added_at: string;
  checked_today: number;
  checked_total: number;
}

function rpcRows<T>(data: unknown): T[] {
  return ((data ?? []) as unknown) as T[];
}

export async function adminListCheckers(): Promise<CheckerAdminRow[]> {
  const { data, error } = await supabase.rpc('admin_list_checker_accounts' as never);
  if (error) throw error;
  return rpcRows<CheckerAdminRow>(data);
}

/** Returns the new checker's user id. Throws if no account exists for that
 *  email (an admin cannot invite someone who has never signed up) or if
 *  they are already a checker -- both are server-side decisions this
 *  module does not duplicate, only surfaces via the thrown error. */
export async function adminAddChecker(email: string): Promise<string> {
  const trimmed = email.trim();
  const { data, error } = await supabase.rpc('admin_add_checker' as never, { p_email: trimmed } as never);
  if (error) throw error;
  return data as unknown as string;
}

export async function adminRemoveChecker(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_remove_checker' as never, { p_user_id: userId } as never);
  if (error) throw error;
}

/** Accounts whose name or email matches (at least two letters). The same
 *  search the Paper review checkers tab used (admin_search_users), so there is
 *  one way to find a person. */
export async function adminSearchAccounts(query: string): Promise<UserSearchRow[]> {
  return adminSearchUsers(query);
}

export interface CheckerAdminApi {
  searchUsers: typeof adminSearchAccounts;
  listCheckers: typeof adminListCheckers;
  addChecker: typeof adminAddChecker;
  removeChecker: typeof adminRemoveChecker;
}

export const realCheckerAdminApi: CheckerAdminApi = {
  searchUsers: adminSearchAccounts,
  listCheckers: adminListCheckers,
  addChecker: adminAddChecker,
  removeChecker: adminRemoveChecker,
};
