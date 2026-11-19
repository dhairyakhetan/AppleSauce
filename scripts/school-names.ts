/* School name resolution — IMPORT TIME ONLY.
 *
 * This used to live in src/lib and ship to every visitor: a strip regex, an
 * alias map and ~30 unresolved abbreviations, downloaded by every browser so
 * it could re-derive the same school name on every page load, for data that
 * cannot change between deploys. It also meant correcting a school's name was
 * a code change and a deploy.
 *
 * Now it runs once, in scripts/import-bank.ts, and the resolved name is
 * written to bank_papers.school. The app reads that column. Renaming a school
 * is an UPDATE. None of this is in the client bundle any more.
 *
 * The bank's `school` field is derived from source filenames, so it arrives
 * abbreviated with paper-code fragments attached ("Avm Juhu Icse10 Preprelim",
 * "Cnms Mpe"). Two passes fix what can be fixed honestly:
 *
 *   1. strip the code fragments — filename residue, not part of a name
 *   2. expand only schools that are unambiguous, each one verified against
 *      the school's own site or its CISCE listing before being added
 *
 * Anything not in the map is left as the source had it, cleaned but not
 * invented. A wrong school name on a question paper is worse than a terse one,
 * so nothing here is a guess — see UNRESOLVED_SCHOOLS for what was deliberately
 * left alone.
 *
 * ⚠ Display only. The bank's own question data is never rewritten.
 */

/* Paper-code fragments that are filename residue rather than name.
 *
 * Four of these earned their place by splitting one school into several:
 *   `prelims?\d*`   "Children'S Academy Prelim01" kept the 01, because \b sits
 *                   between two word characters and so never matched
 *   `xii|xi|x|...`  a trailing class numeral: "Ariv X ...", "... Pfe Ii".
 *                   Longest-first, or `x` would match the front of `xii`
 *   `\d{1,4}`       a bare trailing digit, which made "Avm" and "Avm 6" two
 *                   different schools with one paper each
 *   `rehearsal`     this source's word for a mock ("Cbs Rehearsal X Maths")
 */
const CODE_FRAGMENTS =
  /\b(icse\s?10|icse|isc|cbse|maths?|mathematics|prelims?\d*|preprelim|pre\s?boards?|pre|prel|rehearsal|midterms?|term\s?\d*|\d?nd\s?term|unit|ut\s?\d+|s\d{2}|t\d{2}|a\d{2}|qp\d+|nov\d+|fpe|cpe|spe|mpe|pfe|pie|fre|question|questions|paper|sample|xii|xi|x|iii|ii|\d{1,4}(?:-\d{2})?)\b/gi;

/* cnms.ac.in brands itself "CNM School"; the registered name is Shree
   Chandulal Nanavati Vinay Mandir (ICSE, Vile Parle West). The bank spells it
   five ways -- Cnm, Cnms, C.N.M. School, Chandulal, Chandulal Nanavati -- which
   was five schools holding eight papers between them. One constant so they
   cannot drift apart again. */
const CNM = 'Chandulal Nanavati Vinay Mandir';

/** Only schools that are unambiguous. Terse entries stay terse on purpose. */
const SCHOOL_ALIASES: Record<string, string> = {
  // Kolkata
  'delhi public school joka': 'Delhi Public School, Joka',
  'dps megacity': 'Delhi Public School, Megacity',
  'dps newton': 'Delhi Public School, Newtown',
  'bhavans gangabux kanoria vidyamandir': "Bhavan's Gangabux Kanoria Vidyamandir",
  'la martiniere for boys': 'La Martiniere for Boys',
  'la martiniere for girls': 'La Martiniere for Girls',
  'don bosco park circus': 'Don Bosco School, Park Circus',
  'calcutta boys school': 'Calcutta Boys\u2019 School',
  // Mumbai
  cathedral: 'The Cathedral and John Connon School',
  'cathedral and john canon': 'The Cathedral and John Connon School',
  'dhirubhai ambani': 'Dhirubhai Ambani International School',
  dais: 'Dhirubhai Ambani International School',
  'bombay scottish': 'Bombay Scottish School',
  'bombay scottish mahim': 'Bombay Scottish School, Mahim',
  jamnabai: 'Jamnabai Narsee School',
  'jamnabai narsee': 'Jamnabai Narsee School',
  'j b petit': 'J. B. Petit High School for Girls',
  "children's academy": "Children's Academy",
  'childrens academy': "Children's Academy",
  gokuldham: 'Gokuldham High School',
  'gokuldham int': 'Gokuldham High School',
  'lilavatibai poddar high school': 'Lilavatibai Podar High School',
  'bai avabai framji petite first': 'Bai Avabai Framji Petit Girls\u2019 High School',
  'bai avabai': 'Bai Avabai Framji Petit Girls\u2019 High School',
  'thakur international school': 'Thakur International School',
  'chandulal nanavati': CNM,
  chandulal: CNM,
  vissanji: 'Vissanji Academy',
  'hfs powai': 'Hiranandani Foundation School, Powai',
  'hfs thane': 'Hiranandani Foundation School, Thane',
  'c.n.m. school': CNM,
  cnm: CNM,
  cnms: CNM,
  billabong: 'Billabong High International School',
  euroschool: 'EuroSchool',
  // Elsewhere
  'baldwin girls hs': 'Baldwin Girls\u2019 High School, Bengaluru',
  'greenwood high': 'Greenwood High International School, Bengaluru',
  'hyderabad public school': 'The Hyderabad Public School',
  'bishop westcott': 'Bishop Westcott School, Ranchi',
  'bhuta high school': 'Bhuta High School',

  /* Verified against each school's own site or its CISCE listing before being
     added here, because the whole point of this map is that it does not
     guess. Each of these was merging two ways at once: the abbreviation and
     the spelled-out name were separate schools with a paper or two each. */
  avm: 'Arya Vidya Mandir',
  'avm juhu': 'Arya Vidya Mandir, Juhu',
  orion: 'IES Orion, Dadar',
  'ies orion': 'IES Orion, Dadar',
  gea: 'Gundecha Education Academy, Kandivali',
  gundecha: 'Gundecha Education Academy, Kandivali',
  svis: 'Swami Vivekanand International School, Kandivali',
  'swami vivekanand': 'Swami Vivekanand International School, Kandivali',
  bhaktivedanta: 'Bhaktivedanta Swami Mission School',
  bss: 'Bombay Scottish School',
  bssm: 'Bombay Scottish School, Mahim',
  jns: 'Jamnabai Narsee School',

  /* Not expansions: an initialism the source never spelled out reads as a
     typo in Title Case ("Nps", "Ghsjc"). Printing it as an initialism says
     "abbreviation we could not resolve" instead, which is the truth. Listed
     one by one rather than upper-casing every short label, because "Apex"
     and "Ariv" are words, not initials. */
  ais: 'AIS',
  'ais se': 'AIS SE',
  asc: 'ASC',
  cbs: 'CBS',
  dbcs: 'DBCS',
  faps: 'FAPS',
  ges: 'GES',
  ghsjc: 'GHSJC',
  hcs: 'HCS',
  ies: 'IES',
  jgs: 'JGS',
  lfs: 'LFS',
  lml: 'LML',
  nps: 'NPS',
  nsm: 'NSM',
  pis: 'PIS',
  ppsc: 'PPSC',
  rbs: 'RBS',
};

/** Placeholders the bank uses when it could not read a school at all. */
const NO_SCHOOL = /^(unknownschool|unknown school|unknown)$/i;

/* Values in the school column that are not schools. "Graphs Question" is a
   topic file and "Brugesh Sir" is a tutor; both were being given a school
   page of their own, and both were in the sitemap. */
/* The History & Civics / Economics banks put a topic in the school column on
   a handful of rows, so "Inflation Mcqs" and "Consumer Awareness" were being
   given a school page each and landing in the sitemap as thin pages. "Hist"
   is the subject abbreviated, not a school either. Matched on the cleaned
   label, so the mangled run-together heading is caught by its "mcqs" tail. */
const NOT_A_SCHOOL = /^(graphs?|brugesh sir|hist|.*\bmcqs?$|consumer awareness)$/i;

/** Names the source abbreviated past the point of safe expansion. */
export const UNRESOLVED_SCHOOLS = [
  // Initialisms printed as initialisms; nobody could tell us what they expand to.
  'AIS', 'AIS SE', 'ASC', 'CBS', 'DBCS', 'FAPS', 'GES', 'GHSJC', 'HCS', 'IES',
  'JGS', 'LFS', 'LML', 'MPBFHS', 'NPS', 'NSM', 'PIS', 'PPSC', 'RBS',
  // Words, but not ones that identify a school on their own.
  'Anubhuti', 'Apex', 'Ariv', 'Champion', 'Dr Mts Pune', 'Hare Krishna',
  'Hutchings', 'Internobilian', 'Podar', 'St Mary',
];

/** The name to print for a bank school. Display only. */
export function schoolLabel(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return 'Unnamed school';
  if (NO_SCHOOL.test(s)) return 'School not recorded';
  if (/^(icse|isc|cbse|igcse|ib)$/i.test(s)) return `${s.toUpperCase()} board paper`;

  const cleaned = s
    .replace(CODE_FRAGMENTS, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,.-]+$/, '')
    .trim();

  const key = (cleaned || s).toLowerCase();
  if (SCHOOL_ALIASES[key]) return SCHOOL_ALIASES[key];

  // Longest alias that the cleaned name starts with, so "Gokuldham Int" hits
  // "gokuldham" without "Gundecha Cpe" hitting anything it should not.
  const prefix = Object.keys(SCHOOL_ALIASES)
    .filter((k) => key === k || key.startsWith(`${k} `))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return SCHOOL_ALIASES[prefix];

  return cleaned || s;
}


/** A board-published paper (ICSE 2026), not a paper from any one school. */
export const isBoardPaper = (school: string | null | undefined): boolean =>
  /^(icse|isc|cbse|igcse|ib)$/i.test((school ?? '').trim());

/** Whether a row can be attributed to a named school at all. */
export const hasSchool = (school: string | null | undefined): boolean => {
  const s = (school ?? '').trim();
  if (!s || NO_SCHOOL.test(s) || isBoardPaper(s)) return false;
  // Tested against the cleaned label, because the raw value carries the
  // filename residue that hides it ("Graphs Question" -> "Graphs").
  return !NOT_A_SCHOOL.test(schoolLabel(s));
};
