import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  FileText,
  GraduationCap,
  IndianRupee,
  MessageCircle,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { EmptyResults } from '@/components/EmptyResults';
import { supabase } from '@/integrations/supabase/client';
import { imageAtWidth, validateImageSrc } from '@/utils/imageSanitizer';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/use-mobile';
import { TeacherCard } from '@/components/TeacherCard';
import { SubjectCard } from '@/components/SubjectCard';
import { SearchDesk } from '@/components/home/SearchDesk';
import { RegionNotice } from '@/components/RegionNotice';
import { CornerMascot } from '@/components/home/CornerMascot';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { useChromeConfig } from '@/components/layout/AppShell';
import { NumberedHeading } from '@/components/ui/numbered-heading';
import { IconDisc } from '@/components/ui/icon-disc';
import { PaperCover } from '@/components/papers/paper-cover';
import { StripePlaceholder } from '@/components/ui/stripe-placeholder';
import { useAuth } from '@/lib/auth-context';
import { useLikes } from '@/lib/likes-context';
import { resolveHeroCopy, papersHeroCopy } from '@/lib/hero-copy';
import { getSubjectPalette } from '@/lib/subject-palette';
import { useRequireRole } from '@/hooks/use-require-role';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useIntent } from '@/lib/intent-context';
import { intentCta } from '@/lib/intent/copy';
import { getShikshaqmineBasicBySlugs } from '@/lib/teachers';
import { loadPaperIndex, hasYear } from '@/lib/question-bank';
import { bankSubjectToSite } from '@/lib/subject-vocabulary';
import { coverPaper, coverMeta, pickVariedRecent, type CoverSourcePaper } from '@/lib/paper-cover-mapping';
import { generateLocalBusinessSchema, generateServiceSchema } from '@/utils/structuredDataGenerators';
import type { SearchMode } from '@/utils/searchFacets';
import { reportLoadError } from '@/lib/load-error';

/* P1-3/P1-7: neither of these renders anywhere near the top of the page --
   HomeActivitySection is section 13 (Favourites/Recently visited) and
   EyesPanel is the last section, the sentence-builder at the very bottom.
   Both are Home-only (no other route imports them) and both were previously
   static imports, so every cold/direct load of ANY route paid for their code
   inside the shared entry chunk before that route's own chunk even started
   downloading (confirmed via dist/assets/index-*.js). Lazy here keeps Index
   itself eager (it's still a static import in App.tsx) while letting these
   two below-the-fold children load in their own chunk. SearchDesk and
   CornerMascot are NOT lazy-loaded: both render inside the hero (sections
   2-4), which is above the fold on every viewport this page is tested at. */
const HomeActivitySection = lazy(() =>
  import('@/components/HomeActivitySection').then((m) => ({ default: m.HomeActivitySection })),
);
const EyesPanel = lazy(() =>
  import('@/components/home/EyesPanel').then((m) => ({ default: m.EyesPanel })),
);

interface Teacher {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  is_verified?: boolean | null;
  subjects: { name: string; slug: string } | null;
  featuredSubjectLabel?: string | null;
  whatsappLink?: string | null;
  experienceYears?: number | null;
  sirMaam?: string | null;
  minFees?: number | null;
  maxFees?: number | null;
  area?: string | null;
}

interface Subject {
  id: string;
  name: string;
  slug: string;
  teacherCount: number;
  paperCount: number;
}

/* Shape a PaperCover actually renders (paper-cover.tsx's PaperCoverPaper),
   plus the `meta` lines it prints under the headline. Built by running a bank
   row through paper-cover-mapping.ts's coverPaper()/coverMeta() — the same
   helpers PastPapers.tsx's own shelf uses, so a paper reads identically on
   both surfaces. */
interface RecentPaper {
  id: string;
  title: string;
  subject: string;
  board: string;
  year: number | string;
  /** Subject, class and (for board papers) school — coverMeta()'s output. */
  meta: string[];
  /** Bank papers get a generated tint (one subject, many schools, would
   *  otherwise render identical covers) — same `${school}-${id}` key
   *  PastPapers.tsx's shelf uses. */
  tintKey: string;
  /** Listed but not yet openable — PaperCover shows "Soon" instead of a lock. */
  comingSoon: boolean;
}

interface StudentQuote {
  id: string;
  comment: string;
  authorName: string;
  authorMeta: string;
  /** Who the review is about. A quote like "Ashok sir explains clearly" is
   *  unreadable on the home page without it — the reader has no idea who
   *  "Ashok sir" is or how to reach them. */
  teacherName: string | null;
  teacherSlug: string | null;
  teacherImageUrl: string | null;
}

const BOARD_ORDER = ['ICSE', 'CBSE', 'IGCSE', 'IB', 'State'] as const;
const BOARD_FILLS: Record<string, string> = {
  ICSE: 'bg-brand text-brand-foreground',
  CBSE: 'bg-brand-blue-subtle text-brand-blue-deep',
  IGCSE: 'bg-panel text-background',
  IB: 'bg-muted text-foreground',
  State: 'bg-warm-band text-foreground',
};
/* Tilt is a mobile-only flourish — the project owner flagged it as "too
   crooked" on desktop, so each entry carries its own tilt below `lg` and
   snaps flat at `lg` and up. Literal classes (not built from a template
   string) so Tailwind's content scanner can see them. */
const BOARD_TILT_CLASSES = [
  'rotate-[-1deg] motion-reduce:rotate-0 lg:rotate-0',
  'rotate-[0.8deg] motion-reduce:rotate-0 lg:rotate-0',
  'rotate-[-0.6deg] motion-reduce:rotate-0 lg:rotate-0',
  'rotate-[1deg] motion-reduce:rotate-0 lg:rotate-0',
  'rotate-[-0.5deg] motion-reduce:rotate-0 lg:rotate-0',
];

// "9-12" / "9,10,11,12" / "Class 9 to 12" -> [9,10,11,12]. Real teacher data,
// tokenized the same way the subjects tile counts already are (Index.tsx's
// prior `subjects_text` pattern) rather than invented — design.md §0.10.
function parseClassNumbers(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const out = new Set<number>();
  const rangeRe = /(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})/gi;
  let stripped = raw;
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(raw)) !== null) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a && b && a <= b && b - a < 12) {
      for (let n = a; n <= b; n++) out.add(n);
    }
    stripped = stripped.replace(m[0], ' ');
  }
  (stripped.match(/\d{1,2}/g) || []).forEach((n) => out.add(parseInt(n, 10)));
  return Array.from(out);
}

export default function Index() {

  const navigate = useNavigate();
  const { profile } = useAuth();
  const { likedTeacherIds, likedCount } = useLikes();
  const { intent, experience } = useIntent();
  // Shared by the teachers-fork CTA and the featured-teachers footer link
  // below — both fall back to their own existing copy/destination when this
  // is null, which is most visitors (nothing subject-specific known yet).
  const teachersCta = intentCta(intent);

  useRequireRole();

  // Handoff H-023/S-015: Home renders its own eyes panel inline (with the
  // real sentence-builder data this page already fetches), replacing
  // AppShell's default pre-footer for this route only.
  useChromeConfig({ preFooter: 'none' });

  // Homepage-specific JSON-LD structured data
  useEffect(() => {
    const localBusinessScript = document.createElement('script');
    localBusinessScript.type = 'application/ld+json';
    localBusinessScript.id = 'homepage-localbusiness-schema';
    localBusinessScript.textContent = JSON.stringify(generateLocalBusinessSchema());

    const serviceScript = document.createElement('script');
    serviceScript.type = 'application/ld+json';
    serviceScript.id = 'homepage-service-schema';
    serviceScript.textContent = JSON.stringify(
      generateServiceSchema({
        id: 'https://www.shikshaq.in/#service',
        name: 'Free Tutor-Student Connection Service',
        description:
          'Connect with verified tutors for personalized tuition in your locality. Free platform for both students and educators.',
        serviceType: 'Educational Tutoring Service',
        areaServed: 'Kolkata',
        availableChannel: {
          serviceUrl: 'https://www.shikshaq.in/all-tuition-teachers-in-kolkata',
          servicePhone: '+91-8240980312',
        },
        offers: [
          { '@type': 'Offer', name: 'Subject-Based Tutor Search', description: 'Find tutors for Mathematics, Physics, Chemistry, Biology, English, and more', price: '0', priceCurrency: 'INR' },
          { '@type': 'Offer', name: 'Online Tuition', description: 'Connect with tutors offering online classes', price: '0', priceCurrency: 'INR' },
          { '@type': 'Offer', name: 'Offline/Home Tuition', description: 'Find tutors offering offline/home tuition in your area', price: '0', priceCurrency: 'INR' },
        ],
      })
    );

    document.head.appendChild(localBusinessScript);
    document.head.appendChild(serviceScript);
    return () => {
      document.getElementById('homepage-localbusiness-schema')?.remove();
      document.getElementById('homepage-service-schema')?.remove();
    };
  }, []);

  /* Home data on react-query. Was a ~180-line useEffect owning its own loading
     and error flags on top of a separate localStorage cache. The queries and
     every derivation are unchanged.

     One real improvement falls out of the move: the featured grid fills any
     remainder with Math.random(), so under the old effect it reshuffled on
     every mount. Inside a queryFn it is computed once per cache entry and
     stays put while the entry is fresh. */
  const home = useQuery({
    queryKey: ['home', 'landing'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      let featured: Teacher[] = [];
      let subjectList: Subject[] = [];
      /* The localStorage warm-start that used to live here is gone: react-query
         now owns caching for this data, and keeping a second cache in front of
         it meant two sources of truth that could disagree. src/utils/cache.ts
         stays for the call sites still using it. */

        const desiredSubjects = ['Chemistry', 'Hindi', 'English', 'Maths', 'Mathematics', 'Psychology', 'Computers', 'Computer', 'Accounts', 'Biology', 'Economics'];
        const [subjectsRes, upvoteStatsRes, allTeachersRes, facetCountsRes, bankPapersForFacets] = await Promise.all([
          supabase.from('subjects').select('*').in('name', desiredSubjects).limit(10),
          // teacher_upvote_stats is a pre-aggregated view (teacher_id, upvote_count) —
          // avoids pulling every teacher_upvotes row down and counting client-side.
          // Was limit(6) — the featured rail showed at most 6 teachers no
          // matter how many the site actually has, so "start with the
          // teachers parents pick" read as a small, fixed set rather than a
          // rail with real depth to scroll through. 24 is a real cap for
          // page weight, not an arbitrary "still small" number — allTeachers
          // below already pulls up to 200 for other purposes, so the fill
          // logic has plenty to draw from without a second round trip.
          supabase.from('teacher_upvote_stats').select('teacher_id, upvote_count').order('upvote_count', { ascending: false }).limit(24),
          supabase
            .from('teachers_list')
            .select('id, name, slug, image_url, is_verified, subject_id, classes, subjects(name, slug), subjects_text:subjects')
            .limit(200),
          /* teacher_boards (every teacher's "School Boards Catered" cell) is
             still one aggregate done in the database (migration
             home_facet_counts_rpc, not checked into supabase/migrations/).
             paper_boards from the SAME rpc is NOT used any more (see below):
             it reads the wrong table (bank_papers has 1,960 rows; the RPC's
             own paper_boards always came back {}), so the homepage's paper
             board pills silently never rendered -- 2026-09-26,
             docs/SUPABASE_RUNBOOK.md. We cannot fix the RPC's SQL from here
             (no migration file for it, anon can't read pg_proc), so
             paper_boards is derived client-side instead, from the same
             cached bank_papers index PastPapers.tsx already uses. */
          supabase.rpc('home_facet_counts'),
          loadPaperIndex(),
        ]);

        if (subjectsRes.error || upvoteStatsRes.error || allTeachersRes.error) {
          if (import.meta.env.DEV) {
            console.error('Index.fetchData error:', {
              subjects: subjectsRes.error,
              upvoteStats: upvoteStatsRes.error,
              teachers: allTeachersRes.error,
            });
          }
          throw subjectsRes.error || upvoteStatsRes.error || allTeachersRes.error;
        }

        const allTeachers = allTeachersRes.data || [];

        // Top upvoted teachers from teachers_list, limit 6. Fill any remainder
        // randomly so the grid never renders fewer than 6 tiles when upvotes
        // are sparse.
        let teachersData: typeof allTeachers = [];
        if (upvoteStatsRes.data && upvoteStatsRes.data.length > 0) {
          const topIds = upvoteStatsRes.data.map((u) => u.teacher_id).filter(Boolean) as string[];
          const teacherMap = new Map(allTeachers.map((t) => [t.id, t]));
          teachersData = topIds.map((id) => teacherMap.get(id)).filter(Boolean) as typeof allTeachers;
        }
        const FEATURED_TARGET = 24;
        if (teachersData.length < FEATURED_TARGET) {
          const existingIds = new Set(teachersData.map((t) => t.id));
          const shuffled = allTeachers.filter((t) => !existingIds.has(t.id)).sort(() => Math.random() - 0.5);
          teachersData = [...teachersData, ...shuffled.slice(0, FEATURED_TARGET - teachersData.length)];
        }

        if (teachersData.length > 0) {
          // Card-level fields (WhatsApp link, experience, fees, area) come from the
          // same Shikshaqmine-by-slug helper Liked/My Teachers already use — a lean,
          // column-scoped fetch rather than a second select('*') round trip.
          const basicMap = await getShikshaqmineBasicBySlugs(teachersData.map((t) => t.slug));
          const processed: Teacher[] = teachersData.map((teacher) => {
            const basic = basicMap.get(teacher.slug);
            // Bug 5 fix: the query above already selects `subjects_text` — the
            // raw comma-separated subject list from teachers_list (the same
            // column Browse.tsx already tokenizes for its own subject counts,
            // aliased `subjects_text:subjects` at the select above) — but this
            // mapping used to read only `teacher.subjects?.name`, the FK-joined
            // `subjects` relation. That relation is null for plenty of teacher
            // rows that DO have real subject text, so the card fell through
            // straight to TeacherCard's "Tuition Teacher" fallback even though
            // the actual subject was sitting right there in `subjects_text`,
            // unused. Same first-token extraction Browse.tsx already uses.
            const rawSubjectsText = (teacher as { subjects_text?: string | null }).subjects_text;
            const firstSubjectToken = rawSubjectsText
              ? rawSubjectsText.split(',').map((s) => s.trim()).filter(Boolean)[0] ?? null
              : null;
            return {
              id: teacher.id,
              name: teacher.name,
              slug: teacher.slug,
              image_url: teacher.image_url,
              is_verified: (teacher as { is_verified?: boolean | null }).is_verified,
              subjects: teacher.subjects as { name: string; slug: string } | null,
              featuredSubjectLabel: firstSubjectToken || teacher.subjects?.name || null,
              whatsappLink: basic?.whatsappLink ?? null,
              experienceYears: basic?.experienceYears ?? null,
              minFees: basic?.minFees ?? null,
              maxFees: basic?.maxFees ?? null,
              area: basic?.area ?? null,
              /* Owner: the featured rail showed bare names while Browse and
                 the profile both render the honorific. basicMap is already
                 fetched above for the fee/area fields, so this costs nothing. */
              sirMaam: basic?.sirMaam ?? null,
            };
          });
          featured = processed;
        }

        if (subjectsRes.data) {
          const desiredOrder = desiredSubjects;
          const seen = new Set<string>();
          const filtered = subjectsRes.data
            .filter((s) => desiredOrder.includes(s.name))
            .filter((s) => {
              const normalized = s.name.toLowerCase().replace('computers', 'computer');
              if (seen.has(normalized)) return false;
              seen.add(normalized);
              return true;
            })
            .sort((a, b) => desiredOrder.indexOf(a.name) - desiredOrder.indexOf(b.name));
          // Spec: 8 tiles mobile, 12 on desktop. The fetch above already
          // limits to 10 desired subjects, so this slice is a no-op past 10
          // until more subjects are added — kept at 12 to match the spec'd
          // ceiling rather than the current data size.

          const subjectAliases: Record<string, string[]> = {
            computer: ['computer', 'computers'],
            computers: ['computer', 'computers'],
            maths: ['maths', 'mathematics'],
            mathematics: ['maths', 'mathematics'],
          };
          const matchesSubject = (teacherSubjectsText: string | null | undefined, tileName: string) => {
            const tokens = (teacherSubjectsText || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
            const tileKey = tileName.toLowerCase();
            const aliases = subjectAliases[tileKey] || [tileKey];
            return tokens.some((t) => aliases.includes(t));
          };

          const withCounts: Subject[] = filtered.map((s) => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
            teacherCount: allTeachers.filter((t) => matchesSubject((t as { subjects_text?: string | null }).subjects_text, s.name)).length,
            paperCount: 0,
          }));

          subjectList = withCounts;
        }

        // Board pill stack — real per-board TUTOR counts, which is what mockup
        // 2a actually shows ("ICSE · 128 tutors"). An earlier pass counted
        // published papers instead, on the assumption that no per-board teacher
        // count existed; it does — Shikshaqmine."School Boards Catered" is the
        // same column Browse already tokenizes for its board filter. Counting
        // papers also meant the whole section vanished on a database with no
        // papers in it, which is the state this one is in.
        /* Tallies now arrive pre-aggregated. Mapped through BOARD_ORDER so
           the display order and the key spellings stay this page's own,
           rather than whatever order jsonb_object_agg returned. */
        const facetCounts = (facetCountsRes.data ?? {}) as {
          paper_boards?: Record<string, number>;
          teacher_boards?: Record<string, number>;
        };
        if (facetCountsRes.error) {
          logger.error('Board counts failed', facetCountsRes.error);
        }
        const tallyFrom = (src: Record<string, number> | undefined) => {
          const out: Record<string, number> = {};
          Object.entries(src ?? {}).forEach(([raw, n]) => {
            const key = BOARD_ORDER.find((b) => b.toLowerCase() === raw.trim().toLowerCase());
            if (key) out[key] = (out[key] || 0) + n;
          });
          return out;
        };
        const boardTally = tallyFrom(facetCounts.teacher_boards);

        // By-class rail — real per-class teacher counts, tokenized from the
        // teachers_list `classes` column (same pattern as the subject counts
        // above), resolving O-01's "needs a query that doesn't exist" for the
        // teacher side: the column already exists, it just wasn't parsed.
        const classTally: Record<number, number> = {};
        allTeachers.forEach((t) => {
          const nums = parseClassNumbers((t as { classes?: string | null }).classes);
          nums.forEach((n) => {
            if (n >= 9 && n <= 12) classTally[n] = (classTally[n] || 0) + 1;
          });
        });


        // Derived from bank_papers client-side (see the loadPaperIndex() call
        // above) rather than facetCounts.paper_boards: that RPC field reads
        // the wrong table and always comes back {}. Reuses the same
        // BOARD_ORDER-normalised tallyFrom the teacher side already uses.
        const paperBoardRaw: Record<string, number> = {};
        bankPapersForFacets.forEach((p) => {
          paperBoardRaw[p.board] = (paperBoardRaw[p.board] ?? 0) + 1;
        });
        const paperBoardTally = tallyFrom(paperBoardRaw);

        // "New papers" shelf (section 04, "the boards set") — was reading
        // `papers` (18 rows, the submit-a-paper flow, 0 published to anon),
        // not `bank_papers` (the library this same queryFn already loaded
        // above for the board pills) — the exact "counted/read the wrong
        // table" bug class CLAUDE.md calls out. That made the shelf almost
        // always fall through to its EmptyResults ("Papers are being added").
        // Reuses bankPapersForFacets rather than a second loadPaperIndex()
        // call — the function memoises one promise for the whole session
        // regardless, but there is no reason to ask twice from the same
        // queryFn.
        //
        // Mapped into the same CoverSourcePaper shape PastPapers.tsx's own
        // bank mapping builds, then run through the SAME coverPaper()/
        // coverMeta()/pickVariedRecent() paper-cover-mapping.ts exports —
        // product-owner review of the shelf (2026-09-26) caught two things a
        // bare slice(0, 10) missed: no meta line (subject/class/school), so
        // every cover under-described itself next to PastPapers.tsx's own
        // shelf, and no variety — the bank sorts undated board papers first
        // within a year, so ten near-identical "ICSE 2026" covers could
        // (and did) fill the whole rail.
        const bankAsCoverSource: CoverSourcePaper[] = bankPapersForFacets.map((b) => {
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
            _bankYear: b.year,
            _questions: b.questionCount,
            _isBoard: b.isBoardPaper,
            _needsReview: b.needsReview,
          };
        });
        const recentPapers: RecentPaper[] = pickVariedRecent(bankAsCoverSource, 10).map((p) => {
          const shown = coverPaper(p);
          return {
            id: p.id,
            subject: shown.subject,
            board: shown.board,
            title: shown.title,
            year: shown.year,
            meta: coverMeta(p),
            tintKey: `${p.school}-${p.id}`,
            comingSoon: p._needsReview === true,
          };
        });

      return { featured, subjectList, boardTally, classTally, paperBoardTally, recentPapers };
    },
  });

  /* `?? []` inline is a new array identity on every render, which invalidated
     the useMemo downstream every time and re-derived its work for nothing.
     Same fix as bankPapers and recentPapers on the papers page. */
  const featuredTeachers = useMemo(() => home.data?.featured ?? [], [home.data]);
  const subjects = home.data?.subjectList ?? [];
  const boardCounts = home.data?.boardTally ?? {};
  const classCounts = home.data?.classTally ?? {};
  const paperBoardCounts = home.data?.paperBoardTally ?? {};
  const loading = home.isPending;
  const loadError = home.isError;
  void classCounts;

  /* clearExpiredCache() removed: utils/cache.ts schedules one idle pass per
     page load. This, Browse's copy and the module-load call meant a single
     visit scanned and JSON-parsed all of localStorage three times. */

  /* The three remaining home fetches, moved off bare useEffect onto react-query
     alongside the landing query above. They were the last of the ~180-line
     effect era on this route: six requests fired on every single mount, with no
     cache, no dedup and no shared staleness — so returning home from a teacher
     profile re-ran all six.

     The queries themselves are unchanged, character for character. What changes
     is that they now answer from cache for five minutes like the landing data
     does, and that three pieces of state and their setters disappear: the value
     IS the query result rather than something an effect copies into a hook.

     Kept as three keys rather than one, because they fail independently — an
     empty papers table should not cost the page its stats or its quotes. */
  const statsQuery = useQuery({
    queryKey: ['home', 'stats'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      /* 2026-09-26: papers was reading `papers` (18 rows, the submit-a-paper
         flow), not `bank_papers` (the library, ~1,960 rows incl. needs_review)
         -- the exact "counted the wrong table" bug class CLAUDE.md calls out.
         The sentence-builder's "N papers" pill was silently near-zero. Matches
         useSiteCounts' inclusive count (is_published, needs_review or not). */
      const [teachersRes, papersRes, reviewsRes] = await Promise.all([
        supabase.from('teachers_list').select('id', { count: 'exact', head: true }),
        supabase.from('bank_papers').select('id', { count: 'exact', head: true }).eq('is_published', true).gt('question_count', 0),
        supabase.from('teacher_comments').select('id', { count: 'exact', head: true }).eq('approved', true),
      ]);
      return {
        teachers: teachersRes.count ?? null,
        papers: papersRes.count ?? null,
        reviews: reviewsRes.count ?? null,
      };
    },
  });
  const stats = statsQuery.data ?? { teachers: null, papers: null, reviews: null };

  // New papers (section 04, "the boards set") — the 10 bank papers computed
  // inside the `home` query above (see its 2026-09-26 comment), not a
  // separate query: that queryFn already holds the one loadPaperIndex() call
  // this route makes, so deriving from its result here is one fetch, not two.
  const recentPapers = home.data?.recentPapers ?? [];

  // Student quote rail (C-009) — real, approved teacher_comments only. Never
  // ships placeholder quotes (design.md §0.10).
  const quotesQuery = useQuery({
    queryKey: ['home', 'quotes'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<StudentQuote[]> => {
      const { data: comments, error: commentsError } = await supabase
        /* teacher_comments_public, not the base table: `anon` no longer holds
           SELECT on teacher_comments.user_id, because that column plus an
           unfiltered public_profiles made every anonymous review
           de-anonymisable by a single join. The view nulls user_id on
           anonymous rows and is the only read path a logged-out visitor has. */
        .from('teacher_comments_public')
        .select('id, comment, is_anonymous, user_id, created_at, teacher_id')
        .eq('approved', true)
        .order('created_at', { ascending: false })
        /* Pull a wider slice than the six we show: the rail is deduplicated to
           one quote per teacher below, and with one popular teacher holding a
           dozen reviews a limit of 6 returned six cards about the same person. */
        .limit(60);
      if (commentsError) throw commentsError;
      if (!comments || comments.length === 0) return [];

      const userIds = [...new Set(comments.filter((c) => !c.is_anonymous).map((c) => c.user_id))];
      const profilesMap = new Map<string, { full_name: string | null; role: string | null; school_college: string | null; grade: string | null }>();
      if (userIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('public_profiles')
          .select('id, full_name, role, school_college, grade')
          .in('id', userIds);
        if (profilesError) throw profilesError;
        (profiles || []).forEach((pr) => {
          if (pr.id) profilesMap.set(pr.id, pr);
        });
      }

      /* The teachers these quotes are about, in one batched read — same shape
         as the profiles lookup above, no per-row query. */
      const teacherIds = [...new Set(comments.map((c) => (c as { teacher_id?: string }).teacher_id).filter(Boolean))] as string[];
      const teacherMap = new Map<string, { name: string | null; slug: string | null; imageUrl: string | null }>();
      if (teacherIds.length > 0) {
        const { data: tRows, error: tRowsError } = await supabase
          .from('teachers_list')
          .select('id, name, slug, image_url')
          .in('id', teacherIds);
        if (tRowsError) throw tRowsError;
        (tRows || []).forEach((t) => {
          if (t.id) teacherMap.set(t.id, { name: t.name, slug: t.slug, imageUrl: (t as { image_url?: string | null }).image_url ?? null });
        });
      }

      /* One quote per teacher, teachers with the most reviews first — six
         cards all praising the same tutor says nothing about the site. */
      const perTeacher = new Map<string, number>();
      comments.forEach((c) => {
        const id = (c as { teacher_id?: string }).teacher_id;
        if (id) perTeacher.set(id, (perTeacher.get(id) ?? 0) + 1);
      });
      const seenTeacher = new Set<string>();
      const picked = comments
        .filter((c) => {
          const id = (c as { teacher_id?: string }).teacher_id;
          if (!id) return false;
          if (seenTeacher.has(id)) return false;
          seenTeacher.add(id);
          return true;
        })
        .sort((a, b) => {
          const ca = perTeacher.get((a as { teacher_id?: string }).teacher_id ?? '') ?? 0;
          const cb = perTeacher.get((b as { teacher_id?: string }).teacher_id ?? '') ?? 0;
          return cb - ca;
        })
        .slice(0, 6);

      return picked.map((c) => {
        const profile = c.is_anonymous ? null : profilesMap.get(c.user_id);
        const teacher = teacherMap.get((c as { teacher_id?: string }).teacher_id ?? '');
        const name = c.is_anonymous ? 'Anonymous' : profile?.full_name || 'A Shikshaq user';
        const metaParts = c.is_anonymous
          ? []
          : profile?.role === 'guardian'
            ? ['Guardian']
            : [profile?.school_college, profile?.grade ? `Class ${profile.grade}` : null].filter(Boolean);
        return {
          id: c.id,
          comment: c.comment,
          authorName: name,
          authorMeta: (metaParts as string[]).join(' · '),
          teacherName: teacher?.name ?? null,
          teacherSlug: teacher?.slug ?? null,
          teacherImageUrl: teacher?.imageUrl ?? null,
        };
      });
    },
  });
  /* A failed quote read used to look like "no quotes yet". Say so, with a retry. */
  const quotesRefetch = quotesQuery.refetch;
  useEffect(() => {
    if (quotesQuery.isError) {
      reportLoadError('home.quotes', quotesQuery.error, { what: 'student reviews', retry: () => { void quotesRefetch(); } });
    }
  }, [quotesQuery.isError, quotesQuery.error, quotesRefetch]);
  const studentQuotes = quotesQuery.data ?? [];

  // Handoff H-023: the sentence builder moved out of Footer.tsx, "move not
  // copy" — same component, same slot logic and submit routes. Its state now
  // lives in the shared useSentenceBuilder hook (P-014 needs the identical
  // builder on TeacherProfile too), not duplicated per page.
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();

  const [heroMode, setHeroMode] = useState<SearchMode>('teachers');
  /* Owner spec: the search toggle's mode now drives which hero fork panel
     (teachers/papers) is "active" — below `lg` only the active one shows,
     at `lg`+ it takes the larger share of the row and its mascot is awake.
     `useMediaQuery`, not `innerWidth`: the same source CSS breakpoints read
     from (CLAUDE.md gotcha), so the JS split and the `lg:` classes below
     can never disagree about which layout is showing. */
  const teachersActive = heroMode === 'teachers';
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  /* Only teachers who actually have a photo. The stack is a row of faces; an
     initial placeholder in it would read as a missing image rather than a
     person. */
  const featuredWithPhotos = featuredTeachers.filter((t) => Boolean(t.image_url));

  // H-005 branch 1b needs the single liked teacher's name. H-005 adds no new
  // query, so this only resolves when that teacher is already in the
  // featured list this page already fetched — otherwise 1b falls through to 2.
  const likedSingleTeacher = useMemo(() => {
    if (likedCount !== 1) return null;
    const [onlyId] = Array.from(likedTeacherIds);
    return featuredTeachers.find((t) => t.id === onlyId) ?? null;
  }, [likedCount, likedTeacherIds, featuredTeachers]);
  const likedSingleTeacherName = likedSingleTeacher?.name ?? null;

  const baseHeroCopy = useMemo(
    () => resolveHeroCopy({
      profile,
      likedCount,
      likedSingleTeacherName,
      likedSingleTeacherImageUrl: likedSingleTeacher?.image_url ?? null,
      /* Same gate InlinePapersNudge and every other adaptive surface reads —
         below it, the trail-based candidates (branches 3-5) fall through to
         the generic pool instead of personalising off a signal the rest of
         the page would not yet act on. */
      trailAdaptationAllowed: experience.level !== 'none',
    }),
    [profile, likedCount, likedSingleTeacherName, likedSingleTeacher, experience.level],
  );
  const heroCopy = useMemo(
    () => (heroMode === 'papers' ? papersHeroCopy(baseHeroCopy, profile) : baseHeroCopy),
    [heroMode, baseHeroCopy, profile],
  );
  /* Teachers are orange, papers are blue — the same two accents the search
     desk, the fork panels and the results rows already use. Carrying it up
     into the greeting is what makes the switch read as the whole page
     changing subject rather than one control changing state. */
  const heroAccent = heroMode === 'papers' ? 'text-brand-blue' : 'text-brand';
  /* H-005a rule 3: three lines maximum at 375px, measured against the LONGEST
     REAL value — not a short sample. Six lines failed it: two pool lines, the
     handoff's own "No agent in between." line at four, and branches 3-5 once
     they carry a real 25-character name or "WBCHSE Environmental Science".
     The branch copy is specified verbatim, so the size steps down instead of
     the words being cut — every branch stays inside three lines at any real
     value, and short lines keep the full 34px. */
  const heroLength = (heroCopy.before + heroCopy.bold + heroCopy.after).length;
  const heroSize =
    heroLength > 74
      ? 'text-[26px] leading-[1.16] lg:text-[44px] lg:leading-[1.06]'
      : heroLength > 54
        ? 'text-[29px] leading-[1.15] lg:text-[50px] lg:leading-[1.04]'
        : 'text-[34px] leading-[1.14] lg:text-[58px] lg:leading-[1.02]';
  // The hero's own mode (from the copy resolver) drives the search desk's
  // initial mode too, the same way the old two-line headline used to swap
  // with SearchDesk's onModeChange — except now the direction of truth runs
  // the other way for the papers branch: H-005's branch 5 both names the
  // hero copy AND wants the desk in papers mode from first paint.
  useEffect(() => {
    if (baseHeroCopy.mode === 'papers') setHeroMode('papers');
  }, [baseHeroCopy.mode]);

  /* chip 'stripe' means the line names ONE specific teacher (heroCopy.bold) —
     that chip must be that teacher's own photo or nothing, never a
     different, unrelated teacher's face next to their name. Only the
     generic 'avatar' branches (no specific person named) borrow
     featuredTeachers[0] as decoration. */
  const namesSpecificTeacher = heroCopy.chip === 'stripe';
  const chipImageUrl = namesSpecificTeacher ? heroCopy.imageUrl : featuredTeachers[0]?.image_url;
  const chipPlaceholderName = namesSpecificTeacher ? heroCopy.bold : featuredTeachers[0]?.name;
  const heroAvatarChip = heroCopy.chip === null ? null : (
    <span
      aria-hidden
      className={`relative inline-block h-[28px] w-[28px] shrink-0 overflow-hidden rounded-full align-[-6px] ${
        chipImageUrl ? '' : 'ring-1 ring-warm-hairline'
      }`}
    >
      {chipImageUrl ? (
        <img src={validateImageSrc(chipImageUrl)} alt="" className="h-full w-full object-cover" />
      ) : (
        <StripePlaceholder name={chipPlaceholderName} initialSize={14} className="h-full w-full" />
      )}
    </span>
  );

  const leadTeacher = featuredTeachers[0];

  return (
    <div className="min-h-screen bg-background">
      {/* Owner correction: edge-to-edge is the intended pattern for
          BentoStack pages — panels stretch left to right with 0 gap to
          the viewport, not inset behind a page-level gutter. An earlier
          pass here wrapped this in PageContainer/max-w-6xl to match
          PastPapers/TeacherProfile's own hand-rolled centred column, on
          the theory that THOSE were the correct reference — backwards:
          this page's original bare `<main>` was the one actually
          matching the handoff, and PastPapers/TeacherProfile are the
          pages that need fixing to match it, not the other way round. */}
      <main id="main-content">
        <BentoStack>
          {/* --------------------------------------------- 1-4 · Hero grid (D-005)
              Mobile: greeting, then search, then the two fork panels — a plain
              flex-col stack, touching (gap-0), same as BentoStack's own rule.
              `lg`: grid-cols-[1.15fr_1fr] — greeting+search left, forks stacked
              right — per the 34-desktop.md D-005 "Home hero" row. */}
          {/* No lg:items-start. Pinned to the top, the right column ended
              wherever its two fork panels ended and left a tall band of page
              ground beside the search desk — the hero read as half-finished at
              desktop. The columns are equal height now and the forks divide it
              between them. */}
          <div className="flex flex-col gap-0 lg:grid lg:grid-cols-[1.15fr_1fr] lg:gap-0">
            <div className="flex flex-col gap-0">
          {/* -------------------------------------------------------- 1 · Greeting */}
          <BentoPanel fill="card" edge="top" className="relative overflow-hidden pt-[14px] px-[22px]">
            {/* Both lines are keyed on the mode so a toggle flip remounts them
                and re-runs the entrance. animate-blur-swap defocuses the old
                wording out and the new wording in, which reads as one line
                changing its mind rather than two lines crossfading. */}
            <p
              key={`eyebrow-${heroMode}`}
              className={`animate-blur-swap text-[13px] font-semibold ${heroAccent} motion-reduce:animate-none`}
            >
              {heroCopy.eyebrow}
            </p>
            <h1
              key={`${heroMode}-${heroCopy.before}${heroCopy.bold}`}
              className={`animate-blur-swap mt-[6px] text-balance font-display font-normal tracking-[-0.045em] text-foreground motion-reduce:animate-none lg:tracking-[-0.05em] ${heroSize}`}
            >
              {heroAvatarChip}
              {heroAvatarChip ? ' ' : null}
              {heroCopy.before}
              {/* When the line names something reachable, the name IS the way
                  there. It used to be inert text: the hero told you it knew
                  which teacher you were considering and then made you go and
                  find them again. */}
              {heroCopy.href ? (
                <Link
                  to={heroCopy.href}
                  className={`animate-hero-blink font-extrabold motion-reduce:animate-none ${heroAccent} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
                >
                  {heroCopy.bold}
                </Link>
              ) : (
                <span className={`font-extrabold ${heroAccent}`}>{heroCopy.bold}</span>
              )}
              {heroCopy.after}
            </h1>

            {/* H-007: live facet-count pills replace the old stat-pill pair. */}
            {heroMode === 'teachers' && subjects.length > 0 && (
              <div key="pills-teachers" className="-mx-[22px] mt-4 animate-blur-swap overflow-x-auto px-[22px] scrollbar-hide motion-reduce:animate-none">
                <div className="flex w-max items-center gap-2">
                  {subjects.slice(0, 3).map((s) => (
                    <span
                      key={s.id}
                      className="flex h-[38px] shrink-0 items-center gap-[8px] whitespace-nowrap rounded-full bg-muted px-3.5 text-[13px] font-semibold text-foreground"
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 rounded-[2px]"
                        style={{ backgroundColor: getSubjectPalette(s.name).solid }}
                      />
                      {s.name} · {s.teacherCount}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {heroMode === 'papers' && Object.keys(paperBoardCounts).length > 0 && (
              <div key="pills-papers" className="-mx-[22px] mt-4 animate-blur-swap overflow-x-auto px-[22px] scrollbar-hide motion-reduce:animate-none">
                <div className="flex w-max items-center gap-2">
                  {BOARD_ORDER.filter((b) => paperBoardCounts[b]).slice(0, 3).map((b) => (
                    <Link
                      key={b}
                      to={`/past-papers/results?filter_boards=${encodeURIComponent(b)}`}
                      className="flex h-[38px] shrink-0 items-center gap-[8px] whitespace-nowrap rounded-full bg-brand-blue-subtle px-3.5 text-[13px] font-semibold text-brand-blue-deep transition-transform duration-tap ease-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:hover:translate-y-0"
                    >
                      <span aria-hidden className="h-2 w-2 rounded-[2px] bg-brand-blue" />
                      {b} · {paperBoardCounts[b]}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* D1's overlapping face stack. Desktop only — the mobile drawing
                has no equivalent and the facet pills already carry the count
                there. The faces are the real featured teachers rendered
                further down this same page, not stock or invented portraits,
                and it draws nothing at all until at least three of them have
                a photo. */}
            {featuredWithPhotos.length >= 3 && (stats.teachers ?? 0) > 0 && (
              <div className="mt-4 hidden items-center gap-3 lg:flex">
                <div className="flex -space-x-3">
                  {featuredWithPhotos.slice(0, 5).map((t) => (
                    <img
                      key={t.id}
                      src={imageAtWidth(t.image_url, 400)}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      decoding="async"
                      width={44}
                      height={44}
                      className="h-11 w-11 rounded-full border-2 border-card object-cover"
                    />
                  ))}
                </div>
                {/* A pill, like every other small fact on this page. It was
                    bare grey text sitting beside a row of avatars, which read
                    as a caption someone forgot to style rather than as part of
                    the same family as the facet pills directly above it. */}
                <span className="flex h-[34px] items-center gap-[8px] whitespace-nowrap rounded-full bg-muted px-3.5 text-[13px] font-semibold text-foreground">
                  <ShieldCheck className="h-[15px] w-[15px] flex-none text-brand-deep" strokeWidth={2.25} aria-hidden="true" />
                  {stats.teachers} verified teachers in Kolkata
                </span>
              </div>
            )}
          </BentoPanel>

          {/* ---------------------------------------------------------- 2 · Search */}
          <SearchDesk onModeChange={setHeroMode} />

          {/* Compact form of the same notice Browse carries. Sits under the
              search rather than above it: the point is to catch someone as
              they go to search, not to greet them with a caveat. It renders
              nothing at all unless location is already known AND outside West
              Bengal — it never prompts from here. */}
          <RegionNotice variant="inline" />
            </div>

            {/* lg:pt-[72px] matches the nav reserve the greeting panel gets from
                `edge="top"`. At lg this column is the RIGHT half of D-005's
                `grid-cols-[1.15fr_1fr]` hero, so it starts at y=0 like the
                left one — but it holds no `edge="top"` panel, so nothing was
                clearing the floating top bar and the first fork's heading sat
                underneath it. The left column's reserve only offsets its own
                cell. */}
            {/* Owner spec: the search toggle above now drives which fork is
                "active." Below `lg` only the active tile shows (the other
                fades/scales out and is pulled out of the tab order — never
                just hidden with CSS that a screen reader or Tab key would
                still reach); at `lg`+ both stay side by side but the active
                one takes ~65% of the row and the inactive ~35%, animating
                between the two splits rather than snapping. The two mobile
                states share one grid cell ([grid-area:1/1]) so the container's
                height never jumps as they cross-fade — at `lg` the container
                switches to a real flex row and that grid-area is moot. */}
            <div className="relative grid lg:flex lg:min-w-0 lg:items-stretch lg:gap-0 lg:pt-[72px]">
          {/* --------------------------------------------------- 3 · Teachers fork */}
          <div
            className={cn(
              '[grid-area:1/1] transition-[opacity,transform] duration-[220ms] ease-settle motion-reduce:transition-opacity motion-reduce:duration-150',
              'lg:transition-[flex-basis] lg:duration-lift lg:ease-settle lg:grow-0 lg:shrink-0 lg:min-w-0 lg:opacity-100 lg:scale-100 lg:pointer-events-auto',
              teachersActive
                ? 'relative z-10 opacity-100 scale-100 lg:basis-[70%]'
                : 'opacity-0 scale-95 pointer-events-none lg:basis-[30%]',
            )}
            aria-hidden={!teachersActive && !isDesktop}
          >
          <BentoPanel fill="brandTint" className="h-full !px-[22px] !pt-[18px] !pb-5 lg:flex lg:flex-col lg:justify-between lg:!px-6 lg:!pt-6 lg:!pb-6 xl:!px-8 xl:!pt-8 xl:!pb-8">
            {/* Owner call, reworked: the mascot was a tiny corner badge —
                "make them bigger, take up half the panel, circular." Now a
                real side-by-side split at lg: text content on the left, a big
                circular tracking face on the right.

                Compact (inactive) is its own layout, not a squeezed copy of
                the active one: side-by-side left no room for a full,
                unclipped heading beside even a small mascot (measured — the
                first pass truncated "Revise for free" to "R…", CRAFT.md's
                "no clipped words"). Compact stacks instead — heading on top
                at full tile width, small mascot pinned bottom-right below it
                via `justify-between` on the full-height column — so the two
                never compete for the same horizontal space and can never
                overlap (verified with getBoundingClientRect). */}
            <div className={cn('lg:flex lg:h-full lg:gap-2 xl:gap-3', teachersActive ? 'lg:items-center' : 'lg:flex-col lg:items-start lg:justify-between')}>
            <div className="min-w-0 lg:flex-1">
            <div className="flex items-center justify-between">
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-xl bg-brand text-brand-foreground">
                <Users className="h-[19px] w-[19px]" strokeWidth={2.25} aria-hidden />
              </span>
              {/* Dropped from the compact (inactive) tile at lg — three
                  overlapping avatars plus a 38px arrow button is decoration
                  the active tile can afford and the compact one can't. Always
                  shown on mobile — there the tile is either
                  active-and-full-width or not rendered at all, never
                  compact. */}
              {featuredWithPhotos.length > 0 && (
                <div className={cn('flex items-center', !teachersActive && 'lg:hidden')}>
                  <div className="flex -space-x-2.5">
                    {featuredWithPhotos.slice(0, 3).map((t) => (
                      <img
                        key={t.id}
                        src={imageAtWidth(t.image_url, 400)}
                        alt=""
                        aria-hidden
                        loading="lazy"
                        width={30}
                        height={30}
                        className="h-[30px] w-[30px] rounded-full object-cover ring-2 ring-brand-subtle"
                      />
                    ))}
                  </div>
                  <Link
                    to={teachersCta?.href ?? '/all-tuition-teachers-in-kolkata'}
                    aria-label="Find a teacher"
                    tabIndex={!teachersActive && !isDesktop ? -1 : undefined}
                    className="tap-44 ml-2 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-panel text-background transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:hover:translate-y-0"
                  >
                    <ArrowUpRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              )}
            </div>
            {/* The eyebrow line is the one piece of this block that follows
                intent ("Find a teacher" -> "Find Maths teachers"); the
                stylised "Message them yourself, free" line under it is brand
                voice, not a CTA label, and stays fixed so the block does not
                read as unstable every time the subject changes.

                Active: `text-balance` so the three words left over after
                "Message them" wraps don't strand "them" as a one-word orphan
                line — measured at 1280 this was wrapping to three lines
                without it. Compact: two DELIBERATE lines ("Message them" /
                "yourself, free" as separate block-level lines, not one
                inline phrase left to wrap on its own) at a fixed size small
                enough that neither line has to wrap again or clip — the
                panel's own share of the row isn't a predictable fraction of
                the viewport, so a vw-based clamp can't promise that fit the
                way a fixed size can. */}
            <Link
              to={teachersCta?.href ?? '/all-tuition-teachers-in-kolkata'}
              tabIndex={!teachersActive && !isDesktop ? -1 : undefined}
              className="group mt-[14px] block rounded-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-4 focus-visible:ring-offset-card"
            >
              <p className="text-[13px] font-medium text-warm-secondary">{teachersCta?.label ?? 'Find a teacher'}</p>
              {teachersActive ? (
                <p className="mt-[2px] text-balance font-display text-[25px] font-extrabold leading-[1.05] tracking-[-0.045em] lg:text-[21px] lg:leading-[1.08] lg:tracking-[-0.04em] 2xl:text-[25px] 2xl:leading-[1.05] 2xl:tracking-[-0.045em]">
                  <span className="text-brand-deep decoration-2 underline-offset-4 group-hover:underline">Message them</span>{' '}
                  <span className="font-normal text-foreground">yourself, free</span>
                </p>
              ) : (
                <p className="mt-[2px] font-display text-[17px] font-extrabold leading-[1.18] tracking-[-0.03em] lg:block">
                  <span className="block text-brand-deep decoration-2 underline-offset-4 group-hover:underline">Message them</span>
                  <span className="block font-normal text-foreground">yourself, free</span>
                </p>
              )}
            </Link>
            </div>
            <CornerMascot tone="teachers" asleep={!teachersActive} compact={!teachersActive} />
            </div>
          </BentoPanel>
          </div>

          {/* ----------------------------------------------------- 4 · Papers fork */}
          <div
            className={cn(
              '[grid-area:1/1] transition-[opacity,transform] duration-[220ms] ease-settle motion-reduce:transition-opacity motion-reduce:duration-150',
              'lg:transition-[flex-basis] lg:duration-lift lg:ease-settle lg:grow-0 lg:shrink-0 lg:min-w-0 lg:opacity-100 lg:scale-100 lg:pointer-events-auto',
              !teachersActive
                ? 'relative z-10 opacity-100 scale-100 lg:basis-[70%]'
                : 'opacity-0 scale-95 pointer-events-none lg:basis-[30%]',
            )}
            aria-hidden={teachersActive && !isDesktop}
          >
          <BentoPanel fill="papersTint" className="h-full !px-[22px] !pt-[18px] !pb-5 lg:flex lg:flex-col lg:justify-between lg:!px-6 lg:!pt-6 lg:!pb-6 xl:!px-8 xl:!pt-8 xl:!pb-8">
            {/* Compact (inactive) is its own stacked layout — see the
                teachers fork's comment above for why: side-by-side left
                "Revise for free" truncated to "R…", which CRAFT.md forbids.
                Heading on top at full tile width, small mascot pinned
                bottom-right below it. */}
            <div className={cn('lg:flex lg:h-full lg:gap-2 xl:gap-3', !teachersActive ? 'lg:items-center' : 'lg:flex-col lg:items-start lg:justify-between')}>
            <div className="min-w-0 lg:flex-1">
            {/* Same top-left icon-badge treatment as the teachers fork above
                (Users, bg-brand) — this panel had no equivalent icon at all. */}
            <span className="flex h-[38px] w-[38px] items-center justify-center rounded-xl bg-brand-blue text-white">
              <BookOpen className="h-[19px] w-[19px]" strokeWidth={2.25} aria-hidden />
            </span>
            <Link
              to="/past-papers"
              tabIndex={teachersActive && !isDesktop ? -1 : undefined}
              className="group mt-[14px] flex items-center justify-between gap-3 rounded-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-4 focus-visible:ring-offset-card"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-warm-secondary">Past papers</p>
                {/* Active: `text-balance` (same reasoning as the teachers
                    fork). Compact: two deliberate lines, own fixed size — see
                    the teachers fork's comment on why a fixed size beats a
                    vw-clamp here. */}
                {!teachersActive ? (
                  <p className="mt-[2px] text-balance font-display text-[22px] font-extrabold tracking-[-0.04em] lg:text-[19px] 2xl:text-[22px]">
                    <span className="text-brand-blue-deep">Revise</span>{' '}
                    <span className="font-normal text-foreground">for free</span>
                  </p>
                ) : (
                  <p className="mt-[2px] font-display text-[17px] font-extrabold leading-[1.18] tracking-[-0.03em]">
                    <span className="block text-brand-blue-deep">Revise</span>
                    <span className="block font-normal text-foreground">for free</span>
                  </p>
                )}
              </div>
              {/* Dropped from the compact tile for the same reason the
                  teachers fork drops its avatar row — see that comment. */}
              <span
                aria-hidden
                className={cn(
                  'h-11 w-11 flex-none items-center justify-center rounded-full bg-brand-blue text-white transition-transform duration-hover ease-settle group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:group-hover:transform-none',
                  teachersActive ? 'hidden' : 'flex',
                )}
              >
                <ArrowUpRight className="h-[18px] w-[18px]" strokeWidth={2.5} />
              </span>
            </Link>
            </div>
            <CornerMascot tone="papers" asleep={teachersActive} compact={teachersActive} />
            </div>
          </BentoPanel>
          </div>
            </div>
          </div>

          {/* --------------------------------------------- 5 · 01 Featured teachers */}
          <BentoPanel fill="card" className="!px-0 !py-[22px] lg:!py-8">
            <div className="px-[22px]">
              <NumberedHeading
                size="compact"
                line1="Start with the"
                ordinal="01"
                line2="teachers parents pick"
              />
            </div>

            {loading ? (
              <div className="mt-4 grid grid-cols-2 gap-4 px-[22px] sm:grid-cols-3 lg:grid-cols-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="aspect-[4/5] rounded-2xl bg-gradient-to-r from-muted via-background to-muted bg-[length:200%_100%] animate-shimmer" />
                ))}
              </div>
            ) : leadTeacher ? (
              /* A carousel at every width. D-005 called for a grid-cols-4 at
                 lg on the reasoning that a wide column should not hide cards
                 behind a drag gesture — but at 1900px that grid gave each card
                 a ~450px portrait, so the row read as a photo gallery and
                 pushed the rest of the page off the fold. Fixed-width cards
                 keep the photo small AND let the row show that more teachers
                 exist than fit, which is what a featured rail is for. */
              /* overflow-y-visible here was a no-op: per spec, once one axis
                 is non-visible (overflow-x-auto, needed for the horizontal
                 scroll), 'visible' on the other axis computes to 'auto'
                 instead — confirmed live via getComputedStyle. So the
                 hover-lift shadow (shadow-border-hover, -translate-y-0.5 on
                 TeacherCard) was getting clipped at the row's top/bottom
                 edge on hover. True vertical overflow can't coexist with
                 horizontal auto-scroll, so the real fix is padding room for
                 the shadow instead of an overflow value that was never
                 doing anything. */
              <div className="mt-4 overflow-x-auto overflow-y-hidden px-[22px] pb-3 pt-3 scrollbar-hide">
                <ul className="flex w-max snap-x snap-mandatory gap-3 stagger-children">
                  {featuredTeachers.map((t) => (
                    <li key={t.id} className="w-[168px] flex-none snap-start animate-card-blur-in lg:w-[196px]">
                      <TeacherCard
                        id={t.id}
                        name={t.name}
                        slug={t.slug}
                        subject={t.featuredSubjectLabel || t.subjects?.name || 'Tuition Teacher'}
                        subjectSlug={t.subjects?.slug}
                        imageUrl={t.image_url ?? undefined}
                        verified={t.is_verified ?? undefined}
                        variant="grid-compact"
                        sirMaam={t.sirMaam ?? null}
                        /* No fees on this rail. Owner call. It also only ever
                           rendered on the subset of teachers who have both
                           figures recorded, so the row showed a price under
                           some cards and nothing under others — the cards
                           without one read as free rather than as unrecorded.
                           Fees still show on Browse and the profile, where
                           they are a filter and a fact respectively.
                           formatFeeLabel() returns null for absent values, so
                           omitting the props is all this takes. */
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="px-[22px] pt-3">
                <EmptyResults
                  icon={<Users className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />}
                  heading={loadError ? 'We could not load teachers just now' : 'Refreshing our featured teachers'}
                  message={
                    loadError
                      ? 'Check your connection and try again. The full list is still there.'
                      : 'The full list of verified tutors is still searchable in the meantime.'
                  }
                  action={{ label: 'Browse all teachers', onClick: () => navigate('/all-tuition-teachers-in-kolkata') }}
                />
              </div>
            )}

            <Link
              to={teachersCta?.href ?? '/all-tuition-teachers-in-kolkata'}
              className="flex h-11 items-center gap-2 whitespace-nowrap px-[22px] pt-[18px] text-body-secondary font-medium text-brand-blue transition-colors duration-tap hover:text-brand-blue-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              {/* teachersCta drops the global stats.teachers count rather than
                  keep it beside a subject-specific label — "All 350 Maths
                  teachers" would put a real number next to a filtered
                  destination it does not describe, which is exactly the kind
                  of invented-looking claim the copy guardrails forbid. */}
              {teachersCta
                ? teachersCta.label
                : (stats.teachers ?? 0) > 0
                  ? `All ${stats.teachers} teachers`
                  : 'All teachers'}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </BentoPanel>

          {/* Subjects (6) / Board (7) / Class (9) back to three full-width
              panels stacked vertically. The one-row-at-lg version (weighted
              grid-cols, each section's internal grid squeezed to fit a
              third of the page) read as cramped columns rather than three
              real sections — reverted per owner review; each panel gets the
              full page width again and its own internal grid back at the
              wider count it had for that width. */}
          {/* --------------------------------------------------------- 6 · Subjects */}
          <BentoPanel fill="card" className="p-[22px]">
            <NumberedHeading
              size="compact"
              line1="Or go straight"
              ordinal="02"
              line2="to the subject"
              support="Every board, every class."
            />

            {loading && subjects.length === 0 ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="h-28 rounded-2xl bg-gradient-to-r from-muted via-background to-muted bg-[length:200%_100%] animate-shimmer" />
                ))}
              </div>
            ) : subjects.length > 0 ? (
              <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                {subjects.slice(0, 8).map((s) => (
                  <SubjectCard key={s.id} name={s.name} slug={s.slug} context="teachers" teacherCount={s.teacherCount} paperCount={s.paperCount} />
                ))}
              </div>
            ) : (
              <div className="mt-4">
                <EmptyResults
                  icon={<BookOpen className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />}
                  heading="Subjects are being updated"
                  message="Please check back shortly. You can still search for any subject directly."
                  action={{ label: 'Browse all teachers', onClick: () => navigate('/all-tuition-teachers-in-kolkata') }}
                />
              </div>
            )}
          </BentoPanel>

          {/* ---------------------------------------------------- 7 · Your board */}
          {Object.keys(boardCounts).length > 0 && (
            <BentoPanel fill="card" className="p-[22px]">
              <h2 className="font-display text-[21px] font-extrabold tracking-[-0.03em] text-foreground lg:text-[26px]">
                Your board
              </h2>
              {/* Back to a full page width, so a 5-across row at lg has real
                  room for "141 tutors" instead of truncating inside a
                  cramped third-of-the-page column. */}
              <div className="stagger-children mt-[14px] grid grid-cols-1 gap-2 lg:grid-cols-5">
                {BOARD_ORDER.filter((b) => boardCounts[b]).map((b, i) => (
                  <Link
                    key={b}
                    to={`/all-tuition-teachers-in-kolkata?filter_boards=${encodeURIComponent(b)}`}
                    className={`flex h-[52px] min-h-[44px] items-center justify-between gap-2 rounded-full px-[18px] transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 animate-card-reveal ${BOARD_FILLS[b] ?? 'bg-muted text-foreground'} ${BOARD_TILT_CLASSES[i % BOARD_TILT_CLASSES.length]}`}
                  >
                    <span className="font-display text-[17px] font-bold">{b}</span>
                    <span className="text-[14px] tabular-nums opacity-80">
                      {boardCounts[b]} {boardCounts[b] === 1 ? 'teacher' : 'teachers'}
                    </span>
                  </Link>
                ))}
              </div>
            </BentoPanel>
          )}

          {/* --------------------------------------------------------- 9 · By class */}
          <BentoPanel fill="card" className="p-[22px]">
            <NumberedHeading
              size="compact"
              line1="Or by the class"
              ordinal="03"
              line2="they are sitting"
              support="Classes 1 through 12."
            />

            {/* 02a §9: `grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-12`,
                which is exactly what runs from 360px up now that this panel
                has the full page width again. Below 360 the six columns work
                out to 39px each, under the C-013 44px floor — a width the
                handoff never draws, so the sub-360 sliver falls back to four
                columns of the same chip at the same gap. */}
            <ul className="mt-4 grid grid-cols-4 gap-2 min-[360px]:grid-cols-6 sm:grid-cols-8 lg:grid-cols-12">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <li key={n}>
                  <Link
                    to={`/all-tuition-teachers-in-kolkata?filter_classes=${n}`}
                    className="flex h-12 w-full items-center justify-center rounded-2xl bg-muted transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span className="font-display text-[16px] font-extrabold tabular-nums">{n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </BentoPanel>

          {/* ------------------------------------------------------- 10 · New papers */}
          <BentoPanel fill="papers" className="relative overflow-hidden px-[22px] pb-[26px] pt-[22px]">
            <span aria-hidden className="pointer-events-none absolute -left-10 top-0 h-[160px] w-[160px] rounded-full bg-white/[.06]" />
            <span aria-hidden className="pointer-events-none absolute -right-10 top-10 h-[190px] w-[190px] rounded-full bg-white/[.06]" />

            {/* Two columns from lg. As one centred stack the tray was capped
                at 420px, so on a 1900px screen this panel was mostly empty
                blue with a small huddle of covers in the middle. Copy and CTA
                on one side, the shelf on the other, and the shelf shows five
                covers instead of three because there is now room for them. */}
            <div className="relative lg:flex lg:items-center lg:gap-12">
              <div className="lg:flex-1">
                {/* Was /70 (3.47:1 on --brand-blue). An 11.5px eyebrow is small text. */}
                <p className="text-[12px] font-bold uppercase tracking-[.04em] text-white">04</p>
                <h2 className="font-display text-[23px] font-extrabold text-white lg:text-[30px]">the boards set</h2>
                {/* Was /80 (4.06:1). */}
                <p className="mt-3 max-w-prose text-[14px] leading-[1.5] text-white/90 lg:text-[15px]">
                  {/* Not "from Kolkata schools": the question bank added 193 ICSE
                      and CBSE papers from schools across India, and a handful of
                      the covers beside this line are from Mumbai and Bengaluru. */}
                  Free past papers: ICSE, CBSE and ISC, read as questions with
                  marks, chapters and figures.
                </p>
                <Link
                  to="/past-papers"
                  className="mt-4 inline-flex h-[46px] items-center gap-2 whitespace-nowrap rounded-full bg-warm-card px-6 text-[14px] font-extrabold text-brand-blue-deep transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-blue"
                >
                  Browse past papers
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>

              {recentPapers.length > 0 ? (
                <div className="mx-auto mt-6 w-full max-w-[420px] rounded-t-[24px] border-[1.5px] border-b-0 border-dashed border-white/45 px-4 pb-3 pt-4 lg:mx-0 lg:mt-0 lg:max-w-none lg:flex-[1.2]">
                  {/* justify-start, not center: a centred flex row whose content
                      overflows is clipped at BOTH ends, and the part past the
                      start edge cannot be scrolled back to. With ten covers in
                      here that would strand the first few. */}
                  <div className="scrollbar-hide flex items-end justify-start gap-3 overflow-x-auto overflow-y-visible">
                    {recentPapers.slice(0, 10).map((p) => (
                      <PaperCover
                        key={p.id}
                        paper={p}
                        meta={p.meta}
                        tintKey={p.tintKey}
                        comingSoon={p.comingSoon}
                        href={`/past-papers/${p.id}`}
                        size="mobile"
                        /* Three fit a phone; the rest are there to scroll to. */
                        className="flex-none"
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-5 lg:flex-1">
                  <EmptyResults
                    icon={<FileText className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />}
                    heading="Papers are being added"
                    message="Free ICSE, CBSE and ISC papers. Check back shortly."
                    action={{ label: 'Browse past papers', onClick: () => navigate('/past-papers') }}
                  />
                </div>
              )}
            </div>
          </BentoPanel>

          {/* "Then talk to them yourself" (how-it-works, moved here from
              between Board/Class above) paired in line with "Why guardians
              use Shikshaq" — both are "why trust this" content, and neither
              needed the full page width it was taking stacked alone. */}
          {/* items-stretch, not items-start: with unequal content, items-start
             let the shorter panel (guardian trust) stop where its content
             ended, leaving flat blank canvas below it while the taller panel
             kept going — a visible gap on the right. Stretched, both panels'
             own fill colour runs the full shared height instead.
             Equal grid-cols-2 still read unbalanced even stretched: at 708px
             each, "Talk to them" (3 icon-stacked steps + a closing line)
             filled ~94% of the shared height while "Why guardians" (3
             shorter inline rows) filled ~50%, measured live — same panel,
             same colour, visibly more empty fill. Narrowing guardians'
             column reflows its short row text onto more lines, closing
             most of that gap, same fix as the Subjects/Board/Class row
             above. */}
          <div className="lg:grid lg:grid-cols-[1.15fr_0.85fr] lg:items-stretch lg:gap-0">
          {/* --------------------------------------------------- 8 · How it works */}
          {/* No mt, no lg:gap. BentoStack already owns zero gap between every
              pair of panels; adding one here stacked on top of it and made
              this the only visible gap on the page — the "extra padding
              between the rounded sections" report. */}
          <BentoPanel fill="brand" className="relative overflow-visible px-[22px] pb-6 pt-[26px]">
            {/* brand-foreground, not white: white on #FF8000 measures
                2.52:1 and the /75 opacity variant 1.56:1 — the exact pair
                index.css:112-123 documents as failing AA. The token is
                near-black at 6.46:1. */}
            <p className="text-[12px] font-bold uppercase tracking-[.04em] text-brand-foreground/75">
              02 · Two minutes, start to finish
            </p>
            <h2 className="mt-2 font-display text-[28px] font-extrabold tracking-[-0.045em] text-brand-foreground">
              Then talk to them yourself
            </h2>

            {/* D-005 "Home how-it-works": 3 steps stacked below `lg`. Was 3
                columns from `lg` too, but this panel is now half the row's
                width there (paired with Guardian trust beside it), so 3
                columns squeezed each step's text under its own icon —
                kept a single column at every width instead. */}
            <ol className="mt-[22px] flex flex-col gap-[18px]">
              {[
                { icon: <Search />, title: 'Tell us the subject', body: 'Subject, class and your area. Three taps, no account needed.' },
                { icon: <Users />, title: 'Compare real profiles', body: 'Rates, boards, reviews and travel radius, all on one card.' },
                { icon: <MessageCircle />, title: 'Message on WhatsApp', body: 'Talk to the teacher directly. Shikshaq never sits in the middle.' },
              ].map((step) => (
                /* brand-foreground, not white. This panel is fill="brand", and
                   white on #FF8000 measures 2.52:1 (the /85 and /80 variants
                   below were worse still, at 2.19:1 and 2.09:1). The fix was
                   applied to this panel's eyebrow and h2 when it was first
                   raised; the three step cards inside the same panel were
                   missed, so the documented failure survived in the place with
                   the most words on it. */
                <li key={step.title} className="flex flex-col">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-foreground/15 text-brand-foreground [&_svg]:size-5">
                    {step.icon}
                  </span>
                  <h3 className="mt-[10px] font-display text-[17px] font-bold text-brand-foreground">{step.title}</h3>
                  <p className="mt-1 text-[14px] leading-[1.5] text-brand-foreground/80">{step.body}</p>
                </li>
              ))}
            </ol>

            <p className="mt-[22px] text-[14px] text-brand-foreground/80">
              No fees, no middleman, no commission.
            </p>
          </BentoPanel>

          {/* --------------------------------------------------- 11 · Guardian trust */}
          <BentoPanel fill="brandTint" className="p-[22px]">
            <div className="flex items-center gap-3">
              <IconDisc tone="brand" size={38} shape="square"><ShieldCheck className="h-[19px] w-[19px]" /></IconDisc>
              <h2 className="font-display text-[22px] font-extrabold tracking-[-0.04em] text-brand-deep lg:text-[28px]">Why guardians use Shikshaq</h2>
            </div>
            {/* mt-8/gap-7/size-44, up from mt-[18px]/gap-4/size-36: this list
               was the shorter of the paired columns even after the fr-weight
               above narrowed its column (its three lines were already short
               enough not to reflow at the narrower width) — more room per
               real row, not new copy, closes most of the remaining gap. */}
            <ul className="mt-8 flex flex-col gap-7">
              {[
                { icon: <ShieldCheck />, title: 'Verified, every one', body: 'ID and degree checked by a human before a profile goes live.' },
                { icon: <IndianRupee />, title: 'No commission, ever', body: 'Teachers keep every rupee of their fee. We never invoice anyone.' },
                { icon: <Users />, title: 'Reviews you can trust', body: 'Every review comes from a student who actually messaged the teacher.' },
              ].map((row) => (
                <li key={row.title} className="flex items-start gap-3.5">
                  <IconDisc tone="muted" size={44} className="text-brand-deep"><span className="[&_svg]:h-5 [&_svg]:w-5">{row.icon}</span></IconDisc>
                  <div>
                    <p className="text-[17px] font-semibold text-brand-deep">{row.title}</p>
                    <p className="mt-1 text-[15px] leading-[1.6] text-warm-prose">{row.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </BentoPanel>
          </div>

          {/* ------------------------------------------------------ 12 · From students */}
          {studentQuotes.length > 0 && (
            <BentoPanel fill="card" className="!px-0 !py-[22px] lg:!py-8">
              <div className="px-[22px]">
                <div className="flex items-center gap-3">
                  <IconDisc tone="muted" size={32} shape="square" className="!rounded-xl"><MessageCircle /></IconDisc>
                  <h2 className="font-display text-[22px] font-extrabold lg:text-[28px]">From students</h2>
                </div>
                {/* Without this line the rail is a wall of praise for people
                    the reader has never heard of — "Ashok sir explains
                    clearly" means nothing until you know Ashok sir is on this
                    site and one tap away. */}
                <p className="mt-1.5 text-[14px] leading-[1.5] text-warm-secondary">
                  Every one of them found their teacher here. Tap a name to see that teacher.
                </p>
              </div>

              {/* D-005 doesn't itemize this rail by name, but its own
                  "rails become grids, they do not become wider rails"
                  warning applies here exactly as it does to the featured
                  rail it does name — at 1280px this stayed a flex-nowrap
                  scroller (scrollWidth > clientWidth), hiding quotes past
                  the third behind an edge nobody drags. */}
              <div className="mt-4 overflow-x-auto overflow-y-visible px-[22px] scrollbar-hide lg:overflow-x-visible">
                <ul className="flex w-max gap-3 lg:grid lg:w-auto lg:grid-cols-3">
                  {studentQuotes.map((q) => (
                    <li
                      key={q.id}
                      className="relative flex w-[268px] flex-none flex-col rounded-[20px] bg-muted p-[18px] pt-[22px] lg:w-auto"
                    >
                      {/* A real quote mark, set large and low-contrast behind
                          the opening line. The card was three stacked blocks of
                          near-identical grey; this gives it a top and tells you
                          at a glance that the thing you are reading is somebody
                          speaking. aria-hidden because the quotation is already
                          punctuated in the text. */}
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute right-4 top-1 select-none font-display text-[54px] leading-none text-foreground/[0.07]"
                      >
                        &rdquo;
                      </span>

                      <p className="relative line-clamp-5 text-[15px] leading-[1.55] text-warm-prose">
                        {q.comment}
                      </p>

                      <div className="mt-auto pt-4">
                        {/* Owner call: the card's headline identity — photo
                           AND name — is the TEACHER being quoted about, not
                           the student/parent who wrote it. Was photo=
                           teacher, name=reviewer, which paired a
                           recognisable face with a name it didn't belong
                           to. Falls back to the same initials stripe, keyed
                           off the teacher's name, never the reviewer's.

                           Wrapped in the same profile link the "View X's
                           profile" row below points to when there's a
                           teacherSlug to send it to: a recognisable face
                           sitting right next to that teacher's own name
                           read as a card about them, so it should behave
                           like one and go straight to their profile,
                           instead of the tiny text row underneath being the
                           only thing on the whole card that actually is. */}
                        {q.teacherName && q.teacherSlug ? (
                          <Link
                            to={`/tuition-teachers/${q.teacherSlug}`}
                            className="flex min-h-[44px] items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            {q.teacherImageUrl ? (
                              <img
                                src={validateImageSrc(q.teacherImageUrl)}
                                alt=""
                                aria-hidden
                                loading="lazy"
                                decoding="async"
                                className="h-[30px] w-[30px] flex-none rounded-full object-cover"
                              />
                            ) : (
                              <StripePlaceholder
                                name={q.teacherName}
                                initialSize={14}
                                className="h-[30px] w-[30px] flex-none rounded-full"
                              />
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-bold text-foreground">{q.teacherName}</p>
                              <p className="truncate text-[12px] text-warm-meta">
                                {q.authorName}{q.authorMeta ? `, ${q.authorMeta}` : ''}
                              </p>
                            </div>
                          </Link>
                        ) : (
                          <div className="flex items-center gap-2.5">
                            <StripePlaceholder
                              name={q.authorName}
                              initialSize={14}
                              className="h-[30px] w-[30px] flex-none rounded-full"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-bold text-foreground">{q.authorName}</p>
                              {q.authorMeta && <p className="truncate text-[12px] text-warm-meta">{q.authorMeta}</p>}
                            </div>
                          </div>
                        )}

                        {q.teacherName && q.teacherSlug && (
                          <Link
                            to={`/tuition-teachers/${q.teacherSlug}`}
                            className="mt-2.5 flex min-h-11 items-center gap-1.5 text-[13px] text-warm-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-brand" />
                            <span className="min-w-0 truncate">View {q.teacherName}&rsquo;s profile</span>
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </BentoPanel>
          )}

          {/* ------------------------------------------------------- 13 · Recommend */}
          <BentoPanel fill="card" className="!px-[22px] !py-[18px] lg:!px-8 lg:!py-8">
            <Link
              to="/recommend-teacher"
              className="flex items-center gap-[14px] transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <IconDisc tone="muted" size={44}>
                <GraduationCap />
              </IconDisc>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold text-foreground">Know a good teacher?</p>
                <p className="mt-0.5 text-[14px] leading-[1.45] text-warm-secondary">Recommend them and we'll reach out and get them listed, free.</p>
              </div>
              <ArrowRight className="h-5 w-5 flex-none text-warm-label" aria-hidden="true" />
            </Link>
          </BentoPanel>

          {/* HomeActivitySection (Favourites, Recently visited) is a real,
              localStorage/likes-backed feature with no home in the mockup's own
              section order. Kept, below the mockup's sections, above the eyes
              panel. p-[22px] like every other card panel on this page.

              HomeGreeting was removed (owner call). It was a saturated orange
              "Hello, {firstName} 👋 / Here is where you left off" slab shown
              only to signed-in readers, restating counts that the Favourites
              and Recently-visited lists directly below it already show. */}
          <BentoPanel fill="card" className="p-[22px]">
            {/* fallback={null}: this section is below the fold and additive
                (Favourites/Recently visited) -- an empty panel for one extra
                tick reads as nothing rather than as a layout jump, and the
                panel around it already reserves the padding. */}
            <Suspense fallback={null}>
              <HomeActivitySection />
            </Suspense>
          </BentoPanel>

          {/* ---------------------------------------- 14 · Eyes + sentence builder */}
          {/* Same reasoning as above: last section on the page, chunk-split
              so its ~480 lines don't ride in every route's shared entry. */}
          <Suspense fallback={null}>
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
              count={builderMode === 'teachers' ? (stats.teachers || undefined) : (stats.papers || undefined)}
            />
          </Suspense>
        </BentoStack>
      </main>

      {/* The tour is mounted once in App.tsx (ProductTourHost), not here: it
          now opens on a first visit from any route, and two mounts would both
          answer the logo-tap event and stack two dialogs. */}
    </div>
  );
}
