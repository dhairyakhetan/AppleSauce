/* The writers behind H-005's "where you left off" hero branches.

   As of the intent index this is a SHIM. The three keys it used to own
   (`shikshaq.lastSearch`, `shikshaq.lastViewedTeacher`,
   `shikshaq.lastPaperSubject`) are now sub-records of the single
   `shikshaq.intent.v1` envelope in src/lib/intent/store.ts, migrated on first
   read and still mirrored back to the old keys for one release.

   Every export below keeps its exact previous name, signature and behaviour,
   because hero-copy.ts and the footer sign-off read them and neither should
   have to know the storage moved. The shapes are unchanged too: the envelope
   holds each legacy record verbatim rather than merging them into something
   new, which is what makes this substitution safe.

   Deliberately still device-local, not a profile row: this is a convenience,
   it is worthless to us on a server, and a signed-out reader should get it
   too. Nothing here is sent anywhere. */

import { recordSignal } from '@/lib/intent/signals';
import { readStore, THIRTY_DAYS_MS } from '@/lib/intent/store';

/** Branch 3. Only recorded when there is something to say it back with:
 *  the branch needs BOTH a subject and an area, so a bare keyword search
 *  writes nothing rather than storing a half-line the hero can't use.
 *  That condition now lives in the signal recorder, which applies it
 *  identically. */
export function recordSearch(input: {
  subject?: string | null;
  classLevel?: string | null;
  area?: string | null;
}): void {
  recordSignal('search_submitted', {
    subject: input.subject,
    classLevel: input.classLevel,
    area: input.area,
  });
}

/** Branch 4. Name is the only field the branch requires; subject and area
 *  ride along because they cost nothing and future copy may want them.
 *  slug/imageUrl let the hero link straight to this teacher's own profile
 *  and show this teacher's own photo. */
export function recordViewedTeacher(input: {
  name?: string | null;
  subject?: string | null;
  area?: string | null;
  slug?: string | null;
  imageUrl?: string | null;
}): void {
  recordSignal('teacher_viewed', {
    name: input.name,
    subject: input.subject,
    area: input.area,
    id: input.slug,
    imageUrl: input.imageUrl,
  });
}

/** Branch 5. Needs both board and subject to read as a sentence. */
export function recordPaperSubject(input: {
  board?: string | null;
  subject?: string | null;
  count?: number;
}): void {
  recordSignal('paper_viewed', {
    board: input.board,
    subject: input.subject,
  });
}

export interface ActivityTrail {
  teacherName: string | null;
  searchSubject: string | null;
  searchArea: string | null;
  paperBoard: string | null;
  paperSubject: string | null;
}

function fresh(at: unknown): boolean {
  return typeof at === 'number' && Date.now() - at < THIRTY_DAYS_MS;
}

/** What the trail knows right now, for surfaces other than the hero (the
 *  footer sign-off). Same freshness window hero-copy.ts uses, so the two
 *  never disagree about whether a visit still counts. */
export function readActivityTrail(): ActivityTrail {
  let store;
  try {
    store = readStore();
  } catch {
    return {
      teacherName: null,
      searchSubject: null,
      searchArea: null,
      paperBoard: null,
      paperSubject: null,
    };
  }
  const s = store.lastSearch;
  const t = store.lastTeacher;
  const p = store.lastPaper;
  return {
    teacherName: t && fresh(t.at) ? t.name ?? null : null,
    searchSubject: s && fresh(s.at) ? s.subject ?? null : null,
    searchArea: s && fresh(s.at) ? s.area ?? null : null,
    paperBoard: p && fresh(p.at) ? p.board ?? null : null,
    paperSubject: p && fresh(p.at) ? p.subject ?? null : null,
  };
}
