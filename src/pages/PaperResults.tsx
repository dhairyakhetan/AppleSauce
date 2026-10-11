import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUp, FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { PaperSheetCard } from '@/components/papers/paper-sheet-card';
import { SearchControl } from '@/components/SearchControl';
import { loadPaperIndex, hasYear } from '@/lib/question-bank';
import { sanitizeForIlike } from '@/lib/ilike-sanitize';
import { bankSubjectToSite, bankSubjectMatches } from '@/lib/subject-vocabulary';
import { bankClassMatches } from '@/utils/romanNumerals';
import { parsePaperQuery, paperQueryHasFacets } from '@/lib/paper-query';
import { filterToKnownVocabulary } from '@/lib/paper-filter-validation';
import { createSearchGeneration } from '@/lib/search-generation';
import { SUBJECTS, CLASSES, BOARDS } from '@/utils/searchFacets';
import { FilterChips, type FilterChipItem } from '@/components/FilterChips';
import { EmptyResults } from '@/components/EmptyResults';
import { usePageMeta } from '@/hooks/usePageMeta';
import { supabase } from '@/integrations/supabase/client';
import { getWhatsAppLink } from '@/utils/whatsapp';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useChromeConfig } from '@/components/layout/AppShell';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { ArrowLeft } from 'lucide-react';
import { getSubjectPalette } from '@/lib/subject-palette';
import { displaySchool, schoolSearchTerms } from '@/lib/school-display';

interface Paper {
  id: string;
  title: string;
  school: string;
  subject: string;
  class: string;
  board: string;
  exam_type: string;
  year: number;
  file_url: string | null;
  needsReview?: boolean;
}

const PAGE_SIZE = 24;
const BANK_STEP = 48;

const SKELETON = 'bg-gradient-to-r from-muted via-background to-muted bg-[length:200%_100%] animate-shimmer';
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

function parseArrayParam(param: string | null): string[] {
  if (!param) return [];
  return param.split(',').filter(Boolean);
}

// See src/lib/ilike-sanitize.ts -- kept dependency-free there so it can be
// unit tested without pulling in this page's Supabase client import.

export default function PaperResults() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  /* Moved above the filter parsing below: R4G6's school-vocabulary check
     needs the bank's own school list, which only this query can supply, and
     a hook's position among other hooks can move freely as long as it is
     still called unconditionally on every render (it is). Nothing here reads
     `q` or any filter_* value -- it fetches the static 193-paper bank index
     regardless of what's being filtered for. */
  const bankQuery = useQuery({
    queryKey: ['paper-results', 'bank'],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<Paper[]> =>
      /* b.subject, not the literal 'Mathematics'/'Maths' these two lines used
         to carry. That was true while the bank held nothing else; once History
         & Civics and Economics landed it meant all 619 bank papers claimed to
         be maths, so a History filter returned none of its 302 papers and every
         one of them rendered as "Class X Mathematics". Subject is mapped into
         the SITE vocabulary here so it matches the filter chips, the facets and
         the subject pages. */
      (await loadPaperIndex()).map((b) => {
        // Both fields share one computed value now -- title used to read the
        // raw b.subject directly, which is exactly the "Class X Mathematics"
        // bug the comment above describes; only the `subject` field (used
        // for filtering, not for what a reader actually sees) was mapped.
        const site = bankSubjectToSite(b.subject);
        return {
          id: b.id,
          title: `Class ${b.cls} ${site}`,
          school: b.school,
          subject: site,
          class: b.cls,
          board: b.board,
          exam_type: b.exam,
          year: hasYear(b.year) ? Number(String(b.year).slice(0, 4)) : 0,
          file_url: null,
          needsReview: b.needsReview,
        };
      }) as Paper[],
  });

  const q = searchParams.get('q') || '';
  const rawSubjectFilters = parseArrayParam(searchParams.get('filter_subjects'));
  const rawClassFilters = parseArrayParam(searchParams.get('filter_classes'));
  const rawBoardFilters = parseArrayParam(searchParams.get('filter_boards'));
  const rawSchoolFilters = parseArrayParam(searchParams.get('filter_schools'));
  const yearFilters = parseArrayParam(searchParams.get('filter_years'));

  /* R4G6: a filter_* value from the URL used to reach the heading, <title>
     and the Supabase query unchecked -- ?filter_classes=%25%25%25 rendered
     as literally "Class %%% papers | Shikshaq", and nothing stopped a
     crafted link from steering that title to arbitrary text. Classes,
     subjects and boards are small closed vocabularies (searchFacets.ts, the
     same file SearchControl and the Teacher filters already draw from), so
     a value that doesn't match one case-insensitively is dropped rather than
     echoed. Subjects also pass through bankSubjectToSite first so an older
     ?filter_subjects=Mathematics link still resolves (to "Maths", the site
     spelling) instead of being wrongly dropped as unrecognised.
     Schools are not a small closed set, so they're checked against the
     schools this page has actually loaded from the bank once that load
     settles; before it settles (or if it's empty), school filters pass
     through unchecked rather than being wrongly dropped while still loading. */
  const subjectFilters = filterToKnownVocabulary(
    rawSubjectFilters.map((v) => bankSubjectToSite(v) || v),
    SUBJECTS,
  );
  const classFilters = filterToKnownVocabulary(rawClassFilters, CLASSES);
  const boardFilters = filterToKnownVocabulary(rawBoardFilters, BOARDS);
  const knownSchoolNames = bankQuery.data?.length ? bankQuery.data.map((p) => p.school) : null;
  const schoolFilters = knownSchoolNames
    ? filterToKnownVocabulary(rawSchoolFilters, knownSchoolNames)
    : rawSchoolFilters;
  // Single-value convenience accessors, used for heading/chip/handoff display
  // (which show one value per filter). Query filtering itself honours the
  // full array via .in() below — see runQuery.
  const subjectFilter = subjectFilters[0] || '';
  const classFilter = classFilters[0] || '';
  const boardFilter = boardFilters[0] || '';
  const schoolFilter = schoolFilters[0] || '';

  /* `q` can still carry recognisable class/subject/board/year tokens even
     here -- a direct link, a bookmark, or any entry point that didn't route
     through SearchControl's own facet parsing. Re-parsing it (mirroring how
     Browse.tsx re-parses `q` for teachers with extractFiltersFromQuery)
     means a bare "?q=12%20math%20cbse" link works too, not only the one
     SearchControl now produces. Merged with, not replacing, the explicit
     filter_* chips -- a reader can have both a Subject chip picked AND typed
     "cbse 2023". Root-cause writeup: src/lib/paper-query.ts. */
  // Joined once, so every memo/effect below that needs to react to a filter_*
  // array can list one plain identifier in its dependency array instead of a
  // repeated `.join(',')` call (eslint's react-hooks/exhaustive-deps flags an
  // inline expression there as unable to be statically checked).
  const subjectFiltersKey = subjectFilters.join(',');
  const classFiltersKey = classFilters.join(',');
  const boardFiltersKey = boardFilters.join(',');
  const schoolFiltersKey = schoolFilters.join(',');
  const yearFiltersKey = yearFilters.join(',');

  const parsedQuery = useMemo(() => (q.trim().length >= 2 ? parsePaperQuery(q) : null), [q]);
  const hasParsedFacets = !!parsedQuery && paperQueryHasFacets(parsedQuery);
  const effectiveSubjects = useMemo(
    () => Array.from(new Set([...subjectFilters, ...(parsedQuery?.subjects ?? [])])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subjectFiltersKey, parsedQuery],
  );
  const effectiveClasses = useMemo(
    () => Array.from(new Set([...classFilters, ...(parsedQuery?.classes ?? [])])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [classFiltersKey, parsedQuery],
  );
  const effectiveBoards = useMemo(
    () => Array.from(new Set([...boardFilters, ...(parsedQuery?.boards ?? [])])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardFiltersKey, parsedQuery],
  );
  const effectiveYears = useMemo(
    () => Array.from(new Set([...yearFilters.map(Number), ...(parsedQuery?.years ?? [])])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [yearFiltersKey, parsedQuery],
  );
  /* The text that actually goes into the ilike/substring match. Once facets
     are pulled out of `q`, searching for the FULL "12 math cbse" against
     title/school/subject is exactly the bug (no column ever contains that
     whole phrase) -- only the leftover (a school name, a typo) should be
     matched as free text. A query with no recognisable facet at all falls
     through unchanged, so a plain school-name search behaves exactly as
     before. */
  const freeText = hasParsedFacets ? (parsedQuery?.freeText ?? '') : q.trim();

  const [papers, setPapers] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);

  /* The 193 question-bank papers are papers on this surface too, so a filter
     for "ICSE Class X Maths" has to find them. They cannot ride the Supabase
     query — they are a static file — so they are filtered here with the same
     params and merged in ahead of the database rows, which is also the right
     order: they read as questions rather than as a scan. 193 rows filter in
     well under a frame. (bankQuery itself is declared above, before the
     filter parsing that now depends on it -- see R4G6's comment there.) */
  const bankMatches = useMemo(() => {
    const rows = bankQuery.data ?? [];
    const needle = freeText.toLowerCase();
    const eq = (want: string[], value: string) =>
      want.length === 0 || want.some((w) => w.toLowerCase() === value.toLowerCase());
    return rows.filter((p) =>
      /* Subject goes through the vocabulary map rather than a plain equality:
         a ?filter_subjects=Maths link has to find rows whose bank subject is
         "Mathematics", and an older ?filter_subjects=Mathematics link has to
         keep working. */
      (effectiveSubjects.length === 0 ||
        effectiveSubjects.some((w) => bankSubjectMatches(w, p.subject))) &&
      /* bank_papers.cls stores numeric classes as Roman numerals ("X"), while
         the filter chips and URL are Arabic ("10") -- see bankClassMatches.
         The 18-row `papers` table below (runQuery) is untouched: its `class`
         column is already Arabic-numeral native. */
      (effectiveClasses.length === 0 || effectiveClasses.some((w) => bankClassMatches(w, p.class))) &&
      eq(effectiveBoards, p.board) &&
      eq(schoolFilters, p.school) &&
      (effectiveYears.length === 0 || effectiveYears.includes(p.year)) &&
      (!needle ||
        p.title.toLowerCase().includes(needle) ||
        p.school.toLowerCase().includes(needle) ||
        schoolSearchTerms(p.school).some((t) => t.toLowerCase().includes(needle)) ||
        p.subject.toLowerCase().includes(needle)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankQuery.data, freeText, effectiveSubjects, effectiveClasses, effectiveBoards, schoolFiltersKey, effectiveYears]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /* Which search the list on screen belongs to. Bumped each time the first
     page is re-fetched; loadMore() captures it and drops its result when it
     has moved on, so a next-page request that was in flight when the filters
     changed cannot append the OLD search's rows under the new heading. */
  const searchGen = useRef(createSearchGeneration()).current;
  const [loadError, setLoadError] = useState(false);
  // Presentation-only: shows the back-to-top affordance once the student has
  // scrolled past roughly a viewport of results. This is an honest boolean
  // about the WINDOW's own scroll position — it makes no claim about how much
  // of any paper has been read.
  const [showTop, setShowTop] = useState(false);

  // Bumped exactly once per search settling (loading -> a real count), never
  // on scroll or a re-render with the same result. Used as a `key` so the
  // count's one-shot landing animation replays on a new search but never
  // repeats while that search's result sits on screen.
  const [revealKey, setRevealKey] = useState(0);
  const wasLoadingRef = useRef(true);
  useEffect(() => {
    if (wasLoadingRef.current && !loading) {
      setRevealKey((k) => k + 1);
    }
    wasLoadingRef.current = loading;
  }, [loading]);

  // Every active value per facet (not just the first) so the heading doesn't
  // understate a multi-value filter the query is actually honouring via .in().
  const heading = useMemo(() => {
    if (q) return `Results for "${q}"`;
    const parts = [
      boardFilters.length ? boardFilters.join(', ') : '',
      classFilters.length ? `Class ${classFilters.join(', ')}` : '',
      subjectFilters.length ? subjectFilters.join(', ') : '',
      schoolFilters.length ? Array.from(new Set(schoolFilters.map(displaySchool))).join(', ') : '',
    ].filter(Boolean);
    return parts.length ? `${parts.join(' ')} papers` : 'Past papers';
    // Depend on the raw joined params (not just the first value) so the heading
    // updates when a non-first value in the list changes, matching the fetch effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, subjectFiltersKey, classFiltersKey, boardFiltersKey, schoolFiltersKey]);

  usePageMeta(
    `${heading} | Shikshaq`,
    'Browse free past year question papers shared by students. Read them online, the first two questions of every paper need no account.'
  );

  function runQuery(pageNum: number) {
    let query = supabase
      .from('papers')
      .select('id,title,school,subject,class,board,exam_type,year', { count: 'exact' })
      .eq('is_published', true);

    if (effectiveSubjects.length > 1) query = query.in('subject', effectiveSubjects);
    else if (effectiveSubjects.length === 1) query = query.eq('subject', effectiveSubjects[0]);
    if (effectiveClasses.length > 1) query = query.in('class', effectiveClasses);
    else if (effectiveClasses.length === 1) query = query.eq('class', effectiveClasses[0]);
    if (effectiveBoards.length > 1) query = query.in('board', effectiveBoards);
    else if (effectiveBoards.length === 1) query = query.eq('board', effectiveBoards[0]);
    if (schoolFilters.length > 1) query = query.in('school', schoolFilters);
    else if (schoolFilters.length === 1) query = query.eq('school', schoolFilters[0]);
    if (effectiveYears.length > 1) query = query.in('year', effectiveYears);
    else if (effectiveYears.length === 1) query = query.eq('year', effectiveYears[0]);
    /* Only the leftover free text after facets are pulled out -- searching
       ilike for the WHOLE raw query (e.g. "12 math cbse") is the bug this
       page used to have: no title/school/subject column ever contains that
       phrase verbatim, so a compound casual query always matched nothing
       however many such papers exist. See src/lib/paper-query.ts. */
    if (freeText.trim()) {
      const needle = sanitizeForIlike(freeText.trim());
      query = query.or(`title.ilike.%${needle}%,school.ilike.%${needle}%,subject.ilike.%${needle}%`);
    }

    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    return query.order('year', { ascending: false }).order('school', { ascending: true }).range(from, to);
  }

  // Bumped by the error state's Retry button to re-run the fetch effect below
  // without a full page reload -- CRAFT.md §4 wants an actual retry, not
  // window.location.reload().
  const [retryTick, setRetryTick] = useState(0);
  const retry = useCallback(() => setRetryTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    searchGen.begin();
    async function fetchFirstPage() {
      setLoading(true);
      setLoadError(false);
      setLoadingMore(false);
      setPage(0);
      try {
        const { data, error, count } = await runQuery(0);
        if (error) throw error;
        if (cancelled) return;
        setPapers((data as Paper[]) || []);
        setTotal(count ?? 0);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchFirstPage();
    return () => { cancelled = true; };
    // Depend on the raw joined params (not just the first value) so a change
    // to e.g. "Maths,Physics" -> "Maths,Chemistry" re-fetches even though the
    // first value in the list didn't change. effectiveX (not the raw filter_*
    // arrays) so a query-derived facet re-fetches too. retryTick has no effect
    // on the query itself -- it exists purely so Retry can re-trigger this
    // effect when nothing else about the search changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeText, effectiveSubjects, effectiveClasses, effectiveBoards, schoolFiltersKey, effectiveYears, retryTick]);

  // Back-to-top visibility. Long lists here are unbounded ("Load more" with no
  // virtualization by design), so getting back to the filter row must not mean
  // flicking for ten seconds.
  useEffect(() => {
    function onScroll() {
      setShowTop(window.scrollY > (window.innerHeight || 800));
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }, []);

  async function loadMore() {
    const nextPage = page + 1;
    const gen = searchGen.current();
    setLoadingMore(true);
    try {
      const { data, error } = await runQuery(nextPage);
      if (error) throw error;
      // The filters changed while this page was in flight: it belongs to a
      // search that is no longer on screen. Drop it (page, rows and the
      // loadingMore flag are all the new search's to manage now).
      if (!searchGen.isCurrent(gen)) return;
      setPapers((prev) => [...prev, ...((data as Paper[]) || [])]);
      setPage(nextPage);
    } catch {
      // Leave the existing results in place; the button stays put so the
      // student can just try again rather than losing what already loaded.
    } finally {
      if (searchGen.isCurrent(gen)) setLoadingMore(false);
    }
  }

  // Removes just one value from a multi-value filter param, leaving the rest
  // intact — so a student filtering by two subjects can drop one without
  // losing the other.
  const removeFilterValue = (
    key: 'filter_subjects' | 'filter_classes' | 'filter_boards' | 'filter_schools',
    value: string
  ) => {
    const current = parseArrayParam(searchParams.get(key));
    const remaining = current.filter((v) => v !== value);
    const next = new URLSearchParams(searchParams);
    if (remaining.length > 0) next.set(key, remaining.join(','));
    else next.delete(key);
    setSearchParams(next);
  };

  /* A merged school label (school-display.ts) can cover several raw
     filter_schools values at once. removeFilterValue() reads searchParams
     fresh from its closure on every call, so calling it once per raw value
     in a loop drops all but the last removal — the second call rebuilds
     `next` from the still-unmodified `searchParams`, discarding the first
     call's edit. This removes every value named in one pass instead. */
  const removeFilterValues = (
    key: 'filter_subjects' | 'filter_classes' | 'filter_boards' | 'filter_schools',
    values: string[],
  ) => {
    const current = parseArrayParam(searchParams.get(key));
    const remaining = current.filter((v) => !values.includes(v));
    const next = new URLSearchParams(searchParams);
    if (remaining.length > 0) next.set(key, remaining.join(','));
    else next.delete(key);
    setSearchParams(next);
  };

  const clearFilters = () => setSearchParams(new URLSearchParams());

  // Subject/class/board carry to the teachers browse page; school and free-text
  // search don't apply there (mirrors Browse's equivalent handoff).
  const handleSeeTeachers = () => {
    const params = new URLSearchParams();
    if (subjectFilter) params.set('filter_subjects', subjectFilter);
    if (classFilter) params.set('filter_classes', classFilter);
    if (boardFilter) params.set('filter_boards', boardFilter);
    const qs = params.toString();
    navigate(qs ? `/all-tuition-teachers-in-kolkata?${qs}` : '/all-tuition-teachers-in-kolkata');
  };

  // Prefilled WhatsApp message for the EmptyResults "Request this paper" action,
  // carrying whatever filters/search the student had applied.
  const requestPaperUrl = () => {
    const parts = [subjectFilter, classFilter && `Class ${classFilter}`, boardFilter, schoolFilter && displaySchool(schoolFilter), q && `"${q}"`].filter(Boolean);
    const context = parts.length ? ` (${parts.join(', ')})` : '';
    const message = `Hi! I couldn't find a paper on Shikshaq${context}. Could you add it?`;
    return `${getWhatsAppLink('8240980312')}?text=${encodeURIComponent(message)}`;
  };

  // One chip per active VALUE (not per facet) so a multi-select filter shows
  // and can remove each value independently — matching the .in() query above.
  // Memoized (not just a plain const) so the relax-scoring effect and
  // relaxOptions memo below, which both depend on this array by reference,
  // don't re-run on every render — only when a filter value actually changes.
  const filterChips: FilterChipItem[] = useMemo(
    () => [
      ...subjectFilters.map((v) => ({
        key: `filter_subjects:${v}`,
        label: v,
        onRemove: () => removeFilterValue('filter_subjects', v),
      })),
      ...classFilters.map((v) => ({
        key: `filter_classes:${v}`,
        label: `Class ${v}`,
        onRemove: () => removeFilterValue('filter_classes', v),
      })),
      ...boardFilters.map((v) => ({
        key: `filter_boards:${v}`,
        label: v,
        onRemove: () => removeFilterValue('filter_boards', v),
      })),
      /* One chip per LABEL, not per raw value -- a merged label (school-
         display.ts) can cover several raw schoolFilters entries (e.g. "Arya
         Vidya Mandir" + "Arya Vidya Mandir Hc"), and without this dedupe the
         chip row showed two identical-looking "Arya Vidya Mandir" chips.
         Removing the chip removes every raw value grouped under it. */
      ...Array.from(
        schoolFilters.reduce((byLabel, v) => {
          const label = displaySchool(v);
          (byLabel.get(label) ?? byLabel.set(label, []).get(label)!).push(v);
          return byLabel;
        }, new Map<string, string[]>()),
      ).map(([label, raws]) => ({
        key: `filter_schools:${label}`,
        label,
        onRemove: () => removeFilterValues('filter_schools', raws),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subjectFiltersKey, classFiltersKey, boardFiltersKey, schoolFiltersKey],
  );

  /* Bank matches lead, then the database page. Only on the first page — they
     are not part of the server's pagination. */
  /* Capped, then "Show more": an unfiltered visit matches every bank paper
     (1,500+), and mounting that many cards at once put ~31,000 nodes on a
     phone and a 195,000px scroll. The count shown in the readout is still the
     true total. Resets whenever the filters change what matches. */
  const [bankShown, setBankShown] = useState(BANK_STEP);
  useEffect(() => { setBankShown(BANK_STEP); }, [bankMatches]);
  const bankVisible = bankMatches.slice(0, bankShown);
  const shownPapers = page === 0 ? [...bankVisible, ...papers] : papers;
  const shownTotal = total + bankMatches.length;
  const bankHasMore = page === 0 && bankMatches.length > bankShown;

  const hasMore = papers.length < total;

  // Same predicate as the `bankMatches` memo above, parametrised so the relax
  // scoring below can ask "how many bank rows would match with one filter
  // value dropped" without re-deriving effectiveSubjects/etc. for a
  // hypothetical filter state.
  const countBankMatches = useCallback(
    (subjects: string[], classes: string[], boards: string[], schools: string[], years: number[]) => {
      const rows = bankQuery.data ?? [];
      const needle = freeText.toLowerCase();
      const eq = (want: string[], value: string) =>
        want.length === 0 || want.some((w) => w.toLowerCase() === value.toLowerCase());
      return rows.filter(
        (p) =>
          (subjects.length === 0 || subjects.some((w) => bankSubjectMatches(w, p.subject))) &&
          (classes.length === 0 || classes.some((w) => bankClassMatches(w, p.class))) &&
          eq(boards, p.board) &&
          eq(schools, p.school) &&
          (years.length === 0 || years.includes(p.year)) &&
          (!needle ||
            p.title.toLowerCase().includes(needle) ||
            p.school.toLowerCase().includes(needle) ||
            schoolSearchTerms(p.school).some((t) => t.toLowerCase().includes(needle)) ||
            p.subject.toLowerCase().includes(needle)),
      ).length;
    },
    [bankQuery.data, freeText],
  );

  /* Two sources feed this list: the Supabase page and the static bank index.
     "Loading" has to wait for both. Gating on the database alone showed
     "No papers match all of those filters yet" and "0 papers found" on a cold
     load whenever the database answered (with nothing) before the bank index
     arrived, then swapped to the real rows a moment later. A failed bank load
     settles (isPending is false on error), so this can never hang. */
  const listLoading = loading || bankQuery.isPending;
  const isDeadEnd = !listLoading && !loadError && shownPapers.length === 0;

  // EmptyResults relax options: for each active filter chip, a head-only count
  // (bank rows filtered locally + a Supabase count query) of what the result
  // set would be with just that one value dropped. Reuses the existing
  // chip-removal logic (`removeFilterValue`, the same one FilterChips itself
  // calls) rather than inventing a second way to drop a filter -- this IS the
  // "existing relax logic" the brief asks for, just scored so the empty state
  // can show the highest-yield option(s) first instead of guessing.
  const [relaxCounts, setRelaxCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!isDeadEnd || filterChips.length === 0) return;
    let cancelled = false;
    async function scoreOne(chip: FilterChipItem): Promise<[string, number]> {
      const sepIndex = chip.key.indexOf(':');
      const paramKey = chip.key.slice(0, sepIndex);
      const value = chip.key.slice(sepIndex + 1);
      const subjects = paramKey === 'filter_subjects' ? effectiveSubjects.filter((v) => v !== value) : effectiveSubjects;
      const classes = paramKey === 'filter_classes' ? effectiveClasses.filter((v) => v !== value) : effectiveClasses;
      const boards = paramKey === 'filter_boards' ? effectiveBoards.filter((v) => v !== value) : effectiveBoards;
      const schools = paramKey === 'filter_schools' ? schoolFilters.filter((v) => v !== value) : schoolFilters;
      const bankCount = countBankMatches(subjects, classes, boards, schools, effectiveYears);
      let dbCount = 0;
      try {
        let q = supabase.from('papers').select('id', { count: 'exact', head: true }).eq('is_published', true);
        if (subjects.length > 1) q = q.in('subject', subjects);
        else if (subjects.length === 1) q = q.eq('subject', subjects[0]);
        if (classes.length > 1) q = q.in('class', classes);
        else if (classes.length === 1) q = q.eq('class', classes[0]);
        if (boards.length > 1) q = q.in('board', boards);
        else if (boards.length === 1) q = q.eq('board', boards[0]);
        if (schools.length > 1) q = q.in('school', schools);
        else if (schools.length === 1) q = q.eq('school', schools[0]);
        if (effectiveYears.length > 1) q = q.in('year', effectiveYears);
        else if (effectiveYears.length === 1) q = q.eq('year', effectiveYears[0]);
        if (freeText.trim()) {
          const needle = sanitizeForIlike(freeText.trim());
          q = q.or(`title.ilike.%${needle}%,school.ilike.%${needle}%,subject.ilike.%${needle}%`);
        }
        const { count, error } = await q;
        if (error) throw error;
        dbCount = count ?? 0;
      } catch {
        // Losing one candidate's DB half is not losing the empty state -- it
        // just scores lower (bank-only) than it should, worst case it's left
        // out of the top slice below rather than shown wrong.
      }
      return [chip.key, bankCount + dbCount];
    }
    Promise.all(filterChips.map(scoreOne)).then((entries) => {
      if (!cancelled) setRelaxCounts(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDeadEnd, subjectFiltersKey, classFiltersKey, boardFiltersKey, schoolFiltersKey, yearFiltersKey, bankQuery.data]);

  // Highest-yield first, capped at 2 so it plus the "Browse all papers"
  // fallback below never exceeds EmptyResults' three-pill guidance.
  const relaxOptions = useMemo(
    () =>
      filterChips
        .map((chip) => ({ chip, n: relaxCounts[chip.key] }))
        .filter((r): r is { chip: FilterChipItem; n: number } => typeof r.n === 'number' && r.n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, 2)
        .map(({ chip, n }) => ({
          label: `Without ${chip.label} · ${n.toLocaleString('en-IN')}`,
          onClick: chip.onRemove,
        })),
    [filterChips, relaxCounts],
  );

  // "Browse all papers" always stands regardless of whether a relax option
  // exists -- it's the one option that works even for a free-text search
  // with no filter chips to drop (e.g. "?q=zzqx").
  const emptyStateOptions = [
    ...relaxOptions,
    { label: 'Browse all papers', onClick: clearFilters },
    {
      label: 'Request this paper',
      onClick: () => window.open(requestPaperUrl(), '_blank', 'noopener,noreferrer'),
    },
  ];
  const findTeacherLabel = subjectFilter ? `Find a teacher for ${subjectFilter}` : 'Find a teacher';

  const infiniteScrollRef = useInfiniteScroll({ hasMore, loading: loadingMore, onLoadMore: loadMore });

  // Handoff PR-006: this route renders its own eyes panel (papers mode).
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();
  useEffect(() => { setBuilderMode('papers'); }, [setBuilderMode]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Owner correction: edge-to-edge (0 gutter) is the intended
          pattern — a prior pass wrapped this in PageContainer/max-w-6xl,
          backwards from what the handoff actually calls for. */}
      <main className="flex-1">
      <BentoStack>
        {/* Handoff PR-001: one BentoPanel carries the back link, h1 and count
            tag — PageHeader's graph ground is dropped on this route. No
            separate in-panel logo/menu row (see PP-002's note — Home and
            Browse don't duplicate the floating Navbar pill either).
            Copy unchanged: `heading`, and the count tag's two strings. The
            entry's "weight 400 with a font-black span" doesn't say which
            substring is bold, and `heading` has no fixed trailing phrase to
            split on (unlike Browse's "in Kolkata") — rendered at the base
            weight rather than guessing a split point. */}
        <BentoPanel fill="papers" edge="top" className="px-[22px] pt-[14px] pb-[22px]">
          <Link
            to="/past-papers"
            className={`-m-1 mb-3 flex h-11 w-fit items-center gap-1.5 p-1 text-[13px] font-semibold text-white/75 transition-colors duration-tap ease-tap hover:text-white ${FOCUS}`}
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2.25} aria-hidden />
            Past Papers
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[27px] font-normal leading-[1.05] tracking-[-0.035em] text-white lg:text-[44px] lg:leading-[1.02] lg:tracking-[-0.04em]">
              {heading}
            </h1>
            <span
              /* P1-2/P2-5: a filter-driven refetch that already has a real
                 count on screen keeps showing it (and keeps its settled key)
                 instead of resetting to "Counting…" — that reset was its own
                 small skeleton-flash, on the count tag rather than the grid,
                 every time a filter changed. Only a genuine first load (no
                 papers, no total yet) gets the "Counting…" placeholder. */
              key={listLoading && shownTotal === 0 && shownPapers.length === 0 ? 'counting' : revealKey}
              /* Count-tag landing: a single scale/fade-in (card-reveal's own
                 curve) plus a once-only glow pulse under the tag, in the
                 first active subject filter's REAL palette color — the same
                 `getSubjectPalette` used by every subject chip/card, no new
                 color invented, and nothing fires without a real settled
                 count. Re-keyed only on revealKey (search settling), so
                 clicking through filters or scrolling never repeats it. */
              className={`inline-flex h-8 flex-none items-center whitespace-nowrap rounded-full bg-white/15 px-[14px] text-[13px] font-bold text-white ${
                listLoading && shownTotal === 0 && shownPapers.length === 0 ? '' : 'animate-card-reveal animate-count-glow motion-reduce:animate-none'
              }`}
              style={
                !(listLoading && shownTotal === 0 && shownPapers.length === 0) && subjectFilters[0]
                  ? ({ '--count-glow-color': `${getSubjectPalette(subjectFilters[0]).solid}99` } as CSSProperties)
                  : undefined
              }
            >
              {listLoading && shownTotal === 0 && shownPapers.length === 0
                ? 'Counting…'
                : `${shownTotal.toLocaleString('en-IN')} paper${shownTotal === 1 ? '' : 's'} found`}
            </span>
          </div>
        </BentoPanel>

        {/* R3S1: this route had no way to change or add to a search once
            landed on it -- only FilterChips below (remove a value) or "See
            teachers with these filters" (leave papers entirely). Reuses
            SearchControl itself (papers mode, same component /past-papers'
            hero and Browse already render) rather than a second bespoke
            control, pre-filled from this page's own URL params so editing
            starts from the search that's actually showing. Keyed on the
            params string so removing a chip below (which changes the URL,
            not this control's own internal state) remounts it in sync
            instead of drifting from what FilterChips now shows; typing here
            doesn't touch the URL until submit, so it never fights that key
            mid-keystroke. Collapsed at rest (no `inlineFacetsDesktop`) so it
            reads as one compact bar plus the existing chip row, not a second
            block pushing results below the fold on a 375px phone. */}
        <BentoPanel fill="card" className="px-4 py-3">
          <SearchControl
            key={searchParams.toString()}
            align="flex-start"
            /* Toggle hidden at rest (shown above the field once opened), as on
               the /past-papers hero: inline it squeezed the 375px field down to
               "Boar" of "Board, class, subject". */
            stackedToggle
            initialMode="papers"
            initialQuery={q}
            initialSelections={{
              subject: subjectFilters,
              cls: classFilters,
              board: boardFilters,
              school: schoolFilters,
            }}
          />
        </BentoPanel>

        {/* Handoff PR-002: sticky filter row becomes a BentoPanel pill row —
            no hairline, no blur, isolate kept (same compositing reason as
            Browse B-007). FilterChips.tsx's own S-006-matched tint and the
            handoff pill styling apply automatically. */}
        {/* lg:py-3 restates the mobile value on purpose. Without it BentoPanel's
            `lg:py-8` applies and this sticky bar becomes 108px tall at 1280 —
            64px of padding around a 44px control row, sitting under a 60px nav.
            D-003 excepts counter tiles for exactly this reason ("they stay
            compact; py-8 would make them tall boxes"); a sticky control bar has
            the same reason and simply is not in its table. Desktop Layouts.dc.html
            does not draw this screen, so this follows the spec's own logic. */}
        <BentoPanel fill="card" className="sticky top-[80px] z-20 isolate !px-0 !pl-4 py-3 lg:py-3">
          <FilterChips
            mode="papers"
            chips={filterChips}
            onClearAll={filterChips.length > 0 ? clearFilters : undefined}
            handoff={{ label: 'See teachers with these filters →', onClick: handleSeeTeachers }}
            className="pr-4"
          />
        </BentoPanel>

        {/* Handoff PR-003/PR-004: results live inside one BentoPanel; base
            grid is a single column at gap-[10px] (sm:/lg: unchanged). */}
        <BentoPanel fill="card" className="px-4 py-[18px]">
          {listLoading && shownPapers.length === 0 ? (
            // One coherent skeleton in the real grid's shape, not a spinner.
            // Only for a genuine first load — see the dimmed-in-place branch
            // below for a filter/search-driven refetch with results already
            // on screen (P1-2/P2-5: no re-skeleton-on-filter-tap).
            <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className={`h-48 rounded-2xl ${SKELETON}`} />
              ))}
            </div>
          ) : loadError ? (
            <EmptyResults
              tone="papers"
              heading="Unable to load papers right now"
              message="This is on us, not necessarily on your connection. Try again."
              action={{ label: 'Retry', onClick: retry }}
            />
          ) : /* shownPapers, not papers. This gated the whole result list on the
                 Supabase PDF rows alone while the count beside the heading used
                 the MERGED total, so any filter matching bank papers but no PDF
                 rows rendered "302 papers found" directly above "No papers match
                 all of those filters yet". It stayed hidden while every bank row
                 claimed to be Maths, which is the one subject with PDF rows to
                 carry it; correcting the bank's subjects surfaced it for all 302
                 History & Civics and 124 Economics papers. */
            shownPapers.length > 0 ? (
            <div
              // A subtle dim, not a re-skeleton, while a filter/search-driven
              // refetch is in flight over results already on screen — see the
              // `loading && shownPapers.length === 0` gate above for why this
              // branch (not the skeleton one) is what a filter tap now hits.
              className={loading ? 'opacity-60 transition-opacity duration-hover' : 'transition-opacity duration-hover'}
              aria-busy={loading || undefined}
            >
              <div className="stagger-children grid grid-cols-1 gap-[10px] sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
                {shownPapers.map((p) => (
                  <div key={p.id} className="animate-card-reveal motion-reduce:animate-none">
                    {/* Never locked: papers are soft-gated, not locked (CLAUDE.md), so the
                      first two questions of any bank paper read with no account.
                      A "Sign in to read" pill here promised a wall the paper
                      page does not have. /past-papers and Browse already
                      render these cards unlocked; the sign-in prompt belongs
                      on the paper itself, after the free questions. */}
                    <PaperSheetCard paper={p} />
                  </div>
                ))}
              </div>

              {/* Honest position-in-list readout, same as before. The tap-to-load
                  button under it is gone — the sentinel div below fires
                  loadMore() itself once it scrolls within 600px of view, so
                  the next page is already loading by the time the reader
                  gets there instead of waiting on a button they have to find.
                  Handoff PR-004: bg-card -> bg-muted (sits on a bone panel now), shadow-border removed. */}
              <div className="mt-8 flex flex-col items-center gap-3">
                <p className="text-meta tabular-nums text-muted-foreground">
                  Showing {shownPapers.length.toLocaleString('en-IN')} of {shownTotal.toLocaleString('en-IN')}
                </p>
                {bankHasMore ? (
                  <button
                    type="button"
                    onClick={() => setBankShown((n) => n + BANK_STEP)}
                    className={`inline-flex min-h-[44px] items-center justify-center rounded-full bg-foreground px-6 text-[14px] font-bold text-background transition-transform duration-tap ease-tap active:scale-[0.97] ${FOCUS}`}
                  >
                    Show {Math.min(BANK_STEP, bankMatches.length - bankShown).toLocaleString('en-IN')} more papers
                  </button>
                ) : hasMore ? (
                  <div ref={infiniteScrollRef} className="flex h-12 items-center gap-2 text-[14px] font-bold text-muted-foreground" aria-hidden={!loadingMore}>
                    {loadingMore && (
                      <>
                        <FileText className="h-4 w-4 animate-pulse" strokeWidth={2} aria-hidden="true" />
                        Loading…
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-meta text-muted-foreground">That's every paper matching these filters.</p>
                )}
              </div>
            </div>
          ) : (
            <EmptyResults
              tone="papers"
              heading="No papers match all of those filters yet"
              message="The collection is still growing. Drop a filter, browse everything we have, ask us to add this paper, or find a teacher instead."
              options={emptyStateOptions}
              action={{ label: findTeacherLabel, onClick: handleSeeTeachers }}
            />
          )}
        </BentoPanel>

        {/* Handoff PR-005: ownership panel, BentoPanel fill="dark". */}
        <BentoPanel fill="dark" className="p-[22px]">
          <h2 className="font-display text-[21px] font-extrabold tracking-[-0.03em] lg:text-[26px]">Who owns these papers</h2>
          <p className="mt-3 max-w-prose text-[14px] leading-[1.55] text-white/75 lg:text-[16px] lg:leading-[1.65]">
            Every paper here is the property of the school that set it. Shikshaq claims no
            ownership, derives no revenue from any paper, and hosts these materials solely as a
            free revision resource.
          </p>
        </BentoPanel>

        {/* Handoff PR-006: shared tail, identical to Home/PastPapers. */}
        <EyesPanel
          mode={builderMode}
          onModeChange={setBuilderMode}
          heading={(
            <>
              Need a paper? <span className="font-extrabold">We keep an eye out.</span>
            </>
          )}
          subline="Fill in the blanks and we'll take you straight there."
          slots={builderSlots}
          onSlotChange={handleSlotChange}
          onSubmit={handleBuilderSubmit}
        />
      </BentoStack>
      </main>

      {/* Back to top — sits above the bottom tab bar on mobile. */}
      {showTop && (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label="Back to top"
          className={`animate-card-reveal fixed bottom-24 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background shadow-border transition-transform duration-tap ease-tap active:scale-[0.97] motion-reduce:animate-none lg:bottom-8 lg:right-8 ${FOCUS}`}
        >
          <ArrowUp className="h-6 w-6" strokeWidth={2.25} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
