/* The Class X Mathematics bank, as papers.

   193 individual ICSE/CBSE papers (6,912 questions across 66 schools). They
   are papers like any other on this site, so they belong IN the papers surface
   — listed on /past-papers, filterable on /past-papers/results, and each one
   opening at its own /past-papers/:id — not behind a separate browser of their
   own. The only thing that differs is the reading experience: these have
   structured questions, so the reader renders them as questions rather than
   embedding a scan.

   The bank lives in Supabase, in bank_papers and bank_questions, and is read
   from there. It used to be a 2.5MB JSON asset in public/, which meant every
   reader of one 40-question paper downloaded all 6,912 questions, and every
   correction to a school's name was a code change and a deploy. Now a listing
   reads 193 summary rows and a paper reads its own questions and nothing else.

   Both tables are world-readable for published papers, so none of this waits
   on a session — the library is open to anyone who lands on it.

   ⚠ Question text is byte-exact from the source and is never cleaned or
   retyped anywhere in this app. It is read from the column and rendered. */

import { supabase } from '@/integrations/supabase/client';
import { schoolSlug } from '@/lib/school-slug';
import { displaySchool, isRealSchoolLabel } from '@/lib/school-display';

/** One question, as the reader needs it. Paper-level facts live on BankPaper. */
export interface BankQuestion {
  i: string;              // stable id
  p: string;              // paper id
  n: string | null;       // printed number
  t: string;              // text, verbatim
  m: number | null;       // marks
  c: string | null;       // chapter
  ty: string | null;      // short | long | MCQ
  pg?: number;            // source page
  f?: string;             // figure filename
  o?: string[];           // options
  /** D66: the printed display number, when the checker/admin has recorded
   *  one -- distinct from `n`, which is the raw parsed number. Callers fall
   *  back to `n` when this is null, same rule BankPaper.tsx already used for
   *  its own runs-of-parts lettering. */
  dn?: string | null;
  /** D66: question-level instructions ("Answer any three of the following"),
   *  as distinct from the paper-level general_instructions on BankPaper. */
  instr?: string | null;
  /** How many minutes this ONE question is suggested to take -- distinct from
   *  the paper-level allowed_time_minutes. Most questions carry none. */
  stm?: number | null;
  /** A printed heading above a run of questions ("Section A"). Rendered once,
   *  when it differs from the previous question's, never repeated per row. */
  sec?: string | null;
  /** Rows sharing the same non-null value are OR-choices of each other
   *  ("Answer Q7 OR Q8"). Grouping key only -- never shown to the reader. */
  ag?: string | null;
  /** The printed label for this row within its alternative group ("OR",
   *  "Either", a repeated number) -- distinct from `ag`, which is the key. */
  al?: string | null;
  /** The id of the question this row is a printed sub-part of, when the
   *  source numbered it as one ("5" -> "5(a)", "5(b)"). Null for a top-level
   *  question or when no parent was recorded. */
  pid?: string | null;
  /** QUEUE_20261002: a question that is set aside, rejected or still being
   *  checked on a live paper. The RPC sends only `{held: true, number, ord}`
   *  for it -- no body, options or figure ever reach the browser -- and the
   *  page draws a short placeholder card in its place. */
  held?: boolean;
}

export interface BankPaper {
  id: string;
  /** The resolved display name, already expanded in the database. */
  school: string;
  /** What the source filename actually said. Kept for search, not for display. */
  schoolRaw: string | null;
  /** A board's own paper (ICSE 2026) rather than any one school's. */
  isBoardPaper: boolean;
  /** Whether this paper can be attributed to a named school at all. */
  hasSchool: boolean;
  year: string;
  exam: string;
  cls: string;
  /* Was the literal 'Mathematics' — true only while the bank held nothing
     else. bank_papers.subject is a plain text column, and the bank now also
     carries History & Civics and Economics. */
  subject: string;
  board: string;
  questionCount: number;
  marks: number;
  /** Listed and searchable (is_published is untouched), but not openable yet
   *  -- the reader shows a "Coming soon" notice instead of content. */
  needsReview: boolean;
  /** D66: minutes allowed for the whole paper, when recorded. */
  allowedTimeMinutes: number | null;
  /** D66: paper-level instructions ("Answer all questions in Section A"), as
   *  distinct from a single question's own `instr`. */
  generalInstructions: string | null;
  /** D66: a small note when the source paper itself was incomplete (missing
   *  pages, a cut-off scan, etc.) -- never a claim about question quality. */
  incompleteNote: string | null;
}

/* Several papers carry no year at all. The column is null in those cases;
   this keeps the old empty-string contract for callers that only ever ask the
   question through hasYear. */
export const hasYear = (y: string | null | undefined): boolean =>
  Boolean(y) && !String(y).startsWith('year-unknown');

/* ---------------------------------------------------------------------------
   Reading
--------------------------------------------------------------------------- */

const PAPER_COLUMNS =
  'id, school, school_raw, is_board_paper, has_school, year, exam, cls, subject, board, question_count, marks, needs_review, allowed_time_minutes, general_instructions, incomplete_note';

interface PaperRow {
  id: string;
  school: string;
  school_raw: string | null;
  is_board_paper: boolean;
  has_school: boolean;
  year: string | null;
  exam: string | null;
  cls: string;
  subject: string;
  board: string;
  question_count: number;
  marks: number;
  needs_review: boolean;
  allowed_time_minutes: number | null;
  general_instructions: string | null;
  incomplete_note: string | null;
}

const toPaper = (r: PaperRow): BankPaper => ({
  id: r.id,
  school: r.school,
  schoolRaw: r.school_raw,
  isBoardPaper: r.is_board_paper,
  hasSchool: r.has_school,
  year: r.year ?? '',
  exam: r.exam ?? '',
  cls: r.cls,
  /* Reads the column instead of asserting Mathematics. bank_papers.subject
     has always existed; the bank simply only held maths until the History &
     Civics and Economics banks landed. */
  subject: r.subject ?? 'Mathematics',
  board: r.board,
  questionCount: r.question_count,
  /* Number(): marks is a numeric column now (half marks are real), and
     PostgREST serialises numeric as a STRING to preserve precision. Without
     this the declared `marks: number` would quietly be "82.5". */
  marks: Number(r.marks) || 0,
  needsReview: r.needs_review,
  allowedTimeMinutes: r.allowed_time_minutes ?? null,
  generalInstructions: r.general_instructions ?? null,
  incompleteNote: r.incomplete_note ?? null,
});

let indexCache: Promise<BankPaper[]> | null = null;

const PAGE = 1000;

/* PostgREST caps an unbounded select at 1000 rows and returns them — no
   error, nothing to catch — so a query written before the table crossed
   that count silently starts dropping rows once it does. Confirmed live:
   the English import pushed published bank_papers past 1000 (1,282 today),
   and every one of them sorts undated-last, so the entire English release
   was landing past row 1000 and vanishing from every page reading this
   index. Paged explicitly so growth past any future page boundary fails
   the same way growth past this one didn't: not at all. */
/* Every public read of bank_papers also requires question_count > 0: 469
   English rows were published with no questions at all (2026-09-28), and a
   listed paper that opens empty is worse than no listing. question_count was
   checked against bank_questions and matches exactly. */
function pageQuery(from: number) {
  return supabase
    .from('bank_papers')
    .select(PAPER_COLUMNS)
    .eq('is_published', true).gt('question_count', 0)
    .order('year', { ascending: false, nullsFirst: false })
    .order('school', { ascending: true })
    /* Year and school are not unique; without a unique last key two range
       requests can each see a different order and skip or repeat a paper. */
    .order('id', { ascending: true })
    .range(from, from + PAGE - 1)
    /* D66: allowed_time_minutes/general_instructions/incomplete_note are not
       yet in the generated Database type. The migration that adds them
       (supabase/migrations/20260928000000_paper_checker_and_admin.sql) was
       applied live on 2026-09-28; .returns<>() asserts the real shape until
       `npm run generate-types` is re-run. */
    .returns<PaperRow[]>();
}

/* Was a `for` loop awaiting one page at a time, and then a head count before
   any page could start. Both are serial round trips on every visitor's first
   load of any page that reads the bank (past papers, school pages, browse,
   search). The first two pages now go out together with no count at all.
   Further pages are requested in widening waves, and the walk ends at the
   first short page, so the no-silent-truncation guarantee is unchanged: a
   full page means keep going, a short page means the table has ended. */
async function fetchAllPages(): Promise<PaperRow[]> {
  const rows: PaperRow[] = [];
  let from = 0;
  let wave = 2;
  for (;;) {
    const starts = Array.from({ length: wave }, (_, i) => from + i * PAGE);
    const pages = await Promise.all(
      starts.map(async (start) => {
        const { data, error } = await pageQuery(start);
        if (error) throw new Error(`bank papers: ${error.message}`);
        return data ?? [];
      }),
    );
    for (const page of pages) {
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
    from += wave * PAGE;
    wave = Math.min(wave * 2, 8);
  }
}

/* Three call sites (useSiteCounts, About, the live-papers banner) each count
   distinct schools by fetching bank_papers.school and de-duping client-side
   -- there's no distinct-count equivalent to a head:true row count. Each had
   its own copy of this fetch, unpaged, so each was independently exposed to
   the same 1000-row cap loadPaperIndex() above just got fixed for. Kept as
   three call sites (each counts a slightly different filter) rather than
   merged into one, but the pagination is shared rather than tripled. */
export async function fetchBankSchoolValues(onlyWithSchool = false): Promise<(string | null)[]> {
  const values: (string | null)[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('bank_papers').select('school').eq('is_published', true).gt('question_count', 0);
    if (onlyWithSchool) q = q.eq('has_school', true);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`bank papers schools: ${error.message}`);
    values.push(...(data ?? []).map((r) => r.school));
    if (!data || data.length < PAGE) break;
  }
  return values;
}

/**
 * Every published bank paper, newest first, undated last.
 *
 * Fetched once per session and shared by every caller. The ordering is the
 * database's, not the client's: year descending with the undated last, then
 * school, which is the order these listings have always been in.
 */
export function loadPaperIndex(): Promise<BankPaper[]> {
  if (!indexCache) {
    indexCache = fetchAllPages()
      .then((rows) => rows.map(toPaper))
      .catch((err: unknown) => {
        indexCache = null; // let a later caller retry rather than caching the failure
        throw err;
      });
  }
  return indexCache;
}

/* A reader opens one paper, so it fetches one paper's questions. Memoised per
   paper id: going back and forward between two papers should not re-fetch
   either of them.

   Keyed by paper id AND by whether the caller is signed in, because those two
   states now return different rows. Signing in from the gate has to be able to
   re-ask for the same paper and get all of it, rather than being handed the
   preview questions cached a moment earlier while signed out. */
const questionCache = new Map<string, Promise<BankQuestion[]>>();

/**
 * One paper's questions, in printed order.
 *
 * Reads through the `bank_paper_questions` RPC, not the table: anon SELECT on
 * bank_questions is revoked, and the function returns five rows to a signed-out
 * caller and the whole paper to a signed-in one. A signed-out reader therefore
 * receives only the preview questions and no trace of the rest -- there is nothing in the
 * payload to un-blur, which is the point.
 *
 * @param signedIn only ever affects the CACHE KEY. The gate itself is decided
 *   server-side from auth.uid(); passing true here cannot unlock anything.
 */
export function loadPaperQuestions(paperId: string, signedIn = false): Promise<BankQuestion[]> {
  const key = `${paperId}:${signedIn ? 'full' : 'free'}`;
  const hit = questionCache.get(key);
  if (hit) return hit;

  const req = Promise.resolve(
    // p_with_placeholders (20261003100000): held questions come back as
    // {held: true, number, ord} with no text, and render as a placeholder card.
    supabase.rpc('bank_paper_questions', { p_paper_id: paperId, p_with_placeholders: true } as never),
  )
    .then(({ data, error }) => {
      if (error) throw new Error(`bank questions: ${error.message}`);
      return ((data ?? []) as any[]).map(
        (r, idx): BankQuestion => ({
          i: r.id ?? `held-${r.ord ?? idx}`,
          p: r.paper_id ?? paperId,
          n: r.number ?? null,
          t: r.held === true ? '' : r.body ?? '',
          m: r.marks === null || r.marks === undefined ? null : Number(r.marks),
          c: r.chapter,
          ty: r.qtype,
          pg: r.page ?? undefined,
          f: r.figure ?? undefined,
          o: r.options ?? undefined,
          dn: r.display_number ?? null,
          instr: r.instructions ?? null,
          stm: r.suggested_time_minutes === null || r.suggested_time_minutes === undefined
            ? null
            : Number(r.suggested_time_minutes),
          sec: r.section_label ?? null,
          ag: r.alternative_group ?? null,
          al: r.alternative_label ?? null,
          pid: r.parent_question_id ?? null,
          ...(r.held === true ? { held: true } : {}),
        }),
      );
    })
    .catch((err: unknown) => {
      questionCache.delete(key);
      throw err;
    });

  questionCache.set(key, req);
  return req;
}

/** One paper's summary row, without pulling the whole index. */
export function loadPaper(paperId: string): Promise<BankPaper | null> {
  return Promise.resolve(
    supabase
      .from('bank_papers')
      .select(PAPER_COLUMNS)
      .eq('id', paperId)
      .eq('is_published', true).gt('question_count', 0)
      .maybeSingle()
      .returns<PaperRow | null>(),
  ).then(({ data, error }) => {
    if (error) throw new Error(`bank paper: ${error.message}`);
    return data ? withVisibleCount(toPaper(data)) : null;
  });
}

/* question_count counts every row; the Maths hold keeps flagged questions off
   the page. The count a reader is promised ("Sign in to read all N", "N
   questions") is the visible one, from the same rule the reader RPC applies.
   Any failure keeps question_count: a slightly high number beats no page. */
function withVisibleCount(paper: BankPaper): Promise<BankPaper> {
  return Promise.resolve(
    supabase.rpc('bank_paper_visible_counts' as never, { p_paper_id: paper.id } as never),
  )
    .then(({ data, error }) => {
      const row = !error && Array.isArray(data) ? (data as Array<{ visible: number }>)[0] : undefined;
      return typeof row?.visible === 'number' ? { ...paper, questionCount: row.visible } : paper;
    })
    .catch(() => paper);
}

/** The title a paper is listed under across the papers surface. */
export function paperTitle(p: BankPaper): string {
  return [displaySchool(p.school), `Class ${p.cls} ${p.subject}`, hasYear(p.year) ? p.year : null]
    .filter(Boolean)
    .join(' · ');
}

/* ---------------------------------------------------------------------------
   Schools

   The papers surface has two sources: the `papers` table and this bank. Only
   the table was ever wired into /schools and /school/:slug, so every bank
   paper was invisible to both — a school could have papers live on the site
   and an empty page of its own. These helpers give those two routes the
   bank's half of the data.

   The names themselves are resolved at import time, in scripts/school-names.ts,
   and stored in bank_papers.school. Correcting one is an UPDATE now, not a
   deploy, and the alias table is no longer in anybody's browser.
--------------------------------------------------------------------------- */

export interface BankSchool {
  slug: string;
  name: string;
  papers: BankPaper[];
}

/* loadPaperIndex memoises one array for the session, so keying on that
   identity means the grouping below runs once no matter how many routes ask
   for it. A WeakMap rather than a plain cache so a discarded index can be
   collected. */
const schoolsCache = new WeakMap<object, BankSchool[]>();

/**
 * Bank papers grouped by the school they came from, largest first.
 *
 * Board papers are deliberately excluded: an ICSE board paper belongs to the
 * board, not to a school, and a /school/icse page would be a category error.
 * Rows whose school the source could not read are excluded for the same
 * reason — there is no page to send them to. Both are decided by the
 * has_school column rather than re-derived here.
 */
export function schoolsOfPapers(papers: BankPaper[]): BankSchool[] {
  const hit = schoolsCache.get(papers);
  if (hit) return hit;

  const map = new Map<string, BankSchool>();
  papers.forEach((p) => {
    if (!p.hasSchool) return;
    const slug = schoolSlug(p.school);
    /* Keyed on the slug, not the name: two source spellings that resolve to
       the same school are one school and must not become two rows that each
       claim half its papers. */
    const entry = map.get(slug) ?? { slug, name: p.school, papers: [] };
    entry.papers.push(p);
    map.set(slug, entry);
  });

  const out = [...map.values()].sort(
    (a, b) => b.papers.length - a.papers.length || a.name.localeCompare(b.name),
  );
  schoolsCache.set(papers, out);
  return out;
}

/** The one school a slug resolves to, or null. */
export function schoolBySlug(papers: BankPaper[], slug: string): BankSchool | null {
  return schoolsOfPapers(papers).find((s) => s.slug === slug) ?? null;
}

/* schoolsOfPapers() above groups by RAW slug: two raw spellings that share a
   display label (school-display.ts) but derive different slugs -- "Gregorios",
   "St Gregorios" and "St. Gregorios High School" are three raw values, three
   slugs, one real school -- still produced three separate /school/:slug rows
   each claiming a third of the papers. This second layer groups those raw
   groups again, by DISPLAY LABEL, so a school reads as one row with the full
   count and one page with every paper, no matter which raw spelling (and
   therefore which slug) a paper happened to be filed under. */

export interface BankSchoolGroup {
  /** The merged label every raw spelling in this group displays as. */
  label: string;
  /** The slug SchoolsPage links to and SchoolPage's canonical tag points at:
   *  the raw value whose OWN display equals the label (needs no lookup table
   *  to explain), or, when no member is self-canonical (every raw spelling is
   *  itself a fragment/abbreviation), the one with the most papers. */
  canonicalSlug: string;
  /** Every raw spelling folded into this group, each with its own slug —
   *  schoolGroupBySlug() below matches on any of these, not just the
   *  canonical one, so an old /school/gregorios link still resolves. */
  raws: { raw: string; slug: string }[];
  /** Every paper from every raw spelling in the group, combined. */
  papers: BankPaper[];
}

const schoolGroupsCache = new WeakMap<object, BankSchoolGroup[]>();

export function schoolGroupsOfPapers(papers: BankPaper[]): BankSchoolGroup[] {
  const hit = schoolGroupsCache.get(papers);
  if (hit) return hit;

  const byLabel = new Map<string, { members: BankSchool[]; papers: BankPaper[] }>();
  schoolsOfPapers(papers).forEach((school) => {
    const label = displaySchool(school.name);
    /* "School not recorded" and board-paper source lines are real facts on a
       paper's own card, but neither is a school -- they do not belong in the
       schools directory or on a /school/:slug page of their own. */
    if (!isRealSchoolLabel(label)) return;
    const entry = byLabel.get(label) ?? { members: [], papers: [] };
    entry.members.push(school);
    entry.papers.push(...school.papers);
    byLabel.set(label, entry);
  });

  const out: BankSchoolGroup[] = [...byLabel.entries()].map(([label, { members, papers: groupPapers }]) => {
    const selfCanonical = members.find((m) => displaySchool(m.name) === m.name);
    const canonical = selfCanonical
      ?? members.reduce((best, m) => (m.papers.length > best.papers.length ? m : best));
    return {
      label,
      canonicalSlug: canonical.slug,
      raws: members.map((m) => ({ raw: m.name, slug: m.slug })),
      papers: groupPapers,
    };
  }).sort((a, b) => b.papers.length - a.papers.length || a.label.localeCompare(b.label));

  schoolGroupsCache.set(papers, out);
  return out;
}

/** The merged group a slug belongs to — matched against EVERY raw slug the
 *  group covers, not just its canonical one, so a non-canonical /school/:slug
 *  (an older link, or one of several merged spellings) still resolves to the
 *  full merged page rather than 404ing or showing a partial count. */
export function schoolGroupBySlug(papers: BankPaper[], slug: string): BankSchoolGroup | null {
  return schoolGroupsOfPapers(papers).find((g) => g.raws.some((r) => r.slug === slug)) ?? null;
}
