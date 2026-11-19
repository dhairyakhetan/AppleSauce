import type { UserProfile } from '@/lib/auth-context';

/** What one try at reading the profile row gives back. Mirrors what the
 *  Supabase client returns: it usually reports a failure in `error` rather
 *  than throwing. */
export interface ProfileFetchResult {
  data: { role: string | null; full_name: string | null; terms_agreement?: boolean | null } | null;
  error?: unknown;
}

export interface ProfileFetchOutcome {
  profile: UserProfile | null;
  /** True when every try failed (network or server trouble). False when the
   *  database answered, even if it said "no such row". */
  failed: boolean;
}

/** Waits before try 2 and try 3. Short, so a person is not left staring at a
 *  blank menu, but long enough for a wobbly connection to come back. */
export const PROFILE_RETRY_DELAYS_MS = [800, 2500];

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Read a user's profile, trying again when the read itself fails.
 *
 * Why this exists: a single failed read used to leave the person looking like
 * they had no role (no Verify link, no Desk) until they reloaded the page,
 * because the page had already marked this person as "done".
 *
 * An honest "no row" answer is NOT retried: the database replied, so trying
 * again would give the same reply.
 */
export async function fetchProfileWithRetry(
  fetchOnce: () => PromiseLike<ProfileFetchResult>,
  options: {
    delays?: number[];
    sleep?: (ms: number) => Promise<void>;
    /** Return true to stop retrying (for example the person signed out). */
    isCancelled?: () => boolean;
  } = {},
): Promise<ProfileFetchOutcome> {
  const delays = options.delays ?? PROFILE_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? wait;
  const isCancelled = options.isCancelled ?? (() => false);

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const { data, error } = await fetchOnce();
      if (!error) {
        if (!data) return { profile: null, failed: false };
        return {
          profile: { role: data.role, full_name: data.full_name, terms_agreement: data.terms_agreement ?? undefined },
          failed: false,
        };
      }
    } catch {
      // A thrown failure counts the same as a reported one: try again.
    }
    if (attempt < delays.length) {
      await sleep(delays[attempt]);
      if (isCancelled()) return { profile: null, failed: true };
    }
  }
  return { profile: null, failed: true };
}
