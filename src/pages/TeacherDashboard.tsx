import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BentoStack, BentoPanel, PageContainer } from '@/components/layout/PageContainer';
import { usePageMeta } from '@/hooks/usePageMeta';
import { IconDisc } from '@/components/ui/icon-disc';
import { StripePlaceholder } from '@/components/ui/stripe-placeholder';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Save, Lock, Upload, X, PencilLine, PauseCircle, PlayCircle, Link2,
  Info, Check, UserCircle2, Eye,
} from 'lucide-react';
import { type ReviewCardData } from '@/components/reviews/review-card';
import { ListLoading, ListError } from '@/components/ui/list-states';
import { toast } from 'sonner';
import { logger } from '@/utils/logger';
import { convertClassesToRoman } from '@/utils/romanNumerals';
import { sanitizeImageUrl, validateImageSrc } from '@/utils/imageSanitizer';
import DOMPurify from 'dompurify';
import { invalidateTeacherCache, removeCache } from '@/utils/cache';
import imageCompression from 'browser-image-compression';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useChromeConfig } from '@/components/layout/AppShell';

import { fetchOwnContact } from '@/lib/teacher-contact';
const AREAS = [
  // Group 1
  'Alipore', 'Ballygunge', 'Behala', 'Bhowanipore', 'Gariahat', 'Garia', 'Jadavpur', 'Kasba',
  'New Alipore', 'Southern Avenue', 'Tollygunge', 'Hazra',
  // Group 2
  'Baguihati', 'Belur', 'Howrah', 'Joka', 'Newtown', 'Rajarhat', 'Salt Lake', 'Science City',
  // Group 3
  'Dum Dum', 'Entally', 'Girish Park', 'Nagarbazar', 'Sealdah', 'Shyam Bazar', 'Tangra',
  // Group 4
  'Camac Street', 'College Street', 'Elgin', 'Minto Park', 'Park Street', 'Park Circus',
  // Group 5
  'Kankurgachi', 'Laketown', 'Phoolbagan', 'Ultadanga',
  // Group 6
  'Anandapur', 'Parnasree', 'Rabindra Nagar',
  // Group 7
  'Hooghly'
].sort();

const SCHOOL_BOARDS = ['ICSE', 'CBSE', 'IGCSE', 'IB', 'State', 'N/A'];

const CLASS_NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'UG'];

const SUBJECTS = [
  'Accounts', 'ACT', 'AP', 'Bengali', 'Biology', 'Business Studies', 'CA', 'CAT', 'Chemistry',
  'CLAT', 'Commerce', 'Computers', 'Drawing & Painting', 'Economics', 'English', 'Environmental Science',
  'Geography', 'Hindi', 'History & Civics', 'Home Science', 'JEE', 'Legal Studies', 'Maths',
  'NEET', 'NMAT', 'Physics', 'Political Science', 'Psychology', 'SAT', 'Science',
  'Sanskrit', 'Social Studies', 'Sociology'
];

const MODE_OF_TEACHING = ['Online', 'Offline'];

const CLASS_SIZE = ['Group', 'Solo'];

interface TeacherData {
  "Email ID": string | null;
  Description: string | null;
  "LOCATION V2": string | null;
  "STUDENT'S HOME IN THESE AREAS": string | null;
  "TUTOR'S HOME IN THESE AREAS": string | null;
  "Qualifications etc": string | null;
  "Years they started teaching": string | null;
  "Featured Subject": string | null;
  "School Boards Catered": string | null;
  "Phone Number": string | null;
  "Hero Image": string | null;
  "Classes Taught for Backend": string | null;
  "Classes Taught": string | null;
  Title: string | null;
  "Sir/Ma'am?": string | null;
  Area: string | null;
  "Link": string | null;
  Subjects: string | null;
  "Mode of Teaching": string | null;
  "Class Size (Group/ Solo)": string | null;
  "Min Fees": number | null;
  "Max Fees": number | null;
  Slug: string | null;
  /**
   * Self-service pause toggle (design_handoff_shikshaq/pages/TeacherDashboard.md "Pause listing").
   * Column added via supabase/migrations/20260812060000_add_is_paused_to_shikshaqmine.sql — this
   * migration has been applied to the live database, but src/integrations/supabase/types.ts has
   * not yet been regenerated, so the generated Shikshaqmine Row/Update types below still don't
   * know about it. Read/written below via `ShikshaqmineRowWithPause`/`ShikshaqmineUpdateWithPause`
   * (narrow additions of just this one column) instead of a blanket `as any`, same as the
   * pre-existing "Min Fees"/"Max Fees" handling in this file. Once the types are regenerated,
   * these two aliases and their casts can be dropped in favor of the real generated types.
   */
  is_paused: boolean;
}

type ShikshaqmineRow = Database['public']['Tables']['Shikshaqmine']['Row'];
type ShikshaqmineUpdate = Database['public']['Tables']['Shikshaqmine']['Update'];
/** `data` from a `Shikshaqmine` select, with the not-yet-generated `is_paused` column added. */
type ShikshaqmineRowWithPause = ShikshaqmineRow & { is_paused: boolean | null };
/** Payload for a `Shikshaqmine` update that includes the not-yet-generated `is_paused` column. */
type ShikshaqmineUpdateWithPause = ShikshaqmineUpdate & { is_paused: boolean };

// Profile form field/label/panel styling, on the token system so the long editable form below
// matches the rest of the page instead of falling back to shadcn's bare default input styling.
// Handoff TD-004: field height/radius and label treatment now follow JA-004's field pattern
// (h52 rounded-2xl bg-muted, 11.5px/700/.07em uppercase label) — panel-on-panel shadow dropped
// since these now sit inside a bg-card BentoPanel rather than directly on the page ground.
const FIELD_CLASSNAME =
  'h-[52px] rounded-2xl border-0 bg-muted px-4 text-base focus-visible:ring-0 focus-visible:ring-offset-0';
const LOCKED_FIELD_CLASSNAME = `${FIELD_CLASSNAME} cursor-not-allowed opacity-70`;
const LABEL_CLASSNAME = 'mb-1.5 block text-[12px] font-bold uppercase tracking-[.07em] text-warm-label';
const HELP_TEXT_CLASSNAME = 'text-xs text-muted-foreground';
/* The three option groups that use this (subjects, boards, classes) are
   wrapping checkbox chips -- 33 subjects alone, which is 12+ rows on a phone
   and comfortably past the old `max-h-48`. That made each one a nested scroll
   container on a touch page: a finger landing anywhere inside scrolled the
   chip list instead of the page, and the only way to keep scrolling the form
   was to find the narrow gutter beside it.
   Fixed by removing the cap below `lg` rather than by adding
   `overscroll-behavior: contain`, which would have made it worse -- contain
   stops the scroll chaining to the page, which is the one thing still letting
   a trapped user out. Desktop keeps the cap; there the form has room and a
   mouse wheel over a bounded list is the expected behaviour. */
const OPTION_GROUP_CLASSNAME = 'rounded-2xl bg-muted';

/** Normalizes a Shikshaqmine row into the dashboard's own TeacherData shape
 *  (phone-number cleanup included) — pulled out of the old fetch effect so
 *  the query below can call it directly. */
function normalizeTeacherRow(data: ShikshaqmineRowWithPause): TeacherData {
  let phoneNumber = data["Phone Number"] || null;
  if (phoneNumber) {
    const digits = phoneNumber.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) {
      phoneNumber = digits.slice(2);
    } else if (digits.length > 10) {
      phoneNumber = digits.slice(-10);
    } else if (digits.length === 10) {
      phoneNumber = digits;
    } else {
      phoneNumber = null;
    }
  }

  return {
    "Email ID": data["Email ID"] || null,
    Description: data["Description"] || null,
    "LOCATION V2": data["LOCATION V2"] || (data as any)["Location V2"] || null,
    "STUDENT'S HOME IN THESE AREAS": data["STUDENT'S HOME IN THESE AREAS"] || null,
    "TUTOR'S HOME IN THESE AREAS": data["TUTOR'S HOME IN THESE AREAS"] || null,
    "Qualifications etc": data["Qualifications etc"] || null,
    "Years they started teaching": data["Years they started teaching"] || null,
    "Featured Subject": data["Featured Subject"] || null,
    "School Boards Catered": data["School Boards Catered"] || null,
    "Phone Number": phoneNumber,
    "Hero Image": data["Hero Image"] || null,
    "Classes Taught for Backend": data["Classes Taught for Backend"] || null,
    "Classes Taught": data["Classes Taught"] || null,
    Title: data["Title"] || null,
    "Sir/Ma'am?": data["Sir/Ma'am?"] || null,
    Area: data["Area"] || null,
    "Link": data["Link"] || null,
    Subjects: data["Subjects"] || null,
    "Mode of Teaching": data["Mode of Teaching"] || null,
    "Class Size (Group/ Solo)": data["Class Size (Group/ Solo)"] || null,
    "Min Fees": data["Min Fees"] || null,
    "Max Fees": data["Max Fees"] || null,
    Slug: data["Slug"] || null,
    is_paused: Boolean(data["is_paused"]),
  };
}

export default function TeacherDashboard() {
  usePageMeta(
    'Your Teacher Dashboard | Shikshaq',
    'Edit your profile, pause your listing and see how many students have reached out.',
  );

  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /* `profiles` (email/role) used to be fetched independently four times in
     this file — the redirect guard, the main data load, pause-toggle, and
     save each ran their own `supabase.from('profiles')` call. One shared
     query now, everything else reads it. */
  const authProfileQuery = useQuery({
    queryKey: ['teacherAuthProfile', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('email, role')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
  const isTeacherWithEmail =
    authProfileQuery.data?.role === 'teacher' && !!authProfileQuery.data?.email;

  // Fetches the Shikshaqmine row by the profile's email — the actual
  // listing. `data === null` (not undefined) means the fetch completed and
  // genuinely found no matching row, distinct from "still loading".
  const shikshaqmineQuery = useQuery({
    queryKey: ['shikshaqmineByEmail', authProfileQuery.data?.email],
    queryFn: async () => {
      /* Two reads, not one. The contact columns AND this row's own id come
         through fetchOwnContact first, via teacher_own_contact() -- a
         SECURITY DEFINER function that resolves the caller from auth.uid()
         internally, so it can still read "Email ID" even though
         `authenticated` cannot. The bulk of the row is then fetched by id,
         never by "Email ID": Postgres requires SELECT on any column named in
         a WHERE clause, not just returned ones, so filtering this select on
         the revoked "Email ID" column would 42501 for every teacher now that
         migration 20260917120000 has run. (It has -- confirmed live via
         has_column_privilege('authenticated', 'Shikshaqmine', 'Email ID',
         'SELECT') = false.) The two reads can no longer run in parallel: the
         id the second one filters on comes from the first. */
      const contact = await fetchOwnContact(authProfileQuery.data!.email!);
      if (!contact?.id) return null;
      /* Not select('*'): migration 20260918100000 revoked table-level SELECT
         on Shikshaqmine from `authenticated` outright and re-granted it on
         a named column subset only (contact columns excluded on purpose,
         supplied by fetchOwnContact above instead). That is the opposite
         shape from "full grant, columns individually revoked" -- here
         select('*') does not silently drop what it can't read, it 401s the
         WHOLE request (verified directly against the REST endpoint: 42501
         permission denied), which `if (error) throw error` below then threw
         for every teacher opening their own dashboard. */
      /* Cast to `any`: this column list is too long for supabase-js's
         compile-time select-string parser to resolve into a usable row type
         (same as Browse.tsx's own SHIKSHAQ_COLUMNS pattern). */
      const { data, error } = await (supabase
        .from('Shikshaqmine')
        .select(
          '"Area","Class Size (Group/ Solo)","Classes Taught","Classes Taught for Backend",' +
          '"Description","EXPANDED","Featured","Featured Subject","Hero Image","LOCATION V2",' +
          '"MOU","Max Fees","Min Fees","Mode of Teaching","Place of Teaching","Qualifications etc",' +
          '"Review 1","Review 2","Review 3","STUDENT\'S HOME IN THESE AREAS","School Boards Catered",' +
          '"Sir/Ma\'am?","Slug","Subjects","TUTOR\'S HOME IN THESE AREAS","Title","Video","Video Link",' +
          '"Years they started teaching",id,is_paused'
        ) as any)
        .eq('id', contact.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const merged = {
        ...(data as Record<string, unknown>),
        'Phone Number': contact.phoneNumber ?? (data as Record<string, unknown>)['Phone Number'] ?? null,
        Link: contact.link ?? (data as Record<string, unknown>).Link ?? null,
      };
      return normalizeTeacherRow(merged as ShikshaqmineRowWithPause);
    },
    enabled: isTeacherWithEmail,
  });
  // profile.email didn't match any "Email ID" in Shikshaqmine — surfaced so the
  // teacher has something concrete to give support instead of a dead-end toast.
  const lookupFailedEmail =
    shikshaqmineQuery.data === null ? authProfileQuery.data!.email : null;

  const loading =
    !!user && (authProfileQuery.isPending || (isTeacherWithEmail && shikshaqmineQuery.isPending));

  useEffect(() => {
    if (shikshaqmineQuery.isError && import.meta.env.DEV) {
      console.error('Error fetching teacher data:', shikshaqmineQuery.error);
    }
  }, [shikshaqmineQuery.isError, shikshaqmineQuery.error]);

  // Editable copy of the fetched listing — everything below (handleInputChange,
  // the whole form) reads/writes this exactly as it did before. Only its
  // SOURCE changed: re-seeded whenever a fresh fetch lands (first load, or a
  // future invalidation), left alone the rest of the time — same
  // "editable copy, not a live query read" reasoning as Account.tsx.
  const [teacherData, setTeacherData] = useState<TeacherData | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  useEffect(() => {
    if (!shikshaqmineQuery.data) return;
    setTeacherData(shikshaqmineQuery.data);
    setImagePreview(shikshaqmineQuery.data["Hero Image"]);
    setIsPaused(shikshaqmineQuery.data.is_paused);
  }, [shikshaqmineQuery.data]);

  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [pausing, setPausing] = useState(false);
  const profileFormRef = useRef<HTMLDivElement>(null);

  // Handoff TD: this route renders its own eyes panel, replacing AppShell's
  // default pre-footer (same pattern as Account.tsx's AC-007).
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();

  // Redirect if not authenticated or not a teacher — reads the one shared
  // authProfileQuery instead of running its own profiles.role fetch.
  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
      return;
    }
    if (!loading && authProfileQuery.data && authProfileQuery.data.role !== 'teacher') {
      navigate('/');
    }
  }, [user, loading, authProfileQuery.data, navigate]);

  // Real "Upvotes"/"Reviews" stat-card counts, plus the reviews list itself,
  // as one query: teacher_upvotes/teacher_comments both key off
  // teachers_list.id (not the Shikshaqmine row), so this looks that id up by
  // slug first, then reads counts and the review rows off it. Was two
  // separate effects (fetchCounts calling fetchReviewsList inline) plus a
  // reviewsRetryKey counter to force a re-run — replaced by one query and
  // its own .refetch().
  const listingStatsQuery = useQuery({
    queryKey: ['teacherListingStats', teacherData?.Slug],
    queryFn: async () => {
      const slug = teacherData!.Slug!;
      const { data: listRow, error: listError } = await supabase
        .from('teachers_list')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (listError) throw listError;

      if (!listRow) return { upvoteCount: null, reviewCount: null, reviews: [] as ReviewCardData[] };

      const [{ count: upvotes }, { count: reviewsCount }] = await Promise.all([
        supabase.from('teacher_upvotes').select('id', { count: 'exact', head: true }).eq('teacher_id', listRow.id),
        supabase.from('teacher_comments').select('id', { count: 'exact', head: true }).eq('teacher_id', listRow.id).eq('approved', true),
      ]);

      // Reviews list — this teacher's own approved reviews, read through the same
      // teacher_comments_public + public_profiles pairing TeacherComments.tsx uses (RLS on
      // teacher_comments hides user_id from anon reads, and public_profiles avoids exposing PII).
      const { data: commentsData, error: commentsError } = await supabase
        .from('teacher_comments_public')
        .select('id, comment, rating, created_at, user_id, is_anonymous, approved')
        .eq('teacher_id', listRow.id)
        .eq('approved', true)
        .order('created_at', { ascending: false })
        .limit(10);
      if (commentsError) throw commentsError;

      const rows = commentsData || [];
      const userIds = [...new Set(rows.map((c) => c.user_id).filter(Boolean))] as string[];

      const profilesMap = new Map<string, { full_name: string | null; role: string | null; school_college: string | null; grade: string | null }>();
      if (userIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('public_profiles')
          .select('id, full_name, role, school_college, grade')
          .in('id', userIds);
        if (profilesError) throw profilesError;
        (profilesData || []).forEach((p) => profilesMap.set(p.id, p));
      }

      const featuredSubject = teacherData?.["Featured Subject"] || null;
      const cards: ReviewCardData[] = rows.map((c) => {
        const profile = c.user_id ? profilesMap.get(c.user_id) : undefined;
        const name = c.is_anonymous ? 'Anonymous' : profile?.full_name || 'Anonymous';
        const infoParts: string[] = [];
        if (!c.is_anonymous) {
          if (profile?.role === 'guardian') infoParts.push('Guardian');
          else if (profile?.role === 'student') {
            if (profile.school_college) infoParts.push(profile.school_college);
            if (profile.grade) infoParts.push(`Grade ${profile.grade}`);
          }
        }
        const initial = c.is_anonymous
          ? 'A'
          : profile?.full_name
            ? profile.full_name.trim().charAt(0).toUpperCase() || 'U'
            : 'U';

        return {
          id: c.id,
          quote: c.comment,
          subject: featuredSubject,
          className: null,
          gain: null,
          initial,
          who: [name, infoParts.join(' · ')].filter(Boolean).join(' · '),
          when: new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
          rating: c.rating,
        };
      });

      return { upvoteCount: upvotes ?? 0, reviewCount: reviewsCount ?? 0, reviews: cards };
    },
    enabled: !!teacherData?.Slug,
  });
  const upvoteCount = listingStatsQuery.data?.upvoteCount ?? null;
  const reviewCount = listingStatsQuery.data?.reviewCount ?? null;
  const reviews = listingStatsQuery.data?.reviews ?? [];
  const reviewsLoading = !!teacherData?.Slug && listingStatsQuery.isPending;
  const reviewsError = listingStatsQuery.isError ? 'Failed to load reviews' : null;

  // Real WhatsApp-tap count for this listing (Handoff TD-003 follow-up: the
  // whatsapp_clicks table now exists). The table's select RLS policy scopes
  // rows to the signed-in teacher's own slug via Shikshaqmine, so this can
  // only ever return this teacher's own count, never another teacher's.
  const whatsappClicksQuery = useQuery({
    queryKey: ['whatsappClickCount', teacherData?.Slug],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('whatsapp_clicks')
        .select('id', { count: 'exact', head: true })
        .eq('teacher_slug', teacherData!.Slug!);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!teacherData?.Slug,
  });
  const whatsappClickCount = whatsappClicksQuery.data ?? null;

  // Real profile-view count (Enquiries' sibling metric) -- see
  // profileViewLog.ts. Same RLS shape as whatsapp_clicks: this can only ever
  // return this teacher's own count, never another teacher's.
  const profileViewsQuery = useQuery({
    queryKey: ['profileViewCount', teacherData?.Slug],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('profile_views')
        .select('id', { count: 'exact', head: true })
        .eq('teacher_slug', teacherData!.Slug!);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!teacherData?.Slug,
  });
  const profileViewCount = profileViewsQuery.data ?? null;

  // "Pause your listing" — flips the self-service is_paused flag (see the TeacherData interface
  // note above), reverting on failure. Browse/search now filter on is_paused too (see Browse.tsx),
  // so pausing here does hide the profile from public results, not just this dashboard's pill.
  // O-013 ⚠ "used only for irreversible actions": this used to be gated behind an
  // AlertDialog, but pausing is reversible in one tap — the dialog's own copy said so —
  // so it applies immediately and offers a toast with Undo instead. That is the same
  // resolution AD-005 already spells out for the admin roster's identical control, and
  // the same pattern admin/teachers.tsx implements. The mutation itself is unchanged;
  // only how consent is gathered has. Undo just calls this again — the toggle is
  // idempotent in both directions.
  const handlePauseToggle = async () => {
    if (!user || !teacherData) return;
    // Was its own supabase.from('profiles') fetch — now the one shared
    // authProfileQuery every other email lookup in this file reads too.
    const email = authProfileQuery.data?.email;
    if (!email) return;

    const nextPaused = !isPaused;
    const previousPaused = isPaused;
    setIsPaused(nextPaused); // optimistic
    setPausing(true);

    try {
      const { error } = await supabase
        .from('Shikshaqmine')
        .update({ is_paused: nextPaused } as ShikshaqmineUpdateWithPause)
        /* Filtered by id, not by "Email ID". Postgres requires SELECT on any
           column named in a WHERE clause, and migration 20260917120000 revokes
           that column -- so this filter would start failing while the UPDATE
           privilege itself was untouched. "Slug" stays granted either side. */
        .eq('Slug', teacherData!.Slug!);

      if (error) throw error;

      setTeacherData((prev) => (prev ? { ...prev, is_paused: nextPaused } : prev));
      toast.success(nextPaused ? 'Listing paused.' : 'Listing resumed.', {
        description: nextPaused
          ? 'Hidden from Browse and search results.'
          : 'Visible in Browse and search results again.',
        action: { label: 'Undo', onClick: () => { void handlePauseToggle(); } },
      });
    } catch (error) {
      setIsPaused(previousPaused);
      if (import.meta.env.DEV) {
        console.error('Error toggling pause state:', error);
      }
      toast.error("Couldn't update your listing status. Try again shortly.");
    } finally {
      setPausing(false);
    }
  };

  // "Request a review" — copies the teacher's public profile link so they can send it to a
  // current student. No new backend: the review form students use already lives on that page.
  const handleRequestReview = async () => {
    const slug = teacherData?.Slug;
    if (!slug) {
      toast.error('Add your profile details first.');
      return;
    }
    const url = `${window.location.origin}/tuition-teachers/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Review link copied.');
    } catch {
      toast.error('Could not copy the link. Copy it from your profile page instead.');
    }
  };

  const scrollToProfileForm = () => {
    profileFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Helper function to check if value exists in comma-separated string
  const valueExistsInString = (str: string | null, value: string): boolean => {
    if (!str) return false;
    return str.split(',').some((item) => item.trim() === value);
  };

  const handleInputChange = (field: keyof TeacherData, value: string | null) => {
    setTeacherData((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, [field]: value };

      // Auto-clear Featured Subject if it's no longer in the selected Subjects
      if (field === "Subjects") {
        const selectedSubjects = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
        if (updated["Featured Subject"] && !selectedSubjects.includes(updated["Featured Subject"])) {
          updated["Featured Subject"] = null;
        }
      }

      // Auto-update Classes Taught when Classes Taught for Backend changes
      if (field === "Classes Taught for Backend") {
        const romanClasses = convertClassesToRoman(value);
        updated["Classes Taught"] = romanClasses;
      }

      // Auto-generate WhatsApp link when Phone Number changes
      if (field === "Phone Number") {
        if (value && value.trim()) {
          // Extract only digits from phone number
          const phoneDigits = value.replace(/\D/g, '');
          // If it's exactly 10 digits, generate WhatsApp link
          if (phoneDigits.length === 10) {
            updated["Link"] = `https://wa.me/91${phoneDigits}`;
          } else if (phoneDigits.length > 10) {
            // If more than 10 digits, take the last 10
            const last10Digits = phoneDigits.slice(-10);
            updated["Link"] = `https://wa.me/91${last10Digits}`;
          } else {
            // If less than 10 digits, clear the WhatsApp link
            updated["Link"] = null;
          }
        } else {
          // If phone number is cleared, clear WhatsApp link
          updated["Link"] = null;
        }
      }

      // Clear areas when Location V2 changes
      if (field === "LOCATION V2") {
        const locationV2 = value as string | null;
        // If switching to "TEACHER'S HOME TUTORING", clear student's home areas
        if (locationV2 === "TEACHER'S HOME TUTORING") {
          updated["STUDENT'S HOME IN THESE AREAS"] = null;
        }
        // If switching to "STUDENT'S HOME TUTORING ONLY", clear tutor's home areas
        if (locationV2 === "STUDENT'S HOME TUTORING ONLY") {
          updated["TUTOR'S HOME IN THESE AREAS"] = null;
        }
      }

      return updated;
    });
  };

  // "Min Fees"/"Max Fees" are the only numeric fields on TeacherData — handleInputChange above is
  // typed for the string fields that make up the rest of the form, so this is a small dedicated
  // setter for the two numeric ones rather than widening handleInputChange's value type (which
  // would remove the string narrowing that its Subjects/Classes Taught/Phone Number branches rely on).
  const handleFeeChange = (field: 'Min Fees' | 'Max Fees', value: number | null) => {
    setTeacherData((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleMultiSelectChange = (field: keyof TeacherData, value: string, checked: boolean) => {
    if (!teacherData) return;

    const currentValue = teacherData[field] as string | null;
    const currentArray = currentValue ? currentValue.split(',').map((v) => v.trim()) : [];

    let newArray: string[];
    if (checked) {
      newArray = [...currentArray, value].filter((v) => v !== '');
    } else {
      newArray = currentArray.filter((v) => v !== value);
    }

    handleInputChange(field, newArray.join(', ') || null);
  };

  // Helper function to check if form is valid
  const isFormValid = (): boolean => {
    if (!teacherData) return false;

    // Check phone number (must be 10 digits)
    if (!teacherData["Phone Number"] || teacherData["Phone Number"].replace(/\D/g, '').length !== 10) {
      return false;
    }

    // Check Location V2 (Place of Teaching)
    if (!teacherData["LOCATION V2"]) {
      return false;
    }

    // Check areas based on Location V2
    const locationV2 = teacherData["LOCATION V2"];
    if (locationV2 === "STUDENT'S HOME TUTORING ONLY" || locationV2 === "BOTH OPTIONS LISTED") {
      if (!teacherData["STUDENT'S HOME IN THESE AREAS"] || !teacherData["STUDENT'S HOME IN THESE AREAS"].trim()) {
        return false;
      }
    }

    if (locationV2 === "TEACHER'S HOME TUTORING" || locationV2 === "BOTH OPTIONS LISTED") {
      if (!teacherData["TUTOR'S HOME IN THESE AREAS"] || !teacherData["TUTOR'S HOME IN THESE AREAS"].trim()) {
        return false;
      }
    }

    // Check Subjects (required)
    if (!teacherData.Subjects || !teacherData.Subjects.trim()) {
      return false;
    }

    // Check School Boards Catered (required)
    if (!teacherData["School Boards Catered"] || !teacherData["School Boards Catered"].trim()) {
      return false;
    }

    // Check Classes Taught (required)
    if (!teacherData["Classes Taught for Backend"] || !teacherData["Classes Taught for Backend"].trim()) {
      return false;
    }

    // Check Mode of Teaching (required)
    if (!teacherData["Mode of Teaching"] || !teacherData["Mode of Teaching"].trim()) {
      return false;
    }

    // Check Class Size (required)
    if (!teacherData["Class Size (Group/ Solo)"] || !teacherData["Class Size (Group/ Solo)"].trim()) {
      return false;
    }

    return true;
  };

  const handleImageUpload = async (file: File) => {
    if (!user || !teacherData) return;

    try {
      setUploadingImage(true);

      // Get old image URL before uploading new one
      const oldImageUrl = teacherData["Hero Image"];

      // Compress image before upload
      const options = {
        maxSizeMB: 1, // Maximum size in MB (1MB)
        maxWidthOrHeight: 1920, // Maximum width or height
        useWebWorker: true, // Use web worker for better performance
        fileType: file.type, // Preserve original file type
      };

      let compressedFile: File;
      try {
        compressedFile = await imageCompression(file, options);
        if (import.meta.env.DEV) {
          const originalSize = (file.size / 1024 / 1024).toFixed(2);
          const compressedSize = (compressedFile.size / 1024 / 1024).toFixed(2);
          logger.log(`Image compressed: ${originalSize}MB → ${compressedSize}MB`);
        }
      } catch (compressionError) {
        if (import.meta.env.DEV) {
          console.warn('Image compression failed, using original file:', compressionError);
        }
        // If compression fails, use original file
        compressedFile = file;
      }

      // Create a unique filename (use .jpg for compressed images to ensure compatibility)
      const fileExt = 'jpg'; // Use jpg for better compression
      const fileName = `hero-images/${user.id}-${Date.now()}.${fileExt}`;

      // Upload compressed image to Supabase Storage
      const { data, error } = await supabase.storage
        .from('hero-images')
        .upload(fileName, compressedFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'image/jpeg' // Set content type for compressed images
        });

      if (error) {
        toast.error('Image upload failed. Please check storage setup.');
        if (import.meta.env.DEV) {
          console.error('Upload error:', error);
        }
        return;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('hero-images')
        .getPublicUrl(data.path);

      // Sanitize the URL
      const sanitizedUrl = sanitizeImageUrl(publicUrl);
      if (sanitizedUrl) {
        handleInputChange("Hero Image", sanitizedUrl);
        setImagePreview(sanitizedUrl);

        // Delete old image from storage if it exists in the bucket
        if (oldImageUrl && oldImageUrl.includes('hero-images')) {
          // Extract the file path from the URL
          // URL format: https://[project].supabase.co/storage/v1/object/public/hero-images/[path]
          // Or: https://[project].supabase.co/storage/v1/object/sign/hero-images/[path]
          let oldFilePath: string | null = null;

          // Try multiple URL patterns
          // Pattern 1: /hero-images/[filename]
          const urlMatch1 = oldImageUrl.match(/\/hero-images\/([^?#]+)/);
          if (urlMatch1 && urlMatch1[1]) {
            oldFilePath = `hero-images/${urlMatch1[1]}`;
          }

          // Pattern 2: If URL contains the full path already
          if (!oldFilePath && oldImageUrl.includes('/storage/v1/object/public/hero-images/')) {
            const parts = oldImageUrl.split('/hero-images/');
            if (parts.length > 1) {
              const filename = parts[1].split('?')[0].split('#')[0]; // Remove query params and hash
              oldFilePath = `hero-images/${filename}`;
            }
          }

          // Only delete if it's the teacher's own file (contains their user ID)
          if (oldFilePath && oldFilePath.includes(user.id)) {
            try {
              // The remove function expects paths relative to the bucket root
              // If oldFilePath is "hero-images/user-id-123.jpg", we need just "user-id-123.jpg"
              // But if it's already just "user-id-123.jpg", use it as is
              let pathToDelete = oldFilePath;
              if (oldFilePath.startsWith('hero-images/')) {
                pathToDelete = oldFilePath.replace('hero-images/', '');
              }

              const { error: deleteError } = await supabase.storage
                .from('hero-images')
                .remove([pathToDelete]);

              if (deleteError) {
                if (import.meta.env.DEV) {
                  console.warn('Error deleting old image:', deleteError);
                  console.warn('Attempted to delete path:', pathToDelete);
                  console.warn('Original URL:', oldImageUrl);
                }
                // Don't show error to user - old image deletion is not critical
              } else if (import.meta.env.DEV) {
                logger.log('Successfully deleted old image:', pathToDelete);
              }
            } catch (deleteErr) {
              if (import.meta.env.DEV) {
                console.warn('Error deleting old image:', deleteErr);
              }
            }
          } else if (import.meta.env.DEV && oldImageUrl.includes('hero-images')) {
            console.warn('Could not extract file path from URL or file does not belong to user:', oldImageUrl);
            console.warn('Extracted path:', oldFilePath);
            console.warn('User ID:', user.id);
          }
        }

        toast.success('Image uploaded successfully');
      } else {
        toast.error('Failed to generate valid image URL');
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error uploading image:', error);
      }
      toast.error('Failed to upload image.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file');
        return;
      }

      // Block HEIC/HEIF formats which most browsers can't display
      const lowerName = file.name.toLowerCase();
      const isHeicLike =
        lowerName.endsWith('.heic') ||
        lowerName.endsWith('.heif') ||
        file.type === 'image/heic' ||
        file.type === 'image/heif';
      if (isHeicLike) {
        toast.error('HEIC images are not supported. Please upload a JPG or PNG image instead.');
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image size must be less than 5MB');
        return;
      }
      handleImageUpload(file);
    }
  };

  const handleSave = async () => {
    if (!user || !teacherData) return;

    // Validate required fields
    if (!teacherData["Phone Number"] || teacherData["Phone Number"].replace(/\D/g, '').length !== 10) {
      toast.error('Phone number must be exactly 10 digits');
      return;
    }

    if (!teacherData["LOCATION V2"]) {
      toast.error('Place of Teaching is required');
      return;
    }

    // Validate areas based on Location V2
    const locationV2 = teacherData["LOCATION V2"];
    if (locationV2 === "STUDENT'S HOME TUTORING ONLY" || locationV2 === "BOTH OPTIONS LISTED") {
      if (!teacherData["STUDENT'S HOME IN THESE AREAS"] || !teacherData["STUDENT'S HOME IN THESE AREAS"].trim()) {
        toast.error('Student\'s Home in These Areas is required');
        return;
      }
    }

    if (locationV2 === "TEACHER'S HOME TUTORING" || locationV2 === "BOTH OPTIONS LISTED") {
      if (!teacherData["TUTOR'S HOME IN THESE AREAS"] || !teacherData["TUTOR'S HOME IN THESE AREAS"].trim()) {
        toast.error('Tutor\'s Home in These Areas is required');
        return;
      }
    }

    // Validate Subjects (required)
    if (!teacherData.Subjects || !teacherData.Subjects.trim()) {
      toast.error('Please select at least one subject');
      return;
    }

    // Validate School Boards Catered (required)
    if (!teacherData["School Boards Catered"] || !teacherData["School Boards Catered"].trim()) {
      toast.error('Please select at least one school board');
      return;
    }

    // Validate Classes Taught (required)
    if (!teacherData["Classes Taught for Backend"] || !teacherData["Classes Taught for Backend"].trim()) {
      toast.error('Please select at least one class');
      return;
    }

    // Validate Mode of Teaching (required)
    if (!teacherData["Mode of Teaching"] || !teacherData["Mode of Teaching"].trim()) {
      toast.error('Please select a mode of teaching');
      return;
    }

    // Validate Class Size (required)
    if (!teacherData["Class Size (Group/ Solo)"] || !teacherData["Class Size (Group/ Solo)"].trim()) {
      toast.error('Please select structure of classes');
      return;
    }

    setSaving(true);

    try {
      // Was its own supabase.from('profiles') fetch (the third of four in
      // this file) — now the one shared authProfileQuery.
      const profile = authProfileQuery.data;

      if (!profile?.email) {
        toast.error(
          "We couldn't find an email on your account, so we can't save your listing. Contact ngo.aquaterra@gmail.com for help."
        );
        setSaving(false);
        return;
      }

      // Normalize phone number to 10 digits before saving
      let normalizedPhoneNumber: string | null = null;
      if (teacherData["Phone Number"]) {
        const digits = teacherData["Phone Number"].replace(/\D/g, '');
        if (digits.length === 10) {
          normalizedPhoneNumber = digits;
        } else if (digits.length > 10) {
          // Take last 10 digits
          normalizedPhoneNumber = digits.slice(-10);
        } else if (digits.length === 12 && digits.startsWith('91')) {
          // Remove 91 prefix
          normalizedPhoneNumber = digits.slice(2);
        }
      }

      // Auto-generate WhatsApp link if phone number is valid
      let whatsappLink: string | null = teacherData["Link"] || null;
      if (normalizedPhoneNumber && normalizedPhoneNumber.length === 10) {
        whatsappLink = `https://wa.me/91${normalizedPhoneNumber}`;
      } else if (!normalizedPhoneNumber) {
        whatsappLink = null;
      }

      // Prepare update data
      // Use profile email (locked field) instead of teacherData email
      const updateData: Partial<ShikshaqmineUpdateWithPause> = {
        "Email ID": profile.email, // Use locked email from profile
        Description: teacherData["Description"] || null,
        "LOCATION V2": teacherData["LOCATION V2"] || null,
        "STUDENT'S HOME IN THESE AREAS": teacherData["STUDENT'S HOME IN THESE AREAS"] || null,
        "TUTOR'S HOME IN THESE AREAS": teacherData["TUTOR'S HOME IN THESE AREAS"] || null,
        "Qualifications etc": teacherData["Qualifications etc"] || null,
        "Years they started teaching": teacherData["Years they started teaching"] || null,
        "Featured Subject": teacherData["Featured Subject"] || null,
        "School Boards Catered": teacherData["School Boards Catered"] || null,
        "Phone Number": normalizedPhoneNumber,
        "Hero Image": teacherData["Hero Image"] || null,
        "Classes Taught for Backend": teacherData["Classes Taught for Backend"] || null,
        "Classes Taught": convertClassesToRoman(teacherData["Classes Taught for Backend"]) || null, // always write computed value to DB
        "Link": whatsappLink,
        Subjects: teacherData.Subjects || null,
        "Mode of Teaching": teacherData["Mode of Teaching"] || null,
        "Class Size (Group/ Solo)": teacherData["Class Size (Group/ Solo)"] || null,
        "Min Fees": teacherData["Min Fees"] || null,
        "Max Fees": teacherData["Max Fees"] || null,
      };

      // teacherData is the already-loaded row this form is editing, so its
      // Slug is already known -- no need for a second round trip to fetch it
      // again, and no need to filter that round trip by the revoked
      // "Email ID" column the way this used to (see shikshaqmineQuery above
      // for why that 42501s for every teacher now).
      const { error } = await supabase
        .from('Shikshaqmine')
        .update(updateData)
        // "Slug", not "Email ID" -- see the pause toggle above for why.
        .eq('Slug', teacherData!.Slug!);

      if (error) {
        if (import.meta.env.DEV) {
          console.error('Error updating teacher data:', error);
        }
        toast.error('Failed to update profile. Please try again, or contact ngo.aquaterra@gmail.com if it persists.');
        setSaving(false);
        return;
      }

      // Invalidate cache for this teacher's profile
      if (teacherData!.Slug) {
        invalidateTeacherCache(teacherData!.Slug);
      }

      // Invalidate featured teachers cache (they might appear on browse/home)
      removeCache('featured_teachers_browse');
      removeCache('featured_teachers_index');

      // Clear all Shikshaqmine chunk caches
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.includes('shikshaq_cache_') && key.includes('shikshaqmine')) {
          localStorage.removeItem(key);
        }
      });
      // react-query's own cache, separate from the bespoke localStorage layer
      // above (that one serves Browse/featured-teachers' public reads; this
      // one is this dashboard's own fetch). teacherData already reflects the
      // save locally, so nothing re-renders differently — this just keeps a
      // later remount from serving a stale cached row.
      queryClient.invalidateQueries({ queryKey: ['shikshaqmineByEmail', profile.email] });

      toast.success('Profile updated successfully');
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error saving:', error);
      }
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <BentoStack>
          <BentoPanel fill="dark" edge="top" className="px-[22px] pt-[14px] pb-[22px]">
            <div className="flex animate-pulse items-center gap-[14px]">
              <div className="h-16 w-16 flex-none rounded-full bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-40 rounded-full bg-white/10" />
                <div className="h-3 w-28 rounded-full bg-white/10" />
              </div>
            </div>
          </BentoPanel>
          <div className="flex gap-seam">
            {[...Array(2)].map((_, i) => (
              <BentoPanel key={i} fill="card" className="flex-1 animate-pulse px-[14px] py-4 lg:p-6">
                <div className="h-6 w-10 rounded-full bg-muted" />
                <div className="mt-2 h-3 w-16 rounded-full bg-muted" />
              </BentoPanel>
            ))}
          </div>
          <BentoPanel fill="card" className="p-[22px]">
            <div className="animate-pulse space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 rounded-2xl bg-muted" />
              ))}
            </div>
          </BentoPanel>
        </BentoStack>
      </div>
    );
  }

  if (!teacherData) {
    // Email-match failure: profile.email had no matching "Email ID" row in Shikshaqmine. Give the
    // teacher a concrete next step — their account email to quote to support — rather than a
    // generic "account required" dead end.
    if (lookupFailedEmail) {
      return (
        <div className="min-h-screen bg-background">
          <PageContainer as="main" className="py-16 pb-16 text-center sm:py-20">
            <h1 className="font-display text-page-title font-extrabold tracking-tight text-foreground">
              We couldn't find your teacher listing
            </h1>
            <p className="mt-3 text-body-secondary text-muted-foreground">
              Your account email doesn't match any listing in our system, so we can't load your
              profile. This usually means your listing was created under a different email address.
            </p>
            <p className="mt-4 text-sm font-semibold text-foreground">
              Contact support at{' '}
              <a href="mailto:ngo.aquaterra@gmail.com" className="text-brand underline underline-offset-2">
                ngo.aquaterra@gmail.com
              </a>{' '}
              and include this email:
            </p>
            <p className="mt-1 text-sm font-semibold text-brand">{lookupFailedEmail}</p>
            <Button variant="primary" size={46} className="mt-6" onClick={() => navigate('/')}>
              Go Home
            </Button>
          </PageContainer>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background">
        <PageContainer as="main" className="py-16 pb-16 text-center sm:py-20">
          <h1 className="font-display text-page-title font-extrabold tracking-tight text-foreground">
            {user ? 'Teacher account required' : 'Sign in required'}
          </h1>
          <p className="mt-3 text-body-secondary text-muted-foreground">
            {user
              ? "We couldn't find a teacher profile for your account. If you believe this is a mistake, contact support."
              : 'Please sign in to view your dashboard.'}
          </p>
          <Button variant="primary" size={46} className="mt-6" onClick={() => navigate(user ? '/' : '/auth')}>
            {user ? 'Go Home' : 'Sign In'}
          </Button>
        </PageContainer>
      </div>
    );
  }

  // Get user email and name (locked fields)
  const userEmail = user?.email || teacherData["Email ID"] || '';
  const userName = teacherData["Title"] || user?.user_metadata?.full_name || '';

  // "{name}, {honorific}" per TeacherDashboard.md's header, same rule TeacherCard.tsx uses:
  // omit the comma entirely when there's no recognisable honorific.
  const honorific = teacherData["Sir/Ma'am?"];
  const displayName = (() => {
    const name = userName || 'Your profile';
    if (!honorific) return name;
    const lower = String(honorific).toLowerCase().trim();
    let h: string | null = null;
    if (lower === 'sir' || lower.includes('sir')) h = 'Sir';
    else if (lower === "ma'am" || lower === 'maam' || lower.includes("ma'am")) h = "Ma'am";
    return h ? `${name}, ${h}` : name;
  })();

  // Handoff TD-002: two real counters, both live queries — never a third,
  // never a derived/fabricated one (see the TD-003 note below on Enquiries).
  const teacherStats: { label: string; value: number | string }[] = [
    { label: 'Upvotes', value: upvoteCount ?? '-' },
    { label: 'Reviews', value: reviewCount ?? '-' },
  ];

  // Handoff TD-004: profile-completeness bar with a missing-fields sentence —
  // same treatment as GD-002. Derived from already-loaded teacherData, no new
  // fetching. Mirrors the required-field checklist isFormValid() already uses,
  // plus the two optional fields (description, hero image) that most affect
  // how complete a listing feels.
  const completenessChecks: { ok: boolean; label: string }[] = [
    { ok: Boolean(teacherData["Hero Image"]), label: 'photo' },
    { ok: Boolean(teacherData["Description"]), label: 'introduction' },
    { ok: Boolean(teacherData["Phone Number"]), label: 'phone' },
    { ok: Boolean(teacherData["LOCATION V2"]), label: 'place of teaching' },
    { ok: Boolean(teacherData.Subjects), label: 'subjects' },
    { ok: Boolean(teacherData["School Boards Catered"]), label: 'boards' },
    { ok: Boolean(teacherData["Classes Taught for Backend"]), label: 'classes' },
    { ok: Boolean(teacherData["Mode of Teaching"]), label: 'mode of teaching' },
    { ok: Boolean(teacherData["Class Size (Group/ Solo)"]), label: 'class structure' },
    { ok: Boolean(teacherData["Min Fees"]), label: 'fee' },
    { ok: Boolean(teacherData["Qualifications etc"]), label: 'qualifications' },
  ];
  const completenessFilled = completenessChecks.filter((c) => c.ok).length;
  const completenessTotal = completenessChecks.length;
  const completenessPct = Math.round((completenessFilled / completenessTotal) * 100);
  const missingLabels = completenessChecks.filter((c) => !c.ok).map((c) => c.label);

  // Handoff TD-003 follow-up: whatsapp_clicks now exists, so this is a real
  // live count, not a fabricated one — same "real number or say why not"
  // rule as before, just with the table it used to be missing.

  // Handoff TD-001: the status pill reflects the real row state (is_paused) —
  // never a hardcoded "Live". There is no separate verification-pending state
  // in the data today, so only the two real states are rendered.
  const statusLabel = isPaused ? 'Paused' : 'Live and verified';

  return (
    <div className="min-h-screen bg-background">
      <main>
        <BentoStack>
          {/* Handoff TD-001: near-black header — the other side of the product,
              so it should not look like a parent's dashboard. */}
          <BentoPanel fill="dark" edge="top" className="overflow-visible px-[22px] pt-[14px] pb-[22px]">
            <div className="flex items-center gap-[14px]">
              <div className="h-16 w-16 flex-none overflow-hidden rounded-full bg-muted">
                {imagePreview ? (
                  <img
                    src={validateImageSrc(imagePreview)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <StripePlaceholder name={displayName} initialSize={24} className="h-full w-full" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold uppercase tracking-[.04em] text-white/50">Your listing</p>
                <h1 className="mt-[3px] truncate font-display text-[24px] font-extrabold tracking-[-0.04em] text-background">
                  {displayName}
                </h1>
                <div
                  className={`mt-1.5 inline-flex h-7 items-center gap-[8px] rounded-full px-3 text-[12px] font-extrabold ${
                    isPaused ? 'bg-muted text-warm-secondary' : 'bg-mint-solid text-[#0B3D1F]'
                  }`}
                >
                  <Check className="h-[13px] w-[13px]" strokeWidth={2.5} aria-hidden="true" />
                  {statusLabel}
                </div>
              </div>
            </div>
          </BentoPanel>

          {/* Handoff TD-002: two real counters, nothing else. */}
          <div className="flex gap-seam">
            {teacherStats.map((st) => (
              <BentoPanel key={st.label} fill="card" className="flex-1 px-[14px] py-4 lg:p-6">
                <div className="font-display text-[26px] font-black tracking-[-0.04em] text-foreground tabular-nums">
                  {st.value}
                </div>
                <div className="mt-0.5 text-[12px] font-bold uppercase tracking-[.04em] text-warm-label">
                  {st.label}
                </div>
              </BentoPanel>
            ))}
          </div>

          {/* Profile views: same real-number-or-say-why-not rule as Enquiries
              below, and its funnel predecessor -- a view can happen with no
              enquiry, so it gets its own panel rather than folding into the
              two-stat-card row above (Handoff TD-002 is explicit: never a
              third counter there). See profileViewLog.ts. */}
          <BentoPanel fill="muted" className="px-[22px] py-5">
            <div className="flex items-center gap-[10px]">
              <IconDisc tone="muted" size={32} shape="square" className="bg-border">
                <Eye className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </IconDisc>
              <h2 className="text-[16px] font-bold tracking-[-0.02em] text-foreground">Profile views</h2>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-display text-[26px] font-black tracking-[-0.04em] text-foreground tabular-nums">
                {profileViewsQuery.isPending ? '-' : profileViewCount}
              </span>
              <span className="text-[13px] font-semibold text-warm-secondary">people looked at your listing</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-[1.55] text-warm-secondary">
              How many times your profile page has loaded, since your listing went live. Only you can see this number.
            </p>
          </BentoPanel>

          {/* Handoff TD-003 follow-up: real WhatsApp-tap count, same visual
              language as the Upvotes/Reviews cards above rather than a plain
              sentence, since it's a number now. */}
          <BentoPanel fill="muted" className="px-[22px] py-5">
            <div className="flex items-center gap-[10px]">
              <IconDisc tone="muted" size={32} shape="square" className="bg-border">
                <Info className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </IconDisc>
              <h2 className="text-[16px] font-bold tracking-[-0.02em] text-foreground">Enquiries</h2>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-display text-[26px] font-black tracking-[-0.04em] text-foreground tabular-nums">
                {whatsappClicksQuery.isPending ? '-' : whatsappClickCount}
              </span>
              <span className="text-[13px] font-semibold text-warm-secondary">WhatsApp taps</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-[1.55] text-warm-secondary">
              How many times someone has tapped "Message on WhatsApp" on your listing. Only you can see this number.
            </p>
          </BentoPanel>

          {/* Your profile — manage-list idiom, kept intact from the previous version:
              edit / pause / request-review as one row of cards. Not named in TD-001..004,
              but real, working functionality (pause is a real is_paused write; request
              review copies a real profile link) that stays rather than being dropped. */}
          <BentoPanel fill="card" className="p-[22px]">
            <h2 className="mb-3.5 flex items-center gap-3 font-display text-[18px] font-extrabold tracking-tight text-foreground">
              <IconDisc tone="muted" size={32} shape="square">
                <UserCircle2 className="h-4 w-4" aria-hidden="true" />
              </IconDisc>
              Your profile
            </h2>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <button
                type="button"
                onClick={scrollToProfileForm}
                className="flex min-h-11 w-full items-start gap-3 rounded-2xl bg-muted p-4 text-left transition-transform duration-hover hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <IconDisc tone="brand-subtle" size={40}>
                  <PencilLine className="h-5 w-5" aria-hidden="true" />
                </IconDisc>
                <span>
                  <span className="block text-[15px] font-semibold text-foreground">Edit your profile</span>
                  <span className="mt-1 block text-[13px] text-warm-secondary">
                    Subjects, classes, boards, areas and fee range.
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={handlePauseToggle}
                disabled={pausing}
                className="flex min-h-11 w-full items-start gap-3 rounded-2xl bg-muted p-4 text-left transition-transform duration-hover hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0 disabled:opacity-60"
              >
                <IconDisc tone="brand-subtle" size={40}>
                  {isPaused ? <PlayCircle className="h-5 w-5" aria-hidden="true" /> : <PauseCircle className="h-5 w-5" aria-hidden="true" />}
                </IconDisc>
                <span>
                  <span className="block text-[15px] font-semibold text-foreground">
                    {isPaused ? 'Resume your listing' : 'Pause your listing'}
                  </span>
                  <span className="mt-1 block text-[13px] text-warm-secondary">
                    {isPaused
                      ? 'Your profile is hidden from students until you resume it.'
                      : 'Hide your profile from results while your batches are full.'}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={handleRequestReview}
                className="flex min-h-11 w-full items-start gap-3 rounded-2xl bg-muted p-4 text-left transition-transform duration-hover hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <IconDisc tone="brand-subtle" size={40}>
                  <Link2 className="h-5 w-5" aria-hidden="true" />
                </IconDisc>
                <span>
                  <span className="block text-[15px] font-semibold text-foreground">Request a review</span>
                  <span className="mt-1 block text-[13px] text-warm-secondary">
                    Send a link to a current student asking them to review you.
                  </span>
                </span>
              </button>
            </div>
          </BentoPanel>

          {/* Account Information — locked fields, kept intact from the previous version. */}
          <BentoPanel fill="card" className="p-[22px]">
            <h2 className="mb-3.5 flex items-center gap-3 font-display text-[18px] font-extrabold tracking-tight text-foreground">
              <IconDisc tone="muted" size={32} shape="square">
                <Lock className="h-4 w-4" aria-hidden="true" />
              </IconDisc>
              Account Information
            </h2>
            <div className="grid gap-2.5">
              {[
                { label: 'Name', value: userName },
                { label: 'Honorific', value: teacherData["Sir/Ma'am?"] },
                { label: 'Email ID', value: teacherData["Email ID"] },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted p-4"
                >
                  <div>
                    <p className="text-[12px] font-bold uppercase tracking-[.04em] text-warm-label">{row.label}</p>
                    <div className="mt-1 text-base font-semibold text-foreground">
                      {row.value || '-'}
                    </div>
                  </div>
                  <span className="flex flex-none items-center gap-1.5 text-meta font-semibold text-warm-meta">
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    Locked
                  </span>
                </div>
              ))}
            </div>
          </BentoPanel>

          {/* Handoff TD-004: profile-completeness treatment (same as GD-002) plus
              the existing long form — every field, label and validation message
              unchanged, restyled per JA-004's field pattern only. */}
          <BentoPanel fill="card" className="p-[22px]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-[19px] font-extrabold tracking-[-0.03em] text-foreground">Your listing</h2>
              <span className="text-[14px] font-extrabold tabular-nums text-brand-deep">{completenessPct}%</span>
            </div>
            <div className="relative mt-2.5 h-2 overflow-hidden rounded-full bg-muted">
              {/* Fixed-width track, inner bar scaled via transform (composited)
                  rather than animating `width` (layout-triggering on every
                  frame). Same visual result: origin-left so it grows from the
                  left edge exactly like the old width animation did. */}
              <span
                className="absolute inset-y-0 left-0 h-full w-full origin-left rounded-full bg-brand transition-transform duration-300 ease-out"
                style={{ transform: `scaleX(${completenessPct / 100})` }}
              />
            </div>
            {missingLabels.length > 0 && (
              <p className="mt-2.5 text-[14px] leading-[1.5] text-muted-foreground">
                Missing: {missingLabels.join(', ')}.
              </p>
            )}

            <div ref={profileFormRef} id="profile-form" className="mt-5 scroll-mt-24 space-y-5">
              {/* Phone Number */}
              <div className="space-y-2">
                <Label htmlFor="phoneNumber" className={LABEL_CLASSNAME}>
                  Phone Number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="phoneNumber"
                  value={teacherData["Phone Number"] || ''}
                  onChange={(e) => {
                    // Only allow digits, limit to 10 digits
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                    handleInputChange("Phone Number", digits || null);
                  }}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="10 digit number"
                  maxLength={10}
                  required
                  className={FIELD_CLASSNAME}
                />
                <p className={HELP_TEXT_CLASSNAME}>
                  Enter 10 digit phone number. WhatsApp link will be auto-generated.
                </p>
                {teacherData["Link"] && (
                  <p className="text-xs text-brand">
                    WhatsApp link: {teacherData["Link"]}
                  </p>
                )}
              </div>

              {/* Profile Image */}
              <div className="space-y-2">
                <Label className={LABEL_CLASSNAME}>Profile Image</Label>
                {imagePreview && (() => {
                  // Apply DOMPurify as final sanitization — CodeQL recognises it as a known sanitizer
                  const safeSrc = DOMPurify.sanitize(validateImageSrc(imagePreview), {
                    ALLOWED_TAGS: [], ALLOWED_ATTR: [], KEEP_CONTENT: true,
                  });
                  if (!safeSrc) return null;
                  return (
                  <div className="relative mb-4 w-full max-w-md">
                    <img
                      src={safeSrc}
                      alt="Hero preview"
                      loading="lazy"
                      className="h-48 w-full rounded-2xl object-cover"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="before:absolute before:-inset-[4px] before:content-[''] absolute top-2 right-2"
                      onClick={() => {
                        handleInputChange("Hero Image", null);
                        setImagePreview(null);
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  );
                })()}

                <label
                  htmlFor="heroImageUpload"
                  className="flex w-fit cursor-pointer items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-accent"
                >
                  <Upload className="w-4 h-4" />
                  {uploadingImage ? 'Uploading...' : 'Upload Image'}
                  <input
                    id="heroImageUpload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageFileChange}
                    disabled={uploadingImage}
                  />
                </label>
                <p className={HELP_TEXT_CLASSNAME}>
                  Max 5MB. Supported formats: JPG, PNG, GIF, WebP
                </p>
              </div>

              {/* Profile Introduction */}
              <div className="space-y-2">
                <Label htmlFor="description" className={LABEL_CLASSNAME}>Profile Introduction</Label>
                <Textarea
                  id="description"
                  value={teacherData["Description"] || ''}
                  onChange={(e) => handleInputChange("Description", e.target.value || null)}
                  rows={5}
                  placeholder="Write about your teaching experience, methodology, and what makes you unique..."
                  maxLength={1000}
                  className={`${FIELD_CLASSNAME} min-h-[130px] py-3`}
                />
                <p className={HELP_TEXT_CLASSNAME}>Max 1000 characters</p>
              </div>

              {/* Subjects (Multiple Select) */}
              <div className="space-y-2">
                <Label className={LABEL_CLASSNAME}>
                  Subjects <span className="text-destructive">*</span>
                </Label>
                <div className={`mt-2 flex max-h-none flex-wrap gap-2 overflow-visible p-4 lg:max-h-48 lg:overflow-y-auto ${OPTION_GROUP_CLASSNAME}`}>
                  {SUBJECTS.map((subject) => {
                    const currentValue = teacherData.Subjects as string | null;
                    const selected = valueExistsInString(currentValue, subject);
                    return (
                      <div key={subject} className="flex items-center space-x-2">
                        <Checkbox
                          id={`subject-${subject}`}
                          checked={selected}
                          onCheckedChange={(checked) =>
                            handleMultiSelectChange("Subjects", subject, checked as boolean)
                          }
                        />
                        <Label htmlFor={`subject-${subject}`} className="cursor-pointer text-sm text-warm-prose">
                          {subject}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Featured Subject */}
              <div className="space-y-2">
                <Label htmlFor="featuredSubject" className={LABEL_CLASSNAME}>Featured Subject</Label>
                <Select
                  value={teacherData["Featured Subject"] || "none"}
                  onValueChange={(value) => handleInputChange("Featured Subject", value === "none" ? null : value)}
                >
                  <SelectTrigger id="featuredSubject" className={FIELD_CLASSNAME}>
                    <SelectValue placeholder="Select featured subject" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(teacherData.Subjects || '').split(',').map(s => s.trim()).filter(Boolean).map((subject) => (
                      <SelectItem key={subject} value={subject}>
                        {subject}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className={HELP_TEXT_CLASSNAME}>
                  Choose one of your selected subjects to feature on your profile
                </p>
              </div>

              {/* School Boards Catered */}
              <div className="space-y-2">
                <Label className={LABEL_CLASSNAME}>
                  School Boards Catered <span className="text-destructive">*</span>
                </Label>
                <div className={`mt-2 flex flex-wrap gap-2 p-4 ${OPTION_GROUP_CLASSNAME}`}>
                  {SCHOOL_BOARDS.map((board) => {
                    const currentValue = teacherData["School Boards Catered"] as string | null;
                    const selected = valueExistsInString(currentValue, board);
                    return (
                      <div key={board} className="flex items-center space-x-2">
                        <Checkbox
                          id={`board-${board}`}
                          checked={selected}
                          onCheckedChange={(checked) =>
                            handleMultiSelectChange("School Boards Catered", board, checked as boolean)
                          }
                        />
                        <Label htmlFor={`board-${board}`} className="cursor-pointer text-sm text-warm-prose">
                          {board}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Classes Taught */}
              <div className="space-y-2">
                <Label className={LABEL_CLASSNAME}>
                  Classes Taught <span className="text-destructive">*</span>
                </Label>
                <p className={`${HELP_TEXT_CLASSNAME} mb-2`}>
                  Select the classes you teach. Display format will be automatically computed.
                </p>
                <div className={`mt-2 flex flex-wrap gap-2 p-4 ${OPTION_GROUP_CLASSNAME}`}>
                  {CLASS_NUMBERS.map((cls) => {
                    const currentValue = teacherData["Classes Taught for Backend"] as string | null;
                    const selected = valueExistsInString(currentValue, cls);
                    return (
                      <div key={cls} className="flex items-center space-x-2">
                        <Checkbox
                          id={`class-${cls}`}
                          checked={selected}
                          onCheckedChange={(checked) =>
                            handleMultiSelectChange("Classes Taught for Backend", cls, checked as boolean)
                          }
                        />
                        <Label htmlFor={`class-${cls}`} className="cursor-pointer text-sm text-warm-prose">
                          {cls}
                        </Label>
                      </div>
                    );
                  })}
                </div>
                {/* Show Classes Taught (read-only) */}
                {teacherData["Classes Taught"] && (
                  <div className="mt-2">
                    <Label className="text-sm text-warm-meta">Classes Taught (Auto-computed):</Label>
                    <Input
                      value={teacherData["Classes Taught"]}
                      disabled
                      className={`${LOCKED_FIELD_CLASSNAME} mt-1`}
                    />
                  </div>
                )}
              </div>

              {/* Mode of Teaching — segmented pill toggle (2 fixed options, still multi-select:
                  a teacher offering both Online and Offline taps both pills on). */}
              <div className="space-y-2">
                <Label className={LABEL_CLASSNAME}>
                  Mode of Teaching <span className="text-destructive">*</span>
                </Label>
                <div className="flex flex-wrap gap-2 mt-2" role="group" aria-label="Mode of teaching">
                  {MODE_OF_TEACHING.map((mode) => {
                    const currentValue = teacherData["Mode of Teaching"] as string | null;
                    const selected = valueExistsInString(currentValue, mode);
                    return (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => handleMultiSelectChange("Mode of Teaching", mode, !selected)}
                        className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors duration-150 ${
                          selected
                            ? 'bg-brand text-brand-foreground'
                            : 'bg-muted text-foreground hover:bg-accent'
                        }`}
                      >
                        {mode}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Structure of classes (stored as Class Size (Group/ Solo)) — segmented pill
                  toggle (2 fixed options), same multi-select semantics as above. */}
              <div className="space-y-2">
                <Label className={LABEL_CLASSNAME}>
                  Structure of classes <span className="text-destructive">*</span>
                </Label>
                <div className="flex flex-wrap gap-2 mt-2" role="group" aria-label="Structure of classes">
                  {CLASS_SIZE.map((size) => {
                    const currentValue = teacherData["Class Size (Group/ Solo)"] as string | null;
                    const selected = valueExistsInString(currentValue, size);
                    return (
                      <button
                        key={size}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => handleMultiSelectChange("Class Size (Group/ Solo)", size, !selected)}
                        className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors duration-150 ${
                          selected
                            ? 'bg-brand text-brand-foreground'
                            : 'bg-muted text-foreground hover:bg-accent'
                        }`}
                      >
                        {size === 'Solo' ? 'One-on-one' : size}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Place of Teaching (Location V2) */}
              <div className="space-y-2">
                <Label htmlFor="locationV2" className={LABEL_CLASSNAME}>
                  Place of Teaching <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={teacherData["LOCATION V2"] || "__none__"}
                  onValueChange={(value) => handleInputChange("LOCATION V2", value === "__none__" ? "" : value)}
                >
                  <SelectTrigger id="locationV2" className={FIELD_CLASSNAME}>
                    <SelectValue placeholder="Select place of teaching" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    <SelectItem value="TEACHER'S HOME TUTORING">Teacher's Home Tutoring Only</SelectItem>
                    <SelectItem value="STUDENT'S HOME TUTORING ONLY">Student's Home Tutoring Only</SelectItem>
                    <SelectItem value="BOTH OPTIONS LISTED">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Student's Home Areas - Show when Place of Teaching is "STUDENT'S HOME TUTORING ONLY" or "BOTH OPTIONS LISTED" */}
              {(teacherData["LOCATION V2"] === "STUDENT'S HOME TUTORING ONLY" || teacherData["LOCATION V2"] === "BOTH OPTIONS LISTED") && (
                <div className="space-y-2">
                  <Label className={LABEL_CLASSNAME}>
                    Student's Home in These Areas <span className="text-destructive">*</span>
                  </Label>
                  <div className={`mt-2 flex max-h-none flex-wrap gap-2 overflow-visible p-4 lg:max-h-48 lg:overflow-y-auto ${OPTION_GROUP_CLASSNAME}`}>
                    {AREAS.map((area) => {
                      const currentValue = teacherData["STUDENT'S HOME IN THESE AREAS"] as string | null;
                      const selected = valueExistsInString(currentValue, area);
                      return (
                        <div key={area} className="flex items-center space-x-2">
                          <Checkbox
                            id={`student-area-${area}`}
                            checked={selected}
                            onCheckedChange={(checked) =>
                              handleMultiSelectChange("STUDENT'S HOME IN THESE AREAS", area, checked as boolean)
                            }
                            required={teacherData["LOCATION V2"] === "STUDENT'S HOME TUTORING ONLY" || teacherData["LOCATION V2"] === "BOTH OPTIONS LISTED"}
                          />
                          <Label htmlFor={`student-area-${area}`} className="cursor-pointer text-sm text-warm-prose">
                            {area}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tutor's Home Areas - Show when Place of Teaching is "TEACHER'S HOME TUTORING" or "BOTH OPTIONS LISTED" */}
              {(teacherData["LOCATION V2"] === "TEACHER'S HOME TUTORING" || teacherData["LOCATION V2"] === "BOTH OPTIONS LISTED") && (
                <div className="space-y-2">
                  <Label className={LABEL_CLASSNAME}>
                    Tutor's Home in These Areas <span className="text-destructive">*</span>
                  </Label>
                  <div className={`mt-2 flex max-h-none flex-wrap gap-2 overflow-visible p-4 lg:max-h-48 lg:overflow-y-auto ${OPTION_GROUP_CLASSNAME}`}>
                    {AREAS.map((area) => {
                      const currentValue = teacherData["TUTOR'S HOME IN THESE AREAS"] as string | null;
                      const selected = valueExistsInString(currentValue, area);
                      return (
                        <div key={area} className="flex items-center space-x-2">
                          <Checkbox
                            id={`tutor-area-${area}`}
                            checked={selected}
                            onCheckedChange={(checked) =>
                              handleMultiSelectChange("TUTOR'S HOME IN THESE AREAS", area, checked as boolean)
                            }
                            required={teacherData["LOCATION V2"] === "TEACHER'S HOME TUTORING" || teacherData["LOCATION V2"] === "BOTH OPTIONS LISTED"}
                          />
                          <Label htmlFor={`tutor-area-${area}`} className="cursor-pointer text-sm text-warm-prose">
                            {area}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Area (read-only, auto-computed) */}
              <div className="space-y-2">
                <Label className={LABEL_CLASSNAME}>Area (Auto-computed)</Label>
                <Input
                  value={teacherData["Area"] || 'Will be computed automatically when you save'}
                  disabled
                  className={LOCKED_FIELD_CLASSNAME}
                />
                <p className={HELP_TEXT_CLASSNAME}>
                  This field is automatically computed from Student's Home Areas and Tutor's Home Areas
                </p>
              </div>

              {/* Educational Qualifications */}
              <div className="space-y-2">
                <Label htmlFor="qualifications" className={LABEL_CLASSNAME}>Educational Qualifications</Label>
                <Textarea
                  id="qualifications"
                  value={teacherData["Qualifications etc"] || ''}
                  onChange={(e) => handleInputChange("Qualifications etc", e.target.value || null)}
                  rows={3}
                  placeholder="List your educational qualifications, certifications, etc."
                  maxLength={500}
                  className={`${FIELD_CLASSNAME} min-h-[90px] py-3`}
                />
                <p className={HELP_TEXT_CLASSNAME}>Max 500 characters</p>
              </div>

              {/* Year you started teaching */}
              <div className="space-y-2">
                <Label htmlFor="yearsStarted" className={LABEL_CLASSNAME}>Year you started teaching</Label>
                <Input
                  id="yearsStarted"
                  value={teacherData["Years they started teaching"] || ''}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                    handleInputChange("Years they started teaching", digits || null);
                  }}
                  type="text"
                  placeholder="e.g. 2015"
                  maxLength={4}
                  inputMode="numeric"
                  className={FIELD_CLASSNAME}
                />
                <p className={HELP_TEXT_CLASSNAME}>Numbers only, up to 4 digits</p>
              </div>

              {/* Fee range - same line on all screen sizes */}
              <div className="space-y-2">
                <Label className={LABEL_CLASSNAME}>Fee range</Label>
                <div className="flex flex-row gap-3 sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <Label htmlFor="minFees" className="mb-1.5 block text-sm font-normal text-warm-meta">Min (₹)</Label>
                    <Input
                      id="minFees"
                      type="tel"
                      value={teacherData["Min Fees"]?.toString() || ''}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                        handleFeeChange("Min Fees", digits ? parseInt(digits) : null);
                      }}
                      placeholder="e.g., 2000"
                      maxLength={6}
                      inputMode="numeric"
                      className={FIELD_CLASSNAME}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Label htmlFor="maxFees" className="mb-1.5 block text-sm font-normal text-warm-meta">Max (₹)</Label>
                    <Input
                      id="maxFees"
                      type="tel"
                      value={teacherData["Max Fees"]?.toString() || ''}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                        handleFeeChange("Max Fees", digits ? parseInt(digits) : null);
                      }}
                      placeholder="e.g., 5000"
                      maxLength={6}
                      inputMode="numeric"
                      className={FIELD_CLASSNAME}
                    />
                  </div>
                </div>
                <p className={HELP_TEXT_CLASSNAME}>Optional</p>
              </div>

              <Button
                variant="primary"
                size={52}
                onClick={handleSave}
                busy={saving}
                className="w-full gap-2"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                Save Changes
              </Button>
            </div>
          </BentoPanel>

          {/* Handoff TD-004: received reviews, read-only — no edit/delete UI on
              this page. Literal heading text from the referenced mockup. */}
          <BentoPanel fill="brandTint" className="p-[22px]">
            <h2 className="font-display text-[19px] font-extrabold tracking-[-0.03em] text-brand-deep">
              What students said
            </h2>
            <div className="mt-3.5 flex flex-col gap-2">
              {reviewsLoading ? (
                <ListLoading count={2} media={0} lines={2} />
              ) : reviewsError ? (
                <ListError onRetry={() => listingStatsQuery.refetch()} />
              ) : reviews.length === 0 ? (
                <p className="text-[14px] leading-[1.55] text-warm-prose">
                  No reviews yet. They'll show up here once students start leaving them.
                </p>
              ) : (
                reviews.map((review) => (
                  <div key={review.id} className="rounded-[20px] bg-card p-4">
                    <p className="text-[14px] leading-[1.55] text-warm-prose">{review.quote}</p>
                    <p className="mt-2.5 text-[13px] text-warm-meta">
                      {[review.who, review.when].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                ))
              )}
            </div>
          </BentoPanel>

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
