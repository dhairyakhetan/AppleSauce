/**
 * In-memory fake of the "Ask HOD for more papers" functions for dummy mode. Test builds only (see src/lib/dummy-mode.ts),
 * reached solely through the PREVIEW_TOOLS-gated lazy imports of the HOD desk and the checker page. Every person here is
 * MADE UP and nothing touches Supabase.
 *
 * It copies the rules the screens lean on: one open ask per person (tapping again says "already asked"), the HOD list is
 * oldest first, and clearing one makes it disappear. The made-up checker on the checker page is "Asha Reviewer".
 */

import type { PaperAsksApi } from '@/lib/paper-asks-api';
import type { PaperAsk } from '@/lib/paper-asks';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const ME_ASK_ID = 'a5000000-0000-4000-8000-0000000000a1';

export interface FakePaperAsksApi extends PaperAsksApi {
  reset(): void;
}

export function createFakePaperAsksApi(): FakePaperAsksApi {
  let asks: PaperAsk[] = [];
  const seed = () => {
    asks = [
      { ask_id: 'a5000000-0000-4000-8000-0000000000b1', user_id: 'a5000000-0000-4000-8000-0000000000c1', name: 'Rohan Verma', asked_at: ago(26 * 60), finished_recently: 3 },
      { ask_id: 'a5000000-0000-4000-8000-0000000000b2', user_id: 'a5000000-0000-4000-8000-0000000000c2', name: 'Meera Iyer', asked_at: ago(95), finished_recently: 1 },
    ];
  };
  seed();

  return {
    reset: seed,
    async ask() {
      if (asks.some((a) => a.ask_id === ME_ASK_ID)) return 'already_asked';
      asks = [...asks, { ask_id: ME_ASK_ID, user_id: 'a5000000-0000-4000-8000-0000000000c0', name: 'Asha Reviewer', asked_at: new Date().toISOString(), finished_recently: 2 }];
      return 'asked';
    },
    async mine() {
      return asks.find((a) => a.ask_id === ME_ASK_ID)?.asked_at ?? null;
    },
    async list() {
      return [...asks].sort((a, b) => (a.asked_at ?? '').localeCompare(b.asked_at ?? ''));
    },
    async dismiss(id) {
      asks = asks.filter((a) => a.ask_id !== id);
    },
  };
}
