/**
 * What "peek at the next questions" means when there is no peek function to
 * call: dummy mode, where nothing may reach Supabase. It reads the paper's
 * own list of questions instead (still the in-memory fake) and answers in the
 * shape of verifier_peek_next_in_paper, so the same screen code runs.
 */

import type { CheckerApi, PeekedQuestion } from '@/lib/checker-api';
import type { PrefetchDeps } from '@/lib/checker-prefetch';

export function peekFromList(api: Pick<CheckerApi, 'paperQuestions'>): PrefetchDeps['peek'] {
  return async (paperId, count): Promise<PeekedQuestion[]> => {
    const rows = await api.paperQuestions(paperId);
    return rows
      .filter((r) => r.state === 'to_verify')
      .sort((a, b) => a.ord - b.ord)
      .slice(0, Math.max(1, count))
      .map((r, i) => ({
        id: r.id,
        ord: r.ord,
        display_number: r.display_number,
        page: r.page,
        page_path: r.page_path,
        snippet_path: r.snippet_path,
        // The first open question is the one on screen.
        held_by_me: i === 0,
      }));
  };
}

/** Prefetch dependencies that never touch the network: no signing, no preload. */
export function offlinePrefetchDeps(api: Pick<CheckerApi, 'paperQuestions'>): Partial<PrefetchDeps> {
  return {
    peek: peekFromList(api),
    signMany: async () => new Map<string, string>(),
    preload: async () => {},
  };
}
