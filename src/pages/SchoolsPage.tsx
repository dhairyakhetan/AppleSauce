import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, School } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { schoolSlug } from '@/lib/school-slug';
import { displaySchool, isRealSchoolLabel } from '@/lib/school-display';
import { ROUTE_META } from '@/content/route-meta';
import { loadPaperIndex, schoolsOfPapers, type BankPaper } from '@/lib/question-bank';
import { usePageMeta } from '@/hooks/usePageMeta';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { NumberedHeading } from '@/components/ui/numbered-heading';
import { EmptyResults } from '@/components/EmptyResults';
import { ListLoading, ListError } from '@/components/ui/list-states';
import { IconDisc } from '@/components/ui/icon-disc';
import { generateBreadcrumbSchema } from '@/utils/structuredDataGenerators';
import { injectSchemas } from '@/utils/injectSchemas';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useChromeConfig } from '@/components/layout/AppShell';

/* Schools index — the real destination for TopBar's "Schools" link.
 *
 * Same derivation PastPapers.tsx already uses for its "By school" section:
 * there is no schools table, so the list and each school's dominant
 * board/count come from grouping published `papers` rows by `school`. Each
 * row links to `/school/:slug` (SchoolPage), same as PastPapers' rows.
 */

interface SchoolStat {
  /** Carried rather than recomputed at render, so the row's href is the same
      slug the two sources were merged on. */
  slug: string;
  school: string;
  board: string | null;
  count: number;
  otherBoardCount: number;
}

export default function SchoolsPage() {
  const navigate = useNavigate();

  usePageMeta(ROUTE_META.schools.title, ROUTE_META.schools.description);

  // Handoff SC-005: this route renders its own eyes panel, replacing
  // AppShell's default (B4) pre-footer. Schools is a papers-funnel surface,
  // so the sentence builder opens in papers mode (matching PastPapers' PP-014).
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();
  useEffect(() => { setBuilderMode('papers'); }, [setBuilderMode]);

  const query = useQuery({
    queryKey: ['schools', 'index'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      /* Two sources, one index. The table was the only one wired in, so
         every school that exists solely in the question bank was missing
         from the page that claims to list them all. A bank failure must not
         empty the index, and vice versa — each is caught on its own and the
         query only fails if neither source answered. */
      const [dbResult, bank] = await Promise.all([
        supabase.from('papers').select('school,board').eq('is_published', true),
        loadPaperIndex().catch(() => [] as BankPaper[]),
      ]);
      if (dbResult.error && bank.length === 0) throw dbResult.error;

      /* Keyed on the DISPLAY LABEL (school-display.ts), not on the raw name
         or its slug: several raw spellings/abbreviations can share one label
         ("Gregorios", "St Gregorios", "St. Gregorios High School" are all
         "St. Gregorios High School"), and without this they showed as three
         separate half-populated rows instead of one row with the true count.
         "candidates" tracks paper count PER RAW NAME (not per label), which
         is what picking a canonical slug below needs. */
      const bySchool = new Map<string, { boards: Map<string, number>; candidates: Map<string, number> }>();
      const add = (rawName: string, board: string | null) => {
        const label = displaySchool(rawName);
        // "School not recorded" and board-paper source lines are real facts
        // on a paper's own card, but neither is a school -- they don't
        // belong in this directory.
        if (!isRealSchoolLabel(label)) return;
        const entry = bySchool.get(label) ?? { boards: new Map<string, number>(), candidates: new Map<string, number>() };
        if (board) entry.boards.set(board, (entry.boards.get(board) || 0) + 1);
        else entry.boards.set('', (entry.boards.get('') || 0) + 1);
        entry.candidates.set(rawName, (entry.candidates.get(rawName) || 0) + 1);
        bySchool.set(label, entry);
      };

      (dbResult.data || []).forEach((p) => add(p.school, p.board));
      schoolsOfPapers(bank).forEach((school) => {
        school.papers.forEach((paper) => add(school.name, paper.board));
      });

      const schoolStats: SchoolStat[] = Array.from(bySchool.entries())
        .map(([label, { boards, candidates }]) => {
          const total = Array.from(boards.values()).reduce((sum, c) => sum + c, 0);
          // Papers with no board recorded are counted but never named as one.
          const named = Array.from(boards.entries())
            .filter(([board]) => board)
            .sort((a, b) => b[1] - a[1]);
          const [dominantBoard, dominantCount] = named[0] ?? [null, 0];
          /* Canonical slug: the raw spelling whose OWN display equals the
             label (needs no lookup table to justify the URL), or, when every
             member is itself a fragment/abbreviation, whichever raw spelling
             has the most papers. */
          const rawNames = Array.from(candidates.keys());
          const selfCanonical = rawNames.find((raw) => displaySchool(raw) === raw);
          const canonicalRaw = selfCanonical
            ?? rawNames.reduce((best, raw) => (
              (candidates.get(raw) ?? 0) > (candidates.get(best) ?? 0) ? raw : best
            ));
          return {
            slug: schoolSlug(canonicalRaw),
            school: label,
            board: dominantBoard,
            count: dominantBoard ? dominantCount : total,
            otherBoardCount: dominantBoard ? total - dominantCount : 0,
          };
        })
        .sort((a, b) => a.school.localeCompare(b.school));

      return schoolStats;
    },
  });

  const schoolStats = query.data ?? [];

  useEffect(() => {
    if (query.isLoading) return;
    injectSchemas([
      generateBreadcrumbSchema([
        { name: 'Home', url: '/' },
        { name: 'Schools', url: '/schools' },
      ]),
    ]);
    return () => {
      document.getElementById('page-schemas')?.remove();
    };
  }, [query.isLoading]);

  return (
    <div className="min-h-screen bg-background">
      <main>
        <BentoStack>
          {/* Handoff SC-002: bone header panel, replacing the dark ControlBlock. */}
          <BentoPanel fill="card" edge="top" className="px-[22px] pt-[14px] pb-[22px]">
            <NumberedHeading
              as="h1"
              line1="Papers from"
              ordinal="01"
              line2="every school"
              support="Free to read, with marking schemes where the boards publish them."
            />
          </BentoPanel>

          {/* Handoff SC-003/SC-004: row list wrapped in its own panel; rows
              match PastPapers' By-school row exactly (PP-010) — bg-muted, no
              shadow-border. */}
          <BentoPanel fill="card" className="p-[22px]">
            {query.isLoading ? (
              <ListLoading count={6} media={0} lines={2} className="grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-[10px]" />
            ) : query.isError ? (
              <ListError onRetry={() => query.refetch()} />
            ) : schoolStats.length > 0 ? (
              <div className="stagger-children grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-[10px]">
                {schoolStats.map(({ slug, school, board, count, otherBoardCount }) => {
                  // `school` is already the merged display label -- schoolStats
                  // is built (above) keyed by displaySchool(), not by raw name.
                  const label = school;
                  return (
                  <Link
                    key={slug}
                    to={`/school/${slug}`}
                    className="flex min-h-11 animate-card-reveal items-center gap-3 rounded-2xl bg-muted px-[14px] py-3 text-left transition-transform duration-hover ease-settle hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:animate-none motion-reduce:hover:translate-y-0 lg:px-[15px] lg:py-[13px]"
                  >
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
                        {board ? `${board} · ` : ''}{count} paper{count === 1 ? '' : 's'}
                        {otherBoardCount > 0 ? ` + ${otherBoardCount} more` : ''}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 flex-none text-warm-quaternary" aria-hidden="true" />
                  </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyResults
                tone="papers"
                icon={<School className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />}
                heading="Schools are being updated"
                message="We're still gathering papers from schools, nothing's uploaded yet."
                action={{ label: 'Browse past papers', onClick: () => navigate('/past-papers') }}
              />
            )}
          </BentoPanel>

          {/* Handoff SC-005: shared tail, pinned to papers mode. */}
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
