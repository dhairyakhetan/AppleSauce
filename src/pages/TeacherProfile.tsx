import { useEffect, useRef, useState } from 'react';
import { recordViewedTeacher } from '@/lib/activity-trail';
import { recordSignal } from '@/lib/intent/signals';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useChromeConfig } from '@/components/layout/AppShell';
import { ListError } from '@/components/ui/list-states';
import { Heart, Share2, ArrowLeft, Clock, Wallet, Users, ShieldCheck } from 'lucide-react';
import { useLikes } from '@/lib/likes-context';
import { useAuth } from '@/lib/auth-context';
import { useRequireRole } from '@/hooks/use-require-role';
import { usePageMeta } from '@/hooks/usePageMeta';
import { resolveTeacherWhatsAppUrl } from '@/utils/whatsapp';
import { WhatsAppIcon } from '@/components/BrandIcons';
import { getSubjectPalette } from '@/lib/subject-palette';
import { getTeacherBySlug, getTeachersByIds, getWhatsAppLinkBySlug } from '@/lib/teachers';
import { excerptDescription } from '@/lib/excerpt-description';
import { ContentGuard } from '@/components/ContentGuard';
import { CaptureShield } from '@/components/CaptureShield';
import { protectedClass } from '@/lib/copy-guard';
import { substituteGlyphs, substituteGlyphsInHtml } from '@/lib/glyph-substitution';
import { TeacherCard } from '@/components/TeacherCard';
import DOMPurify from 'dompurify';
import { imageAtWidth, validateImageSrc } from '@/utils/imageSanitizer';
import { recordVisit } from '@/lib/recently-visited';
import { recordProfileView } from '@/utils/profileViewLog';
import { TeacherComments } from '@/components/TeacherComments';
import { StripePlaceholder } from '@/components/ui/stripe-placeholder';
import { Button } from '@/components/ui/button';
import { ContactGateSheet } from '@/components/ContactGateSheet';
import { toast } from 'sonner';
import { BROWSE_PATH } from '@/lib/nav-config';
import { setAuthIntent } from '@/lib/auth-intent';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import {
  generateTeacherPersonSchema,
  generateBreadcrumbSchema,
  generatePersonReviewSchema,
} from '@/utils/structuredDataGenerators';
import { logger } from '@/utils/logger';

interface Teacher {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  bio: string | null;
  experience_years: number | null;
  location: string | null;
  whatsapp_number: string | null;
  is_verified: boolean;
  subjects: { name: string; slug: string } | null;
  subjects_text?: string | null;
  subjects_from_shikshaq?: string | null;
  classes?: string | null;
  classes_taught?: string | null;
  classes_taught_for_backend?: string | null;
  sir_maam?: string | null;
  area?: string | null;
  boards_taught?: string | null;
  class_size?: string | null;
  mode_of_teaching?: string | null;
  place_of_teaching?: string | null;
  location_v2?: string | null;
  students_home_areas?: string | null;
  tutors_home_areas?: string | null;
  expanded?: string | null;
  description?: string | null;
  qualifications_etc?: string | null;
  teaching_since?: string | null;
  review_1?: string | null;
  review_2?: string | null;
  review_3?: string | null;
  whatsapp_link?: string | null;
  min_fees?: number | null;
  max_fees?: number | null;
}

/* Bug fix, mobile QA pass: this heading used to run a mixed-weight H1 split
   (design system signature move, see Index.tsx/Join.tsx hero H1s) — a
   font-normal base clause followed by a font-black payoff, with the payoff
   falling on "Sir"/"Ma'am" when there was one. That put the honorific in
   bold and the teacher's actual name in font-normal: backwards for a
   profile, where the name is the primary identity element and the
   honorific is a secondary courtesy label. The name now always renders at
   full display weight; this helper only extracts the honorific so it can
   render separately, at its own small/light size. */
function getHonorific(sirMaam?: string | null): string | null {
  const lower = String(sirMaam ?? '').toLowerCase().trim();
  if (lower === 'sir' || lower.includes('sir')) return 'Sir';
  if (lower === "ma'am" || lower === 'maam' || lower.includes("ma'am")) return "Ma'am";
  return null;
}

function parseCommaList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function getTaughtAreas(teacher: Teacher): string[] {
  const locationV2 = teacher.location_v2;
  if (!locationV2) return [];
  const lower = String(locationV2).toLowerCase().trim();
  const isStudentsHomeOnly = lower.includes('students home tutoring only') || lower.includes("student's home tutoring only");
  const isTeachersHomeOnly = lower.includes("teacher's home tutoring") || lower.includes("tutor's home tutoring");
  const isBothOptions = lower.includes('both options listed') || lower.includes('both options');

  const studentsAreas = isStudentsHomeOnly || isBothOptions ? parseCommaList(teacher.students_home_areas) : [];
  const tutorsAreas = isTeachersHomeOnly || isBothOptions ? parseCommaList(teacher.tutors_home_areas) : [];
  return Array.from(new Set([...studentsAreas, ...tutorsAreas]));
}

function SubjectPill({ label }: { label: string }) {
  const palette = getSubjectPalette(label);
  return (
    <span
      className="animate-card-reveal motion-reduce:animate-none inline-flex h-[32px] items-center whitespace-nowrap rounded-full px-[14px] text-[14px] font-bold"
      style={{ backgroundColor: palette.tint, color: palette.text }}
    >
      {label}
    </span>
  );
}

// S3 header chips: height:26px padding:0 10px font-size:11.5px font-weight:700.
// max-w-full + truncate: bug fix (mobile QA) — a joined boards string like
// "ICSE/ISC + CBSE + State" is longer than any single mock's example data,
// and this chip's whitespace-nowrap had no width limit, so on narrow phones
// it overflowed past the identity card's rounded edge instead of wrapping or
// shrinking. Truncating with an ellipsis keeps the chip inside the card at
// every width instead of spilling over it.
// Handoff P-005: the first chip (boards) becomes the page's single accent
// above the CTA; the rest stay bone.
// Geometry is h32 / px-[14px] / 13.5px / 700. An earlier pass kept the
// source's h26/px-10/11.5px on the grounds that P-005's "Before" line did not
// describe what was actually in the file — but P-005's After says "unchanged
// geometry", i.e. that same h32 row, and 04's geometry appendix states it a
// second time independently. Two statements agreeing outweigh one stale
// before-value.
function SpeechChip({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    /* Wraps, never truncates. Beside the photo these chips had ~216px to hold
       a full board list or every area a teacher travels to, so both ended in
       an ellipsis that hid the actual answer. They now sit full width under
       the photo and name and are free to run to a second line.
       rounded-[16px] is half of the 32px single-line height, so one line still
       reads as a pill while two lines read as a rounded block rather than a
       stretched lozenge. */
    <span
      className={`animate-card-reveal motion-reduce:animate-none inline-flex min-h-[32px] max-w-full items-center rounded-[16px] px-[14px] py-[6px] text-[14px] font-bold leading-[1.35] backdrop-blur-sm ${
        accent ? 'bg-brand text-brand-foreground' : 'bg-card/90 text-foreground shadow-border'
      }`}
    >
      {children}
    </span>
  );
}

// Handoff P-007: a BentoPanel now, not a shadow-bordered card — radius 16 -> 30.
function StatTile({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <BentoPanel fill="card" className="animate-card-reveal flex-1 px-[14px] py-4">
      <Icon size={18} className="text-warm-meta" strokeWidth={2} aria-hidden="true" />
      <div className="mt-[10px] text-[12px] font-bold uppercase tracking-[0.04em] text-warm-label">
        {label}
      </div>
      <div className="mt-[3px] font-display tabular-nums text-[16px] font-extrabold tracking-[-0.03em] text-foreground">{value}</div>
    </BentoPanel>
  );
}

// Handoff P-009: every heading below is now the first child of its own
// BentoPanel — the panel's own padding plus the stack's seam replace the
// old inter-section margin, so this carries no top margin any more.
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-[10px] font-display text-[18px] font-extrabold tracking-[-0.03em] text-foreground lg:mb-[12px] lg:text-[26px] lg:tracking-[-0.02em]">
      {children}
    </h2>
  );
}

export default function TeacherProfile() {
  const { slug } = useParams<{ slug: string }>();

  const { user } = useAuth();
  const { isLiked, toggleLike } = useLikes();
  const navigate = useNavigate();
  const location = useLocation();
  const [primaryCtaVisible, setPrimaryCtaVisible] = useState(true);
  const primaryCtaRef = useRef<HTMLDivElement>(null);
  // M36 — the floating CTA's fade/slide must only ever play in response to a
  // real open/close (IntersectionObserver) state change, never as a side
  // effect of the element simply mounting. The transition classes are held
  // off until one paint after mount, so whatever visibility the very first
  // render settles on (before the observer has taken its first reading)
  // never animates; only a later, genuine flip does.
  const [ctaMotionReady, setCtaMotionReady] = useState(false);
  useEffect(() => {
    setCtaMotionReady(true);
  }, []);
  // design.md §3 — WhatsApp / save taps while signed out open a soft sheet,
  // never a route change; after auth the visitor continues to what they tapped.
  const [signInSheetOpen, setSignInSheetOpen] = useState(false);
  const [signInIntent, setSignInIntent] = useState<'message' | 'save'>('message');

  // Handoff P-014: the eyes panel at the bottom of this page needs the same
  // live sentence-builder data Home's does.
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();

  useRequireRole();

  /* Profile fetch on react-query. Was a hand-rolled useEffect owning its own
     loading flag and swallowing errors in a catch; the join itself already
     lives in src/lib/teachers.ts, so only the async-state ownership moved.

     staleTime is generous — a teacher profile changes rarely, and navigating
     back to one should not refetch. */
  const profileQuery = useQuery({
    queryKey: ['teacher-profile', slug],
    enabled: Boolean(slug),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Teacher | null> => {
      const { teacher: teacherData, shikshaqmine } = await getTeacherBySlug<any>(slug as string);
      if (!teacherData) return null;
      return {
        ...teacherData,
        sir_maam: shikshaqmine?.sirMaam ?? null,
        subjects_from_shikshaq: shikshaqmine?.subjectsFromShikshaq ?? null,
        classes_taught: shikshaqmine?.classesTaught ?? null,
        classes_taught_for_backend: shikshaqmine?.classesTaughtForBackend ?? null,
        area: shikshaqmine?.area ?? null,
        boards_taught: shikshaqmine?.boardsTaught ?? null,
        class_size: shikshaqmine?.classSize ?? null,
        mode_of_teaching: shikshaqmine?.modeOfTeaching ?? null,
        place_of_teaching: shikshaqmine?.placeOfTeaching ?? null,
        location_v2: shikshaqmine?.locationV2 ?? null,
        students_home_areas: shikshaqmine?.studentsHomeAreas ?? null,
        tutors_home_areas: shikshaqmine?.tutorsHomeAreas ?? null,
        expanded: shikshaqmine?.expanded ?? null,
        description: shikshaqmine?.description ?? null,
        qualifications_etc: shikshaqmine?.qualificationsEtc ?? null,
        teaching_since:
          shikshaqmine?.teachingSinceRaw != null && String(shikshaqmine.teachingSinceRaw).trim() !== ''
            ? String(shikshaqmine.teachingSinceRaw).trim()
            : null,
        review_1: shikshaqmine?.review1 ?? null,
        review_2: shikshaqmine?.review2 ?? null,
        review_3: shikshaqmine?.review3 ?? null,
        whatsapp_link: shikshaqmine?.whatsappLink ?? null,
        min_fees: shikshaqmine?.minFees ?? null,
        max_fees: shikshaqmine?.maxFees ?? null,
      } as Teacher;
    },
  });

  const teacher = profileQuery.data ?? null;
  const loading = profileQuery.isPending && Boolean(slug);

  /* Feeds H-005 branch 4 ("You looked at {name} last time. Still deciding?").
     Runs on the resolved profile, not on the route param, so a slug that 404s
     never writes a teacher the hero would then name back. */
  useEffect(() => {
    if (!teacher?.name) return;
    recordViewedTeacher({
      name: teacher.name,
      subject: teacher.subjects?.name ?? teacher.subjects_from_shikshaq?.split(',')[0]?.trim() ?? null,
      area: (teacher as { area?: string | null }).area?.split(',')[0]?.trim() ?? null,
      slug: teacher.slug,
      imageUrl: teacher.image_url,
    });
    // Real, teacher-visible count (Enquiries' sibling metric) -- see
    // profileViewLog.ts. Same trigger as recordViewedTeacher above: once per
    // resolved profile, never on a slug that 404s.
    if (teacher.slug) recordProfileView(teacher.slug);
  }, [teacher]);

  /* Owner call: reframed from "Similar teachers" (same subject only) to
     "More teachers we think you'd like" — deliberately NOT subject-filtered
     any more, so it surfaces teachers across other subjects too instead of
     only ever showing the same one. The same-subject rail this replaces
     still exists, just moved to its own "More teachers in {subject}"
     section below (recommendedInSubjectQuery). */
  const recommendedTeachersQuery = useQuery({
    queryKey: ['recommended-teachers', teacher?.id],
    enabled: Boolean(teacher?.id),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teachers_list')
        /* Only ids are used -- the row data is discarded and refetched by
           getTeachersByIds below, which returns the enriched shape this rail
           actually renders. Selecting the full column list here transferred
           six rows twice per profile view. */
        .select('id')
        .neq('id', teacher!.id)
        .order('is_featured', { ascending: false })
        .limit(6);
      if (error || !data) return [];
      return getTeachersByIds((data as any[]).map((t) => t.id));
    },
  });
  const recommendedTeachers = recommendedTeachersQuery.data ?? [];

  /* "More teachers in {subject}" — the same-subject rail "Similar teachers"
     used to be, now living under its own heading after the broadened
     recommendation rail above. */
  const moreInSubjectQuery = useQuery({
    queryKey: ['more-in-subject-teachers', teacher?.subjects?.slug, teacher?.id],
    enabled: Boolean(teacher?.subjects?.slug && teacher?.id),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      /* Only id (and subjects.slug, needed for the filter below to resolve)
         -- same reason as recommendedTeachersQuery above: the row data is
         discarded and refetched by getTeachersByIds, which returns the
         enriched shape this rail actually renders. */
      const { data, error } = await supabase
        .from('teachers_list')
        .select('id, subjects!inner(slug)')
        .eq('subjects.slug', teacher!.subjects!.slug)
        .neq('id', teacher!.id)
        .order('is_featured', { ascending: false })
        .limit(6);
      if (error || !data) return [];
      return getTeachersByIds((data as any[]).map((t) => t.id));
    },
  });
  const moreInSubjectTeachers = moreInSubjectQuery.data ?? [];

  // Called unconditionally, above the loading/error/not-found early returns
  // below — AppShell already renders the B2 pre-footer + Footer for this
  // route from the URL alone, this only adds the profile's own "Find the
  // best teachers for you" blurb once the teacher has loaded.
  // Handoff P-014: the eyes panel (H-023) replaces the old B2 pre-footer on
  // this route, rendered inline as the stack's own second-to-last panel —
  // same as Home.
  useChromeConfig({ preFooter: 'none', footerExpandedContent: teacher?.expanded || null });

  // Auto-continue after sign-in — see handleWhatsAppClick's sessionStorage flag.
  useEffect(() => {
    if (!user || !teacher) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem('shikshaq_pending_whatsapp');
    } catch {
      return;
    }
    if (pending && pending === teacher.slug) {
      try {
        sessionStorage.removeItem('shikshaq_pending_whatsapp');
      } catch {
        /* ok */
      }
      // Signed in by this point (the effect's own `!user` guard above), so
      // the gate on getWhatsAppLinkBySlug already returns the real number.
      void getWhatsAppLinkBySlug(teacher.slug).then((link) => {
        const url = resolveTeacherWhatsAppUrl(link);
        navigate(`/tuition-teachers/${teacher.slug}/whatsapp-click`, { state: { url, name: teacher.name } });
      });
    }
  }, [user, teacher]);

  useEffect(() => {
    const node = primaryCtaRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setPrimaryCtaVisible(entry.isIntersecting), { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [teacher?.id]);

  useEffect(() => {
    if (!teacher || !teacher.slug) return;
    recordVisit({
      type: 'teacher',
      id: teacher.id,
      title: teacher.name,
      subtitle: teacher.subjects?.name || teacher.subjects_from_shikshaq?.split(',')[0].trim(),
      path: `/tuition-teachers/${teacher.slug}`,
    });
  }, [teacher?.id]);

  useEffect(() => {
    if (!teacher || !teacher.slug) return;
    let cancelled = false;

    const toArray = (value: string | null | undefined): string[] => {
      if (!value || typeof value !== 'string') return [];
      return value.split(',').map((s) => s.trim()).filter(Boolean);
    };

    const subjectSlug =
      teacher.subjects?.slug ||
      (teacher.subjects_from_shikshaq
        ? teacher.subjects_from_shikshaq.toLowerCase().replace(/\s+/g, '-').split(',')[0].trim()
        : null);
    const subjectName = teacher.subjects?.name || teacher.subjects_from_shikshaq?.split(',')[0].trim() || 'Tuition Teachers';
    const subjectUrl = subjectSlug ? `https://www.shikshaq.in/${subjectSlug}-tuition-teachers-in-kolkata` : 'https://www.shikshaq.in/all-tuition-teachers-in-kolkata';

    const teacherUrl = `https://www.shikshaq.in/tuition-teachers/${teacher.slug}`;
    const teacherName = teacher.name || '';
    const rawTeacherDescription = teacher.description || teacher.bio || '';
    // SEO audit finding: ~45% of stored bios have a keyword-stuffed SEO block
    // appended after the real opening — see excerpt-description.ts. Capped at
    // 500 chars, generous enough for a real intro but short of the spam tail.
    const teacherDescription = rawTeacherDescription ? excerptDescription(rawTeacherDescription, 500) : '';
    const phoneNumber = teacher.whatsapp_number || null;
    const area = teacher.area || null;
    const subjects = teacher.subjects_from_shikshaq ? toArray(teacher.subjects_from_shikshaq) : [];
    const classesTaught = teacher.classes_taught_for_backend ? toArray(teacher.classes_taught_for_backend) : [];
    const qualifications = teacher.qualifications_etc || null;

    const personSchema = generateTeacherPersonSchema({
      url: teacherUrl,
      name: teacherName,
      description: teacherDescription || undefined,
      phoneNumber,
      area,
      qualifications,
      subjects,
      classesTaught,
    });

    const breadcrumbItems = [
      { name: 'Home', url: 'https://www.shikshaq.in' },
      { name: 'Tuition Teachers', url: 'https://www.shikshaq.in/all-tuition-teachers-in-kolkata' },
      ...(subjectSlug && subjectName ? [{ name: subjectName, url: subjectUrl }] : []),
      { name: teacherName, url: teacherUrl },
    ];
    const breadcrumbSchema = generateBreadcrumbSchema(breadcrumbItems, `${teacherUrl}#breadcrumb`);

    const personScript = document.createElement('script');
    personScript.type = 'application/ld+json';
    personScript.id = 'teacher-profile-person-schema';
    personScript.textContent = JSON.stringify(personSchema);

    const breadcrumbScript = document.createElement('script');
    breadcrumbScript.type = 'application/ld+json';
    breadcrumbScript.id = 'teacher-profile-breadcrumb-schema';
    breadcrumbScript.textContent = JSON.stringify(breadcrumbSchema);

    document.head.appendChild(personScript);
    document.head.appendChild(breadcrumbScript);

    // Reviews: sourced from `teacher_comments` — the real, user-submitted,
    // moderated reviews — never a fabricated rating (O-02 is unresolved).
    (async () => {
      const { data: comments, error: commentsError } = await supabase
        .from('teacher_comments')
        .select('comment, approved')
        .eq('teacher_id', teacher.id)
        .eq('approved', true)
        .order('created_at', { ascending: false })
        .limit(20);

      /* Search-engine markup only, nothing on screen depends on it, so this
         is logged (Clarity picks it up in production) rather than toasted. */
      if (commentsError) logger.error('TeacherProfile.reviewSchema', commentsError);
      if (cancelled) return;

      const reviewSchema = generatePersonReviewSchema({
        url: teacherUrl,
        name: teacherName,
        reviews: (comments || [])
          .filter((c) => c.comment && c.comment.trim())
          .map((c) => ({ author: 'Student', reviewBody: c.comment as string })),
      });

      if (reviewSchema) {
        const reviewScript = document.createElement('script');
        reviewScript.type = 'application/ld+json';
        reviewScript.id = 'teacher-profile-reviews-schema';
        reviewScript.textContent = JSON.stringify(reviewSchema);
        document.head.appendChild(reviewScript);
      }
    })();

    return () => {
      cancelled = true;
      document.getElementById('teacher-profile-person-schema')?.remove();
      document.getElementById('teacher-profile-breadcrumb-schema')?.remove();
      document.getElementById('teacher-profile-reviews-schema')?.remove();
    };
  }, [teacher]);

  const getMetaValue = (value: string | null | undefined, fallback = '') => value || fallback;
  const metaSubjects = getMetaValue(teacher?.subjects_from_shikshaq || teacher?.subjects?.name, 'subjects');
  const metaClasses = getMetaValue(teacher?.classes_taught || teacher?.classes_taught_for_backend, 'classes');
  const metaArea = getMetaValue(teacher?.area, 'Kolkata');
  const metaMode = getMetaValue(teacher?.mode_of_teaching, 'online/offline');
  const metaExpanded = getMetaValue(teacher?.expanded, '');

  /* Title tags ran 113-248 characters here, measured across the live roster -
     against a search result that shows roughly 60. Megha Bajaj's listed ten
     subjects and two areas, so everything past "Megha Bajaj teaches Commerce,
     Economics..." was cut off, including the brand. This is the largest indexed
     set on the site (147 pages), so it was also the most wasted.

     Keep the parts someone actually searches - the teacher's name, what they
     teach, where - and drop the boilerplate ("for Classes ... via Offline,
     Online on Shikshaq by AquaTerra"), which is identical on every page and
     never survived truncation anyway. Classes and mode still appear in the meta
     description and on the page itself. Subjects cap at two and area at one,
     because the long tail of a ten-subject list is noise in a SERP. */
  const parts = (value: string) => value.split(',').map((x) => x.trim()).filter(Boolean);
  const subjectsForTitle = (value: string) => {
    const p = parts(value);
    return p.length > 2 ? `${p.slice(0, 2).join(', ')} & more` : p.join(', ');
  };
  /* The area takes the first one flat, with no "& more". Two "& more"s in one
     title ("Geography, Biology & more tuition in Alipore & more") reads like a
     bug, and which of a teacher's areas comes second is not what anyone is
     searching for anyway. */
  const areaForTitle = (value: string) => parts(value)[0] || 'Kolkata';
  const pageTitle = teacher
    ? `${teacher.name} - ${subjectsForTitle(metaSubjects)} tuition in ${areaForTitle(metaArea)} | Shikshaq`
    : 'Shikshaq - by AquaTerra';

  let pageDescription = teacher
    ? `${metaSubjects} tuition classes for ${metaClasses} in ${metaArea} via ${metaMode}`
    : 'Shikshaq connects students with real local tuition teachers for free. Discover trusted, verified educators near you for school subjects and exams- simple, genuine, and community-driven learning with no hidden costs.';
  if (teacher && metaExpanded) {
    /* Cap the COMPOSED string, not just the appended fragment. Capping only
       the fragment at 150 let the total reach 221 characters (measured on
       /tuition-teachers/aroon), and Google truncates around 155-160 — so 60+
       characters of the differentiating copy never rendered in the SERP. */
    const expandedText = DOMPurify.sanitize(metaExpanded, { ALLOWED_TAGS: [] }).trim();
    const composed = `${pageDescription}. ${expandedText}`;
    pageDescription = composed.length > 157 ? `${composed.substring(0, 154).trimEnd()}...` : composed;
  }

  /* WhatsApp is this product's main distribution channel — a teacher's own
     photo makes a far more compelling share card than the generic default.
     Only pass real http(s) URLs through: og:image consumers (WhatsApp,
     Facebook) can't resolve blob:/data: URIs. */
  const safeTeacherImage = teacher?.image_url ? validateImageSrc(teacher.image_url) : '';
  const ogImage = safeTeacherImage.startsWith('http') ? safeTeacherImage : undefined;
  usePageMeta(pageTitle, pageDescription, ogImage);

  const backHref = (location.state as { fromBrowse?: string })?.fromBrowse ?? BROWSE_PATH;

  if (loading) {
    /* F3.9 — was three loose, mismatched boxes (full-width 280px band, a
       rounded-lg title, rounded-full chips) that didn't share the real
       layout's boxes or radii, so content visibly jumped into place instead
       of settling. Rebuilt from the same BentoStack/BentoPanel primitives
       the loaded page uses below, at the same heights and roundings, so the
       skeleton IS the final layout with placeholders in it. Also restores
       `bg-[length:200%_100%]`, without which `animate-shimmer` has nothing
       to sweep across (see BankPaper.tsx's skeleton for the same pairing). */
    return (
      <div className="min-h-screen bg-background">
        <main className="pb-10 sm:pb-8 lg:pb-16">
          <div className="lg:grid lg:grid-cols-[1fr_384px] lg:gap-[40px]">
            <BentoStack className="min-w-0">
              <BentoPanel
                fill="dark"
                edge="top"
                className="p-[14px] pb-5 lg:rounded-bento lg:border lg:border-border lg:bg-card lg:px-[30px] lg:pb-[28px] lg:pt-[14px] lg:shadow-none"
              >
                <div className="flex items-end gap-[14px] lg:items-start lg:gap-[28px]">
                  <div className="h-[166px] w-[132px] shrink-0 animate-shimmer rounded-[20px] bg-background/10 bg-[length:200%_100%] lg:h-[280px] lg:w-[224px] lg:bg-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="h-[27px] w-3/4 animate-shimmer rounded-[8px] bg-background/10 bg-[length:200%_100%] lg:h-[44px] lg:w-1/2 lg:bg-muted" />
                    <div className="mt-[10px] h-[18px] w-2/5 animate-shimmer rounded-[8px] bg-background/10 bg-[length:200%_100%] lg:hidden" />
                    <div className="mt-[10px] hidden gap-[18px] lg:flex">
                      <div className="h-[18px] w-20 animate-shimmer rounded-[6px] bg-muted bg-[length:200%_100%]" />
                      <div className="h-[18px] w-28 animate-shimmer rounded-[6px] bg-muted bg-[length:200%_100%]" />
                    </div>
                    <div className="stagger-children mt-[20px] hidden gap-2 lg:flex">
                      <div className="h-[32px] w-24 animate-card-reveal motion-reduce:animate-none rounded-full bg-muted" />
                      <div className="h-[32px] w-28 animate-card-reveal motion-reduce:animate-none rounded-full bg-muted" />
                    </div>
                  </div>
                </div>
                <div className="stagger-children mt-[14px] flex flex-wrap gap-1.5 lg:hidden">
                  <div className="h-[32px] w-28 animate-card-reveal motion-reduce:animate-none rounded-[16px] bg-background/10" />
                  <div className="h-[32px] w-20 animate-card-reveal motion-reduce:animate-none rounded-[16px] bg-background/10" />
                  <div className="h-[32px] w-24 animate-card-reveal motion-reduce:animate-none rounded-[16px] bg-background/10" />
                </div>
              </BentoPanel>

              <div className="stagger-children flex gap-seam">
                {[0, 1, 2].map((i) => (
                  <BentoPanel key={i} fill="card" className="animate-card-reveal motion-reduce:animate-none flex-1 px-[14px] py-4">
                    <div className="h-[18px] w-[18px] animate-shimmer rounded-[6px] bg-muted bg-[length:200%_100%]" />
                    <div className="mt-[10px] h-[10px] w-14 animate-shimmer rounded-[6px] bg-muted bg-[length:200%_100%]" />
                    <div className="mt-[6px] h-[16px] w-16 animate-shimmer rounded-[6px] bg-muted bg-[length:200%_100%]" />
                  </BentoPanel>
                ))}
              </div>

              <BentoPanel fill="card" className="p-[22px]">
                <div className="mb-[10px] h-[18px] w-40 animate-shimmer rounded-[6px] bg-muted bg-[length:200%_100%] lg:mb-[12px] lg:h-[26px]" />
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i}>
                      <div className="h-[11px] w-16 animate-shimmer rounded-[6px] bg-muted bg-[length:200%_100%]" />
                      <div className="mt-2 h-[15px] w-24 animate-shimmer rounded-[6px] bg-muted bg-[length:200%_100%]" />
                    </div>
                  ))}
                </div>
              </BentoPanel>
            </BentoStack>

            <aside className="mt-8 hidden lg:mt-0 lg:block">
              <div className="lg:sticky lg:top-24 lg:flex lg:flex-col lg:gap-[16px]">
                <div className="rounded-bento bg-panel p-[26px]">
                  <div className="h-[36px] w-2/3 animate-shimmer rounded-[8px] bg-background/10 bg-[length:200%_100%]" />
                  <div className="mt-[16px] h-[54px] w-full animate-shimmer rounded-[16px] bg-background/10 bg-[length:200%_100%]" />
                </div>
              </div>
            </aside>
          </div>
        </main>
      </div>
    );
  }

  /* A failed fetch is not a missing teacher. This used to fall through to
     "Teacher not found", telling someone their teacher had been removed when
     the network had simply failed — and offering no retry. Checked before the
     !teacher branch so a real 404 still reads as a 404. */
  if (profileQuery.isError) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-10 sm:px-6 sm:py-8 lg:pb-16 lg:px-8">
          <ListError onRetry={() => profileQuery.refetch()} />
        </main>
      </div>
    );
  }

  if (!teacher) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-16 text-center sm:px-6 sm:py-8 lg:px-8">
          <h1 className="mb-4 text-3xl font-semibold tracking-tight sm:text-4xl">Teacher not found</h1>
          <p className="mb-6 text-sm text-muted-foreground">The teacher you're looking for doesn't exist or has been removed.</p>
          <Button asChild variant="primary" size={44}>
            <Link to={BROWSE_PATH}>Browse all teachers</Link>
          </Button>
        </main>
      </div>
    );
  }

  const openSignInSheet = (intent: 'message' | 'save') => {
    /* Handoff AU-004a: record why the gate is opening, so /auth can show the
       matching hero (variant B for a message, C for a save). Written here
       rather than passed as a query so a teacher's name never lands in the
       URL, history or a referrer. Every field must be real — when the
       subject or area is missing, auth-intent.ts drops back to the default
       hero rather than render one with a blank in it. */
    setAuthIntent(
      intent === 'message'
        ? {
            kind: 'whatsapp',
            teacherName: teacher.name,
            subject: primarySubject ?? '',
            area: areaLabel,
            ...(feesValue ? { fee: feesValue } : null),
          }
        : { kind: 'save', teacherName: teacher.name, subject: primarySubject ?? '', area: areaLabel },
    );
    setSignInIntent(intent);
    setSignInSheetOpen(true);
  };

  const handleHeartClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!user) {
      openSignInSheet('save');
      return;
    }
    const nowLiked = await toggleLike(teacher.id);
    /* Only a save counts. Un-saving is not evidence of evaluating, and
       recording it would let a reader who changed their mind stay pinned to a
       stage they have stepped out of. */
    if (nowLiked) {
      recordSignal('teacher_saved', {
        id: teacher.slug,
        name: teacher.name,
        subject: primarySubject ?? null,
        area: areaLabel,
      });
    }
  };

  const handleWhatsAppClick = async () => {
    /* Reaching for the contact action is the clearest "I have decided" the
       site gets, and it is worth recording whether or not the sign-in that
       follows succeeds. Someone who opened the gate and backed out has still
       told us where they are in the journey.

       Recorded HERE, at the top, rather than inside openSignInSheet where it
       used to live. That placement had it firing on the two wrong conditions:
       a signed-out reader pressing SAVE recorded a contact they never
       started, and a SIGNED-IN reader pressing Message recorded nothing at
       all -- so the middle of the funnel was missing for exactly the people
       most likely to complete it, while being inflated by people who only
       bookmarked someone. Both are invisible until you try to read the
       numbers. */
    recordSignal('contact_started', {
      id: teacher.slug,
      name: teacher.name,
      subject: primarySubject ?? null,
      area: areaLabel,
    });

    // Checked BEFORE resolving anything, not after: teacher.whatsapp_link no
    // longer exists (Shikshaqmine.Link isn't fetched by the profile query at
    // all any more — see teachers.ts). Resolving it earlier and gating only
    // the navigation was exactly the old bug: the real number was already in
    // memory the moment this handler ran, signed in or not. Now there is
    // nothing to resolve until the gate has already passed.
    if (!user) {
      // design.md §3 — "after auth, continue straight to the redirect that was
      // tapped": flag the intent so the effect above fires the moment `user`
      // becomes truthy on this same page (post sign-in redirect lands back here).
      try {
        sessionStorage.setItem('shikshaq_pending_whatsapp', teacher.slug);
      } catch {
        /* storage unavailable — sign-in still works, just without auto-continue */
      }
      openSignInSheet('message');
      return;
    }
    const link = await getWhatsAppLinkBySlug(teacher.slug);
    const url = resolveTeacherWhatsAppUrl(link);
    navigate(`/tuition-teachers/${teacher.slug}/whatsapp-click`, { state: { url, name: teacher.name } });
  };

  const handleShareClick = async () => {
    const shareUrl = `https://www.shikshaq.in/tuition-teachers/${teacher.slug}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: teacher.name, url: shareUrl });
        return;
      } catch {
        // fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Link copied');
    } catch {
      // clipboard unavailable — no-op, share button stays non-fatal
    }
  };

  const liked = isLiked(teacher.id);

  const subjectsList = teacher.subjects_from_shikshaq
    ? parseCommaList(teacher.subjects_from_shikshaq)
    : teacher.subjects_text
    ? parseCommaList(teacher.subjects_text)
    : teacher.subjects
    ? [teacher.subjects.name]
    : [];
  const boardsList = parseCommaList(teacher.boards_taught);
  const taughtAreas = getTaughtAreas(teacher);
  const classesList = parseCommaList(teacher.classes_taught || teacher.classes_taught_for_backend);
  const modeList = parseCommaList(teacher.mode_of_teaching);
  const qualificationsText = teacher.qualifications_etc?.trim() || null;

  const primarySubject = subjectsList[0] || null;
  const accentPalette = getSubjectPalette(primarySubject);

  const feesValue =
    teacher.min_fees != null && teacher.max_fees != null
      ? `₹${teacher.min_fees.toLocaleString()} - ₹${teacher.max_fees.toLocaleString()}`
      : teacher.min_fees != null
      ? `₹${teacher.min_fees.toLocaleString()}+`
      : teacher.max_fees != null
      ? `Up to ₹${teacher.max_fees.toLocaleString()}`
      : null;
  const classSizeValue = teacher.class_size ? teacher.class_size.replace(/\bSolo\b/g, 'One-on-one') : null;
  /* P-007 draws a THREE-across row. With one value present it rendered a lone
     tile floating next to two tile-widths of nothing, and that value is listed
     again in Teaching details directly below — so one tile is suppressed
     rather than shown orphaned. Zero still gets the "not listed yet" note,
     because that says something the details grid cannot. */
  const statTileCount = [teacher.experience_years, feesValue, classSizeValue].filter(Boolean).length;
  const hasStats = statTileCount >= 2;

  /* The six facts pages.md §3 names, in its order. Built as a list so a missing
     value drops its row instead of rendering a label with nothing under it.

     Fee and class size are dropped when the stat tiles above are showing them.
     They were appearing TWICE within one screen -- "FEES / MONTH ₹3,000 -
     ₹5,000" in the tile strip and "FEE ₹3,000 - ₹5,000" again in this grid, a
     few hundred pixels below. The comment on statTileCount already knew the
     two overlap, but it only suppressed the tile in the one-value case; with
     both fees and class size present the tiles render AND the grid repeats
     them.
     Repeating a fact does not reinforce it, it makes the reader check whether
     the second one says something different. The tiles win because they are
     the scannable form and they come first. */
  const shownInTiles = new Set(hasStats ? ['Fee', 'Class size'] : []);

  /* BOARDS is dropped outright. Both headers already print the full list --
     the desktop row at lg and the SpeechChip below the photo on mobile -- so
     it was being said twice at every width. The existing `lg:hidden` on this
     row only fixed desktop, on the stated belief that "mobile's header doesn't
     show them". It does; that comment was describing the subject pills, which
     really are desktop-only, and boards got swept along with them.

     SUBJECTS is desktop-duplicated for the same reason, but on mobile the
     header shows only the PRIMARY subject. So it is a repeat there only when
     the teacher has exactly one, and a teacher with three subjects still needs
     this row on a phone. */
  const subjectsAreRepeatedOnMobile = subjectsList.length <= 1;

  /* AREAS earns its row only when it says something the area chip does not.
     taughtAreas is where the teacher will travel to; teacher.area is where
     they are based. Usually those differ and the row answers "will they come
     to us?". When the travel list is just their own area it answers nothing,
     and printing "AREAS Ballygunge" under a header chip that already says
     Ballygunge is the same repetition this pass exists to remove. */
  const travelAreasSayMore =
    taughtAreas.length > 0 &&
    !(taughtAreas.length === 1 && teacher.area && taughtAreas[0].toLowerCase() === teacher.area.toLowerCase());

  const teachingDetails = [
    { label: 'Subjects', value: subjectsList.join(', ') },
    { label: 'Classes', value: classesList.join(', ') },
    { label: 'Mode', value: modeList.join(', ') },
    { label: 'Fee', value: feesValue },
    { label: 'Class size', value: classSizeValue },
    { label: 'Areas', value: taughtAreas.join(', ') },
  ]
    .filter((row) => !(shownInTiles.has(row.label) && Boolean(row.value)))
    .filter((row) => !(row.label === 'Subjects' && subjectsAreRepeatedOnMobile))
    .filter((row) => !(row.label === 'Areas' && !travelAreasSayMore))
    .filter((row): row is { label: string; value: string } => Boolean(row.value));

  const firstName = teacher.name.trim().split(/\s+/)[0] || teacher.name;
  const honorific = getHonorific(teacher.sir_maam);

  // SEO/UX audit finding: ~45% of stored bios have a keyword-stuffed SEO
  // block appended after the real opening (see excerpt-description.ts) —
  // rendered here, that's what a real visitor read as "About {firstName}".
  // Excerpting is skipped for the (unconfirmed but possible) HTML-tagged
  // case, since it can't cleanly re-wrap arbitrary markup into a shorter
  // plain-text excerpt without risking broken tags.
  const isHtmlDescription = teacher.description ? /<[a-z][\s\S]*>/i.test(teacher.description) : false;
  const excerptedDescription =
    teacher.description && !isHtmlDescription ? excerptDescription(teacher.description, 600) : teacher.description;
  const descriptionHtml = excerptedDescription
    ? isHtmlDescription
      ? DOMPurify.sanitize(excerptedDescription, {
          ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
          ALLOWED_ATTR: ['href', 'target', 'rel'],
        })
      : DOMPurify.sanitize(excerptedDescription.replace(/\n/g, '<br />'), { ALLOWED_TAGS: ['br'] })
    : null;

  const areaLabel = teacher.area || 'Kolkata';

  return (
    <div className="min-h-screen bg-background">
      {/* M15 — whatsapp-pulse-once (index.css) starts 1s after mount, so
          there's a silent gap before the CTA does anything, in which it just
          appears. A brief scale/opacity entrance fills that gap so the button
          arrives, THEN pulses, instead of popping into an already-idle pulse
          cycle. Scoped here (not index.css/tailwind.config — those belong to
          another stream) since this keyframe has no other consumer yet. */}
      <style>{`
        @keyframes whatsapp-cta-pop {
          0% { opacity: 0; transform: scale(0.88); }
          60% { opacity: 1; transform: scale(1.02); }
          100% { opacity: 1; transform: scale(1); }
        }
        .whatsapp-cta-pop { animation: whatsapp-cta-pop 320ms cubic-bezier(0.2, 0, 0, 1) both; }
        @media (prefers-reduced-motion: reduce) {
          .whatsapp-cta-pop { animation: none; }
        }
      `}</style>

      {/* Bug fix, mobile QA: pb-10 not the old pb-[104px]. That 104px was
          reserving clearance for the fixed bottom nav a second time —
          AppShell already reserves it once via BottomNavSpacer, rendered
          after this page's PreFooter/Footer. Stacked on top of each other,
          the two reservations left a dead gap between the last section here
          (the "similar teachers" link) and the B2 strip that follows. */}
      {/* pb only, not py: sm:py-8 was giving this <main> its own 32px top
          padding ON TOP OF the profile panel's own edge="top" NavReserve
          (PageContainer.tsx) just below — the panel is meant to bleed to
          y=0 and let NavReserve alone clear the fixed nav pill (same as
          About.tsx's bare `<main>`, which has none of this). Stacking both
          pushed "Back to all teachers" ~118px down the page for a pill
          that only needs 72px, reported as dead space above it. */}
      {/* No max-w/mx-auto/px — Index.tsx's owner correction applies here
          too: edge-to-edge is the pattern for every BentoStack page, this
          one included, not a page-level gutter. T-006 had only zeroed the
          mobile gutter and left sm:/lg: in place; that was the bug, not a
          decision to keep. */}
      <main className="pb-10 sm:pb-8 lg:pb-16">
        {/* Desktop: 1fr / 384px grid. Left = photo/name card + prose sections. Right = sticky contact card. */}
        <div className="lg:grid lg:grid-cols-[1fr_384px] lg:gap-[40px]">
          <BentoStack className="min-w-0">
            {/* Profile card — design.md "Teacher profile (S3/D3)": photo sits
                inside the card beside the name, never underneath overlaid
                chips/badges — nothing may cover a teacher's face. Dark panel +
                white text on mobile (S3); light bordered card on desktop (D3).
                Handoff P-002: radius 28 -> square-topped 30 on mobile (it
                meets the nav), 24 -> 30 on desktop; the dark fill stays —
                it's the one dark surface above the footer on this page. */}
            <BentoPanel
              fill="dark"
              edge="top"
              /* lg:pt-[14px], not lg:py-[28px]'s top half: NavReserve (inside
                 BentoPanel, edge="top") already reserves the 72px the fixed
                 nav pill needs to clear. That's sized for mobile, where this
                 panel stays dark and genuinely bleeds under the pill; at lg
                 it becomes this bordered, fully-rounded card instead, so
                 stacking the panel's own 28px hero padding on top of the
                 same reserve left ~100px of near-blank card-coloured space
                 before "Back to all teachers" — read as dead space, not
                 breathing room. A small top breather instead of the full
                 padding; bottom keeps its 28px. */
              className="p-[14px] pb-5 lg:rounded-bento lg:border lg:border-border lg:bg-card lg:px-[30px] lg:pb-[28px] lg:pt-[14px] lg:shadow-none"
            >
              {/* S3 top row: 40x40 icon buttons, 18px icons, 8px gap, 16px margin-bottom.
                  Kept at a 44px hit area (padding) around the 40px visual per the
                  44px-minimum rule — mockup draws the control smaller than the a11y floor. */}
              {/* Desktop back link. desktop-03-teacher-profile.png puts
                  "‹ Back to 48 Maths teachers" in the top bar; the row below is
                  lg:hidden, so at desktop width this page offered NO way back to
                  the list at all — only the browser's own back button, which
                  does not exist for someone who arrived from a search result.
                  The label says where you are going in words rather than
                  relying on a bare chevron, since there is room for it here. */}
              <Link
                to={backHref}
                className="mb-[16px] hidden min-h-11 items-center gap-2 text-[13px] font-semibold text-background/70 transition-colors duration-150 hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:inline-flex lg:text-muted-foreground lg:hover:text-foreground"
              >
                <ArrowLeft size={16} aria-hidden="true" />
                Back to all teachers
              </Link>

              <div className="mb-[16px] flex items-center justify-between lg:hidden">
                <button
                  type="button"
                  onClick={() => navigate(backHref)}
                  aria-label="Back to results"
                  className="relative flex h-[40px] w-[40px] items-center justify-center rounded-full bg-background/10 transition-transform duration-150 before:absolute before:-inset-[2px] before:content-[''] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <ArrowLeft size={18} className="text-background" aria-hidden="true" />
                </button>
                <div className="flex gap-[8px]">
                  <button
                    type="button"
                    onClick={handleHeartClick}
                    aria-label={liked ? 'Remove from favourites' : 'Save teacher'}
                    aria-pressed={liked}
                    className="relative flex h-[40px] w-[40px] items-center justify-center rounded-full bg-background/10 transition-transform duration-150 before:absolute before:-inset-[2px] before:content-[''] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <Heart size={18} className={liked ? 'fill-destructive text-destructive' : 'text-background/70'} />
                  </button>
                  <button
                    type="button"
                    onClick={handleShareClick}
                    aria-label="Share teacher"
                    className="relative flex h-[40px] w-[40px] items-center justify-center rounded-full bg-background/10 transition-transform duration-150 before:absolute before:-inset-[2px] before:content-[''] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <Share2 size={18} className="text-background/70" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="flex items-end gap-[14px] lg:items-start lg:gap-[28px]">
                <div className="relative h-[166px] w-[132px] shrink-0 overflow-hidden rounded-[20px] outline outline-1 -outline-offset-1 outline-black/10 lg:h-[280px] lg:w-[224px]">
                  {teacher.image_url ? (
                    <img
                      src={imageAtWidth(teacher.image_url, 800)}
                      alt={`${teacher.name}, ${subjectsForTitle(metaSubjects)} tutor in ${areaForTitle(metaArea)}, Kolkata`}
                      width={224}
                      height={280}
                      decoding="async"
                      /* React 18 does not recognise `fetchPriority` as a prop —
                         it warns and drops it. (React 19 added it.) Spreading
                         the lowercase HTML attribute emits the real thing.
                         This is the profile's LCP image, so the hint is worth
                         keeping rather than removing. */
                      {...({ fetchpriority: 'high' } as Record<string, string>)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full" style={{ backgroundColor: accentPalette.tint }}>
                      <StripePlaceholder name={teacher.name} initialSize={72} className="h-full w-full" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-[8px] gap-y-1">
                    {/* Name is always the bold element; "Sir"/"Ma'am" is a
                        secondary courtesy label and reads small and light
                        next to it, never matching its weight. */}
                    <h1 className="font-display text-[27px] font-black leading-[1] tracking-[-0.04em] text-background lg:text-[44px] lg:tracking-[-0.03em] lg:text-foreground">
                      {teacher.name}
                    </h1>
                    {honorific && (
                      <span className="text-[14px] font-normal leading-[1] text-background/60 lg:text-[17px] lg:text-muted-foreground">
                        {honorific}
                      </span>
                    )}
                    {teacher.is_verified && (
                      <span title="Verified by Shikshaq" className="flex-none">
                        <ShieldCheck
                          className="h-[19px] w-[19px] fill-brand text-background lg:h-[26px] lg:w-[26px] lg:text-card"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      </span>
                    )}
                  </div>

                  {primarySubject && (
                    <p className="mt-[7px] font-display text-[14px] font-bold text-background/90 lg:hidden">
                      Teaches{' '}
                      <span className="rounded-[8px] bg-card px-[8px] py-[1px] text-foreground">{primarySubject}</span>
                    </p>
                  )}

                  {(teacher.area || teacher.experience_years || boardsList.length > 0) && (
                    <div className="mt-[8px] hidden flex-wrap gap-[18px] text-[15px] text-warm-prose lg:flex">
                      {teacher.area && <span className="inline-flex items-center gap-2">{teacher.area}</span>}
                      {teacher.experience_years && (
                        <span className="inline-flex items-center gap-2">{teacher.experience_years}+ years experience</span>
                      )}
                      {boardsList.length > 0 && <span className="inline-flex items-center gap-2">{boardsList.join(' + ')}</span>}
                    </div>
                  )}

                  {subjectsList.length > 0 && (
                    <div className="stagger-children mt-[20px] hidden flex-wrap gap-2 lg:flex">
                      {subjectsList.map((subject) => (
                        <SubjectPill key={subject} label={subject} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* S3 header chips, moved out of the column beside the photo and
                  given the panel's full width. Sharing that column capped them
                  at ~216px, which is not enough for a real board list or a
                  travel radius, so both were being cut. Below the photo and the
                  name they get the whole width and the panel simply grows to
                  fit them. */}
              {(boardsList.length > 0 || teacher.area || teacher.experience_years) && (
                <div className="stagger-children mt-[14px] flex flex-wrap gap-1.5 lg:hidden">
                  {boardsList.length > 0 && <SpeechChip accent>{boardsList.join(' + ')}</SpeechChip>}
                  {teacher.area && <SpeechChip>{teacher.area}</SpeechChip>}
                  {teacher.experience_years && <SpeechChip>{teacher.experience_years}+ years</SpeechChip>}
                </div>
              )}
            </BentoPanel>

            {/* Handoff P-007: a 3-across row at every width, each tile its
                own BentoPanel — was a stacked grid that cost three rows for
                three short facts at 375px. */}
            {hasStats && (
              <div className="stagger-children flex gap-seam">
                {teacher.experience_years && <StatTile icon={Clock} label="Experience" value={`${teacher.experience_years}+ years`} />}
                {feesValue && <StatTile icon={Wallet} label="Fees / month" value={feesValue} />}
                {classSizeValue && <StatTile icon={Users} label="Class size" value={classSizeValue} />}
              </div>
            )}
            {statTileCount === 0 && (
              <BentoPanel fill="muted" className="text-sm text-muted-foreground">
                Experience, fees, and class size aren't listed yet, ask {firstName} directly on WhatsApp.
              </BentoPanel>
            )}


            {/* One "Teaching details" section, not three.
                pages.md §3 section 4 asks for a 2-col meta grid — label 11.5px
                above value 15px — covering subjects, classes, boards, mode, fee
                and availability, with the rule that every field the old page
                showed must appear. It was three separate h2 sections of chip
                rows (Classes taught / Where they teach / Mode of teaching),
                which spread six short facts down a screen and a half and made
                comparing two teachers a scrolling exercise.

                Each row is dropped when its value is missing rather than shown
                empty, and the whole section disappears if nothing survives.
                Handoff P-009: grid-cols-2 at every width now (was 1 col mobile). */}
            {teachingDetails.length > 0 && (
              <BentoPanel fill="card" className="p-[22px]">
                <SectionHeading>Teaching details</SectionHeading>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  {teachingDetails.map(({ label, value }) => (
                    /* Only SUBJECTS is width-dependent now. The desktop
                       header renders the full pill list, so the row would
                       repeat it; the mobile header shows only the primary
                       subject, so a teacher with several still needs the row
                       there (and one with a single subject is filtered out
                       above).

                       AREAS is no longer hidden at lg. It holds the areas the
                       teacher travels to, from students_home_areas and
                       tutors_home_areas, which is a different fact from
                       `teacher.area` -- their base -- and `teacher.area` is
                       the only one either header shows. Hiding this row on
                       desktop did not remove a repeat, it removed the answer
                       to "will they come to us?" for every desktop reader. */
                    <div key={label} className={label === 'Subjects' ? 'lg:hidden' : ''}>
                      <dt className="text-[12px] font-bold uppercase tracking-[0.07em] text-warm-label">
                        {label}
                      </dt>
                      <dd className="mt-1 text-[15px] leading-[1.5] text-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>
              </BentoPanel>
            )}

            {/* Contact panel — mobile/tablet only; desktop's contact card lives in
                the sticky right column below. Green WhatsApp CTA (design.md §4).
                Handoff P-008: bg-muted -> bg-mint, radius 20 -> 30. */}
            <BentoPanel ref={primaryCtaRef} fill="mint" className="flex flex-col p-4 lg:hidden">
              <p className="mb-[12px] text-[14px] leading-[1.55] text-[#3E6F53]">
                Fees and arrangements are settled directly between you and the teacher. Shikshaq takes no commission.
              </p>
              <Button
                variant="whatsapp"
                size={52}
                onClick={handleWhatsAppClick}
                className="whatsapp-cta-pop whatsapp-pulse-once rounded-[16px]"
              >
                <WhatsAppIcon className="h-[19px] w-[19px]" />
                Message on WhatsApp
              </Button>
            </BentoPanel>

            {/* Copy and capture protection for the teacher's own words. Scoped
                to the [data-protected] blocks below, so the name, subjects and
                fees stay selectable -- those are what a parent legitimately
                pastes into a message, and locking them protects nothing.
                See src/lib/copy-guard.ts for what these can and cannot do. */}
            <ContentGuard />
            <CaptureShield label="This profile is not for copying. Share the link instead." />

            {/* Handoff P-009: each of these three becomes its own BentoPanel. */}
            {descriptionHtml && (
              <BentoPanel fill="card" className="p-[22px]">
                <SectionHeading>About {firstName}</SectionHeading>
                <div
                  data-protected
                  className={`max-w-prose text-[15px] leading-[1.65] text-warm-prose [&_p+p]:mt-3 lg:text-[16px] lg:leading-[1.6] ${protectedClass}`}
                  dangerouslySetInnerHTML={{ __html: substituteGlyphsInHtml(descriptionHtml) }}
                />
              </BentoPanel>
            )}

            {qualificationsText && (
              <BentoPanel fill="card" className="p-[22px]">
                <SectionHeading>Qualifications</SectionHeading>
                <p data-protected className={`max-w-prose text-[15px] leading-[1.65] text-warm-prose lg:text-[16px] lg:leading-[1.6] ${protectedClass}`}>{substituteGlyphs(qualificationsText)}</p>
              </BentoPanel>
            )}

            {/* Handoff P-010: wrapped in one orange-tinted panel — see
                TeacherComments.tsx for the heading/write-review pill/card
                treatment. */}
            <BentoPanel fill="brandTint" className="p-[22px]">
              <TeacherComments teacherId={teacher.id} subject={primarySubject} teacherSlug={teacher.slug} teacherName={teacher.name} area={areaLabel} />
            </BentoPanel>

            {/* Handoff P-011: the similar-teachers rail and the closing
                sentence share one panel now, instead of sitting loose on
                page ground. */}
            <BentoPanel fill="card" className="!px-0 !py-[22px] lg:!py-8">
              {recommendedTeachers.length > 0 && (
                <>
                  <div className="px-[22px]">
                    <SectionHeading>More teachers we think you&rsquo;d like</SectionHeading>
                  </div>
                  {/* overflow-y-visible was a no-op here — once overflow-x is
                      auto, overflow-y resolves to auto too (CSS spec), so it
                      never actually gave the hover lift/shadow room and could
                      clip it instead. Same fix as the home rail's featured-
                      teacher shelf: overflow-y-hidden + real pb/pt padding. */}
                  <div className="overflow-x-auto overflow-y-hidden px-[22px] pb-3 pt-3 scrollbar-hide">
                    <ul className="flex w-max snap-x snap-mandatory gap-4">
                      {recommendedTeachers.map((t) => (
                        <li key={t.id} className="w-[168px] flex-none snap-start sm:w-[200px] lg:w-[220px]">
                          <TeacherCard
                            id={t.id}
                            name={t.name}
                            slug={t.slug}
                            subject={t.subjects?.name || 'Tuition Teacher'}
                            subjectSlug={t.subjects?.slug}
                            imageUrl={t.image_url ?? undefined}
                            sirMaam={t.sirMaam}
                            whatsappLink={t.whatsappLink}
                            experienceYears={t.experienceYears}
                            minFees={t.minFees}
                            maxFees={t.maxFees}
                            area={t.area}
                            variant="rail"
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}

              {/* "More teachers in {subject}" — same-subject rail, kept as its
                  own section rather than folded into the broadened one above
                  (owner call: keep both, don't just rename). */}
              {moreInSubjectTeachers.length > 0 && (
                <>
                  <div className="mt-[22px] px-[22px]">
                    <SectionHeading>More teachers in {primarySubject || 'this subject'}</SectionHeading>
                  </div>
                  {/* overflow-y-visible was a no-op here — once overflow-x is
                      auto, overflow-y resolves to auto too (CSS spec), so it
                      never actually gave the hover lift/shadow room and could
                      clip it instead. Same fix as the home rail's featured-
                      teacher shelf: overflow-y-hidden + real pb/pt padding. */}
                  <div className="overflow-x-auto overflow-y-hidden px-[22px] pb-3 pt-3 scrollbar-hide">
                    <ul className="flex w-max snap-x snap-mandatory gap-4">
                      {moreInSubjectTeachers.map((t) => (
                        <li key={t.id} className="w-[168px] flex-none snap-start sm:w-[200px] lg:w-[220px]">
                          <TeacherCard
                            id={t.id}
                            name={t.name}
                            slug={t.slug}
                            subject={t.subjects?.name || 'Tuition Teacher'}
                            subjectSlug={t.subjects?.slug}
                            imageUrl={t.image_url ?? undefined}
                            sirMaam={t.sirMaam}
                            whatsappLink={t.whatsappLink}
                            experienceYears={t.experienceYears}
                            minFees={t.minFees}
                            maxFees={t.maxFees}
                            area={t.area}
                            variant="rail"
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}

              {/* Sentence footer — was a dead link to the unfiltered browse
                  page despite naming a subject+area ("not actually working
                  with the filters"). Now carries the real filter_subjects/
                  filter_areas query params Browse.tsx reads, so it lands
                  already filtered. */}
              <p className="mt-[18px] px-[22px] text-base text-warm-prose">
                Looking for more{' '}
                <Link
                  to={`${BROWSE_PATH}${(() => {
                    const params = new URLSearchParams();
                    if (primarySubject) params.set('filter_subjects', primarySubject);
                    if (areaLabel) params.set('filter_areas', areaLabel);
                    const qs = params.toString();
                    return qs ? `?${qs}` : '';
                  })()}`}
                  className="font-semibold text-foreground underline underline-offset-2 transition-colors duration-150 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {primarySubject || 'tuition'} teachers near {areaLabel}
                </Link>
                ?
              </p>
            </BentoPanel>
          </BentoStack>

          {/* Right column — desktop only: sticky near-black contact card + "not the right fit" panel.
              D3 sticky card: radius:24px padding:26px gap:16px; fee font:36px; WhatsApp h:54 radius:15;
              save/share h:46 radius:13; "not the right fit" card radius:20 padding:20 mt:16.
              Handoff P-012: radius 24 -> 30 on both cards; shadow-border
              removed from the dark card — it's the only dark object in this
              column and needs no ring. */}
          <aside className="mt-8 hidden lg:mt-0 lg:block">
            <div className="lg:sticky lg:top-24 lg:flex lg:flex-col lg:gap-[16px]">
              <div className="rounded-bento bg-panel p-[26px] text-background">
                {feesValue && (
                  <p className="flex items-baseline gap-2">
                    <span className="font-display tabular-nums text-[36px] font-black tracking-[-0.03em] text-background">{feesValue}</span>
                    <span className="text-sm text-background/60">per month</span>
                  </p>
                )}
                <Button
                  variant="whatsapp"
                  size={54}
                  onClick={handleWhatsAppClick}
                  className="whatsapp-cta-pop whatsapp-pulse-once mt-[16px] w-full rounded-[16px]"
                >
                  <WhatsAppIcon className="h-[20px] w-[20px]" />
                  Message on WhatsApp
                </Button>
                <div className="mt-[16px] flex gap-[10px]">
                  <Button
                    variant="ghost"
                    size={44}
                    onClick={handleHeartClick}
                    className="h-[46px] flex-1 rounded-[14px] text-background hover:bg-background/10"
                  >
                    <Heart size={16} className={liked ? 'fill-destructive text-destructive' : ''} aria-hidden="true" />
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size={44}
                    onClick={handleShareClick}
                    className="h-[46px] flex-1 rounded-[14px] text-background hover:bg-background/10"
                  >
                    <Share2 size={15} aria-hidden="true" />
                    Share
                  </Button>
                </div>
                <ul className="mt-4 space-y-2 text-xs text-background/70">
                  {teacher.is_verified && <li>ID and degree verified by Shikshaq</li>}
                  <li>Fees are settled directly with the teacher. Shikshaq takes no commission.</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Handoff P-014: the eyes panel + footer render as the stack's last
          two panels here too, exactly as on Home — AppShell's old B2
          pre-footer is suppressed above (useChromeConfig). */}
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

      {/* Floating mobile CTA — the WhatsApp button must stay reachable as the
          parent reads the whole profile, not just while the panel above is on
          screen. Desktop's sticky contact card keeps the CTA in reach, so this
          is mobile-only. Sits above the fixed bottom nav bar.
          Handoff P-013: bottom clears the nav pill (was bottom-20, a fixed
          80px); z-50 to match the two floating pills it sits between. */}
      {/* Handoff M-010: opacity + translateY(8px -> 0) over 500ms ease-snap,
          reversing on the way out. It used to carry `animate-pop`, which does
          not exist — DESIGN_SYSTEM §6 removed that keyframe (see the note in
          tailwind.config.ts), so the class was inert and the pill simply
          appeared. Rendering it always and animating opacity/transform gives
          the exit the entry already implied; `pointer-events-none` keeps the
          hidden state from swallowing taps meant for the page. */}
      <div
        aria-hidden={primaryCtaVisible}
        data-state={primaryCtaVisible ? 'closed' : 'open'}
        className={`fixed inset-x-4 z-50 lg:hidden motion-reduce:transition-none ${
          ctaMotionReady ? 'transition-[opacity,transform] duration-500 ease-snap' : ''
        } ${
          primaryCtaVisible ? 'pointer-events-none translate-y-2 opacity-0' : 'translate-y-0 opacity-100'
        }`}
        style={{ bottom: 'calc(84px + env(safe-area-inset-bottom))' }}
      >
        {/* P-013: radius 999 "to match the two floating pills it sits between",
            and S-007's ⚠ "no shadow on any button". It had `.sticker
            .outline-offset-shadow` — the character-layer treatment, a 4px white
            + 7px black double ring plus a hard 4px offset shadow — which is
            the wrong register for a floating action pill. `shadow-pill` is
            what the nav pill and the bottom nav already use. */}
        <Button
          variant="whatsapp"
          size={54}
          onClick={handleWhatsAppClick}
          tabIndex={primaryCtaVisible ? -1 : undefined}
          className="w-full rounded-full shadow-pill"
        >
          <WhatsAppIcon className="h-5 w-5" />
          {feesValue ? `${feesValue} · Message` : 'Message on WhatsApp'}
        </Button>
      </div>

      <ContactGateSheet
        open={signInSheetOpen}
        onOpenChange={setSignInSheetOpen}
        intent={signInIntent}
        teacherName={teacher?.name ?? null}
        teacherImageUrl={teacher?.image_url ?? null}
        teacherSubject={teacher?.subjects?.name ?? null}
        teacherArea={teacher?.area ?? null}
      />
    </div>
  );
}
