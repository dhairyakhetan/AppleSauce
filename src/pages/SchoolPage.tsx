import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FileText } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { recordSignal } from '@/lib/intent/signals';
import { schoolSlug } from '@/lib/school-slug';
import { displaySchool } from '@/lib/school-display';
import { loadPaperIndex, schoolGroupBySlug, hasYear } from '@/lib/question-bank';
import { sanitizeForIlike } from '@/lib/ilike-sanitize';
import { bankSubjectToSite } from '@/lib/subject-vocabulary';
import { numberToRoman, romanToNumber } from '@/utils/romanNumerals';
import { getSubjectPalette } from '@/lib/subject-palette';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useChromeConfig } from '@/components/layout/AppShell';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { ListLoading, ListEmpty, ListError } from '@/components/ui/list-states';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ScrollRail } from '@/components/ui/scroll-rail';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { getShikshaqmineBasicBySlugs } from '@/lib/teachers';
import { BROWSE_PATH, PAST_PAPERS_PATH } from '@/lib/nav-config';
import { generateBreadcrumbSchema, generateCollectionPageSchema } from '@/utils/structuredDataGenerators';
import { injectSchemas } from '@/utils/injectSchemas';

/* S16 — the school page.
 *
 * a-to-z.md lists this as the one route marked `new`: "Does not exist;
 * PastPapers has by-school rows that go nowhere". They were buttons with no
 * href, so a school was a dead end — you could read that La Martiniere has four
 * papers and had no way to open them.
 *
 * Everything here is derived from the paper rows themselves. There is no
 * schools table, so the summary line, the facets and the year range are all
 * computed from what has actually been uploaded, and a school with no papers
 * cannot exist as a page at all.
 *
 * Handoff 09g (SP-001..SP-004) rebuilds this as a BentoStack, matching the
 * rest of the already-migrated papers funnel (PastPapers.tsx, SchoolsPage.tsx)
 * — same indigo header, same PP-010 school-row visual language for the
 * canonical patterns it reuses.
 */

/* Mixed-weight H1 split (design system signature move, see Index.tsx/Join.tsx
   hero H1s): a font-normal base clause followed by a font-black payoff. A
   school name has no clause to split on, so the trailing word carries the
   heavy weight, matching how TeacherProfile.tsx handles its own bare-name H1. */
function splitNameForHeading(name: string): [string, string] {
  const lastSpace = name.trim().lastIndexOf(' ');
  if (lastSpace === -1) return ['', name];
  return [name.slice(0, lastSpace), name.slice(lastSpace + 1)];
}

/* Two sources feed this page (the `papers` table and the question bank) and
   they describe a paper differently — one has an editorial title and a year
   column, the other has a question count and often no year at all. Rather
   than teach the row JSX about both, each source maps itself into this shape
   and builds its own `meta` line, so the markup below prints one thing. */
interface SchoolPaper {
  id: string;
  title: string;
  subject: string;
  class: string;
  board: string;
  /** Null where the source never recorded one — sorted last, never shown as 0. */
  year: number | null;
  meta: string;
}

export default function SchoolPage() {
  // /school/:slug doesn't match any of preFooterFor's own patterns, so it
  // would otherwise default to B4; this route renders its own eyes panel
  // (papers mode), same as PastPapers/SchoolsPage (handoff 09g note on SP-004).
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();
  useEffect(() => { setBuilderMode('papers'); }, [setBuilderMode]);

  const { slug = '' } = useParams();

  const query = useQuery({
    queryKey: ['school', slug],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      /* No schools table and no slug column, so the match happens here: pull
         published papers and compare derived slugs. At this scale that is one
         query; past a few thousand papers this wants a generated column and an
         index rather than a client-side filter. */
      const { data, error } = await supabase
        .from('papers')
        .select('id, title, school, subject, class, board, year')
        .eq('is_published', true)
        .order('year', { ascending: false });
      /* Throw, so the query reports isError and the page's own failed/retry
         state can engage, instead of an empty school. */
      if (error) throw error;

      const rows = (data || []).filter((p) => schoolSlug(p.school) === slug);
      return {
        name: rows[0]?.school ?? null,
        papers: rows.map((p): SchoolPaper => ({
          id: p.id,
          title: p.title,
          subject: p.subject,
          class: p.class,
          board: p.board,
          year: p.year ?? null,
          meta: [p.subject, p.class ? `Class ${p.class}` : null, p.board, p.year]
            .filter(Boolean)
            .join(' · '),
        })),
      };
    },
  });

  /* The bank's half of this school. Until this existed, /school/:slug read
     only the `papers` table, so a school with bank papers live on
     /past-papers had an empty page of its own — the wiring simply stopped.
     This reads the light paper index (~31KB) rather than the full bank
     (2.5MB): a school page lists papers, it never shows question text. Both
     the fetch and the grouping are memoised for the session, so opening a
     second school costs nothing beyond the lookup.

     schoolGroupBySlug (not schoolBySlug) — several raw bank_papers.school
     spellings/abbreviations can share one display label (school-display.ts:
     "Gregorios" / "St Gregorios" / "St. Gregorios High School" are all one
     real school), and the requested slug can be ANY of their raw slugs, not
     just the canonical one. The group's `.papers` is every paper from every
     raw spelling combined, so this page shows the school's true count no
     matter which spelling's URL a visitor lands on. */
  const bankQuery = useQuery({
    queryKey: ['school-bank', slug],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => schoolGroupBySlug(await loadPaperIndex(), slug),
  });

  const bankGroup = bankQuery.data ?? null;

  const papers = useMemo<SchoolPaper[]>(() => {
    const fromBank = (bankGroup?.papers ?? []).map((b): SchoolPaper => {
      // b.subject is the raw bank spelling ("Mathematics"); every subject-
      // facing surface on the site (title, chips, cross-sell filter links)
      // uses the site's own vocabulary ("Maths") -- see PastPapers.tsx's
      // subjectCounts fix for the same underlying mismatch.
      const subject = bankSubjectToSite(b.subject) || b.subject;
      return {
        id: b.id,
        title: `Class ${b.cls} ${subject}`,
        subject,
        class: b.cls,
        board: b.board,
        year: hasYear(b.year) ? Number(String(b.year).slice(0, 4)) : null,
        /* Says what this row actually knows. The school is the page, and the
           subject is in the title, so neither is repeated here. */
        meta: [
          b.board,
          hasYear(b.year) ? b.year : 'Year not recorded',
          `${b.questionCount} question${b.questionCount === 1 ? '' : 's'}`,
        ].join(' · '),
      };
    });

    return [...(query.data?.papers ?? []), ...fromBank].sort((a, b) => {
      // Undated papers go last rather than sorting as year zero.
      if (a.year === b.year) return 0;
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return b.year - a.year;
    });
  }, [query.data, bankGroup]);

  // Shared facets — boards/classes/years feed the summary line, years also
  // drive the year chips below, and boards+subjects drive the teacher
  // cross-sell query further down.
  const boards = useMemo(() => [...new Set(papers.map((p) => p.board).filter(Boolean))], [papers]);
  /* p.class is Arabic-numeral native for `papers`-table rows but a Roman
     numeral ("IX", "X"...) for bank rows (see the `fromBank` mapping above,
     which keeps b.cls as-is) -- Number() alone silently dropped every bank
     class, so a bank-only school (most of the top schools by paper count,
     e.g. La Martiniere for Boys) never showed a class range at all. Kept
     numeric here for sorting/range math; displayed back via numberToRoman
     below, consistent with the Roman numerals this same page already shows
     on each bank paper's own card. */
  const classes = useMemo(
    () => [...new Set(papers.map((p) => {
      const n = Number(p.class);
      return Number.isNaN(n) ? romanToNumber(p.class) : n;
    }).filter((n) => !Number.isNaN(n)))].sort((a, b) => a - b),
    [papers],
  );
  const years = useMemo(
    () => [...new Set(papers.map((p) => p.year).filter((y): y is number => y != null))]
      .sort((a, b) => b - a),
    [papers],
  );

  const summary = useMemo(() => {
    if (papers.length === 0) return null;

    /* Each clause drops rather than guesses when its data is missing
       (design.md §0.10). A school with one year shows that year, not a range. */
    const parts = [`${papers.length} paper${papers.length === 1 ? '' : 's'}`];
    /* "ISC & ICSE & Board" — a school with three boards read as a chain of
       ampersands. A list separates with commas and joins the last with one. */
    if (boards.length) {
      parts.push(
        boards.length === 1
          ? boards[0]
          : `${boards.slice(0, -1).join(', ')} & ${boards[boards.length - 1]}`,
      );
    }
    if (classes.length) {
      parts.push(
        classes.length === 1
          ? `Class ${numberToRoman(classes[0])}`
          : `Classes ${numberToRoman(classes[0])} to ${numberToRoman(classes[classes.length - 1])}`,
      );
    }
    if (years.length) {
      const ascYears = [...years].sort((a, b) => a - b);
      parts.push(ascYears.length === 1 ? String(ascYears[0]) : `${ascYears[0]}-${ascYears[ascYears.length - 1]}`);
    }
    return parts.join(' · ');
  }, [papers, boards, classes, years]);

  const subjects = useMemo(
    () => [...new Set(papers.map((p) => p.subject).filter(Boolean))].sort(),
    [papers],
  );

  // Year chips filter the paper rows client-side — the whole set is already
  // loaded (one query per school, S16), so there is no reason to round-trip.
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const filteredPapers = useMemo(
    () => (selectedYear == null ? papers : papers.filter((p) => p.year === selectedYear)),
    [papers, selectedYear],
  );

  // Cross-sell: teachers who cater to this school's board(s) — the "School
  // Boards Catered" free-text column on Shikshaqmine is the closest thing to a
  // school-syllabus match that exists (there is no school<->teacher table).
  // Subject overlap against the papers on this page then ranks the matches so
  // the 3 shown are the most relevant, not just whichever sorts first.
  const crossSellTeachers = useQuery({
    queryKey: ['school-teachers', slug, boards.join('|'), subjects.join('|')],
    enabled: papers.length > 0 && (boards.length > 0 || subjects.length > 0),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      let q = (supabase.from('Shikshaqmine').select('"Slug","School Boards Catered","Subjects"') as any).limit(60);
      // boards/subjects come from bank_papers metadata, not request-time user
      // input, but escaped anyway for the same reason PaperResults.tsx's
      // sanitizeForIlike exists -- an unescaped value in an .or() filter
      // string is a filter-injection surface regardless of where it came from.
      if (boards.length > 0) {
        q = q.or(boards.map((b) => `School Boards Catered.ilike.%${sanitizeForIlike(b)}%`).join(','));
      } else {
        q = q.or(subjects.map((s) => `Subjects.ilike.%${sanitizeForIlike(s)}%`).join(','));
      }
      const { data, error } = await q;
      if (error || !data) return [];

      const ranked = (data as any[])
        .filter((row) => row.Slug)
        .map((row) => {
          const rowSubjects = String(row.Subjects || '').toLowerCase();
          const overlap = subjects.filter((s) => rowSubjects.includes(s.toLowerCase())).length;
          return { slug: row.Slug as string, overlap };
        })
        .sort((a, b) => b.overlap - a.overlap);

      const topSlugs = [...new Set(ranked.map((r) => r.slug))].slice(0, 3);
      if (topSlugs.length === 0) return [];

      const [{ data: teacherRows, error: teacherError }, basicMap] = await Promise.all([
        supabase.from('teachers_list').select('id, name, slug, image_url, subjects(name, slug)').in('slug', topSlugs),
        getShikshaqmineBasicBySlugs(topSlugs),
      ]);
      if (teacherError || !teacherRows) return [];

      return (teacherRows as any[]).map((t) => {
        const basic = basicMap.get(t.slug);
        return {
          id: t.id as string,
          name: t.name as string,
          slug: t.slug as string,
          image_url: t.image_url as string | null,
          subjects: t.subjects as { name: string; slug: string } | null,
          // Bug 5 fix: `basicMap` (getShikshaqmineBasicBySlugs) already resolves
          // a real subject from Shikshaqmine.Subjects for rows whose
          // teachers_list `subjects` FK is null — the same helper LikedTeachers/
          // MyTeachers/StudentDashboard/GuardianDashboard use via getTeachersByIds.
          // This mapping fetched `basicMap` but never read `.firstSubject`, so
          // any teacher without the FK relation fell straight through to
          // TeacherCard's generic fallback below even though a real subject was
          // sitting right there in `basic`.
          firstSubject: basic?.firstSubject ?? null,
          whatsappLink: basic?.whatsappLink ?? null,
          experienceYears: basic?.experienceYears ?? null,
          minFees: basic?.minFees ?? null,
          maxFees: basic?.maxFees ?? null,
          area: basic?.area ?? null,
        };
      });
    },
  });
  const railTeachers = crossSellTeachers.data ?? [];

  // SP-004: the pill's destination reuses the exact same board-first-else-
  // subjects facet the query above ranks on, so "See N teachers" always
  // lands on a Browse result that actually contains them.
  const crossSellHref = boards.length > 0
    ? `${BROWSE_PATH}?filter_boards=${encodeURIComponent(boards.join(','))}`
    : `${BROWSE_PATH}?filter_subjects=${encodeURIComponent(subjects.join(','))}`;

  /* Both sources are independent: if the table is down but the bank
     answered, this school's bank papers still render. Only a dead end when
     neither could answer at all. */
  const loading = query.isLoading || bankQuery.isLoading;
  const failed = query.isError && bankQuery.isError;

  /* Either source can be the one that knows this school's name. When neither
     does and nothing is still in flight, the slug resolves to no school at
     all — say that, rather than heading the page with a bare "School", which
     read as a page about a school whose name had failed to load.

     bankGroup.label is ALREADY the merged display label (schoolGroupBySlug
     groups by it); the `papers`-table half is still a raw name and needs
     displaySchool() itself. Bank wins when both somehow disagree — it is the
     source this whole fix exists for. */
  const rawTableName = query.data?.name ?? null;
  const resolvedName = bankGroup?.label ?? (rawTableName ? displaySchool(rawTableName) : null);
  const unknownSchool = !resolvedName && !loading && !failed;
  const name = resolvedName ?? (unknownSchool ? 'School not found' : 'School');

  /* This slug may be one of several raw spellings folded into bankGroup —
     canonicalSlug is the one SchoolsPage links to and prerender.ts builds
     the merged page at. A non-canonical slug still renders the full merged
     page (no 404: schoolGroupBySlug matches ANY of the group's raw slugs),
     but its <link rel="canonical"> has to point at the canonical URL so
     Google treats every merged spelling as one page, not near-duplicates. */
  const canonicalSlug = bankGroup?.canonicalSlug ?? slug;
  useEffect(() => {
    if (!bankGroup || bankGroup.canonicalSlug === slug) return;
    const href = `https://www.shikshaq.in/school/${bankGroup.canonicalSlug}`;
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = href;
  }, [bankGroup, slug]);

  /* `school` is a tracked FacetSlotKey (lib/intent/types.ts) that nothing
     populated from actually visiting a school page — only from a papers
     filter or the sentence builder's fourth dropdown. Recording it here
     (route-derived, medium strength, same shape as Browse's
     subject_route_viewed a few files over) costs nothing on this SEO route:
     guardrails.ts caps what the page may ADAPT here, not what it may
     RECORD, and a reader who opened /school/some-school by name has told
     the index something real regardless of what this page is allowed to do
     with it. Fires once, when the name resolves. */
  const schoolSignalSent = useRef(false);
  useEffect(() => {
    if (schoolSignalSent.current || !resolvedName) return;
    schoolSignalSent.current = true;
    recordSignal('subject_route_viewed', {
      school: resolvedName,
      board: boards,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedName]);
  /* The description was "N past papers from X, free to read on Shikshaq." at
     63-77 characters, on 66 indexable pages, while the three facts a searcher
     actually types -- board, class, year -- sat computed and unused a few
     lines above. Each clause drops rather than guesses when its data is
     missing, the same rule the on-page summary follows. */
  const metaDescription = useMemo(() => {
    if (!papers.length) {
      return 'Past papers from schools across India, free to read on Shikshaq.';
    }
    const clauses: string[] = [];
    // Same list join as the on-page summary: "ISC and ICSE and Board" was a
    // chain of conjunctions where a list was meant.
    if (boards.length) {
      clauses.push(
        boards.length === 1
          ? boards[0]
          : `${boards.slice(0, -1).join(', ')} and ${boards[boards.length - 1]}`,
      );
    }
    if (classes.length) {
      clauses.push(
        classes.length === 1
          ? `class ${numberToRoman(classes[0])}`
          : `classes ${numberToRoman(classes[0])} to ${numberToRoman(classes[classes.length - 1])}`,
      );
    }
    if (years.length) {
      const asc = [...years].sort((a, b) => a - b);
      clauses.push(asc.length === 1 ? String(asc[0]) : `${asc[0]} to ${asc[asc.length - 1]}`);
    }
    const detail = clauses.length ? `: ${clauses.join(', ')}` : '';
    return `${papers.length} past paper${papers.length === 1 ? '' : 's'} from ${name}${detail}. `
      + 'Read every question online for free, with marks and chapters.';
  }, [papers.length, name, boards, classes, years]);

  /* "Free to Read" earns its place in a result snippet, but not at the cost of
     the school's own name being cut off: a long name plus the full suffix ran
     to 68 characters, past where Google truncates. Long names keep the name. */
  const metaTitle = useMemo(() => {
    const base = `${name} Past Papers`;
    return base.length <= 34 ? `${base}, Free to Read | Shikshaq` : `${base} | Shikshaq`;
  }, [name]);

  usePageMeta(
    papers.length
      ? metaTitle
      : unknownSchool
        ? 'School not found | Shikshaq'
        : 'School past papers | Shikshaq',
    metaDescription,
  );

  // This route (S16, "new" per a-to-z.md) shipped with no structured data at
  // all — every other listing-style page (Browse, subject/board pages) emits
  // at least a BreadcrumbList. Only injected once a real school has resolved
  // (papers.length > 0), matching what usePageMeta above already does for
  // title/description, so a not-found slug doesn't assert a fake breadcrumb
  // for a page name that isn't real.
  useEffect(() => {
    if (!papers.length) return;
    injectSchemas([
      generateCollectionPageSchema({
        url: `https://www.shikshaq.in/school/${canonicalSlug}`,
        name: `${name} past papers`,
        description: `${papers.length} past papers from ${name}, free to read on Shikshaq.`,
        about: name,
        numberOfItems: papers.length,
      }),
      generateBreadcrumbSchema([
        { name: 'Home', url: '/' },
        { name: 'Past papers', url: PAST_PAPERS_PATH },
        { name, url: `/school/${canonicalSlug}` },
      ]),
    ]);
    return () => {
      const existing = document.getElementById('page-schemas');
      if (existing) existing.remove();
    };
  }, [papers.length, name, canonicalSlug]);

  const hasResults = !loading && papers.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <main>
        <BentoStack>
          {/* SP-001: indigo header — papers are the indigo half of the brand
              pair. No in-panel logo/menu row: the floating Navbar pill
              already carries that everywhere on the redesign (PP-002's
              rationale), so only the back link survives from the mockup's
              two-row nav. splitNameForHeading and the summary line's data
              are unchanged — restyled only. */}
          <BentoPanel fill="papers" edge="top" className="relative overflow-hidden px-[22px] pt-[14px] pb-[24px] sm:px-6 lg:px-8">
            <span aria-hidden className="pointer-events-none absolute -right-[50px] top-10 h-[200px] w-[200px] rounded-full bg-white/[.06]" />
            <div className="relative mx-auto w-full max-w-6xl">
              <Link
                to="/schools"
                className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-white/80 transition-colors duration-tap hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                All schools
              </Link>
              <h1 className="font-display text-[28px] font-normal leading-[1.05] tracking-[-0.035em] text-white">
                {(() => {
                  const [base, payoff] = splitNameForHeading(name);
                  return base ? <>{base} <span className="font-black">{payoff}</span></> : <span className="font-black">{payoff}</span>;
                })()}
              </h1>
              {summary && <p className="mt-2.5 text-[14px] leading-[1.55] tabular-nums text-white/80">{summary}</p>}
            </div>
          </BentoPanel>

          {!hasResults ? (
            /* isError before the empty check. A failed fetch used to fall
               through to "No papers from this school yet.", which is a
               factual claim about the data made on the strength of a
               network error, and it offered no way to retry. */
            <BentoPanel fill="card" className="px-[22px] py-8 sm:px-6 lg:px-8">
              {loading ? (
                <ListLoading />
              ) : failed ? (
                <ListError onRetry={() => { query.refetch(); bankQuery.refetch(); }} />
              ) : (
                /* A bare "no papers yet" line left a reader at a dead end on a
                   page they reached on purpose. The library grows by people
                   sending papers in, so the empty state asks for the one thing
                   that would fill it, and offers somewhere to go if they have
                   nothing to give. */
                <div className="mx-auto w-full max-w-prose">
                  <h2 className="font-display text-[21px] font-extrabold tracking-[-0.03em] text-foreground">
                    No papers here yet
                  </h2>
                  <p className="mt-2.5 text-[15px] leading-[1.6] text-warm-prose">
                    {resolvedName
                      ? `Nobody has sent us a paper from ${resolvedName} yet. If you have one sitting in a drawer, it takes a minute to send and the next batch revises from it.`
                      : 'We have no papers filed under this school. It may not be on Shikshaq yet, or the link may be out of date.'}
                  </p>
                  <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
                    <Button asChild variant="primary" size={48}>
                      <Link to="/submit-a-paper">
                        Send a paper
                        <ArrowRight className="h-[15px] w-[15px]" aria-hidden="true" />
                      </Link>
                    </Button>
                    <Link
                      to={PAST_PAPERS_PATH}
                      className="tap-44 inline-flex items-center text-[14px] font-semibold text-brand-blue underline underline-offset-4 transition-colors duration-tap hover:text-brand-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      Read papers from every school
                    </Link>
                  </div>
                </div>
              )}
            </BentoPanel>
          ) : (
            <>
              {/* SP-002: year filter. Client-side toggle over the
                  already-loaded set — one query per school page, so no
                  round-trip is needed to re-slice it by year. */}
              {years.length > 1 && (
                <BentoPanel fill="card" className="px-0 py-3.5 pl-4">
                  <ScrollRail fadeFrom="from-card">
                    <div className="flex items-center gap-2 pr-4">
                      <Chip
                        tone={selectedYear == null ? 'dark' : 'facet'}
                        size={44}
                        onClick={() => setSelectedYear(null)}
                        aria-pressed={selectedYear == null}
                      >
                        All years
                      </Chip>
                      {years.map((year) => (
                        <Chip
                          key={year}
                          tone={selectedYear === year ? 'dark' : 'facet'}
                          size={44}
                          onClick={() => setSelectedYear((prev) => (prev === year ? null : year))}
                          aria-pressed={selectedYear === year}
                        >
                          {year}
                        </Chip>
                      ))}
                    </div>
                  </ScrollRail>
                </BentoPanel>
              )}

              {/* SP-003: subject chips, h40, subject tints, linking into the
                  existing results query. */}
              {subjects.length > 1 && (
                <BentoPanel fill="card" className="!px-0 !py-[22px] lg:!py-8">
                  <h2 className="px-[22px] font-display text-[21px] font-extrabold tracking-[-0.03em] text-foreground">
                    Subjects here
                  </h2>
                  <div className="mt-3 px-[22px]">
                    <ScrollRail fadeFrom="from-card">
                      <div className="flex gap-2 pr-[22px]">
                        {subjects.map((subject) => {
                          const palette = getSubjectPalette(subject);
                          return (
                            <Link
                              key={subject}
                              to={`${PAST_PAPERS_PATH}/results?filter_subjects=${encodeURIComponent(subject)}`}
                              className="tap-44 flex h-10 flex-none items-center whitespace-nowrap rounded-full px-4 text-[14px] font-bold transition-transform duration-tap ease-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              style={{ backgroundColor: palette.tint, color: palette.text }}
                            >
                              {subject}
                            </Link>
                          );
                        })}
                      </div>
                    </ScrollRail>
                  </div>
                </BentoPanel>
              )}

              {/* SP-003: paper rows — r18 in the subject tint, a 30×38 r7
                  cover-shaped tile in the subject text colour, subject-
                  tinted meta. Rows stay <Link>s, never buttons, and
                  ListEmpty copy for a filtered-empty year is unchanged. */}
              <BentoPanel fill="card" className="px-4 py-[18px]">
                {filteredPapers.length === 0 ? (
                  <ListEmpty line={`No papers from ${selectedYear}.`} />
                ) : (
                  /* D-005: a one-column stack of paper rows becomes a grid at
                     lg — otherwise each 70px row spans the full 945px panel.
                     D-005's table doesn't name this page, but it gives the
                     identical content ("Papers by-school / most-read: stacked
                     → grid-cols-2") that treatment, so these rows follow it. */
                  <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2">
                    {filteredPapers.map((paper) => {
                      const palette = getSubjectPalette(paper.subject);
                      return (
                        <Link
                          key={paper.id}
                          to={`${PAST_PAPERS_PATH}/${paper.id}`}
                          className="flex min-h-11 items-center gap-3 rounded-[18px] p-[14px] transition-transform duration-hover ease-settle hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:hover:translate-y-0"
                          style={{ backgroundColor: palette.tint }}
                        >
                          <span
                            className="flex h-[38px] w-[30px] flex-none items-center justify-center rounded-[6px]"
                            style={{ backgroundColor: palette.text }}
                          >
                            <FileText className="h-[15px] w-[15px]" style={{ color: palette.tint }} aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block line-clamp-2 break-words text-[15px] font-bold tracking-[-0.02em]" style={{ color: palette.text }}>
                              {paper.title}
                            </span>
                            <span className="mt-px block truncate text-[12px]" style={{ color: palette.meta }}>
                              {paper.meta}
                            </span>
                          </span>
                          <ArrowRight className="h-4 w-4 flex-none" style={{ color: palette.meta }} aria-hidden="true" />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </BentoPanel>

              {/* SP-004: orange cross-sell, the one warm element on an
                  otherwise all-indigo page. Adapted from the mockup's literal
                  headline+line+pill (no card rail in the source) — the real
                  overlap-ranked query still gates whether this panel renders
                  at all and supplies the real (not fabricated) count on the
                  pill; it never renders a fallback when the count is zero. */}
              {railTeachers.length > 0 && (
                <BentoPanel fill="brandTint" className="p-[22px]">
                  <h2 className="font-display text-[21px] font-extrabold tracking-[-0.03em] text-brand-deep">
                    Teachers who know this syllabus
                  </h2>
                  <p className="mt-2 max-w-prose text-[14px] leading-[1.55] text-warm-prose">
                    Ranked by overlap with the boards and subjects on this page.
                  </p>
                  <Button asChild variant="primary" size={48} className="mt-4">
                    <Link to={crossSellHref}>
                      See {railTeachers.length} teacher{railTeachers.length === 1 ? '' : 's'}
                      <ArrowRight className="h-[15px] w-[15px]" aria-hidden="true" />
                    </Link>
                  </Button>
                </BentoPanel>
              )}
            </>
          )}

          <EyesPanel
            mode={builderMode}
            onModeChange={setBuilderMode}
            heading={(
              <>
                Still deciding? <span className="font-extrabold">We&rsquo;re watching out for you.</span>
              </>
            )}
            subline="Fill in the blanks and we'll take you straight there."
            slots={builderSlots}
            onSlotChange={handleSlotChange}
            onSubmit={handleBuilderSubmit}
          />
        </BentoStack>
      </main>
    </div>
  );
}
