import type { HodVerifierProfile } from '@/lib/hod-api';

/* Which verifiers still lack details, for the Verifiers list. Joins the
   verifier accounts (admin_list_checker_accounts) with their profiles
   (hod_verifier_profiles). The profiles read is allowed to fail: then every
   state is "unknown" and the page says so, rather than calling everyone
   "Missing". */

export type DetailsState = 'missing' | 'expired' | 'ready' | 'unknown';

export const DETAILS_LABEL: Record<DetailsState, string> = {
  missing: 'Missing',
  expired: 'Expired',
  ready: 'Ready',
  unknown: 'Not known',
};

/** Missing is checked before expired, the same order the HOD desk uses. */
export function detailsState(profile: HodVerifierProfile | undefined, profilesLoaded: boolean): DetailsState {
  if (!profilesLoaded) return 'unknown';
  if (!profile) return 'missing';
  if (profile.missing) return 'missing';
  if (profile.expired) return 'expired';
  return 'ready';
}

export function profilesById(profiles: HodVerifierProfile[] | null): Map<string, HodVerifierProfile> {
  return new Map((profiles ?? []).map((p) => [p.user_id, p]));
}

const RANK: Record<DetailsState, number> = { missing: 0, expired: 1, unknown: 2, ready: 2 };

/** Missing first, then expired, then everyone else in the order given. */
export function sortByDetails<T>(rows: T[], stateOf: (row: T) => DetailsState): T[] {
  return rows
    .map((row, i) => ({ row, i, rank: RANK[stateOf(row)] }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.row);
}

/** How many need an admin to fill in or renew details. */
export function needDetailsCount(states: DetailsState[]): number {
  return states.filter((s) => s === 'missing' || s === 'expired').length;
}

/** "2 verifiers still need details", "1 verifier still needs details", or "". */
export function needDetailsText(n: number): string {
  if (n <= 0) return '';
  return n === 1 ? '1 verifier still needs details' : `${n} verifiers still need details`;
}
