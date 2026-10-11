/**
 * NOT ROUTED. Nothing imports this file, so it has no URL and Rollup leaves it
 * out of the bundle entirely -- verified by taking prose strings that appear in
 * this file and nowhere else in src/, then searching every built chunk for
 * them: none are present.
 *
 * It is kept on purpose, as a student-facing dashboard that may be wanted later, not
 * as something half-deleted. The banner exists because the absence of a route
 * is invisible from inside the file: it reads like a live page, and more than
 * one reader has assumed it was one.
 *
 * If you route it, expect real work rather than a line in App.tsx -- it has not
 * been exercised against the current data layer, and the table grants moved
 * underneath it (see docs/GUARDRAILS.md on select('*') and column revokes).
 * If you delete it, delete the whole file; there is nothing here anything else
 * depends on.
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ControlBlock, PageContainer } from '@/components/layout/PageContainer';
import { useAuth } from '@/lib/auth-context';
import { setAuthIntent } from '@/lib/auth-intent';
import { supabase } from '@/integrations/supabase/client';
import { getTeachersByIds } from '@/lib/teachers';
import { TeacherCard } from '@/components/TeacherCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { IconDisc } from '@/components/ui/icon-disc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ListLoading,
  ListEmpty,
  ListError,
  ListEnd,
} from '@/components/ui/list-states';
import {
  Save,
  Lock,
  Heart,
  BookOpen,
  UserRound,
  GraduationCap,
  ShieldCheck,
  LogOut,
  ChevronRight,
  Settings,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLikes } from '@/lib/likes-context';
import { PaperCard, type PaperCardPaper } from '@/components/PaperCard';
import {
  formatDateForDisplay,
  formatDateForDatabase,
  isValidDateFormat,
  formatDateInput,
} from '@/lib/date-helpers';

interface Subject {
  id: string;
  name: string;
  slug: string;
}

interface SavedTeacher {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  subjects: { name: string; slug: string } | null;
  sirMaam?: string | null;
}

interface Profile {
  id: string;
  role: 'student' | 'guardian' | 'teacher';
  full_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  date_of_birth: string | null;
  age: number | null;
  school_college: string | null;
  grade: string | null;
  school_board: string | null;
  guardian_email: string | null;
}

// Profile form field/label/panel styling, on the token system so the editable form matches
// the rest of the page instead of falling back to shadcn's bare default input styling.
const FIELD_CLASSNAME =
  'h-auto min-h-12 rounded-lg border-0 bg-background text-base shadow-border focus-visible:ring-0 focus-visible:ring-offset-0';
const LOCKED_FIELD_CLASSNAME = `${FIELD_CLASSNAME} cursor-not-allowed opacity-70`;
const LABEL_CLASSNAME = 'mb-1.5 block text-sm font-semibold text-foreground';
const OPTION_GROUP_CLASSNAME = 'rounded-2xl bg-background shadow-border';

export default function StudentDashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  /* Was four hand-rolled useEffect fetches + a manual re-fetch after save.
     react-query gives every one of these a shared cache keyed by user id, so
     a revisit within staleTime (5min, App.tsx's QueryClient) shows the
     dashboard instantly from cache instead of refetching from scratch —
     the actual "speed switching pages" complaint this migration exists for. */
  const profileQuery = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user!.id).single();
      if (error) throw error;
      return data as Profile;
    },
    enabled: !!user,
  });
  const profile = profileQuery.data ?? null;

  const subjectsQuery = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subjects').select('*').order('name');
      if (error) throw error;
      return (data ?? []) as Subject[];
    },
  });
  const subjects = subjectsQuery.data ?? [];

  const studentSubjectIdsQuery = useQuery({
    queryKey: ['studentSubjectIds', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_subjects')
        .select('subject_id')
        .eq('student_id', user!.id);
      if (error) throw error;
      return (data ?? []).map((s) => s.subject_id);
    },
    enabled: !!user,
  });
  // Editable copy of the fetched selection, not a direct read of query data:
  // the checklist below mutates this ahead of a save, and a query result is
  // not something a caller should ever write to directly. Re-seeded whenever
  // a fresh fetch lands (first load, or the invalidation after a save) —
  // left alone the rest of the time, same as formData below.
  const [studentSubjects, setStudentSubjects] = useState<string[]>([]);
  useEffect(() => {
    if (studentSubjectIdsQuery.data) setStudentSubjects(studentSubjectIdsQuery.data);
  }, [studentSubjectIdsQuery.data]);

  const loading = profileQuery.isPending || subjectsQuery.isPending || studentSubjectIdsQuery.isPending;
  const { likedTeacherIds, likedCount, loading: likesLoading } = useLikes();

  const savedTeachersQuery = useQuery({
    queryKey: ['savedTeachers', [...likedTeacherIds].sort().join(',')],
    queryFn: () => getTeachersByIds([...likedTeacherIds]),
    enabled: !likesLoading && likedTeacherIds.size > 0,
  });
  // Empty on purpose, not "still loading": zero liked teachers is a real,
  // settled state the query is never even enabled for.
  const savedTeachers = likedTeacherIds.size === 0 ? [] : (savedTeachersQuery.data ?? []);
  const savedTeachersLoading = likesLoading || (likedTeacherIds.size > 0 && savedTeachersQuery.isPending);
  const savedTeachersError = savedTeachersQuery.isError;

  const papersContributedQuery = useQuery({
    queryKey: ['papersContributedCount', user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('papers')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', user!.id);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user,
  });
  const papersContributedCount = papersContributedQuery.data ?? 0;

  const [settingsOpen, setSettingsOpen] = useState<'profile' | 'subjects' | null>(null);

  // Reading history/progress has no backend yet (pages/PaperReader.md hasn't been built — no
  // reader page, no progress table). "Continue reading" and the "Papers read" stat therefore stay
  // honestly empty/zero rather than showing fabricated numbers; this is real, just currently nil.
  const readingHistory: { paper: PaperCardPaper; questionsRead: number; totalQuestions: number }[] = [];
  const papersReadCount = 0;

  // School board options
  const schoolBoards = ['ICSE', 'CBSE', 'IGCSE', 'IB', 'State'];
  const [formData, setFormData] = useState({
    phone: '',
    school_college: '',
    grade: '',
    school_board: '',
    address: '',
    guardian_email: '',
    date_of_birth: '',
  });

  // Redirect if not authenticated or not a student
  useEffect(() => {
    if (!loading && !user) {
      /* AU-004a lists this as a `dashboard` call site. Without the write the
         shelf gate was the one entry point that sent people to /auth with no
         intent, so they got the generic hero instead of variant F ("Your saved
         teachers are still here") — the one line that explains why they are
         being asked to sign in at all. */
      setAuthIntent({ kind: 'dashboard' });
      navigate('/auth');
      return;
    }
    if (!loading && profile && profile.role !== 'student') {
      navigate('/');
      return;
    }
  }, [user, profile, loading, navigate]);

  // Seeds the edit form whenever a fresh profile lands (first load, or the
  // invalidation after a save) — same "editable copy, not a live read"
  // reasoning as studentSubjects above.
  useEffect(() => {
    if (!profileQuery.data) return;
    setFormData({
      phone: profileQuery.data.phone || '',
      school_college: profileQuery.data.school_college || '',
      grade: profileQuery.data.grade || '',
      school_board: profileQuery.data.school_board || '',
      address: profileQuery.data.address || '',
      guardian_email: profileQuery.data.guardian_email || '',
      date_of_birth: formatDateForDisplay(profileQuery.data.date_of_birth),
    });
  }, [profileQuery.data]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;

    // For phone number, only allow numeric characters
    if (name === 'phone') {
      const numericValue = value.replace(/\D/g, ''); // Remove all non-digit characters
      setFormData({ ...formData, [name]: numericValue });
    } else if (name === 'date_of_birth') {
      // Format date input as dd-mm-yyyy
      const formatted = formatDateInput(value);
      setFormData({ ...formData, [name]: formatted });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleSubjectToggle = (subjectId: string) => {
    setStudentSubjects(prev => {
      if (prev.includes(subjectId)) {
        return prev.filter(id => id !== subjectId);
      } else {
        return [...prev, subjectId];
      }
    });
  };

  const validateRequiredFields = (): boolean => {
    if (!formData.phone.trim()) {
      toast.error('Please enter your phone number');
      return false;
    }

    if (formData.phone.trim().length !== 10) {
      toast.error('Phone number must be exactly 10 digits');
      return false;
    }

    if (!formData.date_of_birth.trim()) {
      toast.error('Please enter your date of birth');
      return false;
    }

    if (!isValidDateFormat(formData.date_of_birth.trim())) {
      toast.error('Please enter a valid date in DD-MM-YYYY format (e.g., 15-03-2010)');
      return false;
    }

    if (!formData.school_college.trim()) {
      toast.error('Please enter your school or college name');
      return false;
    }

    if (!formData.grade.trim()) {
      toast.error('Please select your grade');
      return false;
    }

    return true;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Failed to update profile');

      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          phone: formData.phone || null,
          school_college: formData.school_college || null,
          grade: formData.grade || null,
          school_board: formData.school_board || null,
          address: formData.address || null,
          guardian_email: formData.guardian_email || null,
          date_of_birth: formatDateForDatabase(formData.date_of_birth),
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);
      if (profileError) throw new Error('Failed to update profile');

      // Delete existing subjects. If this fails, stop here rather than inserting on top of
      // whatever rows are already there (which would create duplicates) and telling the user
      // the save succeeded when the subjects half of it didn't.
      const { error: deleteError } = await supabase
        .from('student_subjects')
        .delete()
        .eq('student_id', user.id);
      if (deleteError) throw new Error('Failed to update subjects');

      if (studentSubjects.length > 0) {
        const { error: insertError } = await supabase
          .from('student_subjects')
          .insert(
            studentSubjects.map(subjectId => ({
              student_id: user.id,
              subject_id: subjectId,
            }))
          );
        if (insertError) throw new Error('Failed to update subjects');
      }
    },
    onSuccess: () => {
      // Replaces the old manual re-fetch-then-setProfile: invalidating lets
      // react-query re-pull the row (picking up the DB-computed `age`) and
      // keeps every other reader of this same cache key in sync too.
      queryClient.invalidateQueries({ queryKey: ['profile', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['studentSubjectIds', user?.id] });
      toast.success('Profile updated successfully');
    },
    onError: (error) => {
      if (import.meta.env.DEV) {
        console.error('Error saving:', error);
      }
      toast.error(error instanceof Error ? error.message : 'Failed to update profile');
    },
  });
  const saving = saveMutation.isPending;

  const handleSave = () => {
    if (!user || !profile) return;
    if (!validateRequiredFields()) return;
    saveMutation.mutate();
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <ControlBlock mode="dark">
          <div className="flex animate-pulse items-center gap-4">
            <div className="h-14 w-14 flex-none rounded-full bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-40 rounded-full bg-white/10" />
              <div className="h-3 w-28 rounded-full bg-white/10" />
            </div>
          </div>
          <div className="mt-[18px] grid grid-cols-3 gap-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.08]" />
            ))}
          </div>
        </ControlBlock>
        <PageContainer as="main" className="flex flex-col gap-7 py-5">
          <ListLoading count={3} media={0} lines={2} />
        </PageContainer>
      </div>
    );
  }

  if (!profile || profile.role !== 'student') {
    return (
      <div className="min-h-screen bg-background">
        <main className="px-4 py-16 text-center sm:py-20">
          <h1 className="font-display text-page-title font-extrabold tracking-tight text-foreground">
            {user ? 'Student account required' : 'Sign in required'}
          </h1>
          <p className="mt-3 text-body-secondary text-muted-foreground">
            {user
              ? 'This dashboard is only available to student accounts.'
              : 'Please sign in to view your dashboard.'}
          </p>
          <Button variant="primary" size={44} className="mt-6" onClick={() => navigate(user ? '/' : '/auth')}>
            {user ? 'Go Home' : 'Sign In'}
          </Button>
        </main>
      </div>
    );
  }

  // Get user email and name from auth (locked fields)
  const userEmail = user?.email || profile.email || '';
  const userName = user?.user_metadata?.full_name ||
                   user?.user_metadata?.name ||
                   profile.full_name ||
                   '';

  const subLineParts = [
    'Student',
    profile.grade ? `Class ${profile.grade}` : null,
    profile.school_board || null,
  ].filter(Boolean);

  // Three counters, C9 StatCard treatment on the dark control block — every
  // number here is a real query result (design.md §0.10): likedCount from
  // useLikes(), papersReadCount honestly nil until a reader exists (see
  // readingHistory comment above), papersContributedCount from a head-count
  // query against papers.created_by.
  const dashboardStats = [
    { label: 'Saved', value: likedCount },
    { label: 'Papers read', value: papersReadCount },
    { label: 'Papers contributed', value: papersContributedCount },
  ];

  const SAVED_TEACHERS_SHOWN = 6;
  const shownSavedTeachers = savedTeachers.slice(0, SAVED_TEACHERS_SHOWN);
  const hasMoreSavedTeachers = likedCount > shownSavedTeachers.length;

  // Profile-completeness bar — derived purely from already-loaded form state
  // (no new fetching). A PLAIN BAR, never GoalRing (that primitive is reserved
  // for the weekly paper goal only, per components.md P9 / owner instruction).
  const completenessChecks = [
    Boolean(formData.phone),
    Boolean(formData.date_of_birth),
    Boolean(formData.school_college),
    Boolean(formData.grade),
    Boolean(formData.school_board),
    Boolean(formData.address),
    studentSubjects.length > 0,
  ];
  const completenessFilled = completenessChecks.filter(Boolean).length;
  const completenessTotal = completenessChecks.length;
  const completenessPct = Math.round((completenessFilled / completenessTotal) * 100);

  const initial = (userName || userEmail || '?').trim().charAt(0).toUpperCase() || '?';

  const accountRows: {
    key: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    destructive?: boolean;
  }[] = [
    {
      key: 'profile',
      label: 'Profile information',
      icon: <UserRound className="h-4 w-4" strokeWidth={2} aria-hidden="true" />,
      onClick: () => setSettingsOpen(settingsOpen === 'profile' ? null : 'profile'),
    },
    {
      key: 'subjects',
      label: 'Subjects interested in',
      icon: <BookOpen className="h-4 w-4" strokeWidth={2} aria-hidden="true" />,
      onClick: () => setSettingsOpen(settingsOpen === 'subjects' ? null : 'subjects'),
    },
    {
      key: 'favourites',
      label: 'Favourite teachers',
      icon: <Heart className="h-4 w-4" strokeWidth={2} aria-hidden="true" />,
      onClick: () => navigate('/liked-teachers'),
    },
    /* account-04-student-account.png lists "My teachers" here. The route
       exists and works; it was reachable only from the hamburger menu, not from
       the student's own account list where the mockup puts it. */
    {
      key: 'my-teachers',
      label: 'My teachers',
      icon: <GraduationCap className="h-4 w-4" strokeWidth={2} aria-hidden="true" />,
      onClick: () => navigate('/my-teachers'),
    },
    /* The mockup also lists "Notifications", but nothing backs it — there is no
       notifications table, no route, and no UI anywhere in the codebase. This
       row navigated to /notifications, which is not a declared route, so it
       dropped the user on the 404 page. A menu item that 404s is worse than an
       absent one, and design.md §0.10's rule against showing what cannot be
       fetched applies to destinations as much as to counts. Restore it when
       there is something to notify about. */
    {
      key: 'privacy',
      label: 'Privacy & terms',
      icon: <ShieldCheck className="h-4 w-4" strokeWidth={2} aria-hidden="true" />,
      /* Was '/privacy', which is not a route either — the page is
         /privacy-policy. Second dead destination in the same list. */
      onClick: () => navigate('/privacy-policy'),
    },
    {
      key: 'sign-out',
      label: 'Sign out',
      icon: <LogOut className="h-4 w-4" strokeWidth={2} aria-hidden="true" />,
      onClick: handleSignOut,
      destructive: true,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Control block — S9 header: avatar, name, role/class subline, settings
          disc, and the three-counter stat row (components.md C9). */}
      <ControlBlock mode="dark">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-brand font-display text-card-title-lg font-black text-brand-foreground">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-card-title-lg font-extrabold tracking-tight text-background">
              {userName || 'Your account'}
            </h1>
            <p className="mt-0.5 truncate text-body-secondary text-background/60">
              {subLineParts.join(' · ')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(settingsOpen === 'profile' ? null : 'profile')}
            aria-label="Open profile settings"
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-white/10 transition-colors duration-150 hover:bg-white/20 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Settings className="h-[17px] w-[17px] text-background" strokeWidth={2.1} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-[18px] grid grid-cols-3 gap-2">
          {dashboardStats.map((st) => (
            <div key={st.label} className="rounded-2xl bg-white/[0.08] p-3">
              <div className="font-display text-card-title-lg font-black tabular-nums tracking-tight text-background">
                {st.value}
              </div>
              <div className="mt-0.5 text-label text-background/60">{st.label}</div>
            </div>
          ))}
        </div>
      </ControlBlock>

      <PageContainer as="main" className="flex flex-col gap-7 py-5">
        {/* Teachers you saved */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-section-head font-extrabold tracking-tight text-foreground">
              <IconDisc tone="brand-subtle" size={32} shape="square">
                <Heart className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </IconDisc>
              Teachers you saved
            </h2>
            {hasMoreSavedTeachers && (
              <Link
                to="/liked-teachers"
                className="whitespace-nowrap text-body-secondary font-semibold text-brand-blue transition-colors duration-150 hover:text-brand-blue-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                All {likedCount}
              </Link>
            )}
          </div>

          {savedTeachersLoading ? (
            <ListLoading count={3} media={0} lines={2} />
          ) : savedTeachersError ? (
            <ListError onRetry={() => window.location.reload()} />
          ) : shownSavedTeachers.length > 0 ? (
            <>
              <div className="flex flex-col gap-2">
                {shownSavedTeachers.map((teacher) => (
                  <TeacherCard
                    key={teacher.id}
                    id={teacher.id}
                    name={teacher.name}
                    slug={teacher.slug}
                    subject={teacher.subjects?.name || 'Tuition Teacher'}
                    imageUrl={teacher.image_url || undefined}
                    sirMaam={teacher.sirMaam}
                    variant="row"
                  />
                ))}
              </div>
              {!hasMoreSavedTeachers && <ListEnd count={likedCount} />}
            </>
          ) : (
            <ListEmpty line="No saved teachers yet. Tap the mark on any card and they wait for you here." />
          )}
        </section>

        {/* Recently opened papers — no reading-progress/resume feature exists (see
            comment near readingHistory above), so the copy here promises only
            what actually happens: papers you've opened. */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-display text-section-head font-extrabold tracking-tight text-foreground">
            <IconDisc tone="papers-subtle" size={32} shape="square">
              <BookOpen className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </IconDisc>
            Recently opened papers
          </h2>
          {readingHistory.length > 0 ? (
            <div className="flex flex-col gap-2">
              {readingHistory.map(({ paper }) => (
                <PaperCard key={paper.id} paper={paper} variant="compact" />
              ))}
            </div>
          ) : (
            <ListEmpty line="No papers read yet. Pick one from your class and it lands on your shelf." />
          )}
        </section>

        {/* Profile completeness — PLAIN BAR (GoalRing is reserved for the weekly
            paper goal only). Computed from the loaded profile fields. */}
        <section className="flex items-center gap-4 rounded-2xl bg-card p-4 shadow-border sm:p-6">
          <IconDisc tone="brand-subtle" size={44}>
            <UserRound className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </IconDisc>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body font-semibold text-foreground">Profile completeness</span>
              <span className="whitespace-nowrap text-body-secondary font-bold tabular-nums text-foreground">
                {completenessPct}%
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-brand transition-[width] duration-300"
                style={{ width: `${completenessPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-meta text-muted-foreground tabular-nums">
              {completenessFilled} of {completenessTotal} fields filled
            </p>
          </div>
        </section>

        {/* Account settings list */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-display text-section-head font-extrabold tracking-tight text-foreground">
            <IconDisc tone="muted" size={32} shape="square">
              <Settings className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </IconDisc>
            Account
          </h2>
          <div className="overflow-hidden rounded-2xl bg-card shadow-border">
            {accountRows.map((row, i) => (
              <button
                key={row.key}
                type="button"
                onClick={row.onClick}
                aria-expanded={
                  (row.key === 'profile' || row.key === 'subjects') ? settingsOpen === row.key : undefined
                }
                className={`flex min-h-[52px] w-full items-center gap-3 p-4 text-left transition-colors duration-150 hover:bg-accent active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                  i > 0 ? 'border-t border-border' : ''
                }`}
              >
                <IconDisc tone="muted" size={36} shape="square">
                  {row.icon}
                </IconDisc>
                <span
                  className={`flex-1 text-body-secondary font-semibold ${
                    row.destructive ? 'text-destructive' : 'text-foreground'
                  }`}
                >
                  {row.label}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-warm-label" strokeWidth={2.4} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>

        {/* Profile information — real editable form (profiles + student_subjects),
            revealed from the "Profile information" / "Subjects interested in"
            settings rows above so the machinery stays on this one page. */}
        {(settingsOpen === 'profile' || settingsOpen === 'subjects') && (
          <section className="space-y-6 rounded-2xl bg-card p-5 shadow-border sm:p-8">
            {settingsOpen === 'profile' && (
              <>
                {/* Locked Fields Section */}
                <div className="space-y-4 border-b border-border pb-6">
                  <h3 className="flex items-center gap-2 text-body font-semibold text-foreground">
                    <Lock className="h-4 w-4 text-warm-meta" aria-hidden="true" />
                    Account information
                  </h3>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="accountName" className={LABEL_CLASSNAME}>
                        Name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="accountName"
                        value={userName}
                        disabled
                        className={LOCKED_FIELD_CLASSNAME}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="accountEmail" className={LABEL_CLASSNAME}>
                        Email <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="accountEmail"
                        value={userEmail}
                        disabled
                        className={LOCKED_FIELD_CLASSNAME}
                      />
                    </div>
                  </div>
                </div>

                {/* Editable Fields Section */}
                <div className="space-y-4">
                  <h3 className="text-body font-semibold text-foreground">Profile information</h3>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="phone" className={LABEL_CLASSNAME}>
                        Phone Number <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="phone"
                        name="phone"
                        type="tel"
                        autoComplete="tel"
                        placeholder="10-digit phone number"
                        value={formData.phone}
                        onChange={handleInputChange}
                        maxLength={10}
                        inputMode="numeric"
                        className={`w-full ${FIELD_CLASSNAME}`}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="date_of_birth" className={LABEL_CLASSNAME}>
                        Date of Birth <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="date_of_birth"
                        name="date_of_birth"
                        type="text"
                        placeholder="DD-MM-YYYY (e.g., 15-03-2010)"
                        value={formData.date_of_birth}
                        onChange={handleInputChange}
                        maxLength={10}
                        className={`w-full ${FIELD_CLASSNAME}`}
                      />
                      {formData.date_of_birth && !isValidDateFormat(formData.date_of_birth) && (
                        <p className="text-meta text-destructive">Please enter a valid date in DD-MM-YYYY format</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="school_college" className={LABEL_CLASSNAME}>
                        School/College <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="school_college"
                        name="school_college"
                        type="text"
                        placeholder="Enter school or college name"
                        value={formData.school_college}
                        onChange={handleInputChange}
                        className={FIELD_CLASSNAME}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="grade" className={LABEL_CLASSNAME}>
                        Grade <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={formData.grade || "__none__"}
                        onValueChange={(value) => setFormData({ ...formData, grade: value === "__none__" ? "" : value })}
                      >
                        <SelectTrigger id="grade" className={FIELD_CLASSNAME}>
                          <SelectValue placeholder="Select grade" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          <SelectItem value="1">Class 1</SelectItem>
                          <SelectItem value="2">Class 2</SelectItem>
                          <SelectItem value="3">Class 3</SelectItem>
                          <SelectItem value="4">Class 4</SelectItem>
                          <SelectItem value="5">Class 5</SelectItem>
                          <SelectItem value="6">Class 6</SelectItem>
                          <SelectItem value="7">Class 7</SelectItem>
                          <SelectItem value="8">Class 8</SelectItem>
                          <SelectItem value="9">Class 9</SelectItem>
                          <SelectItem value="10">Class 10</SelectItem>
                          <SelectItem value="11">Class 11</SelectItem>
                          <SelectItem value="12">Class 12</SelectItem>
                          <SelectItem value="UG, First Year">UG, First Year</SelectItem>
                          <SelectItem value="UG, Second Year">UG, Second Year</SelectItem>
                          <SelectItem value="UG, Third Year">UG, Third Year</SelectItem>
                          <SelectItem value="UG, Fourth Year">UG, Fourth Year</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label className={LABEL_CLASSNAME}>School Board (Optional)</Label>
                      {/* Segmented pill toggle — 5 fixed options. Tap the active pill
                          again to clear the selection. */}
                      <div className="flex flex-wrap gap-2" role="group" aria-label="School board">
                        {schoolBoards.map((board) => {
                          const selected = formData.school_board === board;
                          return (
                            <button
                              key={board}
                              type="button"
                              aria-pressed={selected}
                              onClick={() =>
                                setFormData({ ...formData, school_board: selected ? '' : board })
                              }
                              className={`min-h-11 rounded-full px-4 text-body-secondary font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                                selected
                                  ? 'bg-brand-blue text-brand-blue-foreground'
                                  : 'bg-muted text-foreground hover:bg-accent'
                              }`}
                            >
                              {board}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="guardian_email" className={LABEL_CLASSNAME}>Guardian's Email (Optional)</Label>
                      <Input
                        id="guardian_email"
                        name="guardian_email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="guardian@example.com"
                        value={formData.guardian_email}
                        onChange={handleInputChange}
                        className={FIELD_CLASSNAME}
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="address" className={LABEL_CLASSNAME}>Address (Optional)</Label>
                      <Textarea
                        id="address"
                        name="address"
                        placeholder="Enter your address"
                        value={formData.address}
                        onChange={handleInputChange}
                        rows={3}
                        className={`${FIELD_CLASSNAME} min-h-[88px] py-3`}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {settingsOpen === 'subjects' && (
              <div className="space-y-3">
                <Label className={LABEL_CLASSNAME}>Subjects interested in</Label>
                <div
                  className={`grid max-h-64 grid-cols-2 gap-3 overflow-y-auto p-4 md:grid-cols-3 lg:grid-cols-4 ${OPTION_GROUP_CLASSNAME}`}
                >
                  {subjects.map((subject) => (
                    <div key={subject.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`subject-${subject.id}`}
                        checked={studentSubjects.includes(subject.id)}
                        onCheckedChange={() => handleSubjectToggle(subject.id)}
                      />
                      <Label
                        htmlFor={`subject-${subject.id}`}
                        className="cursor-pointer text-body-secondary font-normal text-warm-prose"
                      >
                        {subject.name}
                      </Label>
                    </div>
                  ))}
                </div>
                {subjects.length === 0 && (
                  <p className="text-body-secondary text-warm-meta">No subjects available</p>
                )}
              </div>
            )}

            <div className="border-t border-border pt-6">
              <Button
                onClick={handleSave}
                disabled={saving}
                variant="primary"
                size={52}
                className="w-full gap-2 md:w-auto"
              >
                <Save className="w-4 h-4" aria-hidden="true" />
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </section>
        )}
      </PageContainer>
    </div>
  );
}
