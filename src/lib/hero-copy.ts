/* Handoff H-005 — the home hero's copy resolver.
   One pure function, no new query: branches 1-2 read the useAuth() profile
   the page already holds, 3-5 read the intent store's lastSearch/lastTeacher/
   lastPaper records (src/lib/intent/store.ts) — the same single envelope
   TeacherProfile/PaperReader/SearchControl/the sentence builder/Browse all
   write into via recordSignal(), rather than three raw localStorage keys of
   its own. 6 is a session-stable random pool.

   Phase 2 of the intent index: this file used to read
   shikshaq.lastSearch/shikshaq.lastViewedTeacher/shikshaq.lastPaperSubject
   directly. Those are now sub-records of shikshaq.intent.v1 (still mirrored
   back to the old keys during the dual-write release), and reading the store
   module instead of the raw keys is what lets the hero and every later
   adaptive surface agree about who the visitor is, rather than each guessing
   from its own copy of the same three keys.

   ⚠ Branch 1b's copy calls for a gendered pronoun ("message her/him?") that
   the app has no reliable source for; "message them?" is used instead rather
   than guessing a gender. */

import {
  readStore,
  THIRTY_DAYS_MS as STORE_THIRTY_DAYS_MS,
  type StoredLastPaper,
  type StoredLastSearch,
  type StoredLastTeacher,
} from '@/lib/intent/store';

export type HeroMode = 'teachers' | 'papers';
export type HeroChip = 'avatar' | 'stripe' | 'cover' | null;

export interface HeroCopy {
  eyebrow: string;
  /** Plain text before the bold span. */
  before: string;
  /** The single font-extrabold span. */
  bold: string;
  /** Plain text after it. */
  after: string;
  chip: HeroChip;
  mode: HeroMode;
  /** Where the bold span points, when it names something reachable — a
   *  teacher's profile or a filtered list. Null for lines that name nothing. */
  href?: string | null;
  /** Set only when the bold span names one specific teacher AND a photo for
   *  that exact person is in hand. The chip must never fall back to some
   *  other teacher's photo when a name is on screen — showing person A's
   *  face next to person B's name is worse than showing no photo at all. */
  imageUrl?: string | null;
}

export interface ResolveHeroCopyInput {
  profile: { full_name?: string | null } | null | undefined;
  /** From useLikes().likedCount. */
  likedCount: number;
  /**
   * Only meaningful when likedCount === 1. The caller resolves this from
   * whatever teacher data the page already holds (e.g. the featured list) —
   * H-005 adds no new query, so when the single liked teacher isn't already
   * in hand this is left undefined and branch 1b falls through to 2.
   */
  likedSingleTeacherName?: string | null;
  /** Same source as likedSingleTeacherName — the one saved teacher's own
   *  photo, so branch 1b's chip never borrows an unrelated teacher's face. */
  likedSingleTeacherImageUrl?: string | null;
  /**
   * `experience.level !== 'none'` from useIntent() — the same route-aware,
   * confidence-gated bit every other adaptive surface (InlinePapersNudge,
   * PreFooter B1, Index's own CTA) reads before acting on the trail.
   *
   * Branches 1/1b/2 are unaffected: those speak from the reader's OWN account
   * facts (their name, their saved list), not an inference, so there is
   * nothing there to gate. Branches 3-5 are different — they read
   * lastSearch/lastTeacher/lastPaper, which is exactly the same behavioural
   * trail resolveIntent() scores, just reached via readStore() directly
   * instead of through confidence. A single teacher view earns roughly 0.28
   * there, under THRESHOLD.copy's 0.4 — so before this flag, the site's
   * single most visible line personalised off signals the guardrailed
   * surfaces right below it on the same page would not yet act on. Missing
   * or undefined fails closed (no trail line), matching every other
   * guardrail's fail-closed default. */
  trailAdaptationAllowed?: boolean;
}

const SESSION_KEY = 'shikshaq.heroLine';
/** The last line shown, so the next visit can step past it. */
const LAST_LINE_KEY = 'shikshaq.heroLastLine';
/** Advances once per visit so the trail lines cycle rather than alternate. */
const ROTATION_KEY = 'shikshaq.heroRotation';

const POOL: Array<{ before: string; bold: string; after: string }> = [
  { before: 'Who is ', bold: 'teaching your child', after: ' this term?' },
  { before: "Tell us the subject. ", bold: "We'll show you who teaches it", after: ' nearby.' },
  { before: 'Every tutor here is ', bold: 'someone a parent already met', after: '.' },
  { before: 'Find the teacher, ', bold: 'message them yourself', after: '. No agent in between.' },
  { before: 'Which subject is ', bold: 'giving you trouble', after: ' this year?' },
  { before: 'Start where most parents start: ', bold: 'a name and an area', after: '.' },
  /* Additions past the handoff's six. H-005a governs these: second person,
     exactly one bold span, three lines max at 375px, no inventory boasting,
     session-stable (the index is still drawn once, below).

     Tone note: the brief asked for flirty. These are cheeky rather than
     flirty, because the reader is often a parent choosing who sits with
     their child for an hour a week — warmth lands there, a come-on does not.
     Same playfulness, aimed at the subject instead of the person. */
  { before: 'Still Googling ', bold: '"tuition near me"', after: '? You can stop now.' },
  { before: 'That one chapter ', bold: 'nobody understands', after: '?' },
  { before: 'Homework at midnight is ', bold: 'a solvable problem', after: '.' },
  { before: 'Somewhere in Kolkata, ', bold: 'someone loves physics', after: '.' },
  { before: 'Boards are coming. ', bold: 'Pretending otherwise', after: ' is not a plan.' },
  { before: 'Chemistry going badly? ', bold: 'You are not the first', after: '.' },
  { before: 'Ask around, or ', bold: 'just ask here', after: '. Both work.' },
  { before: 'The right teacher makes ', bold: 'one subject bearable', after: '. Start there.' },
];

function isFresh(at: number | undefined): boolean {
  return typeof at === 'number' && Date.now() - at < STORE_THIRTY_DAYS_MS;
}

// H-005a rule 4: counts under ten are spelled out.
const SPELLED = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function spellOut(n: number): string {
  return n < 10 ? SPELLED[n] : String(n);
}

function greetingTime(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function weekday(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' });
}

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

/** Draws the branch-6 pool index once per session (sessionStorage), so the
 *  line never changes on re-render or client-side nav back home. */
function sessionPoolIndex(): number {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    const parsed = stored === null ? NaN : Number(stored);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed < POOL.length) return parsed;
    const index = Math.floor(Math.random() * POOL.length);
    sessionStorage.setItem(SESSION_KEY, String(index));
    return index;
  } catch {
    return 0;
  }
}

export function resolveHeroCopy({ profile, likedCount, likedSingleTeacherName, likedSingleTeacherImageUrl, trailAdaptationAllowed }: ResolveHeroCopyInput): HeroCopy {
  const name = profile?.full_name ? firstNameOf(profile.full_name) : null;

  // Branch 1 — signed in, multiple saved teachers.
  if (name && likedCount > 1) {
    return {
      eyebrow: 'Your shortlist',
      before: `${name}, `,
      bold: `${spellOut(likedCount)} saved tutors`,
      after: " haven't heard from you yet",
      chip: 'stripe',
      mode: 'teachers',
    };
  }

  // Branch 1b — signed in, exactly one saved teacher whose name is in hand.
  if (name && likedCount === 1 && likedSingleTeacherName) {
    return {
      eyebrow: 'Your shortlist',
      before: `${name}, you saved `,
      bold: likedSingleTeacherName,
      after: '. Message them?',
      chip: 'stripe',
      mode: 'teachers',
      imageUrl: likedSingleTeacherImageUrl,
    };
  }

  // Branch 2 — signed in, name known.
  if (name) {
    return {
      eyebrow: `${weekday()} ${greetingTime()}`,
      before: `Hello \u{1F44B} ${name}, `,
      bold: 'what are we finding',
      after: ' today?',
      chip: 'avatar',
      mode: 'teachers',
    };
  }

  /* Branches 3-5, rewritten as a CANDIDATE SET rather than a precedence chain.

     Strict precedence meant one visitor saw the identical "You looked at
     {name} last time. Still deciding?" on every single visit for thirty days,
     which is both monotonous and reads like being watched. Now every piece of
     trail data contributes two or three phrasings, subject-led ones included,
     and the session index picks among them — so the line varies between
     visits while staying fixed within one, which is what H-005a rule 7 asks.

     Each candidate carries an href, so the bold span is the way through to the
     thing it names instead of a dead mention. */
  const candidates: HeroCopy[] = [];

  // One read of the shared envelope instead of three separate localStorage
  // keys — this is the actual point of phase 2: the hero now sees exactly
  // the same lastSearch/lastTeacher/lastPaper records every other adaptive
  // surface writes and reads, rather than a copy of its own. readStore()
  // already fails closed (returns the empty envelope) on unreadable storage,
  // so the try/catch readJSON used to do is handled once, upstream.
  //
  // Read only when trailAdaptationAllowed: left null otherwise, which empties
  // every candidate list below and falls the whole branch through to 6 — the
  // same generic pool a first-time visitor sees. That is the guardrail: it is
  // enforced once, here, rather than re-checked at each of the three trail
  // sources below.
  let store: ReturnType<typeof readStore> | null = null;
  if (trailAdaptationAllowed) {
    try {
      store = readStore();
    } catch {
      store = null;
    }
  }

  const lastSearch: StoredLastSearch | null = store?.lastSearch ?? null;
  if (lastSearch && isFresh(lastSearch.at) && lastSearch.subject && lastSearch.area) {
    const subjectClass = lastSearch.classLevel ? `${lastSearch.subject} ${lastSearch.classLevel}` : lastSearch.subject;
    const href = `/all-tuition-teachers-in-kolkata?filter_subjects=${encodeURIComponent(lastSearch.subject)}&filter_areas=${encodeURIComponent(lastSearch.area)}`;
    candidates.push(
      {
        eyebrow: 'Where you left off',
        before: 'Still looking for ',
        bold: subjectClass,
        after: ` in ${lastSearch.area}?`,
        chip: 'avatar', mode: 'teachers', href,
      },
      {
        eyebrow: lastSearch.subject,
        before: 'Pick up your ',
        bold: `${lastSearch.subject} search`,
        after: ` in ${lastSearch.area}.`,
        chip: null, mode: 'teachers', href,
      },
    );
  }

  const lastViewedTeacher: StoredLastTeacher | null = store?.lastTeacher ?? null;
  if (lastViewedTeacher && isFresh(lastViewedTeacher.at) && lastViewedTeacher.name) {
    const t = lastViewedTeacher;
    // Prefer a direct profile link over the old name-search query — a slug
    // lands exactly on that teacher; a `q=` search can land on someone else
    // entirely when names collide or partially match.
    const teacherHref = t.slug
      ? `/tuition-teachers/${t.slug}`
      : `/all-tuition-teachers-in-kolkata?q=${encodeURIComponent(t.name!)}`;
    candidates.push(
      {
        eyebrow: 'Where you left off',
        before: 'You looked at ',
        bold: t.name!,
        after: ' last time. Still deciding?',
        chip: 'stripe', mode: 'teachers', href: teacherHref, imageUrl: t.imageUrl,
      },
      {
        // Was "{name} is a message away." — read as pushy/surveillance-y
        // ("we noticed, go message them now"), rather than a soft reminder.
        eyebrow: 'Still on your list',
        before: '',
        bold: t.name!,
        after: ' is still here, whenever you are ready.',
        chip: 'stripe', mode: 'teachers', href: teacherHref, imageUrl: t.imageUrl,
      },
      {
        eyebrow: t.area ? t.area : 'Near you',
        before: 'Pick up where you left off with ',
        bold: t.name!,
        after: '.',
        chip: null, mode: 'teachers', href: teacherHref, imageUrl: t.imageUrl,
      },
    );
    if (t.subject) {
      candidates.push({
        eyebrow: t.subject,
        before: 'More ',
        bold: `${t.subject} teachers`,
        after: t.area ? ` around ${t.area}.` : ' in Kolkata.',
        chip: null, mode: 'teachers',
        href: `/all-tuition-teachers-in-kolkata?filter_subjects=${encodeURIComponent(t.subject)}`,
      });
    }
  }

  const lastPaperSubject: StoredLastPaper | null = store?.lastPaper ?? null;
  if (lastPaperSubject && isFresh(lastPaperSubject.at) && lastPaperSubject.board && lastPaperSubject.subject) {
    const lp = lastPaperSubject;
    candidates.push(
      {
        eyebrow: 'Past papers',
        before: 'Two papers open in ',
        bold: `${lp.board} ${lp.subject}`,
        after: '. Want a tutor for it?',
        chip: 'cover', mode: 'papers',
        href: `/past-papers/results?filter_boards=${encodeURIComponent(lp.board!)}&filter_subjects=${encodeURIComponent(lp.subject!)}`,
      },
      {
        eyebrow: lp.subject!,
        before: 'Revising ',
        bold: lp.subject!,
        after: `? There are more ${lp.board} papers.`,
        chip: null, mode: 'papers',
        href: `/past-papers/results?filter_subjects=${encodeURIComponent(lp.subject!)}`,
      },
    );
  }

  if (candidates.length > 0) {
    /* Rotate, and never twice running. The session index alone still landed on
       the same sentence visit after visit, so a returning reader met "You
       looked at {name} last time. Still deciding?" every single time for a
       month, which is the opposite of a greeting. Remembering the last line
       and stepping past it guarantees the wording moves even when the trail
       itself has not. */
    const key = (c: HeroCopy) => `${c.eyebrow}|${c.bold}`;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_LINE_KEY);
    } catch {
      last = null;
    }
    const fresh = candidates.filter((c) => key(c) !== last);
    const pool = fresh.length > 0 ? fresh : candidates;
    /* A counter that advances every visit, not the fixed session index — with
       the index frozen, "never the same as last time" just alternated between
       two lines forever. Advancing walks the whole set. */
    let turn = 0;
    try {
      turn = Number(localStorage.getItem(ROTATION_KEY) ?? '0') || 0;
      localStorage.setItem(ROTATION_KEY, String((turn + 1) % 1000));
    } catch {
      turn = sessionPoolIndex();
    }
    const picked = pool[turn % pool.length];
    try {
      localStorage.setItem(LAST_LINE_KEY, key(picked));
    } catch {
      /* private mode: rotation falls back to the session index alone. */
    }
    return picked;
  }


  // Branch 6 — the pool, resolved once per session.
  const line = POOL[sessionPoolIndex()];
  return {
    eyebrow: 'Tuition in Kolkata',
    before: line.before,
    bold: line.bold,
    after: line.after,
    chip: 'avatar',
    mode: 'teachers',
  };
}

/** The hero while the search desk is set to past papers.
 *  Every H-005 branch except 5 resolves teacher-flavoured copy, so without
 *  this the greeting sat still while the desk beneath it changed subject —
 *  which made the toggle read as decoration. Keeps the reader's first name
 *  when the base copy had one, so being signed in still shows. */
export function papersHeroCopy(
  base: HeroCopy,
  profile: { full_name?: string | null } | null | undefined,
): HeroCopy {
  if (base.mode === 'papers') return base;
  const name = profile?.full_name ? firstNameOf(profile.full_name) : null;
  return {
    eyebrow: 'Past papers',
    before: name ? `${name}, revise from ` : 'Revise from ',
    bold: 'real board papers',
    after: ' from schools across India',
    chip: null,
    mode: 'papers',
  };
}
