/**
 * bank_papers.school is free text typed at import time, straight from a
 * question paper's cover page. A lot of it is a fragment ("Jasudben Jml
 * Hist", "Poddar Sa1"), an abbreviation (MPBFHS, KVS), a duplicate spelling
 * ("Parle Tilak" / "PARLE TILAK Vidyalaya"), or not a school at all
 * ("History", "Graphs"). This module turns that raw text into something a
 * parent or student can actually read.
 *
 * DISPLAY ONLY. Nothing here writes to the database; `bank_papers.school`
 * itself is untouched, and so is question text. Routing stays on the raw
 * value (`schoolSlug()` in school-slug.ts keys off the raw string), and any
 * `school` filter carried in a URL keeps the raw value too — `rawSchoolsFor()`
 * below is how a facet resolves one display label back to every raw value it
 * covers, so a merged label still filters (and searches) completely.
 *
 * The map was built from the 190 distinct raw values live in `bank_papers`
 * (2026-09-27), each looked up against the school's own site or a directory
 * listing that named board + city, per docs/CRAFT.md and the owner's
 * "maximum visibility, no guessing" brief. The full raw -> display table with
 * sources lives in the audit scratchpad, not in the repo.
 */

/** Raw value -> the display label it should show as. Keys are matched
 *  case-sensitively against the exact string bank_papers.school holds. */
const SCHOOL_DISPLAY_MAP: Record<string, string> = {
  // ---- not a school at all -------------------------------------------
  'Unnamed school': 'School not recorded',
  'School not recorded': 'School not recorded',
  // Board papers are not a school but ARE a true, useful source line: the
  // card says "ICSE board paper". Keep them exactly as stored.
  'ICSE board paper': 'ICSE board paper',
  'CBSE board paper': 'CBSE board paper',
  'ISC board paper': 'ISC board paper',
  'History': 'School not recorded',
  'Graphs': 'School not recorded',
  'Consumer Awareness': 'School not recorded',
  'Inflation Mcqs': 'School not recorded',
  'Public Revenuepublic Expenditurepublic Debt Mcqs': 'School not recorded',
  'Brugesh Sir': 'School not recorded',
  'Cag Hcg1': 'School not recorded',
  'Contemprary World': 'School not recorded',
  'Hist': 'School not recorded',

  // ---- abbreviations expanded with a confirmed source -----------------
  'MPBFHS': 'M. P. Birla Foundation Higher Secondary School',
  'KVS': 'Kendriya Vidyalaya Sangathan',
  'Kendriya Vidyalaya Sangathan': 'Kendriya Vidyalaya Sangathan',
  /* ASC and CBS: reverted. Both were only ever a "natural initialism" guess
     (ASC = Assembly of Christ School, CBS = Calcutta Boys' School) with no
     citation tying THIS abbreviation to that school -- and both sit among a
     run of unresolved Mumbai-batch abbreviations (HCS, NSM, Dbpc, Aass...)
     while the guessed schools are Kolkata ones, which is exactly the kind of
     coincidental-initials mismatch the "no guessing" brief warns against.
     Shown as themselves, cleaned, like every other unresolved abbreviation. */
  'Assembly of Christ School': 'Assembly of Christ School',
  'Jbcn': 'JBCN International School',
  'LFS': 'Lokhandwala Foundation School',
  'Lokhandwala Lfs': 'Lokhandwala Foundation School',
  /* FAPS: reverted for the same reason as ASC/CBS -- "The Frank Anthony
     Public School" being a live raw value elsewhere in the bank is not
     evidence FAPS is ITS abbreviation rather than another school's; no
     citation ties this initialism to this school. Shown as itself. */
  'The Frank Anthony Public School': 'The Frank Anthony Public School',
  'Jml': 'Jasudben M. L. School',
  'Jasudben Jml Hist': 'Jasudben M. L. School',
  'FM Tutorials JML': 'Jasudben M. L. School',
  'Sgvp': 'SGVP International School',
  'Hvb': 'Hvb Global Academy',
  'Hvb Global Academy': 'Hvb Global Academy',
  'Dhirubai': 'Dhirubhai Ambani International School',
  'Dhirubhai Ambani International School': 'Dhirubhai Ambani International School',

  // ---- duplicate spellings / casings merged to one label --------------
  'Parle Tilak': 'Parle Tilak Vidyalaya',
  'PARLE TILAK Vidyalaya': 'Parle Tilak Vidyalaya',
  'Euro School': 'EuroSchool',
  'EuroSchool': 'EuroSchool',
  "Calcutta Boys' School": "Calcutta Boys' School",
  'Calcutta Boys’ School': "Calcutta Boys' School", // curly apostrophe variant
  'Delhi Public School Newtown': 'Delhi Public School, Newtown',
  'Delhi Public School, Newtown': 'Delhi Public School, Newtown',
  'Delhi Public School Megacity': 'Delhi Public School, Megacity',
  'Delhi Public School, Megacity': 'Delhi Public School, Megacity',
  'St. Xaviers Collegiate School': "St. Xavier's Collegiate School",
  "St. Xavier's Collegiate School": "St. Xavier's Collegiate School",
  'Ryan Intl': 'Ryan International School',
  'Ryan Intl Hist': 'Ryan International School',
  'Ryan International School': 'Ryan International School',
  'Gregorios': 'St. Gregorios High School',
  'St Gregorios': 'St. Gregorios High School',
  'St. Gregorios High School': 'St. Gregorios High School',
  'Sulochanadevi': 'Sulochanadevi Singhania School',
  'Sulochanadevi Singhania School': 'Sulochanadevi Singhania School',
  'Cathedra John': 'The Cathedral and John Connon School',
  'The Cathedral and John Connon School': 'The Cathedral and John Connon School',
  'B D Bhuta': 'B. D. Bhuta High School',
  'Bhuta High School': 'B. D. Bhuta High School',
  /* "Champion" reverted -- no source confirms it is a typo/OCR variant of
     "Campion School" rather than a genuinely different (or non-) school;
     shown as itself. "Campion" alone is not a guess: it is already the
     correctly-spelled name of the real Mumbai ICSE school, just missing
     the word "School". */
  'Campion': 'Campion School',
  'Hist Billabong': 'Billabong High International School',
  'Billabong High International School': 'Billabong High International School',
  'Arya Vidya Mandir Hc': 'Arya Vidya Mandir',
  'Greenlawns Hc': 'Greenlawns High School',
  'Jamanabai Historycivics': 'Jamnabai Narsee School',
  'Jamnabai Narsee School': 'Jamnabai Narsee School',
  'J B Petite Hc': 'J. B. Petit High School for Girls',
  'J. B. Petit High School for Girls': 'J. B. Petit High School for Girls',
  'Pawar Kandivali And': 'Pawar Public School, Kandivali',
  'And Hiranandani': 'Hiranandani Foundation School',
  'And St Francis': 'St. Francis Xavier School',
  'St. Francis Xavier School': 'St. Francis Xavier School',
  'St Johns And': "St. John's School",
  'St Mary And': "St. Mary's School",
  'St Mary': "St. Mary's School",
  "St Mary'S School": "St. Mary's School",
  'The Brigade History And Civics': 'The Brigade School',
  'Se Rly Kgp Historycivics': 'South Eastern Railway School, Kharagpur',
  'Vsn &': 'S. M. Vissanji Academy',
  'S.M. Vissanji Academy': 'S. M. Vissanji Academy',
  'Vissanji Academy': 'S. M. Vissanji Academy',
  'Tffs &': 'TFFS',
  'Tffs': 'TFFS',
  'Poddar Sa1': 'Poddar',
  'Ramniwas Bajaj Preliem': 'Ramniwas Bajaj',

  // ---- straightforward completions / punctuation fixes -----------------
  'Mother Teresa Mission Higher Secondary S': 'Mother Teresa Mission Higher Secondary School',
  'Indira Gandhi Memorial Senior Secondary': 'Indira Gandhi Memorial Senior Secondary School',
  'Don Bosco School Bandel': 'Don Bosco School, Bandel',
  'Don Bosco School Siliguri': 'Don Bosco School, Siliguri',
  'Don Bosco School Liluah': 'Don Bosco School, Liluah',
  'Delhi Public School Ruby Park': 'Delhi Public School, Ruby Park',
  'Goldcrest High Vashi': 'Goldcrest High, Vashi',
  "Bishop Cotton Girls School": "Bishop Cotton Girls' School",

  // ---- confirmed full names for known abbreviations / short forms ------
  'Rbk School': 'R. B. K. School',
  'Shishuvan': 'The Shishuvan School',
  'Universal High': 'Universal High School',
  'Gd Somani': 'G. D. Somani Memorial School',
  'Maneckji': 'Maneckji Cooper Education Trust School',
  'Kapol Vidyanidhi Int': 'Kapol Vidyanidhi International School',
  'Hutchings': 'Hutchings High School and Junior College',
  'City International': 'City International School',
  'St Annes Fort': "St. Anne's High School, Fort",
  'Pawar Public': 'Pawar Public School',
  /* PPSC and GES: reverted, same reason as ASC/CBS/FAPS above -- both were
     a guess assembling initials against a live raw value's full name with
     no independent source tying THIS abbreviation to THAT specific school
     (or, for PPSC, that specific branch). Shown as themselves. */
  'St Agnes': 'St. Agnes School',
  'IES': 'Indian Education Society',
};

/** Groups of raw values that should render as one label, used so a facet can
 *  show a single option and still filter by every raw value it covers. Built
 *  from SCHOOL_DISPLAY_MAP by grouping keys whose value is identical — kept
 *  as a derived export (not a second hand-authored table) so the two can
 *  never drift apart. */
function buildGroups(): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [raw, display] of Object.entries(SCHOOL_DISPLAY_MAP)) {
    const list = groups.get(display);
    if (list) list.push(raw);
    else groups.set(display, [raw]);
  }
  return groups;
}

const DISPLAY_GROUPS = buildGroups();

/** Straight vs curly apostrophe: the live data leans straight (six raw
 *  values use it against three curly), so normalisation prefers the straight
 *  `'` and the map above is written that way throughout. */
function normaliseApostrophes(s: string): string {
  return s.replace(/[’‘]/g, "'");
}

function collapseSpaces(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function isAllLower(s: string): boolean {
  return /[a-z]/.test(s) && s === s.toLowerCase();
}

const SMALL_WORDS = new Set(['and', 'for', 'of', 'the', 'in', 'a', 'an']);

/** Title Case for a raw value that arrived ALL CAPS or all lowercase — the
 *  two shapes that are unambiguously "not a real casing", as opposed to a
 *  name that is deliberately mixed-case (St. Xaviers, EuroSchool). Small
 *  joining words stay lower unless they open the string. */
function titleCase(s: string): string {
  return s
    .split(' ')
    .map((word, i) => {
      if (word.length === 0) return word;
      const lower = word.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      // Keep apostrophes/periods intact; capitalise only the first letter.
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function lightNormalise(raw: string): string {
  let s = collapseSpaces(raw);
  s = normaliseApostrophes(s);
  /* ALL CAPS is deliberately NOT title-cased here: every raw value that
   *  reaches this fallback in ALL CAPS form (NPS, HCS, GHSJC, AIS SE...) is
   *  an unresolved abbreviation, and the owner's rule for those is to keep
   *  them "uppercased cleanly", not to guess a expansion by re-casing them
   *  into what would look like a normal name. Every raw value that IS a
   *  genuine ALL CAPS sentence (e.g. "PARLE TILAK Vidyalaya") already has an
   *  explicit entry in SCHOOL_DISPLAY_MAP above and never reaches here. */
  if (isAllLower(s)) s = titleCase(s);
  return s;
}

/**
 * Turn a raw `bank_papers.school` value into what the product should show.
 * Never returns an empty string: an unrecognised blank/null raw value falls
 * back to "School not recorded" like every other non-school fragment.
 */
export function displaySchool(raw: string | null | undefined): string {
  if (!raw) return 'School not recorded';
  const trimmed = raw.trim();
  if (!trimmed) return 'School not recorded';

  const mapped = SCHOOL_DISPLAY_MAP[trimmed];
  if (mapped) return mapped;

  // Try again against the apostrophe-normalised form, in case a raw value
  // not in the map above still carries a curly apostrophe variant of one
  // that is (defensive — every live curly variant is already keyed above).
  const normalisedKey = normaliseApostrophes(collapseSpaces(trimmed));
  const mappedNormalised = SCHOOL_DISPLAY_MAP[normalisedKey];
  if (mappedNormalised) return mappedNormalised;

  return lightNormalise(trimmed);
}

/**
 * All raw school values that render under one display label — the label a
 * user picks in the school facet, resolved back to the raw values a filter
 * needs to match to stay complete. Falls back to `[label]` itself for a
 * label that is not a merge target (the common case: one raw value, one
 * label unchanged from a light normalisation of it).
 */
export function rawSchoolsFor(label: string): string[] {
  /* A raw value equal to the label itself is always a member of its own
     group, even when it has no entry in SCHOOL_DISPLAY_MAP (the common
     case: a raw value that already IS its own display label, e.g. "Arya
     Vidya Mandir" sits alongside its mapped alias "Arya Vidya Mandir Hc").
     Without this, selecting a label whose bare/unqualified spelling was
     never itself a MAP KEY silently dropped that spelling's own papers from
     a "filter by every raw value this label covers" query. */
  const mapped = DISPLAY_GROUPS.get(label) ?? [];
  return Array.from(new Set([label, ...mapped]));
}

/** The merged label a raw value's facet bucket should be grouped and shown
 *  under — an alias of displaySchool(), named for facet-building call sites
 *  where "which bucket does this row belong to" reads more clearly than
 *  "what does this row display as". */
export function schoolDisplayGroups(raw: string | null | undefined): string {
  return displaySchool(raw);
}

/** Extra search terms a paper's raw school should also match on — the
 *  expanded/canonical name, so typing "Jamnabai Narsee" finds a paper whose
 *  raw school is "Jamanabai Historycivics". Returns [] when the display
 *  label is just a light normalisation of the raw value itself (nothing
 *  extra to add). */
export function schoolSearchTerms(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const display = displaySchool(raw);
  if (display === 'School not recorded') return [];
  if (display.toLowerCase() === raw.trim().toLowerCase()) return [];
  return [display];
}

/** True when a display label names an actual school, so it belongs in a
 *  school list or facet. Board-paper source lines ("ICSE board paper") and
 *  the "School not recorded" placeholder are true on a card but are not
 *  schools; the Board facet already covers the former. */
export function isRealSchoolLabel(label: string): boolean {
  return label !== 'School not recorded' && !/ board paper$/i.test(label);
}
