import { useCallback, useMemo, useRef, useState } from 'react';
import type Fuse from 'fuse.js';
import { supabase } from '@/integrations/supabase/client';
import { loadPaperIndex, hasYear } from '@/lib/question-bank';
import { bankSubjectToSite } from '@/lib/subject-vocabulary';
import { parsePaperQuery, paperQueryHasFacets, paperMatchesParsedQuery } from '@/lib/paper-query';
import { extractFiltersFromQuery } from '@/utils/searchKeywordExtractor';
import type { searchByName as SearchByNameFn } from '@/utils/searchByName';
import { filterShikshaqRecords, fillFilterStateDefaults, hasTeacherFacets } from '@/lib/teacher-facet-match';
import { displaySchool, isRealSchoolLabel, schoolSearchTerms } from '@/lib/school-display';

/** The Shikshaqmine columns filterShikshaqRecords actually reads for the
 *  subject/class/board/area facets the overlay's chip row (and a typed
 *  query) can produce -- see TEACHER_FACET_KEYS in searchFacets.ts. Fees,
 *  class size, mode/place of teaching and experience are deliberately left
 *  out: none of those are a typed-search facet today, and pulling all
 *  fourteen Shikshaqmine columns Browse.tsx's own fetch needs would
 *  reintroduce the exact "heaviest speculative download" problem the idle
 *  preload above was written to avoid. */
interface TeacherShikshaqSlice {
  Subjects: string | null;
  'Classes Taught': string | null;
  'Classes Taught for Backend': string | null;
  'School Boards Catered': string | null;
  Area: string | null;
}

export interface TeacherHit {
  id: string;
  name: string;
  slug: string;
  subjects: string | null;
  location: string | null;
  honorific: string | null;
  is_featured: boolean | null;
  /** null when the row has none, or when the Shikshaqmine slice below failed
   *  to load -- filterShikshaqRecords treats a null/missing column as "no
   *  value", which fails every subject/class/board/area check gracefully
   *  rather than throwing. */
  shikshaq: TeacherShikshaqSlice | null;
}

export interface PaperHit {
  id: string;
  title: string;
  school: string;
  subject: string;
  class: string;
  board: string;
  exam_type: string;
  year: number;
  /* No file_url: nothing reads it, and asking for it made the whole papers
     query 401 for signed-out visitors -- see the select below. */
}

export interface SearchGroups {
  teachers: TeacherHit[];
  papers: PaperHit[];
  teachersTotal: number;
  papersTotal: number;
}

// Module-level cache so every mount of the search control shares one fetch per page session.
let teachersCache: TeacherHit[] | null = null;
let papersCache: PaperHit[] | null = null;
let loadPromise: Promise<void> | null = null;

// Raised from 500 (which had no ORDER BY, so which 500 rows you got — and therefore which
// teachers were searchable at all — was undefined) to 2000, with a deterministic order so the
// same rows are always included. 2000 is the practical ceiling for teachers searchable via the
// name/subject/location Fuse index today; past that, teachers again become unsearchable and this
// cap would need to be paginated properly (mirroring Browse.tsx's paginated fetch).
const TEACHER_INDEX_LIMIT = 2000;
const PAPER_INDEX_LIMIT = 500;

async function loadIndex(): Promise<void> {
  const [teachersRes, papersRes, bankRes] = await Promise.all([
    supabase
      .from('teachers_list')
      .select('id,name,slug,subjects,location,honorific,is_featured')
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .limit(TEACHER_INDEX_LIMIT),
    supabase
      .from('papers')
      /* No file_url. It is revoked from anon at the column level (migration
         20260909000003_gate_paper_file_url.sql) and PostgREST fails the WHOLE
         request when a named column is forbidden -- it does not omit it. So
         this query returned 401 for every signed-out visitor, which is most of
         them, and the papers half of site search was silently empty for them.
         Verified as a real anonymous caller: selecting it returns
         "permission denied for table papers".
         Nothing here needs it either. openPaper() in SearchControl stopped
         using it when paper opening moved behind the reader's gate, and
         PaperReader.tsx already dropped it for exactly this reason. */
      .select('id,title,school,subject,class,board,exam_type,year')
      .eq('is_published', true)
      .order('year', { ascending: false })
      .order('id', { ascending: true })
      .limit(PAPER_INDEX_LIMIT),
    /* The question bank was invisible to search: 193 papers you could reach
       from /past-papers but could not find by typing their school's name.
       It is the light 31KB index, not the 2.5MB bank, and it is caught on its
       own so a bank failure costs the bank rows and never the whole index. */
    loadPaperIndex().catch(() => []),
  ]);

  let teachersData = teachersRes.data ?? [];

  // Exclude paused listings (Shikshaqmine.is_paused — the self-service pause toggle teachers
  // flip from their dashboard). is_paused IS live (migration
  // 20260816160605_add_is_paused_to_shikshaqmine, boolean not null default false, confirmed
  // against the running database) — the fail-soft handling below is not compensating for a
  // missing column any more. It stays anyway: this is a separate, isolated query specifically
  // so a pause-filter failure of ANY kind (RLS, a future rename, a transient error) costs only
  // the pause filter and never the search index itself. Do NOT merge this column into the main
  // teachers select; doing that in Browse rejected the whole query and wiped out all teacher
  // data — that failure mode has nothing to do with whether the column exists.
  if (teachersData.length > 0) {
    const { data: pausedRows, error: pausedError } = await supabase
      .from('Shikshaqmine')
      .select('Slug')
      .eq('is_paused', true)
      .returns<{ Slug: string | null }[]>();
    if (pausedError && import.meta.env.DEV) {
      console.warn('Search index: pause filter skipped:', pausedError.message);
    }
    const pausedSlugs = new Set((pausedRows ?? []).map((r) => r.Slug));
    if (pausedSlugs.size > 0) {
      teachersData = teachersData.filter((t) => !pausedSlugs.has(t.slug));
    }
  }

  /* Facet slice for the "12 math cbse"-style teacher query: teachers_list
     itself carries neither board nor a machine-tokenised class list, only
     Shikshaqmine does (see teacher-facet-match.ts's column notes). Same
     separate/isolated/fail-soft shape as the pause-filter query above --
     a failure here costs facet matching in the overlay (it falls back to
     treating the query as a name search, exactly like today) and never the
     teacher list itself. Intentionally NOT filtered by is_paused or anything
     else: every teacher's row is needed to build the lookup. */
  let shikshaqBySlug = new Map<string, TeacherShikshaqSlice>();
  if (teachersData.length > 0) {
    const { data: shikRows, error: shikError } = await supabase
      .from('Shikshaqmine')
      .select('Slug, Subjects, "Classes Taught", "Classes Taught for Backend", "School Boards Catered", Area')
      .returns<Array<{ Slug: string | null } & TeacherShikshaqSlice>>();
    if (shikError && import.meta.env.DEV) {
      console.warn('Search index: teacher facet slice skipped:', shikError.message);
    }
    shikshaqBySlug = new Map(
      (shikRows ?? [])
        .filter((r): r is { Slug: string } & TeacherShikshaqSlice => !!r.Slug)
        .map((r) => [r.Slug, {
          Subjects: r.Subjects,
          'Classes Taught': r['Classes Taught'],
          'Classes Taught for Backend': r['Classes Taught for Backend'],
          'School Boards Catered': r['School Boards Catered'],
          Area: r.Area,
        }]),
    );
  }

  teachersCache = teachersData.map((t) => ({ ...t, shikshaq: shikshaqBySlug.get(t.slug) ?? null }));

  /* Mapped exactly as PastPapers maps them, so a paper found by search and the
     same paper found by browsing read identically. */
  const bankHits: PaperHit[] = (bankRes ?? []).map((b) => {
    // b.subject is the raw bank spelling ("Mathematics"); the site's own
    // vocabulary ("Maths") is what every other subject-facing surface uses
    // -- see src/lib/subject-vocabulary.ts for the full history of this bug.
    const subject = bankSubjectToSite(b.subject);
    return {
      id: b.id,
      title: `Class ${b.cls} ${subject}`,
      school: b.school,
      subject,
      class: b.cls,
      board: b.board,
      exam_type: b.exam,
      year: hasYear(b.year) ? Number(String(b.year).slice(0, 4)) : 0,
    };
  });
  papersCache = [...(papersRes.data ?? []), ...bankHits];
}

export function invalidateSearchIndexCache() {
  teachersCache = null;
  papersCache = null;
  loadPromise = null;
}

const RESULT_LIMIT = 3;
const SUGGEST_LIMIT = 4;

/* fuse.js is real weight (~19KB of its own vendor chunk) that only earns its
   keep once someone actually types into search -- nothing above the fold on
   any route needs a fuzzy-match index before first paint, including the
   Home hero this control renders eagerly in. A static top-level `import
   Fuse from 'fuse.js'` therefore put it in the SAME eager module graph every
   route's entry HTML preloads, whether that route renders a search box or
   not (TeacherProfile and BankPaper never do). Loaded here instead, on
   first actual use (ensureLoaded, called on focus/typing -- see
   SearchControl), and cached at module scope so every later search reuses
   the same constructor without a second network round trip. */
let fuseCtorPromise: Promise<typeof Fuse> | null = null;
function loadFuseCtor(): Promise<typeof Fuse> {
  if (!fuseCtorPromise) fuseCtorPromise = import('fuse.js').then((m) => m.default);
  return fuseCtorPromise;
}

/* searchByName.ts is the name-only fallback matcher (see its use in
   `search()` below) and it ALSO imports fuse.js at its own top level -- a
   static `import { searchByName } from '@/utils/searchByName'` here would
   have re-introduced the exact same eager fuse.js dependency the dynamic
   import above just removed, just one hop further away. Loaded the same
   way, alongside Fuse's own constructor, and cached the same way. */
let searchByNamePromise: Promise<typeof SearchByNameFn> | null = null;
function loadSearchByName(): Promise<typeof SearchByNameFn> {
  if (!searchByNamePromise) searchByNamePromise = import('@/utils/searchByName').then((m) => m.searchByName);
  return searchByNamePromise;
}

export function useSearchIndex() {
  /* Always starts false, even when teachersCache/papersCache are already
     warm from an earlier mount: `ready` now means "papersFuse.current is
     built," which the render-body effect below sets asynchronously (Fuse's
     constructor is a dynamic import), so it can never be true before that
     import resolves even once the data itself is cached. */
  const [ready, setReady] = useState(false);
  /* Facet OPTIONS, not raw values -- deduped through displaySchool() so a
     merged label (school-display.ts) appears once here rather than once per
     raw spelling/abbreviation it covers. buildParams() in SearchControl.tsx
     is what expands a picked label back to every raw value it needs to
     filter by. */
  const [schools, setSchools] = useState<string[]>(
    papersCache ? Array.from(new Set(papersCache.map((p) => displaySchool(p.school)))).filter(isRealSchoolLabel).sort() : []
  );
  const papersFuse = useRef<Fuse<PaperHit> | null>(null);
  const searchByNameRef = useRef<typeof SearchByNameFn | null>(null);
  const building = useRef(false);

  const buildFuseIndexes = useCallback(async () => {
    const [FuseCtor, searchByNameFn] = await Promise.all([loadFuseCtor(), loadSearchByName()]);
    searchByNameRef.current = searchByNameFn;
    /* board/exam_type/year were not searchable at all, so "ICSE 2024" and
       "prelim" matched nothing however many such papers existed. */
    papersFuse.current = new FuseCtor(papersCache ?? [], {
      includeScore: true,
      threshold: 0.35,
      minMatchCharLength: 2,
      ignoreLocation: true,
      keys: [
        { name: 'school', weight: 3 },
        /* Typing the real, expanded school name (e.g. "Jamnabai Narsee")
           has to find a paper whose raw bank_papers.school is a fragment or
           abbreviation of it ("Jamanabai Historycivics") -- see
           school-display.ts. Fuse only matches string fields, so this adds
           the expanded name as extra searchable text on the same weight,
           without touching what the row itself displays. */
        {
          name: 'schoolDisplay',
          weight: 3,
          getFn: (p: PaperHit) => schoolSearchTerms(p.school).join(' '),
        },
        { name: 'title', weight: 2 },
        { name: 'subject', weight: 2 },
        { name: 'board', weight: 1 },
        { name: 'exam_type', weight: 1 },
        /* Fuse only matches strings; a numeric year would be read as no
           value at all, so this key would have matched nothing at all. */
        { name: 'year', weight: 1, getFn: (p: PaperHit) => (p.year ? String(p.year) : '') },
      ],
    });
  }, []);

  if ((teachersCache !== null && papersCache !== null) && !papersFuse.current && !building.current) {
    building.current = true;
    void buildFuseIndexes().then(() => {
      building.current = false;
      setReady(true);
    });
  }

  const ensureLoaded = useCallback(async () => {
    if (teachersCache !== null && papersCache !== null) {
      if (!papersFuse.current) await buildFuseIndexes();
      setReady(true);
      return;
    }
    if (!loadPromise) loadPromise = loadIndex();
    await loadPromise;
    await buildFuseIndexes();
    setSchools(Array.from(new Set((papersCache ?? []).map((p) => displaySchool(p.school)))).filter(isRealSchoolLabel).sort());
    setReady(true);
  }, [buildFuseIndexes]);

  const search = useCallback((query: string): SearchGroups => {
    const q = query.trim();
    if (!q || q.length < 2 || !papersFuse.current) {
      return { teachers: [], papers: [], teachersTotal: 0, papersTotal: 0 };
    }

    /* Teachers: the SAME facet extraction Browse.tsx's own results page runs
       on this exact `q` (extractFiltersFromQuery) and the SAME predicate
       Browse filters Shikshaqmine records with (filterShikshaqRecords,
       moved to teacher-facet-match.ts) -- so a multi-facet query like "maths
       class 10 salt lake" or "cbse 12 chemistry" is decided by one function
       used in both places, instead of this overlay's own whole-string Fuse
       match (over name/subjects/location) scoring it near zero the same way
       the papers overlay used to. A query with no recognisable facet at all
       (a teacher's actual name, or plain gibberish) falls through to
       searchByName -- the exact name-only fuzzy matcher Browse's own
       name-search path calls, not a separate Fuse index, so a name query's
       count agrees with Browse too. */
    const extracted = extractFiltersFromQuery(q);
    const teacherResults = hasTeacherFacets(extracted)
      ? (() => {
          const cache = teachersCache ?? [];
          const effectiveFilters = fillFilterStateDefaults(extracted);
          const records = cache.map((t, i) => ({ ...(t.shikshaq ?? {}), __idx: i }));
          const matchedIdx = new Set(filterShikshaqRecords(records, effectiveFilters).map((r) => r.__idx as number));
          return cache.filter((_, i) => matchedIdx.has(i));
        })()
      : (searchByNameRef.current ?? (() => []))(teachersCache ?? [], q);

    /* Papers: try facets first ("12 math cbse" -> class 12 + Maths + CBSE,
       matched as three separate columns) before falling back to Fuse's plain
       fuzzy match on the whole string. Fuse alone never worked for a combined
       query -- no single title/school/subject/board field ever contains "12
       math cbse" verbatim, at any edit distance Fuse's threshold accepts, so
       a casual multi-facet query always scored 0 papers. See
       src/lib/paper-query.ts for why. A query with no recognisable facet at
       all (a school name, a typo) still goes through Fuse exactly as before,
       so the fallback experience is unchanged. */
    const parsedPaperQuery = parsePaperQuery(q);
    const paperResults = paperQueryHasFacets(parsedPaperQuery)
      ? (papersCache ?? []).filter((p) => paperMatchesParsedQuery(p, parsedPaperQuery))
      : papersFuse.current.search(q).map((r) => r.item);

    return {
      teachers: teacherResults.slice(0, RESULT_LIMIT),
      papers: paperResults.slice(0, RESULT_LIMIT),
      teachersTotal: teacherResults.length,
      papersTotal: paperResults.length,
    };
  }, []);

  // Resting-state suggestions — shown before the user has typed anything.
  // Both flavors reuse data already fetched for the index rather than a
  // separate query: `is_featured` is the same column Browse.tsx's "Featured
  // teachers" shelf reads (real, human-curated, not derived from search
  // activity), and papersCache is already ordered newest-year-first, so its
  // head is "recently relevant" papers with no extra sorting needed.
  /* Curated first, but never an empty shelf while real teachers exist. No row
     in this database has `is_featured` set, so the strict filter returned
     nothing and the resting control showed papers with no teachers beside
     them — telling you less than typing one letter did. The fallback is still
     real data off the same cache, just uncurated, so nothing is fabricated. */
  const featuredTeachers = useMemo(
    () => {
      const all = teachersCache ?? [];
      const curated = all.filter((t) => t.is_featured);
      return (curated.length > 0 ? curated : all).slice(0, SUGGEST_LIMIT);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready]
  );
  const recentPapers = useMemo(
    () => (papersCache ?? []).slice(0, SUGGEST_LIMIT),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready]
  );

  return { ensureLoaded, search, ready, schools, featuredTeachers, recentPapers };
}
