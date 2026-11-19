import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowUpRight, FileText } from 'lucide-react';

import { loadPaperIndex } from '@/lib/question-bank';
import { supabase } from '@/integrations/supabase/client';
import { bankSubjectMatches, bankSubjectToSite } from '@/lib/subject-vocabulary';
import { PAST_PAPERS_PATH } from '@/lib/nav-config';
import { cn } from '@/lib/utils';
import { useIntent } from '@/lib/intent-context';

import { FREE_PREVIEW_WORD } from '@/lib/free-preview';
/* A papers card, sitting in the teacher results.
 *
 * Someone comparing Class 10 ICSE Maths teachers is the single most likely
 * person on the site to want Class 10 ICSE Maths papers, and until now the only
 * route between the two surfaces was a promo below the fold on subject pages
 * and the nav. This puts one card in the flow of the thing they are already
 * reading.
 *
 * Four rules keep it a nudge rather than an ad:
 *
 *   1. It carries the READER'S OWN filters through. Subject, class and board
 *      are matched against the bank and passed to the papers surface, so the
 *      handoff lands pre-filtered on what they were already looking at.
 *   2. When no filter is applied at all, it falls back to the intent index
 *      (lib/intent) instead of a generic "619 past papers" line — but only
 *      the FACET, never the count and never below the route's earned
 *      adaptation level (experience.level, the same gate every other
 *      adaptive surface reads). Explicit still beats inferred: the moment a
 *      reader touches a real filter, that overrides whatever intent guessed.
 *   3. It states a real count, computed from the same index the papers surface
 *      renders from. Never a rounded or fabricated figure.
 *   4. It renders NOTHING when the count is zero. The bank covers three
 *      subjects; a reader browsing Physics or Bengali teachers must not be
 *      offered a link to an empty results page. That is the whole reason this
 *      counts before it draws.
 */

export interface InlinePapersNudgeProps {
  subjects: string[];
  classes: string[];
  boards: string[];
  /** 'row' for the mobile list, 'card' for the desktop grid. */
  variant: 'row' | 'card';
  className?: string;
}

export function InlinePapersNudge({
  subjects,
  classes,
  boards,
  variant,
  className,
}: InlinePapersNudgeProps) {
  /* BOTH paper sources, because the papers surface this links to renders both
     and the subject-page promo further down counts both. Counting only the bank
     here would put "193 Maths papers" beside a promo saying 197 on the same
     page, which reads as one of them being wrong.

     Shared react-query keys, so this is two fetches per session no matter how
     many nudges render, and the PDF table is 18 rows. */
  const { data: bankRows } = useQuery({
    queryKey: ['bank-index'],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: () => loadPaperIndex(),
  });
  const { data: pdfRows } = useQuery({
    queryKey: ['pdf-papers-index'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('papers')
        .select('subject, class, board')
        .eq('is_published', true);
      if (error) return [];
      return data ?? [];
    },
  });

  /* Falls back to the intent index only when the reader has applied no
     filter at all here — explicit still beats inferred, same rule the whole
     index runs on. Gated on experience.level rather than raw confidence: that
     is the route-aware number every other adaptive surface reads (it is
     already 'none' below THRESHOLD.copy, and Browse's own landing route
     carries no SEO cap, so a confident reader gets the full facet here). */
  const { intent, experience } = useIntent();
  const noFiltersApplied = subjects.length === 0 && classes.length === 0 && boards.length === 0;
  const usingIntent = noFiltersApplied && experience.level !== 'none';
  const effSubjects = usingIntent ? intent.subject.values : subjects;
  const effClasses = usingIntent ? intent.classLevel.values : classes;
  const effBoards = usingIntent ? intent.board.values : boards;

  const eq = (want: string[], value: string | null) =>
    want.length === 0 || want.some((w) => w.toLowerCase() === (value ?? '').toLowerCase());

  const bankMatches = (bankRows ?? []).filter(
    (p) =>
      (effSubjects.length === 0 || effSubjects.some((s) => bankSubjectMatches(s, p.subject))) &&
      eq(effClasses, p.cls) &&
      eq(effBoards, p.board),
  );
  const pdfMatches = (pdfRows ?? []).filter(
    (p) => eq(effSubjects, p.subject) && eq(effClasses, p.class) && eq(effBoards, p.board),
  );
  const total = bankMatches.length + pdfMatches.length;

  // No papers for what they are looking at: draw nothing rather than a dead end.
  if (total === 0) return null;

  const params = new URLSearchParams();
  if (effSubjects.length) params.set('filter_subjects', effSubjects.join(','));
  if (effClasses.length) params.set('filter_classes', effClasses.join(','));
  if (effBoards.length) params.set('filter_boards', effBoards.join(','));
  const href = `${PAST_PAPERS_PATH}/results${params.toString() ? `?${params}` : ''}`;

  /* The label names only the facets actually applied (or, absent those,
     inferred), so an unfiltered browse with no intent signal yet says "619
     past papers" rather than inventing a subject the reader never chose. */
  const facet = [
    effBoards.length === 1 ? effBoards[0] : null,
    effClasses.length === 1 ? `Class ${effClasses[0]}` : null,
    effSubjects.length === 1 ? effSubjects[0] : null,
  ]
    .filter(Boolean)
    .join(' ');

  const headline = facet
    ? `${total} ${facet} paper${total === 1 ? '' : 's'}`
    : `${total} past paper${total === 1 ? '' : 's'}`;

  /* Card variant only: the row variant (mobile list) is already sized to its
     content, so there is no dead space to fill and no reason to spend a
     second query-shaped pass on every row. A per-subject count, computed
     from the SAME matched rows the headline already counted (bank subjects
     normalised through subject-vocabulary.ts so "Mathematics" and "Maths"
     land in one bucket), top three by count. Renders only past the second
     subject — one subject alone just repeats the headline. */
  const subjectBreakdown =
    variant === 'card'
      ? (() => {
          const counts = new Map<string, number>();
          for (const p of bankMatches) {
            const s = bankSubjectToSite(p.subject) || p.subject;
            if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
          }
          for (const p of pdfMatches) {
            const s = p.subject;
            if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
          }
          return [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        })()
      : [];

  return (
    <Link
      to={href}
      className={cn(
        /* papersTint, not the solid indigo: this sits among teacher cards and
           has to read as a peer offering something else, not as an advert
           shouting over the results.
           D12.1: the lift on hover had nothing making it read as "raised" —
           every other lift-on-hover card in this file's neighbourhood
           (TeacherCard's grid variant) pairs the translate with a shadow that
           deepens, so this gets the same shadow-border/shadow-border-hover
           pairing rather than a translate alone. */
        'group flex items-center gap-3 rounded-[18px] bg-brand-blue-subtle p-4 shadow-border transition-transform duration-tap hover:-translate-y-0.5 hover:shadow-border-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 motion-reduce:hover:translate-y-0',
        /* justify-start, not -center: with the subject breakdown below,
           content height varies row to row, and a tall grid cell (matched to
           its taller photo-card neighbours) centering a variable-height block
           reintroduces the same dead-space-above-and-below this was meant to
           fix. Content starts at the top now; the arrow anchors the bottom
           corner on its own via mt-auto regardless of how tall the text
           block ends up. */
        variant === 'card' && 'h-full flex-col items-start justify-start',
        className,
      )}
    >
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[12px] bg-brand-blue text-white">
        <FileText size={18} strokeWidth={2.1} aria-hidden="true" />
      </span>
      {/* flex-1 only for the row variant, where it fills the WIDTH between
          icon and arrow in a row layout. In the card variant the parent is
          column-direction, so flex-1 there fills the leftover HEIGHT instead
          — the span stretches, its own text stays put at the top of it, and
          the "empty space" just moves from being distributed by
          justify-content to being invisible inside this span. Card variant
          stays naturally sized; mt-auto on the arrow below claims the
          leftover space instead. */}
      <span className={cn('min-w-0', variant === 'row' ? 'flex-1' : 'mt-3')}>
        <span className="block text-[11px] font-extrabold uppercase tracking-[0.09em] text-brand-blue-deep">
          Past papers
        </span>
        <span className="mt-1 block font-display text-[17px] font-extrabold leading-[1.15] tracking-[-0.03em] text-foreground">
          {headline}
        </span>
        <span className="mt-1 block text-[13px] leading-[1.45] text-warm-prose">
          Free to read. First {FREE_PREVIEW_WORD} questions need no account.
        </span>
        {/* Only past two subjects: one alone just repeats the headline in
            smaller type, which is noise rather than a breakdown. */}
        {subjectBreakdown.length > 1 && (
          <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px] tabular-nums text-brand-blue-deep/80">
            {subjectBreakdown.map(([subject, count]) => (
              <span key={subject} className="font-semibold">
                {count} <span className="font-normal opacity-80">{subject}</span>
              </span>
            ))}
          </span>
        )}
      </span>
      <ArrowUpRight
        size={18}
        strokeWidth={2.2}
        aria-hidden="true"
        className={cn('flex-none text-brand-blue-deep', variant === 'card' && 'mt-auto self-end')}
      />
    </Link>
  );
}

export default InlinePapersNudge;
