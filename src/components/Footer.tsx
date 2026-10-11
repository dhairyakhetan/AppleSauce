import { useState, useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Mail, ChevronDown, ChevronUp, FileText, GraduationCap } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { getWhatsAppLink } from '@/utils/whatsapp';
import { Button } from '@/components/ui/button';
import { chipVariants } from '@/components/ui/chip';
import { iconDiscVariants } from '@/components/ui/icon-disc';
import { PageContainer } from '@/components/layout/PageContainer';
import { WordmarkBleed } from '@/components/layout/WordmarkBleed';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useIsAdminBadge } from '@/hooks/useIsAdminBadge';
import { useSiteCounts } from '@/hooks/useSiteCounts';
import { WhatsAppIcon, InstagramIcon } from '@/components/BrandIcons';
import DOMPurify from 'dompurify';
import aquaterraLogo from '@/assets/Frame 48095868.png';
import { cn } from '@/lib/utils';

/* Redesign S6 (components.md §3, design.md §1).

   Inset rounded near-black slab: sentence builder (C8) -> pill-labelled link
   columns -> contact lines -> social discs -> footnote -> C12 WordmarkBleed.
   Renders on every route, so every link and data path this component fetches
   is real functionality carried over from the pre-redesign Footer — see the
   inventory in the handoff report, not repeated here as comments. */

import { BLOG_FOOTER_LINKS, BLOG_PATH } from '@/content/blog-nav';

import { FREE_PREVIEW_WORD } from '@/lib/free-preview';
import { reportLoadError } from '@/lib/load-error';
type FooterLink = { to: string; label: string };

const BOARD_FOOTER_LINKS: FooterLink[] = [
  { to: '/all-tuition-teachers-in-kolkata', label: 'All boards' },
  { to: '/cbse-ncert-tuition-teachers-in-kolkata', label: 'CBSE / NCERT' },
  { to: '/icse-tuition-teachers-in-kolkata', label: 'ICSE' },
  { to: '/igcse-tuition-teachers-in-kolkata', label: 'IGCSE' },
  { to: '/international-board-tuition-teachers-in-kolkata', label: 'International Board' },
  { to: '/state-board-tuition-teachers-in-kolkata', label: 'WB State Board' },
];

const footerContentCache = new Map<string, PageContent>();

const SUBJECT_SEO_LINKS: FooterLink[] = [
  { to: '/accounts-tuition-teachers-in-kolkata', label: 'Accounts' },
  { to: '/act-tuition-teachers-in-kolkata', label: 'ACT' },
  { to: '/bengali-tuition-teachers-in-kolkata', label: 'Bengali' },
  { to: '/biology-tuition-teachers-in-kolkata', label: 'Biology' },
  { to: '/business-studies-tuition-teachers-in-kolkata', label: 'Business Studies' },
  { to: '/ca-tuition-teachers-in-kolkata', label: 'CA' },
  { to: '/cat-tuition-teachers-in-kolkata', label: 'CAT' },
  { to: '/cfa-tuition-teachers-in-kolkata', label: 'CFA' },
  { to: '/chemistry-tuition-teachers-in-kolkata', label: 'Chemistry' },
  { to: '/clat-tuition-teachers-in-kolkata', label: 'CLAT' },
  { to: '/commerce-tuition-teachers-in-kolkata', label: 'Commerce' },
  { to: '/commercial-studies-tuition-teachers-in-kolkata', label: 'Commercial Studies' },
  { to: '/computer-tuition-teachers-in-kolkata', label: 'Computer' },
  { to: '/drawing-tuition-teachers-in-kolkata', label: 'Drawing' },
  { to: '/economics-tuition-teachers-in-kolkata', label: 'Economics' },
  { to: '/english-tuition-teachers-in-kolkata', label: 'English' },
  { to: '/environmental-science-tuition-teachers-in-kolkata', label: 'Environmental Science' },
  { to: '/geography-tuition-teachers-in-kolkata', label: 'Geography' },
  { to: '/gmat-tuition-teachers-in-kolkata', label: 'GMAT' },
  { to: '/hindi-tuition-teachers-in-kolkata', label: 'Hindi' },
  { to: '/history-tuition-teachers-in-kolkata', label: 'History' },
  { to: '/maths-tuition-teachers-in-kolkata', label: 'Maths' },
  { to: '/nmat-tuition-teachers-in-kolkata', label: 'NMAT' },
  { to: '/physics-tuition-teachers-in-kolkata', label: 'Physics' },
  { to: '/political-science-tuition-teachers-in-kolkata', label: 'Political Science' },
  { to: '/psychology-tuition-teachers-in-kolkata', label: 'Psychology' },
  { to: '/sat-tuition-teachers-in-kolkata', label: 'SAT' },
  { to: '/science-tuition-teachers-in-kolkata', label: 'Science' },
  { to: '/social-studies-tuition-teachers-in-kolkata', label: 'Social Studies' },
  { to: '/sociology-tuition-teachers-in-kolkata', label: 'Sociology' },
];

interface PageContent {
  id: string;
  page_type: 'general' | 'subject' | 'board' | 'subject_board';
  subject_slug: string | null;
  board_slug: string | null;
  heading: string;
  short_content: string | null;
  full_content: string;
}

interface FooterProps {
  expandedContent?: string | null; // EXPANDED content from Shikshaqmine for teacher profiles
  /** The outer <footer>'s own background — bg-background by default, which
      is invisible seam-blending on every normal (light-ground) page. The
      two paper readers use a near-black ground all the way down instead, so
      that same cream strip showed up as a stray line right before the
      footer's own dark slab (reported as a "separator glitch" — confirmed
      live: bg-background sitting directly above bg-panel content with
      nothing to blend it). Pass 'panel' from a dark-ground page only. */
  seamFill?: 'background' | 'panel';
}

const COL_LABEL = 'text-xs font-medium uppercase tracking-[0.04em] text-white/70';
// Safari still paints a disclosure triangle even with `list-none`.
const SUMMARY_RESET = '[&::-webkit-details-marker]:hidden';
/* tap-44 rather than min-h-[44px]: the hit area stays 44px via the ::before
   overlay, but the painted row is only as tall as the text. At a full 44px
   each, the thirty subject links alone ran to more than 1300px of footer. */
const FOOTER_LINK = 'tap-44 flex items-center py-[5px] text-sm text-white/85 transition-colors duration-150 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 rounded-lg';

function sanitize(content: string) {
  if (/<[a-z][\s\S]*>/i.test(content)) {
    return DOMPurify.sanitize(content, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      ALLOWED_ATTR: ['href', 'target', 'rel'],
    });
  }
  return DOMPurify.sanitize(content.replace(/\n/g, '<br />'), { ALLOWED_TAGS: ['br'] });
}

function LinkList({ links }: { links: FooterLink[] }) {
  /* Long lists go two-up. A single column of thirty subjects is a scroll, not
     a directory; two columns halves it without shrinking anything. */
  const dense = links.length > 10;
  return (
    <div className={`grid gap-x-4 ${dense ? 'grid-cols-2' : ''}`}>
      {links.map(({ to, label }) => (
        <Link key={to + label} to={to} className={FOOTER_LINK}>{label}</Link>
      ))}
    </div>
  );
}

/** Collapsible group — the mobile-compact form of a footer column. */
/* ---------------------------------------------------------------------------
   What Shikshaq is, said once, in the footer.

   The old identity block was a logo over one grey sentence, which is the
   least-read shape a description can take: it looks like boilerplate, so it
   reads as boilerplate. This says the same thing as a single running sentence
   at display size, with the site's real figures set INSIDE the prose as
   objects rather than listed underneath it as a stat row.

   Reference: Adam Katz's portfolio, where inline images sit mid-sentence and
   carry the meaning the words are only introducing. The register is
   deliberately QUIET (this sits under every page and must not shout); the
   loud half of the same idea belongs on /about.

   Every figure is fetched. A count that has not arrived renders as a plain
   word, not a skeleton and not a zero, so the sentence is grammatical and
   true at every stage of loading. That is why each Fig() call has a fallback
   noun rather than a placeholder.
--------------------------------------------------------------------------- */

/** A live figure set into the sentence, as a link to the thing it counts. */
function Fig({ to, value, children }: { to: string; value: number | null; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        'tap-44 inline whitespace-nowrap rounded-full px-2 py-0.5',
        'bg-white/10 text-white transition-colors duration-hover hover:bg-white/20',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-panel',
      )}
    >
      {value !== null && (
        <>
          <span className="font-display font-black tabular-nums">{value.toLocaleString('en-IN')}</span>{' '}
        </>
      )}
      {children}
    </Link>
  );
}

/** A verb in the second sentence: an action you can take, linked to where you
 *  take it. Tinted rather than white so the two sentences read as different
 *  registers, one describing and one offering. */
function Act({ to, children, tone = 'brand' }: { to: string; children: React.ReactNode; tone?: 'brand' | 'papers' }) {
  return (
    <Link
      to={to}
      className={cn(
        'tap-44 inline whitespace-nowrap rounded-full px-1.5 py-0.5 font-semibold',
        'transition-colors duration-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-panel',
        tone === 'brand'
          ? 'bg-brand text-brand-foreground hover:bg-brand/85'
          : 'bg-brand-blue text-white hover:bg-brand-blue/85',
      )}
    >
      {children}
    </Link>
  );
}

function FooterExplainer() {
  const { data } = useSiteCounts();
  const teachers = data?.teachers ?? null;
  const papers = data?.papers ?? null;

  return (
    <div className="space-y-4">
      <Logo size="nav" onDark className="tap-44 [&_img]:h-[26px]" />

      {/* Sentence one: what this is. Display size, because it is the footer's
          statement rather than its small print. Punctuation sits on the same
          line as the object it follows, or JSX's own newline becomes a space
          and the full stop drifts away from the word.
          2026-09-26: dropped the "across N Kolkata schools" clause -- the
          distinct-school count is not defensible as genuinely Kolkata (see
          the coordinator's audit: only ~38 of 190 raw values are recognisably
          Kolkata schools once board-paper rows, out-of-city schools and junk
          strings are excluded). /schools is still reachable from the Footer's
          own link list and the Navbar sheet menu. */}
      <p className="max-w-[26ch] font-display text-[clamp(21px,3.2vw,32px)] font-black leading-[1.6] tracking-[-0.03em] text-white sm:max-w-[36ch]">
        Shikshaq is{' '}
        <Fig to="/all-tuition-teachers-in-kolkata" value={teachers}>verified teachers</Fig>{' '}
        in Kolkata, and{' '}
        <Fig to="/past-papers" value={papers}>past papers</Fig>.
      </p>

      {/* Sentence two: what you can do here. The reference's whole trick is
          that the inline objects carry the meaning the prose only introduces,
          so every verb below is the real destination for that verb, not a
          decorated noun. */}
      <p className="max-w-[62ch] text-[15px] leading-[2] text-white/85">
        You can{' '}
        <Act to="/all-tuition-teachers-in-kolkata">filter by subject or board</Act>{' '}
        or <Act to="/all-tuition-teachers-in-kolkata">search your own area</Act>{' '}
        of the city. You can{' '}
        <Act to="/past-papers" tone="papers">read the papers free</Act>{' '}
        with the first {FREE_PREVIEW_WORD} questions and no account, or{' '}
        <Act to="/blog" tone="papers">see what gets asked most</Act>{' '}
        before you start. Then you message the teacher yourself on WhatsApp
        <WhatsAppIcon
          aria-hidden
          className="ml-1.5 inline-block h-4 w-4 align-[-2px] text-whatsapp"
        />. No agent
        stands in between, they keep every rupee of their fee, and we take nothing.
      </p>

      <p className="max-w-prose text-[14px] leading-[1.55] text-white/60">
        Free to search, free to contact. We never sell your number.
      </p>
    </div>
  );
}

function FooterAccordion({ label, links }: { label: string; links: FooterLink[] }) {
  /* 02a puts the hairline on the SUMMARY as `inset 0 -1px 0
     rgba(255,255,255,.10)`, not on the <details> as a border-b. The difference
     shows when a group is open: the spec's line stays under the header,
     separating it from its own links, while a border on the details drops to
     the bottom of the expanded list and the header runs into its content. */
  return (
    <details className="disclosure">
      <summary className={`flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 shadow-[inset_0_-1px_0_rgba(255,255,255,.10)] ${COL_LABEL} ${SUMMARY_RESET}`}>
        {label}
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
      </summary>
      {/* pt-1 is the focus ring's clearance, not decoration: the animated
          ::details-content clips to its own box, and the first link sat flush
          against the top edge, so its ring-offset-2 ring lost its top 4px. */}
      <div className="pb-2 pt-1">
        <LinkList links={links} />
      </div>
    </details>
  );
}

export function Footer({ expandedContent, seamFill = 'background' }: FooterProps = {}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isExpandedContentExpanded, setIsExpandedContentExpanded] = useState(false);
  const [pageContent, setPageContent] = useState<PageContent | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, profile } = useAuth();
  const userRole = (profile?.role as 'student' | 'guardian' | 'teacher') || null;
  /* Shared with Navbar's identical check — this pair used to fire nine
     copies of the same `admins` select per page load between them. See
     useIsAdminBadge for the measurement and why the /admin/* route guard
     deliberately does NOT share this cache. */
  const isAdmin = useIsAdminBadge();
  const dashboardPath = userRole === 'student' ? '/dashboard/student' : userRole === 'guardian' ? '/dashboard/guardian' : userRole === 'teacher' ? '/dashboard/teacher' : null;

  useEffect(() => {
    async function fetchPageContent() {
      try {
        setLoading(true);

        const pathname = location.pathname;

        if (pathname.startsWith('/tuition-teachers/')) {
          setLoading(false);
          return;
        }

        // Check in-memory cache by route key to avoid re-fetching on back navigation
        const routeKey = pathname + '|' + (searchParams.get('filter_boards') || '');
        const cachedContent = footerContentCache.get(routeKey);
        if (cachedContent) {
          setPageContent(cachedContent);
          setLoading(false);
          return;
        }

        let subjectSlug: string | null = null;
        let boardSlug: string | null = null;

        // Known board slugs from boardMapping
        const boardPathSlugs: Record<string, string> = {
          '/cbse-ncert-tuition-teachers-in-kolkata': 'cbse',
          '/icse-tuition-teachers-in-kolkata': 'icse',
          '/igcse-tuition-teachers-in-kolkata': 'igcse',
          '/international-board-tuition-teachers-in-kolkata': 'ib',
          '/state-board-tuition-teachers-in-kolkata': 'state',
        };

        // Check if it's a board page first
        if (boardPathSlugs[pathname]) {
          boardSlug = boardPathSlugs[pathname];
        }
        // Check if it's a subject page (pattern: /{subject}-tuition-teachers-in-kolkata)
        // But exclude /all-tuition-teachers-in-kolkata
        else if (pathname !== '/all-tuition-teachers-in-kolkata') {
          const subjectMatch = pathname.match(/^\/([^-]+)-tuition-teachers-in-kolkata/);
          if (subjectMatch) {
            subjectSlug = subjectMatch[1].toLowerCase();
          }
        }

        // Extract board from URL params (e.g., filter_boards=ICSE -> icse)
        // This takes precedence if both pathname and params have board info
        const boardFromUrl = searchParams.get('filter_boards')?.split(',')[0]?.trim();
        if (boardFromUrl) {
          boardSlug = boardFromUrl.toLowerCase();
        }

        // Determine page type and build query
        let query = supabase
          .from('page_content')
          .select('*')
          .eq('is_active', true)
          .order('display_order', { ascending: true })
          .limit(1);

        if (subjectSlug && boardSlug) {
          // Both subject and board - try subject_board first
          query = query
            .eq('page_type', 'subject_board')
            .eq('subject_slug', subjectSlug)
            .eq('board_slug', boardSlug);
        } else if (boardSlug) {
          // Only board
          query = query
            .eq('page_type', 'board')
            .eq('board_slug', boardSlug);
        } else if (subjectSlug) {
          // Only subject
          query = query
            .eq('page_type', 'subject')
            .eq('subject_slug', subjectSlug);
        } else {
          // General page (no filters)
          query = query
            .eq('page_type', 'general')
            .is('subject_slug', null)
            .is('board_slug', null);
        }

        const { data, error } = await query;

        if (error) {
          if (import.meta.env.DEV) {
            console.error('Error fetching page content:', error);
          }
          // Fallback to default content
          setPageContent({
            id: 'default',
            page_type: 'general',
            subject_slug: null,
            board_slug: null,
            heading: 'Find the best teachers for you',
            short_content: null,
            full_content: 'Whether you need help with Mathematics, Science, English, Commerce, or any other subject, our verified teachers are here to help you succeed. All teachers on our platform have been verified and come with student reviews to help you make an informed decision.'
          });
          return;
        }

        // If no exact match found, try fallback
        if (!data || data.length === 0) {
          if (subjectSlug && boardSlug) {
            // Try subject-only fallback
            const { data: subjectData, error: subjectError } = await supabase
              .from('page_content')
              .select('*')
              .eq('is_active', true)
              .eq('page_type', 'subject')
              .eq('subject_slug', subjectSlug)
              .order('display_order', { ascending: true })
              .limit(1);

            if (subjectError) reportLoadError('footer.subject', subjectError, { what: 'the page text' });
            if (subjectData && subjectData.length > 0) {
              const content = subjectData[0] as PageContent;
              setPageContent(content);
              footerContentCache.set(routeKey, content);
              return;
            }
          }

          // Fallback to general content
          const { data: generalData, error: generalError } = await supabase
            .from('page_content')
            .select('*')
            .eq('is_active', true)
            .eq('page_type', 'general')
            .is('subject_slug', null)
            .is('board_slug', null)
            .order('display_order', { ascending: true })
            .limit(1);

          if (generalError) reportLoadError('footer.general', generalError, { what: 'the page text' });
          if (generalData && generalData.length > 0) {
            const content = generalData[0] as PageContent;
            setPageContent(content);
            footerContentCache.set(routeKey, content);
            return;
          }

          // Ultimate fallback
          setPageContent({
            id: 'default',
            page_type: 'general',
            subject_slug: null,
            board_slug: null,
            heading: 'Find the best teachers for you',
            short_content: null,
            full_content: 'Whether you need help with Mathematics, Science, English, Commerce, or any other subject, our verified teachers are here to help you succeed. All teachers on our platform have been verified and come with student reviews to help you make an informed decision.'
          });
        } else {
          const content = data[0] as PageContent;
          setPageContent(content);
          footerContentCache.set(routeKey, content);
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('Error fetching page content:', error);
        }
        // Fallback to default content
        setPageContent({
          id: 'default',
          page_type: 'general',
          subject_slug: null,
          board_slug: null,
          heading: 'Find the best teachers for you',
          short_content: null,
          full_content: 'Whether you need help with Mathematics, Science, English, Commerce, or any other subject, our verified teachers are here to help you succeed. All teachers on our platform have been verified and come with student reviews to help you make an informed decision.'
        });
      } finally {
        setLoading(false);
      }
    }

    fetchPageContent();
    // Reset expanded state when content changes
    setIsExpanded(false);
  }, [location.pathname, searchParams]);

  const shikshaqLinks: FooterLink[] = [
    { to: '/', label: 'Home' },
    { to: '/all-tuition-teachers-in-kolkata', label: 'Browse teachers' },
    { to: '/past-papers', label: 'Past papers' },
    /* Next to the papers, because that is what it is about: the reading pages
       are counted out of the same bank and are useless without it. */
    { to: '/blog', label: 'What the papers show' },
    { to: '/subjects', label: 'Subjects' },
    { to: '/schools', label: 'Schools' },
    ...(dashboardPath ? [{ to: dashboardPath, label: 'Your dashboard' }] : []),
    { to: '/liked-teachers', label: 'Favourite teachers' },
    { to: '/about', label: 'About us' },
    { to: '/recommend-teacher', label: 'Recommend a teacher' },
  ];

  /* Curated, not the full generated article set. That used to be every
     article (fine at 18, one subject) -- with four subjects now generating
     ~113 pages, listing all of them here put 231 links in this block alone
     (mobile accordion + desktop disclosure both render at once) and ~345 in
     the footer overall, confirmed live. A footer is navigation, not a
     sitemap, and a link block that size on every single page is exactly the
     kind of pattern that reads as thin/spammy to search engines rather than
     genuine site structure. Each subject gets its own overview links here;
     the full per-topic list stays one click away on /blog itself. */
  /* From the generated blog-nav, not from @/content/blog. Identical output --
     the generator computes exactly this list -- but importing blog.ts here
     dragged its BLOG_SUBJECTS dependency (a ~116KB generated stats blob) into
     the eager bundle, because the Footer renders on every page. A visitor who
     never opened /blog still downloaded and parsed every chapter statistic for
     every subject. See scripts/generate-blog-nav.ts. */
  const blogLinks: FooterLink[] = [
    { to: BLOG_PATH, label: 'All reading' },
    ...BLOG_FOOTER_LINKS,
  ];

  const supportLinks: FooterLink[] = [
    { to: '/more', label: 'Help' },
    { to: '/faq', label: 'FAQ' },
    { to: '/terms-of-service', label: 'Terms of Service' },
    { to: '/privacy-policy', label: 'Privacy Policy' },
    ...(isAdmin ? [
      { to: '/admin/recommendations', label: 'Admin console' },
      { to: '/admin/papers', label: 'Admin · upload papers' },
    ] : []),
  ];

  const subjectLinks: FooterLink[] = SUBJECT_SEO_LINKS.map(({ to, label }) => ({
    to,
    label: `${label} tuition teachers in Kolkata`,
  }));

  /* pt-seam: H-021's accept line is "6px of #F9F5F1 shows above" the footer's
     top corners. That gap used to come from BottomNavSpacer sitting above the
     footer at 84px; with the reserve moved below where it belongs, the seam is
     stated here. */
  return (
    <footer className={`${seamFill === 'panel' ? 'bg-panel' : 'bg-background'} pt-seam`}>
      {/* Handoff H-021: the footer is the stack's final panel, not an inset
          slab floating on page ground — no mx-3 inset, radius is top-only
          (it butts the bottom-nav reserve). */}
      <div className="overflow-hidden rounded-t-bento bg-panel text-white">
        {/* pb-[34px], not py-8. H-021 writes this container as `py-8`, but
            S-016 gives `px-5 pt-8 pb-[34px]` and the rendered mockup measures
            32px top / 34px bottom — two sources against one, so the bottom
            step wins. The sm:/lg: rows still override both. */}
        <PageContainer className="px-5 pt-8 pb-[34px] sm:px-6 sm:py-14 lg:px-8 lg:py-16">
          <div className="space-y-8">
            {/* Identity, and what this site actually is. */}
            <FooterExplainer />

            {/* 2. Pill-labelled link columns — copy.md §2: find a teacher · past
                papers · contact, as quick-access pills above the full column
                groups, which stay intact for internal-linking / SEO. */}
            <div className="flex flex-wrap gap-2">
              {/* These three carry the chip's classes directly instead of
                  nesting inside `<Chip asChild>`. Chip's `asChild` is not a
                  Radix Slot — it renders a static <span> wrapper and drops the
                  child into its inner `<span class="truncate">`, so the link
                  was never the chip: it measured 87×20 inside a 38px pill, and
                  `truncate`'s `overflow:hidden` clipped the `tap-44` overlay
                  dead (verified with elementFromPoint, not by reading the
                  computed size — a clipped overlay still computes 44px).

                  Size is 44, not 38. The geometry appendix draws these at h40,
                  and S-005 removed 40 with the rule "every former 40px
                  interactive chip is now 44" — these are real links, so 44 is
                  the sanctioned size and it clears C-013 natively, with no
                  overlay to clip.

                  Handoff C-014: the ring tokens are spelled out here because
                  the dark panel needs ring-background/ring-offset-panel, the
                  same pair TopBar's on-panel links use. */}
              {[
                { to: '/all-tuition-teachers-in-kolkata', label: 'find a teacher' },
                { to: '/past-papers', label: 'past papers' },
              ].map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    chipVariants({ tone: 'on-dark', size: 44 }),
                    /* 02a's own numbers for this row: 13.5px/600 and an inset
                       hairline at rgba(255,255,255,.16). Size 44 otherwise
                       brings text-body-secondary (15px), which the appendix
                       does not draw. */
                    /* shadow-inset, not ring-inset: the chip's focus ring is
                       `ring-2`, and a base `ring-inset` would turn that focus
                       ring inward where it reads as a tint, not a focus state
                       (C-014). Same technique HelpFaqStack uses. */
                    'text-[14px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.16)]',
                    'focus-visible:ring-background focus-visible:ring-offset-panel',
                  )}
                >
                  {label}
                </Link>
              ))}
              <a
                href={getWhatsAppLink('8240980312')}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                    chipVariants({ tone: 'on-dark', size: 44 }),
                    /* 02a's own numbers for this row: 13.5px/600 and an inset
                       hairline at rgba(255,255,255,.16). Size 44 otherwise
                       brings text-body-secondary (15px), which the appendix
                       does not draw. */
                    /* shadow-inset, not ring-inset: the chip's focus ring is
                       `ring-2`, and a base `ring-inset` would turn that focus
                       ring inward where it reads as a tint, not a focus state
                       (C-014). Same technique HelpFaqStack uses. */
                    'text-[14px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.16)]',
                    'focus-visible:ring-background focus-visible:ring-offset-panel',
                  )}
              >
                contact
              </a>
            </div>

            {/* Mobile: collapsible groups, so the footer never becomes a wall of
                links stacked above the bottom tab bar. Desktop: open columns. */}
            <div className="lg:hidden">
              <FooterAccordion label="Shikshaq" links={shikshaqLinks} />
              <FooterAccordion label="Support & legal" links={supportLinks} />
              <FooterAccordion label="What the papers show" links={blogLinks} />
              <FooterAccordion label="Teachers by board · Kolkata" links={BOARD_FOOTER_LINKS} />
              <FooterAccordion label="Tuition teachers by subject in Kolkata" links={subjectLinks} />
            </div>

            <div className="hidden lg:flex lg:flex-wrap lg:justify-between lg:gap-x-16 lg:gap-y-6">
              <div className="space-y-2">
                <h2 className={COL_LABEL}>Shikshaq</h2>
                <LinkList links={shikshaqLinks} />
              </div>
              <div className="space-y-2">
                <h2 className={COL_LABEL}>Support &amp; legal</h2>
                <LinkList links={supportLinks} />
              </div>
              <div className="space-y-2">
                <h2 className={COL_LABEL}>Teachers by board · Kolkata</h2>
                <LinkList links={BOARD_FOOTER_LINKS} />
              </div>
            </div>

            <details className="disclosure hidden border-t border-white/10 lg:block">
              <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 ${COL_LABEL} ${SUMMARY_RESET}`}>
                What the papers show
                <ChevronDown className="h-4 w-4" aria-hidden />
              </summary>
              <div className="flex flex-wrap gap-x-6 pt-1">
                {blogLinks.map(({ to, label }) => (
                  <Link key={to} to={to} className={`${FOOTER_LINK} whitespace-nowrap text-xs text-white/70`}>
                    {label}
                  </Link>
                ))}
              </div>
            </details>

            <details className="disclosure hidden border-t border-white/10 lg:block">
              <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 ${COL_LABEL} ${SUMMARY_RESET}`}>
                Tuition teachers by subject in Kolkata
                <ChevronDown className="h-4 w-4" aria-hidden />
              </summary>
              {/* pt-1 for the same reason as the mobile accordion: the clipped
                  ::details-content box would otherwise eat the first link's
                  focus ring. */}
              <div className="flex flex-wrap gap-x-6 pt-1">
                {subjectLinks.map(({ to, label }) => (
                  <Link key={to} to={to} className={`${FOOTER_LINK} whitespace-nowrap text-xs text-white/70`}>
                    {label}
                  </Link>
                ))}
              </div>
            </details>

            {/* 3. Contact lines */}
            <div className="space-y-1 border-t border-white/10 pt-3 text-sm text-white/85">
              <a href="mailto:ngo.aquaterra@gmail.com" className={FOOTER_LINK}>ngo.aquaterra@gmail.com</a>
              <a href={getWhatsAppLink('8240980312')} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK}>
                WhatsApp · +91 82409 80312
              </a>
            </div>

            {/* 4. Social discs */}
            <div className="flex gap-2">
              <a
                href="mailto:ngo.aquaterra@gmail.com"
                aria-label="Email Shikshaq"
                className={cn(iconDiscVariants({ tone: 'on-dark', size: 44 }), 'active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2')}
              >
                <Mail strokeWidth={1.8} aria-hidden />
              </a>
              <a
                href="https://instagram.com/shikshaq.in"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Shikshaq on Instagram"
                className={cn(iconDiscVariants({ tone: 'on-dark', size: 44 }), 'active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2')}
              >
                <InstagramIcon />
              </a>
              <a
                href={getWhatsAppLink('8240980312')}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Shikshaq on WhatsApp"
                className={cn(iconDiscVariants({ tone: 'whatsapp', size: 44 }), 'active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2')}
              >
                <WhatsAppIcon />
              </a>
            </div>

            {/* max-w-prose: without it this ran ~133 characters per line at
                1440 (measured), roughly double the 60-75 cap DESIGN_SYSTEM.md
                §3 sets for body copy. The paragraph further up this same
                footer already carries it. */}
            <p className="max-w-prose text-sm text-white/70">
              Past papers are the property of the schools that set them. Shikshaq claims no ownership and hosts them as a free community resource.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-white/60">
              <a
                href="https://ngoaquaterra.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[44px] items-center gap-2 rounded-md transition-opacity duration-150 hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span>© {new Date().getFullYear()} Shikshaq. An AquaTerra Start-up.</span>
                <img
                  src={aquaterraLogo}
                  alt="AquaTerra"
                  width={64}
                  height={17}
                  loading="lazy"
                  decoding="async"
                  className="h-4 w-auto object-contain opacity-70"
                />
              </a>
              <span>Kolkata, West Bengal, India</span>
            </div>
          </div>
        </PageContainer>

        {/* Find the best teachers section - EXPANDED content from teacher profiles */}
        {expandedContent && (
          <PageContainer className="px-4 pb-10 sm:px-6 lg:px-8">
            <div className="max-w-prose">
              <h2 className="text-lg font-semibold">Find the best teachers for you</h2>
              {isExpandedContentExpanded && (
                <div
                  className="prose prose-sm mt-2 max-w-none text-sm text-white/70"
                  dangerouslySetInnerHTML={{ __html: sanitize(expandedContent || '') }}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpandedContentExpanded(!isExpandedContentExpanded)}
                className="mt-2 h-11 px-1 -mx-1 text-sm text-white/70 hover:text-white"
              >
                {isExpandedContentExpanded ? (
                  <>Read less<ChevronUp className="ml-2 h-4 w-4" /></>
                ) : (
                  <>Read more<ChevronDown className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </div>
          </PageContainer>
        )}

        {/* Find the best teachers section */}
        {!loading && pageContent && (
          <PageContainer className="px-4 pb-10 sm:px-6 lg:px-8">
            <div className="max-w-prose">
              <h2 className="text-lg font-semibold">{pageContent.heading}</h2>
              {(isExpanded || pageContent.short_content) && (
                <div
                  className="prose prose-sm mt-2 max-w-none text-sm text-white/70"
                  dangerouslySetInnerHTML={{
                    __html: sanitize(
                      isExpanded ? pageContent.full_content : (pageContent.short_content || pageContent.full_content),
                    ),
                  }}
                />
              )}
              {pageContent.full_content && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="mt-2 h-11 px-1 -mx-1 text-sm text-white/70 hover:text-white"
                >
                  {isExpanded ? (
                    <>Read less<ChevronUp className="ml-2 h-4 w-4" /></>
                  ) : (
                    <>Read more<ChevronDown className="ml-2 h-4 w-4" /></>
                  )}
                </Button>
              )}
            </div>
          </PageContainer>
        )}

        {/* The two things a visitor can give back, as actual buttons rather
            than links buried in a collapsed column. Both routes already exist:
            /join is the teacher listing flow, /submit-a-paper is the paper
            hand-off. The footer claimed papers were "shared by students" while
            offering nobody a way to share one. */}
        <PageContainer className="px-5 pb-5 sm:px-6 lg:px-8">
          {/* sm:flex-1 on the buttons, never plain flex-1: below sm this row is
              flex-col, where `flex: 1 1 0%` applies its basis to the HEIGHT and
              overrides h-12 — both buttons collapsed to 24px of content at
              320px. They only need to share width once it becomes a row. */}
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <Button asChild variant="indigo" size={48} className="sm:flex-1">
              <Link to="/submit-a-paper">
                <FileText className="h-4 w-4" aria-hidden="true" />
                Submit a paper
              </Link>
            </Button>
            <Button asChild variant="primary" size={48} className="sm:flex-1">
              <Link to="/join">
                <GraduationCap className="h-4 w-4" aria-hidden="true" />
                Join as a teacher
              </Link>
            </Button>
          </div>
        </PageContainer>

        {/* 6. C12 WordmarkBleed — clipped by this slab's own bottom edge (the
            slab has overflow-hidden), sitting above the reserved bottom-nav
            strip because it is the last child inside the rounded panel, not
            flush with the viewport edge. */}
        <WordmarkBleed className="pt-4" />
      </div>
    </footer>
  );
}
