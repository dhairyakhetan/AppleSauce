import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, ChevronDown, FlaskConical, Languages, Calculator, Brain, Landmark as LandmarkIcon, Dna, Monitor, Wallet, FileText, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { SearchControl } from '@/components/SearchControl';
import { loadPaperIndex, hasYear } from '@/lib/question-bank';
import { countPapers, isComingSoon, type ComingSoonShape } from '@/lib/readable-papers';
import { coverPaper, coverMeta } from '@/lib/paper-cover-mapping';
import { EmptyResults } from '@/components/EmptyResults';
import { usePageMeta } from '@/hooks/usePageMeta';
import { supabase } from '@/integrations/supabase/client';
import { SUBJECTS, CLASSES, BOARDS } from '@/utils/searchFacets';
import { facetView, orderFacets } from '@/lib/facet-list';
import { bankSubjectToSite } from '@/lib/subject-vocabulary';
import { getSubjectPalette } from '@/lib/subject-palette';
import { getWhatsAppLink } from '@/utils/whatsapp';
import { useAuth } from '@/lib/auth-context';
import { PaperCover, ShelfLedge } from '@/components/papers/paper-cover';import { IconDisc } from '@/components/ui/icon-disc';
import { PullToRefresh } from '@/components/devices/PullToRefresh';
import { schoolSlug } from '@/lib/school-slug';
import { displaySchool, isRealSchoolLabel } from '@/lib/school-display';
import { generateCollectionPageSchema } from '@/utils/structuredDataGenerators';
import { ROUTE_META } from '@/content/route-meta';
import { injectSchemas } from '@/utils/injectSchemas';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useChromeConfig } from '@/components/layout/AppShell';
import { BROWSE_PATH } from '@/lib/nav-config';

/* One definition for every section heading on this page.

   They had drifted: five were text-[21px] lg:text-[26px], one was
   text-[19px], and the class ORDER varied between them enough that you could
   not tell at a glance whether two headings were the same size. Deliberate
   variants (the centred one, the one on the dark panel) now compose on top of
   this instead of restating the whole string.

   Deliberately NOT text-section-head. That token is clamp(27px..46px); this
   page's heads are 21..26px. Whether the page or the token is right is a real
   open question, but making them agree is a visual change to every section
   head on the page, not a cleanup, so it is not made here. */
const SECTION_H2 = 'font-display text-[21px] font-extrabold tracking-[-0.03em] lg:text-[26px]';


/* Section switches. `bySchool` is off by request: with the question bank in,
   "by school" is 100 entries of which most hold a single paper, so the grid
   read as a directory rather than a way in. Subject, board and class are the
   cuts that actually narrow things. The query and markup are untouched, so
   this is one boolean to bring it back. */
const FEATURES = { bySchool: false, mostRead: false };

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
  created_at: string;
}

interface MostReadPaper {
  paper_id: string;
  title: string;
  school: string;
  read_count: number;
}

interface SchoolStat {
  /** The merged display label (school-display.ts) -- may cover several raw
   *  bank_papers.school / papers.school spellings. */
  school: string;
  /** The slug the row links to: the raw spelling whose own display equals
   *  the label, or (when none is self-canonical) the raw spelling with the
   *  most papers -- same rule SchoolPage.tsx and question-bank.ts's
   *  schoolGroupsOfPapers use. */
  slug: string;
  board: string;
  count: number;
  otherBoardCount: number;
}

const CONTAINER = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8';
// One vertical rhythm for the whole stack below the hero: every section
// contributes its own bottom gap only (no per-section top padding fighting
// the previous section's bottom padding), so the page reads as one
// consistent beat instead of ad-hoc pb-8/pb-12/pb-[24px] values that used
// to drift section to section. Sub-element gap (heading -> its content) is
// exactly half of this, mb-3 (12px) against pb-10/14 (40/56px).
const SKELETON = 'bg-gradient-to-r from-muted via-background to-muted bg-[length:200%_100%] animate-shimmer';
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const FOCUS_BLUE =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const PAPER_CLASSES = CLASSES.filter((c) => c !== 'UG');

type GroupMode = 'subject' | 'board';

const SUBJECT_ICON: Record<string, typeof BookOpen> = {
  Chemistry: FlaskConical, Hindi: Languages, English: BookOpen, Maths: Calculator,
  Mathematics: Calculator, Psychology: Brain, Economics: Wallet, Biology: Dna,
  Computers: Monitor, Computer: Monitor, Accounts: LandmarkIcon,
};

// NOTE ON COPY (kept truthful — see PaperReader.tsx's print-CSS comment):
// `file_url` points at a PUBLIC Supabase bucket, so downloading and printing
// are NOT blocked and this page must never say they are. Earlier copy here
// read "No download, no app, no print" and "Nothing to download", which
// asserted a restriction the product does not enforce. Rewritten to say what
// is actually true: papers open in the browser and cost nothing.
const PAPER_STEPS = [
  { n: '01', icon: Search, title: 'Find the paper', body: 'Search by school, subject, class or board, or browse the sections below.' },
  { n: '02', icon: FileText, title: 'Read it here', body: 'Papers open right in the browser. No app to install, nothing to buy.' },
  { n: '03', icon: ShieldCheck, title: "It's free, always", body: "Shared by students, for students. We don't charge for a single page." },
];

/**
 * Unified loading treatment. Previously each section rendered the moment its
 * own slice of state arrived, so on a slow connection the page assembled
 * itself in four visible jumps and looked half-broken in between. All four
 * queries already resolve together in one Promise.all — this just holds the
 * whole shelf behind one skeleton until they do, in the shape of the real
 * content (DESIGN_SYSTEM §9).
 */
function ShelfSkeleton() {
  return (
    <div className={`${CONTAINER} pb-12`} aria-hidden="true">
      <div className={`h-12 w-full max-w-3xl rounded-2xl ${SKELETON}`} />
      <div className={`mt-6 h-16 w-48 rounded-2xl ${SKELETON}`} />
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => <div key={i} className={`h-48 rounded-2xl ${SKELETON}`} />)}
      </div>
      <div className={`mt-12 h-56 rounded-4xl ${SKELETON}`} />
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <div key={i} className={`h-32 rounded-2xl ${SKELETON}`} />)}
      </div>
    </div>
  );
}

export default function PastPapers() {
  // 58 chars. Wording lives in content/route-meta.ts so the prerendered copy matches.
  usePageMeta(ROUTE_META.pastPapers.title, ROUTE_META.pastPapers.description);

  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const [groupMode, setGroupMode] = useState<GroupMode>('subject');
  // By subject / By board: a search over the headings and a "Show all" for the rest.
  const [facetQuery, setFacetQuery] = useState('');
  const [facetExpanded, setFacetExpanded] = useState(false);

  // Handoff PP-014: this route renders its own eyes panel (papers mode),
  // replacing AppShell's B3 pre-footer.
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();
  useEffect(() => { setBuilderMode('papers'); }, [setBuilderMode]);


  // The old /past-papers route used to render results inline; that's now the
  // dedicated /past-papers/results route (see PaperResults.tsx). SearchControl,
  // Browse's mode-handoff, and a couple of older internal links still commit to
  // /past-papers with filter/q params attached (they're outside this task's
  // edit scope), so this redirect keeps them working instead of silently
  // stranding those params on the landing page.
  const hasFilters = searchParams.toString().length > 0;

  /* Landing-page data. Migrated from useEffect+useState onto react-query:
     QueryClient was configured app-wide in App.tsx but useQuery appeared in no
     file, so every page hand-rolled its own loading/error/cancellation and
     leaned on a separate localStorage TTL cache. The four queries and their
     derivations are unchanged — only who owns the async state changed.

     staleTime is generous: a paper catalogue changes rarely, and remounting
     this route should not refetch four times. */
  const landing = useQuery({
    queryKey: ['past-papers', 'landing'],
    enabled: !hasFilters,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [schoolsRes, recentRes, subjectsRes, countRes, readRes] = await Promise.all([
        supabase.from('papers').select('school,board').eq('is_published', true),
        supabase.from('papers').select('id,title,school,subject,class,board,exam_type,year,created_at').eq('is_published', true).order('created_at', { ascending: false }).limit(6),
        supabase.from('papers').select('subject').eq('is_published', true),
        supabase.from('papers').select('id', { count: 'exact', head: true }).eq('is_published', true),
        /* Most-read joins the batch. It shares no input with the four above
           and nothing derives from it, so awaiting it afterwards was a free
           serial round trip before the shelf could render. */
        supabase.from('paper_read_stats').select('paper_id, title, school, read_count')
          .order('read_count', { ascending: false }).limit(3),
      ]);

      const firstError = schoolsRes.error || recentRes.error || subjectsRes.error || countRes.error;
      if (firstError) throw firstError;

      const boardCounts: Record<string, number> = {};
      (schoolsRes.data || []).forEach((p) => { boardCounts[p.board] = (boardCounts[p.board] || 0) + 1; });

      const subjectCounts: Record<string, number> = {};
      (subjectsRes.data || []).forEach((p) => { subjectCounts[p.subject] = (subjectCounts[p.subject] || 0) + 1; });

      /* Most read (pages.md §4 section 6). Reads come from paper_read_stats,
         a public aggregate view — individual reads stay behind RLS in
         paper_reads and never leave it. Papers nobody has opened are excluded
         rather than listed at zero, so the panel disappears entirely on a
         library nobody has read yet instead of ranking a column of noughts. */
      const readRows = readRes.data;

      return {
        /* Raw (school, board) rows, not pre-grouped: grouping now has to
           happen once, after the bank's rows are folded in too (the
           schoolStats memo below), so a raw spelling that only differs
           between the table and the bank still merges into one label
           instead of producing two rows. */
        schoolRows: (schoolsRes.data || []) as { school: string; board: string }[],
        boardCounts,
        subjectCounts,
        recentPapers: (recentRes.data || []) as Paper[],
        totalPapers: countRes.count ?? 0,
        mostRead: ((readRows || []) as MostReadPaper[]).filter((r) => r.read_count > 0),
      };
    },
  });

  /* New-paper count (pages.md §4 section 1) — "per-user data this schema
     does not have" until paper_reads provided it. Keyed on the user id so
     one reader's number can never be served from another's cache entry,
     and skipped entirely when signed out. The weekly-read-count half of
     this query (and the streak pill it fed) was removed per owner review;
     newCount is still real, still live, still the only thing this query
     now exists for. */
  const personal = useQuery({
    enabled: Boolean(user),
    queryKey: ['papers', 'personal', user?.id],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const lastRead = await supabase
        .from('paper_reads')
        .select('read_at')
        .order('read_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      /* "New" means published since you last opened anything. A reader who has
         never opened a paper has no "since", so the clause is dropped rather
         than defaulting to the whole library and calling all of it new. */
      let newCount: number | null = null;
      if (lastRead.data?.read_at) {
        const { count } = await supabase
          .from('papers')
          .select('id', { count: 'exact', head: true })
          .eq('is_published', true)
          .gt('created_at', lastRead.data.read_at);
        newCount = count ?? 0;
      }

      return { newCount };
    },
  });

  const newPaperCount = personal.data?.newCount ?? null;

  /* The 193 question-bank papers are papers on this surface too, not a
     separate collection behind their own page. Loaded once, cached forever
     (a static asset never goes stale), and mapped into the same shape the
     database rows use so everything below treats them identically. */
  const bankQuery = useQuery({
    queryKey: ['past-papers', 'bank'],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<Paper[]> =>
      /* board is the board, year is a year -- subject is mapped to the SITE
         vocabulary ("Maths"), not the raw bank spelling ("Mathematics"): it
         feeds coverMeta()'s displayed meta line directly (not just the
         title), and every other subject-facing surface on the site already
         reads "Maths" -- see subject-vocabulary.ts for the full history of
         this exact bug. The cover's own display mapping is built at the call
         site (coverPaper below), so presentation never corrupts the data
         it is drawn from. */
      (await loadPaperIndex()).map((b) => {
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
          file_url: null,
          created_at: '',
          _bankYear: b.year,
          _questions: b.questionCount,
          _isBoard: b.isBoardPaper,
          _needsReview: b.needsReview,
        };
      }),
  });
  /* Memoised on the query data, not written as `?? []` inline: a fresh []
     every render is a new identity, which invalidated all three useMemos
     below on every single render and re-derived the facets each time. */
  const bankPapers = useMemo(() => bankQuery.data ?? [], [bankQuery.data]);

  /* coverPaper()/coverMeta() (how a bank paper is drawn on a cover — eyebrow,
     headline and the meta lines under it) now live in paper-cover-mapping.ts,
     shared with Index.tsx's home rail. */

  /* Facets count the bank papers too. Without this the board row, the subject
     row and the "By school" grid all described only the 18 database papers
     while the page's own heading claimed 211 — the counts and the total
     disagreed on the same screen. */
  const schoolStats = useMemo<SchoolStat[]>(() => {
    /* Keyed on the DISPLAY LABEL (school-display.ts), not the raw name: two
       raw spellings from either source that share a label ("Gregorios" /
       "St Gregorios" / "St. Gregorios High School") are one real school and
       must not become two half-populated rows. "candidates" tracks paper
       count PER RAW NAME, which picking a canonical slug below needs. */
    const bySchool = new Map<string, { boards: Map<string, number>; candidates: Map<string, number> }>();
    const add = (rawName: string, board: string | null) => {
      const label = displaySchool(rawName);
      if (!isRealSchoolLabel(label)) return;
      const entry = bySchool.get(label) ?? { boards: new Map<string, number>(), candidates: new Map<string, number>() };
      if (board) entry.boards.set(board, (entry.boards.get(board) ?? 0) + 1);
      entry.candidates.set(rawName, (entry.candidates.get(rawName) ?? 0) + 1);
      bySchool.set(label, entry);
    };
    (landing.data?.schoolRows ?? []).forEach((p) => add(p.school, p.board));
    bankPapers.forEach((p) => add(p.school, p.board));

    return Array.from(bySchool.entries())
      .map(([label, { boards, candidates }]) => {
        let dominantBoard = '';
        let dominantCount = 0;
        let total = 0;
        boards.forEach((count, board) => {
          total += count;
          if (count > dominantCount) { dominantCount = count; dominantBoard = board; }
        });
        /* Canonical: the raw spelling whose OWN display equals the label (no
           lookup table needed to justify the URL), else the raw spelling
           with the most papers. */
        const rawNames = Array.from(candidates.keys());
        const selfCanonical = rawNames.find((raw) => displaySchool(raw) === raw);
        const canonicalRaw = selfCanonical
          ?? rawNames.reduce((best, raw) => (
            (candidates.get(raw) ?? 0) > (candidates.get(best) ?? 0) ? raw : best
          ));
        return {
          school: label,
          slug: schoolSlug(canonicalRaw),
          board: dominantBoard,
          count: dominantCount,
          otherBoardCount: total - dominantCount,
        };
      })
      .sort((a, b) => a.school.localeCompare(b.school));
  }, [landing.data, bankPapers]);
  const mostRead = landing.data?.mostRead ?? [];
  /* Bank papers lead: they read as questions rather than as a scan, which is
     the better thing to land on. */
  /* Sorted, and memoised for the same reason bankPapers is: a fresh array
     each render is a new identity downstream. It is ordered by EXAM year with
     undated papers last, not by when a paper was added (bank rows carry no
     added-date), so it is labelled "Latest papers" and not "Recently added":
     a 2019 paper must never read as "just added". */
  const recentPapers = useMemo(() => {
    const merged = [...bankPapers, ...(landing.data?.recentPapers ?? [])];
    return merged.sort((a, b) => (b.year || 0) - (a.year || 0));
  }, [bankPapers, landing.data]);

  /* A shelf is a shelf, not the whole library. This rail was rendering every
     paper: 199 covers across 33,000px of horizontal scroll, which is not a
     browsing gesture anyone completes, and 199 cover images on first paint.
     Twelve is a shelf you can actually reach the end of, and the end of it is
     a door to the rest. */
  const SHELF_LIMIT = 12;
  const shelfPapers = useMemo(() => recentPapers.slice(0, SHELF_LIMIT), [recentPapers]);
  const subjectCounts = useMemo(() => {
    const out: Record<string, number> = { ...(landing.data?.subjectCounts ?? {}) };
    // p.subject is the raw bank spelling ("Mathematics"); SUBJECTS/
    // featuredSubjects below key on the SITE spelling ("Maths"). Every other
    // bank subject happens to spell identically in both vocabularies, so
    // this was the one row invisible in "By subject" despite having papers.
    bankPapers.forEach((p) => {
      const site = bankSubjectToSite(p.subject) || p.subject;
      out[site] = (out[site] ?? 0) + 1;
    });
    return out;
  }, [landing.data, bankPapers]);
  const boardCounts = useMemo(() => {
    const out: Record<string, number> = { ...(landing.data?.boardCounts ?? {}) };
    bankPapers.forEach((p) => { out[p.board] = (out[p.board] ?? 0) + 1; });
    return out;
  }, [landing.data, bankPapers]);
  /* Readable bank papers only (lib/readable-papers.ts): the Coming soon cards
     below stay on the shelf and in the library but are not a total, so this
     matches the footer, home and About. */
  const totalPapers = (landing.data?.totalPapers ?? 0) + countPapers(bankPapers as ComingSoonShape[]).ready || null;
  /* Same number under the name the "free to read" copy has always used. */
  const totalFreePapers = totalPapers;
  /* Same idea as home's adaptive hero (resolveHeroCopy) and the footer's
     sign-off pool: the signed-in "N new papers waiting" branch below
     already varies per reader, but a first-time/signed-out visitor always
     landed on the exact same fixed sentence around the same real count.
     Picking a wording once per mount — never a different NUMBER, only the
     sentence around the one real totalPapers count already fetched — gets
     the same "the page feels alive" effect without inventing any data. */
  const genericHeadline = useMemo(() => {
    const pool: ((n: string) => ReactNode)[] = [
      (n) => (<>{n} past papers,<br /><span className="font-black">free to read</span></>),
      (n) => (<>{n} papers,<br /><span className="font-black">yours to read free</span></>),
      (n) => (<>Free access to<br /><span className="font-black">{n} real past papers</span></>),
      (n) => (<>{n} papers shared<br /><span className="font-black">by students, for students</span></>),
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }, []);
  /* Was `!hasFilters && landing.isPending` alone — totalPapers sums TWO
     independent queries (landing's DB count + bankQuery's 193 static
     papers), but this only waited on landing. The moment landing resolved,
     loading flipped false and the header rendered whatever partial total
     existed at that instant (bankPapers still `[]` if bankQuery hadn't
     resolved yet), then re-rendered a bigger number a beat later once it
     did — "the number of papers show up randomly" (it wasn't random, it
     was two async counts landing at different times, only one of them
     actually gated). Both queries now hold the header back. */
  const loading = !hasFilters && (landing.isPending || bankQuery.isPending);
  /* Either source failing is an error. The bank index carries most of the
     library, so when only it failed the page used to render quietly with
     DB-only counts, empty facets and an empty shelf, describing a library that
     was not what had loaded. */
  const loadError = landing.isError || bankQuery.isError;

  // The search bar's Teachers/Papers toggle doubles as the page-mode switch.
  const handleSearchModeChange = (mode: 'teachers' | 'papers') => {
    if (mode !== 'teachers') return;
    navigate('/all-tuition-teachers-in-kolkata');
  };

  /* Every subject with a paper, not the first eight of a fixed list: the
     site's own order first, then anything else by size (lib/facet-list.ts). */
  const featuredSubjects = orderFacets(SUBJECTS, subjectCounts);
  /* BOARDS is the known, curated list (also used by the public submit-a-paper
     form and admin dropdowns, so it can't just gain a literal "Board" entry
     there). bank_papers legitimately has board values outside it -- 297 rows
     store the literal string "Board" (boardOf() in scripts/bank-source.ts,
     for papers it could not attribute to a specific board) -- and those were
     silently invisible in this facet despite outnumbering CBSE. Anything in
     boardCounts that isn't one of the known boards is appended, so a real,
     non-zero board value is never dropped just because it wasn't anticipated. */
  const featuredBoards = orderFacets(BOARDS, boardCounts);
  const subjectsCovered = Object.keys(subjectCounts).length;
  const activeFacets = groupMode === 'subject' ? featuredSubjects : featuredBoards;
  const facets = facetView(activeFacets, facetQuery, facetExpanded);
  const isEmptyCatalogue = !loading && !loadError && totalPapers === 0;

  // No structured data existed on this page at all — it's the index of every
  // past paper on the site, the same kind of listing page Browse/Subject/Board
  // pages already emit a CollectionPage schema for. Only fires once a real
  // count has resolved, matching the loading/empty guards above.
  useEffect(() => {
    if (loading || totalPapers == null || totalPapers === 0) return;
    injectSchemas([
      generateCollectionPageSchema({
        url: 'https://www.shikshaq.in/past-papers',
        name: 'Free past year question papers',
        description: `${(totalFreePapers ?? 0).toLocaleString('en-IN')} free past year question papers for CBSE, ICSE, ISC and West Bengal State Board exams.`,
        about: 'Past year question papers',
        numberOfItems: totalPapers,
      }),
    ]);
    return () => {
      const existing = document.getElementById('page-schemas');
      if (existing) existing.remove();
    };
  }, [loading, totalPapers, totalFreePapers]);

  const requestPaperUrl = `${getWhatsAppLink('8240980312')}?text=${encodeURIComponent(
    "Hi! I'm looking for a past paper on Shikshaq, could you add it?"
  )}`;

  if (hasFilters) {
    return <Navigate to={`/past-papers/results?${searchParams.toString()}`} replace />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Owner correction: edge-to-edge (0 gutter) is the intended
          pattern — a prior pass wrapped this in PageContainer/max-w-6xl,
          backwards from what the handoff actually calls for. */}
      <main className="flex-1">
      <PullToRefresh onRefresh={() => landing.refetch()} disabled={hasFilters}>
      <BentoStack>
        {/* ------------------------------------------------------------- Hero */}
        {/* D4 "Papers library" hero: saturated indigo band with two soft
            radial blobs, a centered Archivo-900 headline, lede and sign-in
            CTA. The mockup's headline ("You have 12 new papers waiting on
            your shelf") and the streak/goal-ring pill both depend on
            per-user data this schema does not have (no streak table, no
            per-user new-paper count) — both are now REAL, from paper_reads,
            and render only for a signed-in reader who has opened something.
            The headline still falls back to the total published count for
            everyone else.
            Handoff PP-002: BentoPanel fill="papers" edge="top" — square-topped,
            30px bottom corners. No separate in-panel logo/menu row added: per
            Home (H-002) and Browse (B-003b), the floating Navbar pill already
            carries that, and this route doesn't duplicate it either.

            Owner request: the dashed shelf tray of cover cards that used to
            peek out of this band's bottom edge is gone, and the search bar
            (formerly its own BentoPanel below the hero) now lives inside
            this same panel instead — mirrors Index.tsx's hero, where the
            greeting content is directly followed by SearchDesk
            (src/pages/Index.tsx:788, src/components/home/SearchDesk.tsx)
            with no gap between them. Here the search card is nested in the
            hero panel itself rather than a sibling panel, because this
            hero is a saturated colour (indigo) and Index's is plain card —
            floating a bg-card box on top of it is this page's own
            "colours-on-blue" version of that same pairing. */}
        <BentoPanel fill="papers" edge="top" className="relative overflow-hidden px-4 pt-[14px] pb-6 sm:px-6 sm:pb-8 lg:px-8 lg:pb-10">
          <span aria-hidden className="pointer-events-none absolute -left-10 top-5 h-[180px] w-[180px] rounded-full bg-white/[.06] sm:h-[240px] sm:w-[240px]" />
          <span aria-hidden className="pointer-events-none absolute -right-10 top-16 h-[210px] w-[210px] rounded-full bg-white/[.06] sm:h-[280px] sm:w-[280px]" />

          <div className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
            {/* "N of 5 this week" streak pill removed — per owner review it
                read as a top-of-page counter (design.md's own "never a
                fabricated/empty row" logic doesn't apply, it was real, but
                it's still a distraction stacked right above the headline
                whose whole job is to be the one thing said at a glance). */}
            <h1 className="font-display text-[34px] font-normal leading-[.98] tracking-[-0.03em] text-white sm:text-[52px] lg:text-[74px] lg:leading-[.94] text-balance">
              {/* "You have N new papers waiting on your shelf" (pages.md §4.1)
                  when there genuinely are new ones for THIS reader — published
                  since the last paper they opened. Falls back to a wording
                  picked once per mount from genericHeadline (real count,
                  varied sentence — same idea as home's adaptive hero), then
                  to the plain fallback line, so the headline always states
                  something true rather than reaching for the personal
                  version and finding nothing. */}
              {newPaperCount != null && newPaperCount > 0 ? (
                <>
                  You have {newPaperCount.toLocaleString('en-IN')} new paper
                  {newPaperCount === 1 ? '' : 's'},<br /><span className="font-black">waiting on your shelf</span>
                </>
              ) : !loading && !loadError && totalFreePapers != null && totalFreePapers > 0 ? (
                genericHeadline(totalFreePapers.toLocaleString('en-IN'))
              ) : (
                <>Past papers from{' '}<br /><span className="font-black">schools across India</span></>
              )}
            </h1>
            {/* Was a school-count + "classes 9 to 12" range ("From 6 schools
                across ICSE, CBSE and ISC, classes 9 to 12...") — owner mobile
                QA: a number range under the H1 read as a stray stat, not a
                sentence. Rewritten as plain descriptive copy with no invented
                or fragile-looking numbers, matching the tone of the B3
                pre-footer's "Real school papers, shared by students, free to
                read." headline just below on this same page. */}
            <p className="mt-3 max-w-[62ch] text-[15px] leading-[1.55] text-white/[.82] sm:mt-4 sm:text-[18px]">
              {/* Not "from Kolkata schools" any more: the question bank added
                  193 ICSE and CBSE papers, and while some are Kolkata ones
                  (La Martiniere, Bhavan's, DPS Joka, Don Bosco Park Circus)
                  most are from schools elsewhere in India. Saying Kolkata
                  would be plainly untrue on the same screen that lists them. */}
              Real ICSE, CBSE and ISC papers, shared by students. Free to read, with marking schemes where the boards publish them.
            </p>
            {/* Owner mobile QA: "Sign in free to read" here was a second,
                premature sign-in CTA above the fold — the gate a reader
                actually hits is the lock disc on a locked cover (below) or
                the PaperGate sheet it opens, both of which already name the
                paper and ask to sign in. A signed-out visitor gets no
                competing button here; a signed-in one still gets a real
                shortcut into the full list. */}
            {user && (
              <button
                onClick={() => navigate('/past-papers/results')}
                className={`mt-5 flex h-[54px] min-h-11 w-fit items-center gap-2.5 rounded-full bg-warm-card pl-[26px] pr-6 text-[16px] font-extrabold text-brand-blue-deep transition-transform duration-hover ease-settle hover:-translate-y-0.5 active:scale-[0.97] motion-reduce:hover:translate-y-0 ${FOCUS_BLUE}`}
              >
                Browse every paper
                <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Search, moved up into the hero fold. Same SearchControl, same
              props and handlers as before (only the placement moved) — a
              bg-card box floated on the indigo band, directly under the
              lede/CTA with no gap, the same adjacency Index.tsx gives its
              own greeting-panel + SearchDesk pairing.
              Handoff PP-007: H-009 field metrics via heroDesk (submit disc
              is bg-brand-blue automatically — SearchControl's accent
              already switches on mode, and this control's mode is papers).

              No max-w here (was max-w-3xl): inlineFacetsDesktop pins the
              field to `xl:max-w-lg` and lays the four facet chips + a
              Search button out BESIDE it at xl+ (SearchControl.tsx's own
              `xl:left-[calc(100%+12px)]` row) — that assembly needs close
              to this panel's full available width to avoid the chips
              running past the card (and this panel's own `overflow-hidden`
              clipping them), the same width this control always had before
              it was nested in a card (the standalone BentoPanel it used to
              sit in carried no max-w either). SearchControl.tsx's own
              inlineFacetsDesktop breakpoint moved from `lg` (1024) to `xl`
              (1280) as part of this same fix — at 1024, even with this
              card at full width, there wasn't room for both the shrunk
              field and the chip row + Search button side by side; below xl
              the chips now wrap under the field instead, the same fallback
              they already used below lg. inlineFacetsDesktop has exactly
              one caller (this one), so that breakpoint change is scoped to
              this page.

              This card's OWN box is never inset further than this hero
              panel's own padding (16/24/32px at base/sm/lg) — that's what
              stays concentric with the panel's rounded-bento (30px) corner
              (30 - 16 = 14, both on the design's radius scale; this is the
              value that matters for nesting, not the horizontal padding
              below, which only spaces this card's own children).

              Horizontal padding on that content is px-0 below sm: at 375px
              the field (`isNarrow`'s short "Board, class, subject"
              placeholder, ~154px of text) was measured actually clipping
              inside a padded card — the field's own internal pl-[18px] and
              the Search button already give it plenty of breathing room
              from the card's rounded edge, so a second layer of card
              padding was pure loss on a screen with none to spare. From sm:
              up there is room again, so sm:px-4 restores it — and leaves
              plenty of width free for the chip row at xl either way.
              pb-24, only lifting at xl (not lg): the chip row is still
              wrapping under the field through lg per the breakpoint change
              above, so it needs the same bottom padding as below lg all
              the way to xl. */}
          {/* 2026-09-26 mobile overflow fix: px-0 left the field's 24px
              corners flush against this card's 14px ones, and pb-24 was a
              guess at the absolutely-positioned chip rows' height that lost
              once they wrapped to two rows. The chip row is now in flow below
              xl (SearchControl), so plain p-2 fits it, and 24 + 8 = 32 keeps
              the corners concentric. -mx-1 below sm buys back the width the
              padding costs so "Board, class, subject" still fits at 375. */}
          <div className="relative -mx-1 mt-6 rounded-[32px] bg-card p-2 sm:mx-auto sm:mt-8 sm:w-full">
            <SearchControl align="flex-start" stackedToggle heroDesk initialMode="papers" onModeChange={handleSearchModeChange} inlineFacetsDesktop />
          </div>
        </BentoPanel>

        {/* Board tabs (D4) removed per explicit request: SearchControl above
            already exposes Board as one of its four facet chips (subject,
            class, board, school — PAPER_FACET_KEYS), so this was the same
            "pick a board" entry point twice on one page. featuredBoards/
            boardCounts stay — the "By subject & board" toggle further down
            still uses them. */}

        {loading && <ShelfSkeleton />}

        {/* ----------------------------------------------------- Latest papers */}
        {/* C-055: papers as objects standing on a shelf ledge, not a row of
            cards — PaperCover (C2) + ShelfLedge (C4). Locked covers (26px
            lock disc) when signed out, per design.md §6.5: browsing is
            open, opening is not.
            Handoff PP-008: BentoPanel, heading+rail get px-[22px]. */}
        {!loading && !loadError && recentPapers.length > 0 && (
          <BentoPanel fill="card" className="!px-0 !py-[22px] lg:!py-8">
            {/* The "Sign in to read" pill that used to sit beside this
                heading was a second extraneous sign-in CTA (owner mobile
                QA) — the actual gate lives on each locked cover's 28px
                lock disc below, which already opens PaperGate naming the
                paper. Nothing else needs to ask twice. */}
            <h2 className={`mb-3 px-[22px] ${SECTION_H2} text-foreground`}>Latest papers</h2>
            <div className="px-[22px]">
              <ShelfLedge>
                {shelfPapers.map((p) => (
                  <PaperCover
                    key={p.id}
                    paper={coverPaper(p)}
                    meta={coverMeta(p)}
                    /* Bank papers get a generated tint; papers-table rows keep
                       their own cover. `_questions` identifies a bank row --
                       see coverPaper() for why that replaced a file_url test. */
                    tintKey={(p as { _questions?: number })._questions !== undefined ? `${p.school}-${p.id}` : undefined}
                    href={`/past-papers/${p.id}`}
                    /* Not auth-locked for now: reading is the point, and a
                       gate on a free library only stops people seeing it. */
                    locked={false}
                    comingSoon={isComingSoon(p as ComingSoonShape)}
                    size="desktop"
                    className="animate-card-reveal motion-reduce:animate-none !h-[228px] !w-[150px]"
                  />
                ))}
                {/* The end of the shelf is where someone is already looking
                    when they run out of covers, so that is where the way to
                    the rest belongs. Sized and aligned as a cover so the rail
                    keeps one rhythm; dashed rather than filled so it reads as
                    a door and not as another paper. */}
                {recentPapers.length > SHELF_LIMIT && (
                  <Link
                    to="/past-papers/results"
                    className="group flex h-[228px] w-[128px] flex-none flex-col items-center justify-center gap-2 rounded-[6px_16px_16px_6px] border-2 border-dashed border-warm-band bg-muted/40 px-3 text-center transition-transform duration-hover ease-settle hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:hover:translate-y-0"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-blue text-brand-blue-foreground transition-transform duration-hover ease-settle group-hover:translate-x-0.5">
                      <ArrowRight className="h-[17px] w-[17px]" aria-hidden="true" />
                    </span>
                    <span className="text-[14px] font-bold leading-[1.3] tracking-[-0.01em] text-foreground">
                      {/* totalPapers, not this shelf's own length: the headline
                          above counts the whole library and the two must not
                          disagree on the same screen. */}
                      All {totalPapers ?? recentPapers.length} papers
                    </span>
                    <span className="text-[12px] leading-[1.35] text-warm-secondary">
                      Filter by subject, board or class
                    </span>
                  </Link>
                )}
              </ShelfLedge>
            </div>
          </BentoPanel>
        )}

        {/* ------------------------------------------------------- Error state */}
        {loadError && (
          <BentoPanel fill="card">
            <EmptyResults
              tone="papers"
              heading="Unable to load the paper collection right now"
              message="This is on us, not on your connection necessarily. Try again and it usually comes straight back."
              action={{
                label: 'Try again',
                onClick: () => {
                  // Re-run only what failed; no full page reload (CRAFT 4).
                  if (landing.isError) void landing.refetch();
                  if (bankQuery.isError) void bankQuery.refetch();
                },
              }}
            />
          </BentoPanel>
        )}

        {/* --------------------------------------------- Global-zero empty state */}
        {/* LOUD moment (VISUAL_DIRECTION §4): nothing is being compared here,
            so the collage grammar is fully permitted — thick outline, offset
            shadow, halftone grain, a rotated sticker. This is the single
            highest-leverage screen on the papers surface: it is where a
            first visitor to a sparse catalogue currently dead-ends. */}
        {isEmptyCatalogue && (
          <BentoPanel fill="papersTint" className="halftone-overlay relative">
            {/* Indigo, not the orange brand token — papers mode carries no
                orange (devices.md §5 sticker, tone=papers). */}
            {/* D-007: flatten at lg. `.sticker-rotate-md` (index.css) is a plain
                CSS class outside Tailwind's cascade order, so a `lg:rotate-0`
                utility can't reliably out-specificity/out-order it — swapped
                for the equivalent Tailwind rotate utilities (same 5deg tilt)
                so the `lg:` variant actually wins at the breakpoint. */}
            <span className="sticker rotate-[5deg] motion-reduce:rotate-0 lg:rotate-0 animate-card-reveal absolute -top-3 right-6 rounded-full bg-brand-blue px-4 py-1 text-label font-bold uppercase text-white motion-reduce:animate-none">
              Day one
            </span>
            <EmptyResults
              tone="papers"
              className="bg-transparent shadow-none"
              icon={<FileText className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />}
              heading="The collection is just getting started"
              message="We're still gathering papers, nothing's uploaded yet. Tell us which paper you need and we'll chase it down, or find a teacher who can help in the meantime."
              options={[{ label: 'Browse teachers instead', onClick: () => navigate('/all-tuition-teachers-in-kolkata') }]}
              action={{
                label: 'Request a paper',
                onClick: () => window.open(requestPaperUrl, '_blank', 'noopener,noreferrer'),
              }}
            />
          </BentoPanel>
        )}

        {/* -------------------------------------------------------- Most read */}
        {/* pages.md §4 section 6: bg-muted rounded-3xl p-4, hairline rows, rank
            numeral in display type. Rendered only when something has actually
            been read — a "Most read" list of unread papers is not a ranking,
            it is three arbitrary rows.
            Handoff PP-009: BentoPanel fill="muted", radius 24 -> 30, hairline
            expressed as an inset shadow instead of divide-y. */}
        {FEATURES.mostRead && mostRead.length > 0 && (
          <BentoPanel fill="muted" className="!p-[18px]">
            <h2 className={`mb-3 ${SECTION_H2} text-foreground`}>
              Most read
            </h2>
            {/* D-005: one-column stack becomes a 2-up grid at lg (spec: "Papers
                by-school / most-read -> grid-cols-2"), mirroring the By-school
                grid below. Row divider (inset shadow on all but the last item)
                is unchanged — with at most 3 rows in mostRead this reads as a
                clean 2+1 grid, not a broken divider. */}
            <ol className="stagger-children grid grid-cols-1 lg:grid-cols-2 lg:gap-x-6">
              {mostRead.map((paper, i) => (
                <li
                  key={paper.paper_id}
                  className={`animate-card-reveal motion-reduce:animate-none ${i < mostRead.length - 1 ? 'shadow-[inset_0_-1px_0_rgba(231,223,213,.9)]' : ''}`}
                >
                  <a
                    href={`/past-papers/${paper.paper_id}`}
                    className={`flex min-h-11 items-center gap-3 py-3 transition-opacity duration-tap hover:opacity-80 ${FOCUS_BLUE}`}
                  >
                    <span className="w-6 flex-none font-display text-[22px] font-black leading-none text-warm-label">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block line-clamp-2 break-words text-[15px] font-bold text-foreground">{paper.title}</span>
                      <span className="block line-clamp-1 text-meta text-warm-meta">{displaySchool(paper.school)}</span>
                    </span>
                    <span className="flex-none text-meta tabular-nums text-warm-meta">
                      {/* "opened", not "read" — what is recorded is that
                          someone opened the paper. Nothing observes whether
                          they finished it, and the heading can say Most read
                          without the row claiming more than happened. */}
                      {paper.read_count} opened
                    </span>
                  </a>
                  </li>
                ))}
              </ol>
          </BentoPanel>
        )}

        {/* --------------------------------------------------------- By school */}
        {/* S4/D4: a flat list of school rows — each row is an initial disc +
            name + count + chevron.
            Handoff PP-010: wrapped in a BentoPanel; rows bg-card -> bg-muted,
            shadow-border removed (bone on bone). */}
        {/* Hidden for now, by request. With the question bank in, "by school"
            is 100 entries of which most hold a single paper, so the grid reads
            as a directory rather than a way in. Subject, board and class are
            the cuts that actually narrow things, and they stay. The query and
            the markup are left intact so this is one flag to bring back. */}
        {FEATURES.bySchool && !loading && !loadError && schoolStats.length > 0 && (
          <BentoPanel fill="card" className="p-[22px]">
            <h2 className={`mb-3 ${SECTION_H2} text-foreground`}>By school</h2>
            <div className="stagger-children grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-[10px]">
              {schoolStats.map(({ school, slug, board, count, otherBoardCount }) => {
                // `school` is already the merged display label; `slug` is
                // the group's canonical slug (schoolStats groups by label,
                // above) -- computing schoolSlug(school) here would slug the
                // LABEL text itself, which is not necessarily any raw
                // spelling's own slug.
                const label = school;
                return (
                /* A real link to the school's own page (S16), not a button that
                   pre-filters the results list. These rows were the "by-school
                   rows that go nowhere" a-to-z.md describes: a <button> has no
                   href, so a school could not be opened in a new tab, shared,
                   or reached by a crawler. */
                <Link
                  key={school}
                  to={`/school/${slug}`}
                  className={`flex min-h-11 animate-card-reveal items-center gap-3 rounded-2xl bg-muted px-[14px] py-3 text-left transition-transform duration-hover ease-settle hover:-translate-y-0.5 active:scale-[0.97] motion-reduce:animate-none motion-reduce:hover:translate-y-0 lg:px-[15px] lg:py-[13px] ${FOCUS_BLUE}`}
                >
                  {/* pages.md §4 row 7: "school initial tile 40px solid" — this
                      was tone="papers-subtle", the same pale indigo-on-pale
                      background the By-subject tiles use for their whole card
                      ground, not their icon tile. On a small 38px square that
                      washed-out pairing read as flat and low-contrast (owner
                      mobile QA: "really horribly designed"). Solid matches
                      the spec literally and the same tone already used for
                      the By-board tiles a few sections down. */}
                  <IconDisc
                    tone="papers"
                    size={40}
                    shape="square"
                    className="h-[38px] w-[38px] rounded-xl font-display text-[15px] font-extrabold"
                  >
                    {label.charAt(0).toUpperCase()}
                  </IconDisc>
                  <span className="min-w-0 flex-1">
                    <span className="block line-clamp-2 break-words text-[15px] font-bold text-foreground">{label}</span>
                    <span className="mt-px block text-[12px] tabular-nums text-muted-foreground">
                      {board} · {count} paper{count === 1 ? '' : 's'}
                      {otherBoardCount > 0 ? ` + ${otherBoardCount} more` : ''}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 flex-none text-warm-quaternary" aria-hidden="true" />
                </Link>
                );
              })}
            </div>
          </BentoPanel>
        )}

        {/* -------------------------------------------------------- By subject / board */}
        {/* Handoff PP-011: BentoPanel wrap; toggle track drops shadow-border
            on the active segment; subject rows become horizontal signposts
            at base (a tile grid returns from sm:). */}
        {!loading && !loadError && (featuredSubjects.length > 0 || featuredBoards.length > 0) && (
          <BentoPanel fill="card" className="p-[22px]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
              <h2 className={`${SECTION_H2} text-foreground`}>
                By {groupMode === 'subject' ? 'subject' : 'board'}
              </h2>
              {/* Segmented toggle mapped to the two real groupings this page
                  already fetches — subjectCounts and boardCounts. */}
              <div role="tablist" aria-label="Group papers by" className="inline-flex h-11 items-center rounded-full bg-muted p-1">
                {(['subject', 'board'] as GroupMode[]).map((mode) => (
                  <button
                    key={mode}
                    role="tab"
                    aria-selected={groupMode === mode}
                    onClick={() => {
                      setGroupMode(mode);
                      setFacetQuery('');
                      setFacetExpanded(false);
                    }}
                    className={`tap-44 flex h-9 items-center rounded-full px-[14px] text-[14px] font-bold capitalize transition-colors duration-tap ease-tap ${FOCUS} ${
                      groupMode === mode ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {facets.searchable ? (
              <label className="mb-4 flex max-w-sm flex-col gap-1">
                <span className="sr-only">Search {groupMode === 'subject' ? 'subjects' : 'boards'}</span>
                <span className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input
                    type="search"
                    value={facetQuery}
                    onChange={(e) => setFacetQuery(e.target.value)}
                    placeholder={`Search ${facets.total} ${groupMode === 'subject' ? 'subjects' : 'boards'}`}
                    className={`h-11 w-full rounded-full bg-muted pl-10 pr-4 text-[15px] text-foreground outline-none placeholder:text-muted-foreground ${FOCUS_BLUE}`}
                  />
                </span>
              </label>
            ) : null}
            {facets.shown.length === 0 ? (
              <p className="py-6 text-center text-body-secondary text-muted-foreground" role="status">
                No {groupMode === 'subject' ? 'subject' : 'board'} matches &ldquo;{facetQuery.trim()}&rdquo;.
              </p>
            ) : null}

            {/* RESPONSIVE FIX: this was `grid-cols-2` from 375px up, which put a
                42px icon tile, a 23px name and a count badge inside a ~160px
                column with 22px of padding — the audit's "cramped" finding. The
                base layout is now a single roomy column with the icon set BESIDE
                the label (a signpost read horizontally), flipping to the stacked
                tile from `sm:` where there is width for it. Same destinations,
                same counts, no truncation at 375. */}
            {/* Handoff PP-011: base rows are horizontal signposts —
                rounded-[18px] p-[14px], a 30x30 r10 solid icon tile, name
                19px/800/-0.03em, count right-aligned 12.5px/600. The existing
                stacked tile (sm:block, 40x40 icon, badge-pill count) returns
                unchanged from sm:. */}
            {groupMode === 'subject' ? (
              <div className="stagger-children grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
                {facets.shown.map((s) => {
                  const palette = getSubjectPalette(s);
                  const Icon = SUBJECT_ICON[s] || BookOpen;
                  const count = subjectCounts[s];
                  return (
                    <button
                      key={s}
                      onClick={() => navigate(`/past-papers/results?filter_subjects=${encodeURIComponent(s)}`)}
                      className={`flex min-h-11 animate-card-reveal items-center gap-4 rounded-[18px] p-[14px] text-left transition-transform duration-hover ease-settle hover:-translate-y-0.5 active:scale-[0.97] motion-reduce:animate-none motion-reduce:hover:translate-y-0 sm:block sm:rounded-2xl sm:p-6 ${FOCUS_BLUE}`}
                      style={{ backgroundColor: palette.tint }}
                    >
                      <span
                        className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] sm:h-10 sm:w-10 sm:rounded-lg sm:mb-6"
                        style={{ backgroundColor: palette.solid }}
                      >
                        <Icon size={21} strokeWidth={1.9} aria-hidden="true" style={{ color: palette.badgeText }} />
                      </span>
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-3 sm:block">
                        <span
                          className="block break-words text-[19px] font-extrabold tracking-[-0.03em] sm:text-card-title-lg sm:font-bold sm:tracking-normal"
                          style={{ color: palette.text }}
                        >
                          {s}
                        </span>
                        {/* Live count from the existing subjectCounts state —
                            never a literal zero, since featuredSubjects already
                            filters those out (DESIGN_SYSTEM §13). Base:
                            plain right-aligned text; sm+: the badge pill. */}
                        <span className="flex-none text-[13px] font-semibold tabular-nums sm:hidden" style={{ color: palette.meta }}>
                          {count} paper{count === 1 ? '' : 's'}
                        </span>
                        <span
                          className="mt-2 hidden items-center rounded-full px-3 py-1 text-label font-bold uppercase tabular-nums sm:inline-flex"
                          style={{ backgroundColor: palette.solid, color: palette.badgeText }}
                        >
                          {count} paper{count === 1 ? '' : 's'}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {/* Not another subject tile -- a dashed, muted "there's more
                    coming" note, same row height as the rest of the grid so
                    it doesn't read as a broken slot, but the dashed border
                    marks it as a signpost rather than a real subject (same
                    convention the shelf's own "see all papers" door tile
                    uses further up this page). Spans every column from sm:
                    up rather than stacking like a subject tile: as the 5th
                    item in a 4-wide grid it would otherwise wrap alone onto
                    a second row with three empty column-tracks beside it.
                    No count, no click: it isn't standing in for a real
                    subject with real papers, so nothing here should look
                    actionable. */}
                {facetQuery.trim() === '' ? (
                <div className="col-span-1 flex min-h-11 animate-card-reveal items-center gap-4 rounded-[18px] border-2 border-dashed border-warm-band bg-muted/40 p-[14px] sm:col-span-2 sm:rounded-2xl sm:p-6 lg:col-span-4">
                  <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] bg-muted sm:h-10 sm:w-10 sm:rounded-lg">
                    <Sparkles size={21} strokeWidth={1.9} aria-hidden="true" className="text-muted-foreground" />
                  </span>
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <span className="block break-words text-[19px] font-extrabold tracking-[-0.03em] text-foreground sm:text-card-title-lg sm:font-bold sm:tracking-normal">
                      More coming soon
                    </span>
                    <span className="flex-none rounded-full bg-muted px-3 py-1 text-label font-bold uppercase tabular-nums text-muted-foreground">
                      Stay tuned
                    </span>
                  </span>
                </div>
                ) : null}
              </div>
            ) : (
              <div className="stagger-children grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
                {facets.shown.map((b) => {
                  const count = boardCounts[b];
                  return (
                    <button
                      key={b}
                      onClick={() => navigate(`/past-papers/results?filter_boards=${encodeURIComponent(b)}`)}
                      className={`flex min-h-11 animate-card-reveal items-center gap-4 rounded-[18px] bg-brand-blue-subtle p-[14px] text-left transition-transform duration-hover ease-settle hover:-translate-y-0.5 active:scale-[0.97] motion-reduce:animate-none motion-reduce:hover:translate-y-0 sm:block sm:rounded-2xl sm:p-6 ${FOCUS_BLUE}`}
                    >
                      <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] bg-brand-blue sm:h-10 sm:w-10 sm:rounded-lg sm:mb-6">
                        <LandmarkIcon size={21} className="text-white" strokeWidth={1.9} aria-hidden="true" />
                      </span>
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-3 sm:block">
                        <span className="block break-words text-[19px] font-extrabold tracking-[-0.03em] text-brand-blue-deep sm:text-card-title-lg sm:font-bold sm:tracking-normal">{b}</span>
                        <span className="flex-none text-[13px] font-semibold tabular-nums text-brand-blue-deep sm:hidden">
                          {count} paper{count === 1 ? '' : 's'}
                        </span>
                        <span className="mt-2 hidden items-center rounded-full bg-brand-blue px-3 py-1 text-label font-bold uppercase tabular-nums text-white sm:inline-flex">
                          {count} paper{count === 1 ? '' : 's'}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {facets.hidden > 0 || (facetExpanded && facets.total > 8 && facetQuery.trim() === '') ? (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  aria-expanded={facetExpanded}
                  onClick={() => setFacetExpanded((v) => !v)}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-full bg-muted px-5 text-[14px] font-bold text-foreground transition-colors duration-tap hover:bg-warm-hairline ${FOCUS_BLUE}`}
                >
                  {facetExpanded ? 'Show fewer' : `Show all ${facets.total} ${groupMode === 'subject' ? 'subjects' : 'boards'}`}
                  <ChevronDown className={`h-4 w-4 transition-transform duration-tap ${facetExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </BentoPanel>
        )}

        {/* --------------------------------------------------------- By class */}
        {/* S4/D4: plain wrapped pills directly on the page ground, no colored
            slab. Previously wrapped in a `bg-brand` (orange) rounded-4xl slab
            — a hard violation on this page: papers mode is indigo-only,
            orange must never appear here (tokens.md §2). Removed the slab
            entirely to match the mockup rather than merely recolor it. */}
        {/* Handoff PP-012: BentoPanel wrap; chips h-12 rounded-2xl
            bg-brand-blue-subtle, grid-cols-4 at base (was a flex-wrap flat
            pill wall). */}
        {!loadError && (
          <BentoPanel fill="card" className="p-[22px]">
            {/* Was "By class & board" with a Board pill row underneath Class —
                Board tabs already run WBBSE/CBSE/ICSE/ISC counts near the top
                of this page (pages.md §4 row 3), so this second Board facet
                a few sections down duplicated the same filter with a second,
                inconsistent style (owner mobile QA: "keep class there, remove
                board from there"). Board stays as its own tabs section; this
                row now carries Class only. */}
            <h2 className={`mb-3 ${SECTION_H2} text-foreground`}>By class</h2>

            {/* Classes are 9-12 only: those are the classes the handoff draws,
                and the ones papers actually exist for. */}
            <div className="grid grid-cols-4 gap-2">
              {PAPER_CLASSES.filter((c) => ['9', '10', '11', '12'].includes(c)).map((c) => (
                <button
                  key={`class-${c}`}
                  type="button"
                  onClick={() => navigate(`/past-papers/results?filter_classes=${encodeURIComponent(c)}`)}
                  className="flex h-12 items-center justify-center rounded-2xl bg-brand-blue-subtle text-[16px] font-extrabold tabular-nums text-brand-blue-deep transition-colors duration-tap hover:bg-brand-blue hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Class {c}
                </button>
              ))}
            </div>
          </BentoPanel>
        )}

        {/* ----------------------------------------------------- More coming soon */}
        {/* Honest, low-key note rather than a fabricated count or date -- the
            product does not track a pipeline of in-progress submissions, so
            this says only what is true: students keep adding papers, and the
            library grows because of it. papersTint (not the orange brand
            token) per this page's indigo-only rule. */}
        <BentoPanel fill="papersTint" className="p-[22px]">
          <h2 className={`mb-2 ${SECTION_H2} text-foreground`}>More papers on the way</h2>
          <p className="max-w-prose text-body-secondary text-muted-foreground">
            More papers are added most weeks. If the one you need is not here yet, it is probably next.
          </p>
        </BentoPanel>

        {/* "Three steps" / "Who owns these papers" paired side by side at lg,
            like the Home page's how-it-works/guardian-trust pairing — both
            are "how this works" content and neither needed the full page
            width stacked alone. items-stretch so both panels' own fill
            colour runs the full shared height (same reasoning as Home's
            pairing) rather than the shorter one stopping short. */}
        <div className="lg:grid lg:grid-cols-2 lg:items-stretch lg:gap-0">
        {/* ------------------------------------------------------------ 3 steps */}
        {/* p-[22px]: the mockup never draws this panel, so it follows its
            neighbours on this page rather than BentoPanel's 20px default. */}
        <BentoPanel fill="card" className="p-[22px]">
          <h2 className={`mb-8 text-center ${SECTION_H2} text-foreground`}>
            Three steps, no cost,{' '}<br />no catch.
          </h2>
          {/* sm:grid-cols-3 was sized for the full page width this panel had
             stacked alone — halved to a paired lg column, 3-up left each
             step's icon+title+body too narrow to read. Back to a single
             column at lg, same fix as Home's "Talk to them yourself" steps
             when that panel was paired the same way. */}
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3 lg:grid-cols-1">
            {PAPER_STEPS.map((step) => (
              <div key={step.n}>
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-brand-blue text-body font-display font-bold tabular-nums text-white">{step.n}</span>
                  <h3 className="flex items-center gap-2 text-subsection font-semibold">
                    <step.icon size={18} className="text-brand-blue" strokeWidth={2} aria-hidden="true" />
                    {step.title}
                  </h3>
                </div>
                <p className="max-w-prose text-body-secondary text-muted-foreground lg:text-[16px] lg:leading-[1.65]">{step.body}</p>
              </div>
            ))}
          </div>
        </BentoPanel>

        {/* NOTE: no inline "How the paper library works" slab here — this route
            (anything starting with /past-papers) already gets that exact
            explainer from AppShell's global PreFooter, variant B3
            (see preFooterFor() in PreFooter.tsx). A near-duplicate hand-built
            copy of it used to live here too, so the block rendered twice in a
            row on every load of this page, with two different sets of CTAs.
            Removed rather than kept in sync — B3 is the single source per
            pages.md's "pre-footer block, decided in AppShell, never in the
            page" rule. */}

        {/* ----------------------------------------------------------- Ownership */}
        {/* Handoff PP-013: BentoPanel fill="dark", radius 24/28 -> 30. This
            is also the page's teacher cross-sell — the CTA below is new,
            the page's one orange element (label matches Home's H-011 fork
            tile, "Find a teacher" — the entry names the treatment but not
            exact copy, so this reuses the site's existing wording for the
            identical action rather than inventing new copy). */}
        {/* Was lg:grid-cols-[1fr_1.4fr] laying heading and text side by side —
           sized for the full page width this panel had stacked alone.
           Halved to a paired lg column, back to a single stacked column
           (heading above text, like every width below lg already renders)
           rather than squeezing that split into ~300px. */}
        <BentoPanel fill="dark" className="p-[18px] lg:flex lg:h-full lg:flex-col lg:justify-center lg:px-8 lg:py-7">
          <h2 className={`mb-1.5 ${SECTION_H2} leading-[1.1] text-white lg:mb-3`}>
            Who owns these papers
          </h2>
          <div className="space-y-3">
            <p className="text-[14px] leading-[1.6] text-white/[.72] lg:text-[15px] lg:leading-[1.65]">
              Every paper here is the property of the school that set it. Shikshaq claims no ownership over any paper, derives no revenue from any paper, and hosts these materials solely as a free community resource for students.
            </p>
            <Link
              to={BROWSE_PATH}
              className="inline-flex h-12 items-center rounded-full bg-brand px-5 text-[15px] font-extrabold text-brand-foreground transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
            >
              Find a teacher
            </Link>
          </div>
        </BentoPanel>
        </div>

        {/* Handoff PP-014: shared tail, identical to Home — the sentence-
            builder mode is pinned to 'papers' above (useEffect), so the
            dome renders indigo on load here. */}
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
      </PullToRefresh>
      </main>
    </div>
  );
}
