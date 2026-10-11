import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Settings, LogOut, ShieldCheck, X, Heart, UserRound, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { useAuth } from '@/lib/auth-context';
import { useLikes } from '@/lib/likes-context';
import { useRequireRole } from '@/hooks/use-require-role';
import { supabase } from '@/integrations/supabase/client';
import { getTeachersByIds, getShikshaqmineBasicBySlugs } from '@/lib/teachers';
import { TeacherCard } from '@/components/TeacherCard';
import { PaperCard, type PaperCardPaper } from '@/components/PaperCard';
import { GoalRing } from '@/components/papers/goal-ring';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Field, FieldInput, FieldTextarea, useBlurValidation } from '@/components/ui/field';
import { Eyebrow } from '@/components/ui/eyebrow';
import { formatDateForDisplay, formatDateForDatabase, isValidDateFormat, formatDateInput } from '@/lib/date-helpers';
import { ListLoading, ListError, ListEnd } from '@/components/ui/list-states';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { readAllContacts } from '@/lib/contact-record';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useChromeConfig } from '@/components/layout/AppShell';
import { setAuthIntent } from '@/lib/auth-intent';
import { usePageMeta } from '@/hooks/usePageMeta';

type TabKey = 'saved' | 'contacted' | 'papers';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'saved', label: 'Saved' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'papers', label: 'Papers' },
];

// Same lists StudentDashboard.tsx used for these two fields.
const GRADE_OPTIONS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
  'UG, First Year', 'UG, Second Year', 'UG, Third Year', 'UG, Fourth Year', 'Other',
];
const SCHOOL_BOARDS = ['ICSE', 'CBSE', 'IGCSE', 'IB', 'State'];

interface RowTeacher {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  subjects: { name: string; slug: string } | null;
  sirMaam?: string | null;
  whatsappLink?: string | null;
}

interface ContactedTeacher extends RowTeacher {
  contactedAt: number;
}

interface ReadPaper {
  read_at: string;
  paper: PaperCardPaper;
}

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 5) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  return months <= 1 ? '1 month ago' : `${months} months ago`;
}

/** Thin swipe-to-remove wrapper: drags the row left past a threshold, then
 * calls onRemove. Optimistic — the caller is expected to update its own
 * state/context synchronously, this component only owns the gesture. */
function SwipeToRemove({
  onRemove,
  children,
}: {
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [startX, setStartX] = useState<number | null>(null);

  const THRESHOLD = -88;

  const onPointerDown = (e: React.PointerEvent) => {
    setStartX(e.clientX);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startX == null) return;
    const delta = Math.min(0, e.clientX - startX);
    setDragX(delta);
  };
  const endDrag = () => {
    setDragging(false);
    setStartX(null);
    if (dragX < THRESHOLD) {
      onRemove();
    }
    setDragX(0);
  };

  return (
    // Radius matches TeacherCard's own `row` frame (rounded-[24px]) exactly —
    // this wrapper's only job is to clip the reveal panel during the drag, and
    // a smaller radius here (rounded-2xl/16px) was clipping the card's own
    // 24px corners into a visibly tighter curve than every other row card on
    // the page (make-interfaces-feel-better: concentric radius).
    <div className="relative overflow-hidden rounded-[24px]">
      <div className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-destructive text-destructive-foreground">
        <X className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging ? 'none' : 'transform 200ms var(--ease-settle, ease-out)',
          touchAction: 'pan-y',
        }}
        className="relative bg-background"
      >
        {children}
      </div>
    </div>
  );
}

interface FullProfile {
  role: 'student' | 'guardian' | 'teacher' | null;
  full_name: string | null;
  email: string | null;
  grade: string | null;
  student_grade: string | null;
}

export default function Account() {
  usePageMeta(
    'Your Account | Shikshaq',
    'Your saved teachers, contacted teachers and papers you have read, all in one place.',
  );

  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { likedTeacherIds, likedCount, loading: likesLoading, toggleLike } = useLikes();
  const queryClient = useQueryClient();

  useRequireRole();

  // Handoff AC-007: this route renders its own eyes panel, replacing
  // AppShell's default pre-footer.
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();

  // AuthProvider's UserProfile is a lean {role, full_name} slice; the header's
  // "Student · Class 10" meta needs the class/grade fields too, which live only
  // on the full profiles row (StudentDashboard.tsx / GuardianDashboard.tsx both
  // fetch it the same way).
  const profileQuery = useQuery({
    queryKey: ['accountProfile', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('role, full_name, email, grade, student_grade')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as FullProfile | null;
    },
    enabled: !!user,
  });
  const profile = profileQuery.data ?? null;

  const paramTab = searchParams.get('tab') as TabKey | null;
  const defaultTab: TabKey = profile?.role === 'guardian' ? 'contacted' : 'saved';
  const activeTab: TabKey = paramTab && TABS.some((t) => t.key === paramTab) ? paramTab : defaultTab;

  const setTab = (tab: TabKey) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: false });
  };

  useEffect(() => {
    if (!user) {
      // Handoff AU-004a: variant F — "Your shelf".
      setAuthIntent({ kind: 'dashboard' });
      navigate('/auth');
    }
  }, [user, navigate]);

  // ---------------------------------------------------------------- Saved
  // Same query shape/key as StudentDashboard.tsx's identical fetch — cache
  // is shared if both ever read it in the same session.
  const savedTeachersKey = [...likedTeacherIds].sort().join(',');
  const savedTeachersQuery = useQuery({
    queryKey: ['savedTeachers', savedTeachersKey],
    queryFn: () => getTeachersByIds([...likedTeacherIds]),
    enabled: !likesLoading && likedTeacherIds.size > 0,
  });
  const savedTeachers = likedTeacherIds.size === 0 ? [] : (savedTeachersQuery.data ?? []);
  const savedLoading = likesLoading || (likedTeacherIds.size > 0 && savedTeachersQuery.isPending);
  const savedError = savedTeachersQuery.isError;

  // ------------------------------------------------------------- Contacted
  // Contacted tracking has no server table yet (O-04 — no whatsapp_clicks /
  // enquiries table reachable from the student side). contact-record.ts is a
  // device-local, best-effort log of WhatsApp taps this browser made; it is
  // the only real signal available, so it powers this tab as a pragmatic v1.
  const contactedQuery = useQuery({
    queryKey: ['contactedTeachers'],
    queryFn: async () => {
      const records = readAllContacts();
      if (records.length === 0) return [];
      const slugs = records.map((r) => r.slug);
      const [{ data: rows, error }, basicMap] = await Promise.all([
        supabase
          .from('teachers_list')
          .select('id, name, slug, image_url, subjects(name, slug)')
          .in('slug', slugs),
        getShikshaqmineBasicBySlugs(slugs),
      ]);
      if (error) throw error;

      const bySlug = new Map((rows ?? []).map((r: any) => [r.slug, r]));
      return records
        .map((rec) => {
          const row = bySlug.get(rec.slug);
          if (!row) return null;
          const basic = basicMap.get(rec.slug);
          return {
            id: row.id,
            name: row.name,
            slug: row.slug,
            image_url: row.image_url,
            subjects: row.subjects,
            sirMaam: basic?.sirMaam ?? null,
            whatsappLink: basic?.whatsappLink ?? null,
            contactedAt: rec.ts,
          } as ContactedTeacher;
        })
        .filter((t): t is ContactedTeacher => t !== null);
    },
  });
  const contactedTeachers = contactedQuery.data ?? [];
  const contactedLoading = contactedQuery.isPending;
  const contactedError = contactedQuery.isError;

  // ---------------------------------------------------------------- Papers
  const WEEKLY_GOAL = 5;
  const paperReadsQuery = useQuery({
    queryKey: ['paperReads', user?.id],
    queryFn: async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [{ data, error }, weekRes, totalRes] = await Promise.all([
        supabase
          .from('paper_reads')
          .select('read_at, papers(id, title, school, subject, class, board, exam_type, year)')
          .eq('user_id', user!.id)
          .order('read_at', { ascending: false })
          .limit(40),
        supabase
          .from('paper_reads')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user!.id)
          .gte('read_at', weekAgo),
        supabase
          .from('paper_reads')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user!.id),
      ]);
      if (error) throw error;

      const mapped: ReadPaper[] = (data ?? [])
        .filter((row: any) => row.papers)
        .map((row: any) => ({ read_at: row.read_at, paper: row.papers as PaperCardPaper }));
      return { readPapers: mapped, readThisWeek: weekRes.count ?? 0, totalPapersRead: totalRes.count ?? 0 };
    },
    enabled: !!user,
  });
  const readPapers = paperReadsQuery.data?.readPapers ?? [];
  const papersLoading = paperReadsQuery.isPending;
  const papersError = paperReadsQuery.isError;
  const readThisWeek = paperReadsQuery.data?.readThisWeek ?? 0;
  const totalPapersRead = paperReadsQuery.data?.totalPapersRead ?? 0;

  // ---------------------------------------------------------------- Header
  const userEmail = user?.email || profile?.email || '';
  const userName =
    (user?.user_metadata as any)?.full_name ||
    (user?.user_metadata as any)?.name ||
    profile?.full_name ||
    '';
  const initial = (userName || userEmail || '?').trim().charAt(0).toUpperCase() || '?';

  const roleLabel = profile?.role === 'guardian' ? 'Guardian' : profile?.role === 'teacher' ? 'Teacher' : 'Student';
  const subLineParts = useMemo(() => {
    const grade = profile?.role === 'guardian' ? profile?.student_grade : profile?.grade;
    return [roleLabel, grade ? `Class ${grade}` : null].filter(Boolean);
  }, [profile, roleLabel]);

  const [settingsOpen, setSettingsOpen] = useState(false);

  // ------------------------------------------------------------ Edit profile
  // StudentDashboard.tsx (the pre-redesign profile-editing screen) is
  // unrouted — /dashboard/student redirects here — but its fields (phone,
  // DOB, school, grade, board, guardian email, subjects) had no live
  // replacement anywhere in the app. Ported the same fetch/validate/save
  // logic onto the new Field/Chip components rather than the old shadcn
  // defaults StudentDashboard used.
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);

  // All three enabled only once the sheet actually opens — same "don't fetch
  // the edit form's data until someone is about to edit" as before, just
  // expressed as `enabled` instead of a hand-rolled profileLoaded flag.
  // react-query's own cache is what makes reopening the sheet later in the
  // same session instant, which the old flag also achieved, just by hand.
  const editFormQuery = useQuery({
    queryKey: ['profileEditForm', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('phone, date_of_birth, school_college, grade, school_board, guardian_email, address')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: profileSheetOpen && !!user,
  });
  // Shares a cache key with StudentDashboard.tsx's identical global lookup.
  const editSubjectsQuery = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subjects').select('id, name').order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: profileSheetOpen,
  });
  const editStudentSubjectIdsQuery = useQuery({
    queryKey: ['studentSubjectIds', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_subjects')
        .select('subject_id')
        .eq('student_id', user!.id);
      if (error) throw error;
      return (data ?? []).map((s) => s.subject_id);
    },
    enabled: profileSheetOpen && !!user,
  });
  const profileLoading = profileSheetOpen
    && (editFormQuery.isPending || editSubjectsQuery.isPending || editStudentSubjectIdsQuery.isPending);
  useEffect(() => {
    if (editFormQuery.isError || editSubjectsQuery.isError || editStudentSubjectIdsQuery.isError) {
      if (import.meta.env.DEV) console.error('Error loading profile for editing');
      toast.error('Could not load your profile');
    }
  }, [editFormQuery.isError, editSubjectsQuery.isError, editStudentSubjectIdsQuery.isError]);

  const [profileForm, setProfileForm] = useState({
    phone: '',
    date_of_birth: '',
    school_college: '',
    grade: '',
    school_board: '',
    guardian_email: '',
    address: '',
  });
  useEffect(() => {
    if (!editFormQuery.data) return;
    setProfileForm({
      phone: editFormQuery.data.phone || '',
      date_of_birth: formatDateForDisplay(editFormQuery.data.date_of_birth),
      school_college: editFormQuery.data.school_college || '',
      grade: editFormQuery.data.grade || '',
      school_board: editFormQuery.data.school_board || '',
      guardian_email: editFormQuery.data.guardian_email || '',
      address: editFormQuery.data.address || '',
    });
  }, [editFormQuery.data]);
  const allSubjects = editSubjectsQuery.data ?? [];
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  useEffect(() => {
    if (editStudentSubjectIdsQuery.data) setSelectedSubjectIds(editStudentSubjectIdsQuery.data);
  }, [editStudentSubjectIdsQuery.data]);

  const phoneField = useBlurValidation(profileForm.phone, (v) => {
    if (!v.trim()) return 'Enter your phone number';
    if (v.trim().length !== 10) return 'Phone number must be exactly 10 digits';
    return undefined;
  });
  const dobField = useBlurValidation(profileForm.date_of_birth, (v) => {
    if (!v.trim()) return 'Enter your date of birth';
    if (!isValidDateFormat(v.trim())) return 'Use DD-MM-YYYY, e.g. 15-03-2010';
    return undefined;
  });
  const schoolField = useBlurValidation(profileForm.school_college, (v) =>
    v.trim() ? undefined : 'Enter your school or college name',
  );
  const gradeField = useBlurValidation(profileForm.grade, (v) => (v.trim() ? undefined : 'Select your grade'));

  const toggleSubject = (id: string) => {
    setSelectedSubjectIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('not signed in');
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          phone: profileForm.phone || null,
          school_college: profileForm.school_college || null,
          grade: profileForm.grade || null,
          school_board: profileForm.school_board || null,
          address: profileForm.address || null,
          guardian_email: profileForm.guardian_email || null,
          date_of_birth: formatDateForDatabase(profileForm.date_of_birth),
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);
      if (profileError) throw profileError;

      // Same delete-then-insert as StudentDashboard: stop on a failed delete
      // rather than inserting on top of whatever rows are already there.
      const { error: deleteError } = await supabase.from('student_subjects').delete().eq('student_id', user.id);
      if (deleteError) throw deleteError;
      if (selectedSubjectIds.length > 0) {
        const { error: insertError } = await supabase
          .from('student_subjects')
          .insert(selectedSubjectIds.map((subject_id) => ({ student_id: user.id, subject_id })));
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      toast.success('Profile updated');
      setProfileSheetOpen(false);
      // The header's "Class {grade}" sub-line reads accountProfile's cache —
      // patch it directly instead of waiting on a refetch, same immediacy
      // the old setProfile(prev => ...) had.
      queryClient.setQueryData(['accountProfile', user?.id], (prev: FullProfile | null | undefined) =>
        prev ? { ...prev, grade: profileForm.grade || null } : prev,
      );
      queryClient.invalidateQueries({ queryKey: ['profileEditForm', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['studentSubjectIds', user?.id] });
    },
    onError: (err) => {
      if (import.meta.env.DEV) console.error('Error saving profile:', err);
      toast.error('Failed to save your profile');
    },
  });
  const profileSaving = saveProfileMutation.isPending;

  const handleSaveProfile = () => {
    if (!user) return;
    // Blur-only errors (Field's own rule) don't fire on submit automatically,
    // so touch every field here to surface any that were never blurred.
    phoneField.onBlur();
    dobField.onBlur();
    schoolField.onBlur();
    gradeField.onBlur();
    if (!phoneField.isValid || !dobField.isValid || !schoolField.isValid || !gradeField.isValid) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    saveProfileMutation.mutate();
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const handleRemoveSaved = (id: string) => {
    // Pre-populate the cache entry for the id set toggleLike is about to
    // produce, so the list updates instantly instead of waiting on a
    // refetch for the new (shorter) savedTeachers query key.
    const nextIds = [...likedTeacherIds].filter((tid) => tid !== id).sort().join(',');
    queryClient.setQueryData(['savedTeachers', nextIds], (prev: RowTeacher[] | undefined) =>
      (prev ?? savedTeachers).filter((t) => t.id !== id),
    );
    toggleLike(id);
  };

  if (!user) return null;

  const counts: Record<TabKey, number> = {
    saved: likedCount,
    contacted: contactedTeachers.length,
    papers: totalPapersRead,
  };

  return (
    <div className="min-h-screen bg-background">
      <main>
      <BentoStack>
      {/* Handoff AC-002: bone greeting panel — the !rounded-b-[32px] override
          is gone, the panel owns its own radius now. */}
      <BentoPanel fill="card" edge="top" className="px-[22px] pt-[14px] pb-5">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-brand font-display text-[19px] font-black text-brand-foreground">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[22px] font-extrabold tracking-[-0.04em] text-foreground">
              {userName || 'Your account'}
            </h1>
            <p className="mt-0.5 truncate text-[14px] text-warm-meta">{subLineParts.join(' · ')}</p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
            className="tap-44 flex h-10 w-10 flex-none items-center justify-center rounded-full bg-muted transition-colors duration-150 hover:bg-accent active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Settings className="h-[17px] w-[17px] text-foreground" strokeWidth={2.1} aria-hidden="true" />
          </button>
        </div>
      </BentoPanel>

      {/* Handoff AC-003: sticky pill row — border-b-2 underline removed, the
          active state is now the fill. role="tablist"/"tab"/aria-selected
          and setTab are unchanged. */}
      {/* lg:py-3 restates the mobile value on purpose. Without it BentoPanel's
          `lg:py-8` applies and this sticky bar becomes 108px tall at 1280 —
          64px of padding around a 44px control row, sitting under a 60px nav.
          D-003 excepts counter tiles for exactly this reason ("they stay
          compact; py-8 would make them tall boxes"); a sticky control bar has
          the same reason and simply is not in its table. Desktop Layouts.dc.html
          does not draw this screen, so this follows the spec's own logic. */}
      <BentoPanel fill="card" className="sticky top-[80px] z-20 isolate !px-0 !pl-4 py-3 lg:py-3">
        <div role="tablist" aria-label="Account sections" className="flex gap-2 overflow-x-auto pr-4 scrollbar-hide">
          {TABS.map((tab) => {
            const selected = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(tab.key)}
                className={`flex h-11 flex-none items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  selected ? 'bg-panel font-bold text-background' : 'bg-muted text-warm-secondary'
                }`}
              >
                {tab.label}
                <span
                  className={`inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                    selected ? 'bg-brand text-brand-foreground' : 'bg-card text-warm-secondary'
                  }`}
                >
                  {counts[tab.key]}
                </span>
              </button>
            );
          })}
        </div>
      </BentoPanel>

      <BentoPanel fill="card" className="px-4 py-[18px]">
        {activeTab === 'saved' && (
          <section>
            {savedLoading && savedTeachers.length === 0 ? (
              <ListLoading count={3} media={0} lines={2} />
            ) : savedError ? (
              <ListError onRetry={() => savedTeachersQuery.refetch()} />
            ) : savedTeachers.length > 0 ? (
              <>
                <ul className="flex flex-col gap-2.5">
                  {savedTeachers.map((teacher) => (
                    <li key={teacher.id} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <SwipeToRemove onRemove={() => handleRemoveSaved(teacher.id)}>
                          <TeacherCard
                            id={teacher.id}
                            name={teacher.name}
                            slug={teacher.slug}
                            subject={teacher.subjects?.name || 'Tuition Teacher'}
                            subjectSlug={teacher.subjects?.slug}
                            imageUrl={teacher.image_url || undefined}
                            sirMaam={teacher.sirMaam}
                            variant="row"
                            hideFavourite
                          />
                        </SwipeToRemove>
                      </div>
                      {/* Handoff AC-004: the trailing action on this page is
                          the unsave heart, not the WhatsApp disc. */}
                      <button
                        type="button"
                        onClick={() => handleRemoveSaved(teacher.id)}
                        aria-label={`Remove ${teacher.name} from saved`}
                        className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-card transition-transform duration-tap active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <Heart className="h-4 w-4 fill-destructive text-destructive" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
                <ListEnd count={savedTeachers.length} />
              </>
            ) : (
              /* Handoff AC-005: empty states are their own tinted panel —
                 heading naming the exact empty thing, one line, one action. */
              <BentoPanel fill="brandTint" className="p-[22px]">
                <p className="font-display text-[21px] font-extrabold tracking-[-0.03em] text-brand-deep">Nothing saved yet</p>
                <p className="mt-1.5 text-[14px] leading-[1.55] text-warm-prose">Save a teacher's profile and it shows up here.</p>
                <Button asChild variant="primary" size={52} className="mt-4">
                  <Link to="/all-tuition-teachers-in-kolkata">Browse teachers</Link>
                </Button>
              </BentoPanel>
            )}
          </section>
        )}

        {activeTab === 'contacted' && (
          <section>
            {contactedLoading ? (
              <ListLoading count={3} media={0} lines={2} />
            ) : contactedError ? (
              <ListError onRetry={() => contactedQuery.refetch()} />
            ) : contactedTeachers.length > 0 ? (
              <ul className="flex flex-col gap-2.5">
                {contactedTeachers.map((teacher) => (
                  // No card wrapper here — TeacherCard's `row` variant already draws its
                  // own bg-muted/rounded-[24px] frame (S-001). Wrapping it in a second
                  // card would double the frame, which is exactly the "border + shadow
                  // stacked" pattern this redesign rules out. Saved tab's <li> is bare
                  // for the same reason; this now matches it.
                  <li key={teacher.id} className="flex flex-col gap-1.5">
                    <TeacherCard
                      id={teacher.id}
                      name={teacher.name}
                      slug={teacher.slug}
                      subject={teacher.subjects?.name || 'Tuition Teacher'}
                      subjectSlug={teacher.subjects?.slug}
                      imageUrl={teacher.image_url || undefined}
                      sirMaam={teacher.sirMaam}
                      whatsappLink={teacher.whatsappLink}
                      variant="row"
                    />
                    <p className="px-2.5 text-meta text-warm-meta">
                      Messaged {timeAgo(teacher.contactedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <BentoPanel fill="brandTint" className="p-[22px]">
                <p className="font-display text-[21px] font-extrabold tracking-[-0.03em] text-brand-deep">You haven't messaged anyone yet</p>
                <p className="mt-1.5 text-[14px] leading-[1.55] text-warm-prose">Message a teacher on WhatsApp and they'll show up here.</p>
                <Button asChild variant="primary" size={52} className="mt-4">
                  <Link to="/all-tuition-teachers-in-kolkata">Browse teachers</Link>
                </Button>
              </BentoPanel>
            )}
          </section>
        )}

        {activeTab === 'papers' && (
          <section className="flex flex-col gap-4">
            {user && readThisWeek > 0 && (
              <div className="flex items-center gap-3 rounded-2xl bg-muted p-4">
                <GoalRing value={readThisWeek} goal={WEEKLY_GOAL} size={86} stroke={8} />
                <div>
                  <p className="font-display text-card-title-lg font-extrabold tracking-tight text-foreground">
                    {readThisWeek} of {WEEKLY_GOAL}
                  </p>
                  <p className="text-body-secondary text-muted-foreground">papers this week</p>
                </div>
              </div>
            )}
            {papersLoading ? (
              <ListLoading count={3} media={0} lines={2} />
            ) : papersError ? (
              <ListError onRetry={() => paperReadsQuery.refetch()} />
            ) : readPapers.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {readPapers.map(({ paper, read_at }) => (
                  <PaperCard key={`${paper.id}-${read_at}`} paper={paper} variant="compact" />
                ))}
              </div>
            ) : (
              <BentoPanel fill="brandTint" className="p-[22px]">
                <p className="font-display text-[21px] font-extrabold tracking-[-0.03em] text-brand-deep">No papers read yet</p>
                <p className="mt-1.5 text-[14px] leading-[1.55] text-warm-prose">Open a past paper and it shows up here.</p>
                <Button asChild variant="primary" size={52} className="mt-4">
                  <Link to="/past-papers">Browse past papers</Link>
                </Button>
              </BentoPanel>
            )}
          </section>
        )}
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

      {/* Settings sheet — sign-out, account links, and (students only) the
          profile-editing entry point below. */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="bottom" aria-describedby={undefined} className="rounded-t-[28px] border-0 pb-8 pt-6">
          <SheetHeader className="items-start text-left">
            <SheetTitle className="font-display text-xl font-bold tracking-tight text-foreground">
              Settings
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-1">
            {profile?.role === 'student' && (
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  setProfileSheetOpen(true);
                }}
                className="flex min-h-[52px] w-full items-center gap-3 rounded-xl px-2 text-left transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <UserRound className="h-4 w-4 text-warm-label" strokeWidth={2} aria-hidden="true" />
                <span className="flex-1 text-body-secondary font-semibold text-foreground">Edit profile</span>
                <ChevronRight className="h-4 w-4 text-warm-label" strokeWidth={2} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/privacy-policy')}
              className="flex min-h-[52px] w-full items-center gap-3 rounded-xl px-2 text-left transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ShieldCheck className="h-4 w-4 text-warm-label" strokeWidth={2} aria-hidden="true" />
              <span className="flex-1 text-body-secondary font-semibold text-foreground">Privacy &amp; terms</span>
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex min-h-[52px] w-full items-center gap-3 rounded-xl px-2 text-left transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <LogOut className="h-4 w-4 text-destructive" strokeWidth={2} aria-hidden="true" />
              <span className="flex-1 text-body-secondary font-semibold text-destructive">Sign out</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit-profile sheet (students only) — phone/DOB/school/grade/board/
          guardian email/address/subjects, the fields StudentDashboard.tsx
          (unrouted since /dashboard/student -> /account) used to own with
          no live replacement. Ported onto Field/Chip instead of that page's
          shadcn defaults. */}
      <Sheet open={profileSheetOpen} onOpenChange={setProfileSheetOpen}>
        <SheetContent side="bottom" className="flex max-h-[85vh] flex-col rounded-t-[28px] border-0 pb-6 pt-6">
          <SheetHeader className="items-start text-left">
            <SheetTitle className="font-display text-xl font-bold tracking-tight text-foreground">
              Edit profile
            </SheetTitle>
            <SheetDescription className="sr-only">
              Update your phone, date of birth, school, grade, board, guardian email, address, and subjects.
            </SheetDescription>
          </SheetHeader>

          {profileLoading ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-warm-label" aria-hidden="true" />
            </div>
          ) : (
            <div className="mt-4 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-[14px] pb-2">
                <div className="grid gap-[14px] sm:grid-cols-2">
                  <Field label="Phone number" error={phoneField.error} required>
                    {(cp) => (
                      <FieldInput
                        {...cp}
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        maxLength={10}
                        placeholder="10-digit phone number"
                        value={profileForm.phone}
                        onChange={(e) => setProfileForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))}
                        onBlur={phoneField.onBlur}
                      />
                    )}
                  </Field>
                  <Field label="Date of birth" error={dobField.error} required>
                    {(cp) => (
                      <FieldInput
                        {...cp}
                        type="text"
                        maxLength={10}
                        placeholder="DD-MM-YYYY"
                        value={profileForm.date_of_birth}
                        onChange={(e) => setProfileForm((f) => ({ ...f, date_of_birth: formatDateInput(e.target.value) }))}
                        onBlur={dobField.onBlur}
                      />
                    )}
                  </Field>
                </div>

                <Field label="School or college" error={schoolField.error} required>
                  {(cp) => (
                    <FieldInput
                      {...cp}
                      placeholder="Enter school or college name"
                      value={profileForm.school_college}
                      onChange={(e) => setProfileForm((f) => ({ ...f, school_college: e.target.value }))}
                      onBlur={schoolField.onBlur}
                    />
                  )}
                </Field>

                <Field label="Grade" error={gradeField.error} required>
                  {(cp) => (
                    <select
                      {...cp}
                      value={profileForm.grade}
                      onChange={(e) => setProfileForm((f) => ({ ...f, grade: e.target.value }))}
                      onBlur={gradeField.onBlur}
                    >
                      <option value="">Select grade</option>
                      {GRADE_OPTIONS.map((g) => (
                        <option key={g} value={g}>
                          {/^\d+$/.test(g) ? `Class ${g}` : g}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>

                <div className="flex flex-col gap-2">
                  <Eyebrow>School board (optional)</Eyebrow>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="School board">
                    {SCHOOL_BOARDS.map((board) => (
                      <Chip
                        key={board}
                        tone={profileForm.school_board === board ? 'facet-on' : 'facet'}
                        size={44}
                        aria-pressed={profileForm.school_board === board}
                        onClick={() =>
                          setProfileForm((f) => ({ ...f, school_board: f.school_board === board ? '' : board }))
                        }
                      >
                        {board}
                      </Chip>
                    ))}
                  </div>
                </div>

                <Field label="Guardian's email (optional)">
                  {(cp) => (
                    <FieldInput
                      {...cp}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="guardian@example.com"
                      value={profileForm.guardian_email}
                      onChange={(e) => setProfileForm((f) => ({ ...f, guardian_email: e.target.value }))}
                    />
                  )}
                </Field>

                <Field label="Address (optional)">
                  {(cp) => (
                    <FieldTextarea
                      {...cp}
                      placeholder="Enter your address"
                      value={profileForm.address}
                      onChange={(e) => setProfileForm((f) => ({ ...f, address: e.target.value }))}
                    />
                  )}
                </Field>

                <div className="flex flex-col gap-2">
                  <Eyebrow className="whitespace-normal">Subjects interested in (optional)</Eyebrow>
                  <div className="flex flex-wrap gap-2">
                    {allSubjects.map((s) => (
                      <Chip
                        key={s.id}
                        tone={selectedSubjectIds.includes(s.id) ? 'facet-on' : 'facet'}
                        size={44}
                        aria-pressed={selectedSubjectIds.includes(s.id)}
                        onClick={() => toggleSubject(s.id)}
                      >
                        {s.name}
                      </Chip>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!profileLoading && (
            <Button
              variant="primary"
              size={52}
              className="mt-4 w-full flex-none"
              onClick={handleSaveProfile}
              disabled={profileSaving}
            >
              {profileSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Save profile'}
            </Button>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
