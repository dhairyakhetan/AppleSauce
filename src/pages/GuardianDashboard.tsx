/**
 * NOT ROUTED. Nothing imports this file, so it has no URL and Rollup leaves it
 * out of the bundle entirely -- verified by taking prose strings that appear in
 * this file and nowhere else in src/, then searching every built chunk for
 * them: none are present.
 *
 * It is kept on purpose, as a guardian-facing dashboard that may be wanted later, not
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
import { useNavigate, Link } from 'react-router-dom';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { ListEmpty } from '@/components/ui/list-states';
import { IconDisc } from '@/components/ui/icon-disc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Save,
  Lock,
  BookOpen,
  UserCog,
  GraduationCap,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLikes } from '@/lib/likes-context';
import { useStudiesWith } from '@/lib/studies-with-context';
import {
  formatDateForDisplay,
  formatDateForDatabase,
  isValidDateFormat,
  formatDateInput,
} from '@/lib/date-helpers';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useChromeConfig } from '@/components/layout/AppShell';

interface Subject {
  id: string;
  name: string;
  slug: string;
}

interface Profile {
  id: string;
  role: 'student' | 'guardian' | 'teacher';
  full_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  relationship_to_student: string | null;
  student_name: string | null;
  student_date_of_birth: string | null;
  student_age: number | null;
  student_grade: string | null;
  student_school_board: string | null;
}

// Profile form field/label styling, on the token system so the editable form matches the rest
// of the page instead of falling back to shadcn's bare default input styling.
const FIELD_CLASSNAME =
  'h-auto min-h-12 rounded-lg border-0 bg-background text-base shadow-border focus-visible:ring-0 focus-visible:ring-offset-0';
const LOCKED_FIELD_CLASSNAME = `${FIELD_CLASSNAME} cursor-not-allowed opacity-70`;
const LABEL_CLASSNAME = 'mb-1.5 block text-sm font-semibold text-foreground';
const OPTION_GROUP_CLASSNAME = 'rounded-2xl bg-background shadow-border';

// Section-heading pattern (design.md §1): icon tile + name.
function SectionHeading({
  icon,
  children,
  action,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-display text-xl font-extrabold tracking-tight text-foreground">
        <IconDisc tone="muted" size={32} shape="square">
          {icon}
        </IconDisc>
        {children}
      </h2>
      {action}
    </div>
  );
}

export default function GuardianDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [boards, setBoards] = useState<string[]>([]);
  const [studentSubjects, setStudentSubjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { likedCount } = useLikes();
  const { studiesWithCount } = useStudiesWith();
  const [formData, setFormData] = useState({
    phone: '',
    address: '',
    relationship_to_student: '',
    student_name: '',
    student_date_of_birth: '',
    student_grade: '',
    student_school_board: '',
  });

  // Handoff GD: this route renders its own eyes panel, replacing AppShell's
  // default pre-footer (same pattern as Account.tsx's AC-007).
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();

  // Redirect if not authenticated or not a guardian
  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
      return;
    }
    if (!loading && profile && profile.role !== 'guardian') {
      navigate('/');
      return;
    }
  }, [user, profile, loading, navigate]);

  // Fetch profile and subjects
  useEffect(() => {
    async function fetchData() {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        // These four queries are independent of one another (profile and guardianSubjects are
        // keyed off user.id, subjects and the Shikshaqmine board list are global lookups) so
        // they run concurrently via Promise.all instead of four sequential round-trips.
        const [
          { data: profileData, error: profileError },
          { data: subjectsData },
          { data: shikshaqData },
          { data: guardianSubjectsData },
        ] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', user.id).single(),
          supabase.from('subjects').select('*').order('name'),
          supabase.from('Shikshaqmine').select('"School Boards Catered"'),
          supabase.from('guardian_student_subjects').select('subject_id').eq('guardian_id', user.id),
        ]);

        if (profileError) {
          if (import.meta.env.DEV) {
            console.error('Error fetching profile:', profileError);
          }
          setLoading(false);
          return;
        }

        setProfile(profileData as Profile);

        // Populate form
        if (profileData) {
          setFormData({
            phone: profileData.phone || '',
            address: profileData.address || '',
            relationship_to_student: profileData.relationship_to_student || '',
            student_name: profileData.student_name || '',
            student_date_of_birth: formatDateForDisplay(profileData.student_date_of_birth),
            student_grade: profileData.student_grade || '',
            student_school_board: profileData.student_school_board || '',
          });
        }

        if (subjectsData) {
          setSubjects(subjectsData);
        }

        const boardSet = new Set<string>();
        if (shikshaqData) {
          shikshaqData.forEach((record) => {
            const boardsStr = record["School Boards Catered"];
            if (boardsStr) {
              // Split by comma and clean up
              const boardsList = boardsStr.split(',').map((b: string) => b.trim()).filter(Boolean);
              boardsList.forEach((board: string) => {
                if (board && board !== 'College') {
                  boardSet.add(board);
                }
              });
            }
          });
        }

        // Convert to array and sort, or use default list if none found
        const uniqueBoards = boardSet.size > 0
          ? Array.from(boardSet).sort()
          : ['CBSE', 'ICSE', 'IGCSE', 'IB', 'State Board'];
        setBoards(uniqueBoards);

        if (guardianSubjectsData) {
          setStudentSubjects(guardianSubjectsData.map(s => s.subject_id));
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('Error:', error);
        }
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [user]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;

    if (name === 'phone') {
      // For phone number, only allow numeric characters
      const numericValue = value.replace(/\D/g, '');
      setFormData({ ...formData, [name]: numericValue });
    } else if (name === 'student_date_of_birth') {
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

  const handleSave = async () => {
    if (!user || !profile) return;

    // Validate phone number if provided (must be exactly 10 digits)
    if (formData.phone.trim() && formData.phone.trim().length !== 10) {
      toast.error('Phone number must be exactly 10 digits');
      return;
    }

    // Validate date format if provided
    if (formData.student_date_of_birth && !isValidDateFormat(formData.student_date_of_birth)) {
      toast.error('Please enter a valid date in DD-MM-YYYY format (e.g., 15-03-2010)');
      return;
    }

    setSaving(true);

    try {
      // Update profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          phone: formData.phone || null,
          address: formData.address || null,
          relationship_to_student: formData.relationship_to_student || null,
          student_name: formData.student_name || null,
          student_date_of_birth: formatDateForDatabase(formData.student_date_of_birth),
          student_grade: formData.student_grade || null,
          student_school_board: formData.student_school_board || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (profileError) {
        if (import.meta.env.DEV) {
          console.error('Error updating profile:', profileError);
        }
        toast.error('Failed to update profile');
        setSaving(false);
        return;
      }

      // Update guardian student subjects
      // Delete existing subjects. If this fails, stop here rather than inserting on top of
      // whatever rows are already there (which would create duplicates) and telling the user
      // the save succeeded when the subjects half of it didn't.
      const { error: deleteError } = await supabase
        .from('guardian_student_subjects')
        .delete()
        .eq('guardian_id', user.id);

      if (deleteError) {
        if (import.meta.env.DEV) {
          console.error('Error deleting subjects:', deleteError);
        }
        toast.error('Failed to update subjects');
        setSaving(false);
        return;
      }

      // Insert new subjects
      if (studentSubjects.length > 0) {
        const { error: insertError } = await supabase
          .from('guardian_student_subjects')
          .insert(
            studentSubjects.map(subjectId => ({
              guardian_id: user.id,
              subject_id: subjectId,
            }))
          );

        if (insertError) {
          if (import.meta.env.DEV) {
            console.error('Error inserting subjects:', insertError);
          }
          toast.error('Failed to update subjects');
          setSaving(false);
          return;
        }
      }

      // Refresh profile to get updated age
      const { data: updatedProfile, error: refreshError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (refreshError) toast.error('Saved, but we could not refresh your profile. Reload to see it.');

      if (updatedProfile) {
        setProfile(updatedProfile as Profile);
      }

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
          <BentoPanel fill="card" edge="top" className="pt-[14px] pb-5">
            <div className="flex animate-pulse items-center gap-[14px]">
              <div className="h-14 w-14 flex-none rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-40 rounded-full bg-muted" />
                <div className="h-3 w-28 rounded-full bg-muted" />
              </div>
            </div>
          </BentoPanel>
          <div className="flex gap-seam">
            {[...Array(3)].map((_, i) => (
              <BentoPanel key={i} fill="muted" className="flex-1 animate-pulse p-4">
                <div className="h-6 w-10 rounded-full bg-card" />
                <div className="mt-2 h-3 w-16 rounded-full bg-card" />
              </BentoPanel>
            ))}
          </div>
          <BentoPanel fill="card">
            <div className="animate-pulse space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-muted" />
              ))}
            </div>
          </BentoPanel>
        </BentoStack>
      </div>
    );
  }

  if (!profile || profile.role !== 'guardian') {
    return (
      <div className="min-h-screen bg-background">
        <main className="container py-16 pb-16 text-center sm:py-20">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {user ? 'Guardian account required' : 'Sign in required'}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {user
              ? 'This dashboard is only available to guardian accounts.'
              : 'Please sign in to view your dashboard.'}
          </p>
          <Button className="mt-6" onClick={() => navigate(user ? '/' : '/auth')}>
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
  const firstName = userName.split(' ')[0] || 'there';
  const avatarInitial = (userName.trim()[0] || firstName[0] || 'G').toUpperCase();

  const subLineParts = [
    'Guardian',
    profile.student_grade ? `Class ${profile.student_grade}` : null,
    profile.address || null,
  ].filter(Boolean);

  // Handoff GD-001: three real counters, each its own tinted panel. The
  // source entry assumes a Saved/Contacted/Papers trio (mirroring
  // StudentDashboard) — this dashboard's real three counters are "study
  // with" (student_teachers, via useStudiesWith), "saved" (liked_teachers,
  // via useLikes) and "subjects" (guardian_student_subjects, fetched above).
  // There is no guardian-side "contacted" or "papers" count to show, so the
  // three-tinted-panel treatment is kept but populated with the real three
  // numbers this page has always had, instead of relabelling them as
  // something they are not (design.md §0.10 — never a fabricated count).
  const dashboardStats: { label: string; value: number; fill: 'brandTint' | 'mint' | 'papersTint' }[] = [
    { label: 'study with', value: studiesWithCount, fill: 'brandTint' },
    { label: 'saved', value: likedCount, fill: 'mint' },
    { label: 'subjects', value: studentSubjects.length, fill: 'papersTint' },
  ];

  // Handoff GD-002: profile-completeness bar with a next-step line naming
  // what is actually missing — plain bar, never GoalRing (that device is
  // reserved for the weekly paper goal only). Derived from already-loaded
  // form state, no new fetching.
  const completenessChecks: { ok: boolean; label: string }[] = [
    { ok: Boolean(formData.phone), label: 'phone number' },
    { ok: Boolean(formData.address), label: 'address' },
    { ok: Boolean(formData.relationship_to_student), label: 'relationship to student' },
    { ok: Boolean(formData.student_name), label: "student's name" },
    { ok: Boolean(formData.student_date_of_birth), label: 'date of birth' },
    { ok: Boolean(formData.student_grade), label: 'class' },
    { ok: Boolean(formData.student_school_board), label: 'school board' },
    { ok: studentSubjects.length > 0, label: 'subjects' },
  ];
  const completenessFilled = completenessChecks.filter((c) => c.ok).length;
  const completenessTotal = completenessChecks.length;
  const completenessPct = Math.round((completenessFilled / completenessTotal) * 100);
  const missingLabels = completenessChecks.filter((c) => !c.ok).map((c) => c.label);

  return (
    <div className="min-h-screen bg-background">
      <main>
        <BentoStack>
          {/* Handoff GD-001: bone greeting panel — 56px avatar, h1, truncate sub-line. */}
          <BentoPanel fill="card" edge="top" className="pt-[14px] pb-5">
            <div className="flex items-center gap-[14px]">
              <span
                aria-hidden="true"
                className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-brand font-display text-[22px] font-black text-brand-foreground"
              >
                {avatarInitial}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="truncate font-display text-[24px] font-extrabold tracking-[-0.04em] text-foreground">
                  Hi, {firstName}
                </h1>
                <p className="mt-0.5 truncate text-[13px] text-warm-meta">
                  {subLineParts.join(' · ')}
                </p>
              </div>
            </div>
          </BentoPanel>

          {/* Handoff GD-001: three tinted counter panels in one row. */}
          <div className="flex gap-seam">
            {dashboardStats.map((st) => (
              <BentoPanel key={st.label} fill={st.fill} className="flex-1 p-4">
                <div className="font-display text-[24px] font-black tracking-[-0.04em] text-foreground tabular-nums">
                  {st.value}
                </div>
                <div className="mt-0.5 whitespace-nowrap text-[12px] font-bold uppercase tracking-[.04em] text-warm-secondary">
                  teachers {st.label}
                </div>
              </BentoPanel>
            ))}
          </div>

          {/* Handoff GD-002: profile completeness. */}
          <BentoPanel fill="card">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">
                {completenessFilled}/{completenessTotal} fields
              </span>
              <span className="text-[14px] font-extrabold tabular-nums text-brand-deep">{completenessPct}%</span>
            </div>
            <div className="relative mt-2 h-2 rounded-full bg-muted">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] duration-300 ease-out"
                style={{ width: `${completenessPct}%` }}
              />
            </div>
            {missingLabels.length > 0 && (
              <p className="mt-2.5 text-[14px] leading-[1.5] text-muted-foreground">
                Missing: {missingLabels.join(', ')}.
              </p>
            )}

            {/* Account settings — settings-list idiom. Each row is the guardian's own
                profile fields, or the multi-field student form, opened as an accordion so all of the
                original machinery (validation, subject toggles, save) survives without a second route. */}
            <div className="mt-5 rounded-[20px] bg-background">
              <Accordion type="multiple" className="w-full">
                {/* Locked account info row */}
                <AccordionItem value="account-info" className="border-b border-border/60 px-4 last:border-b-0">
                  <AccordionTrigger className="min-h-[44px] gap-3 py-[14px] text-left hover:no-underline">
                    <span className="flex flex-1 items-center gap-3">
                      <IconDisc tone="muted" size={36} shape="square">
                        <Lock className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                      </IconDisc>
                      <span className="text-[15px] font-semibold text-foreground">Account information</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="accountName" className={LABEL_CLASSNAME}>Name</Label>
                        <Input id="accountName" value={userName} disabled className={LOCKED_FIELD_CLASSNAME} />
                        <p className="text-xs text-muted-foreground">Imported from Google Auth</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="accountEmail" className={LABEL_CLASSNAME}>Email</Label>
                        <Input id="accountEmail" value={userEmail} disabled className={LOCKED_FIELD_CLASSNAME} />
                        <p className="text-xs text-muted-foreground">Imported from Google Auth</p>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {/* Guardian information row */}
                <AccordionItem value="guardian-info" className="border-b border-border/60 px-4 last:border-b-0">
                  <AccordionTrigger className="min-h-[44px] gap-3 py-[14px] text-left hover:no-underline">
                    <span className="flex flex-1 items-center gap-3">
                      <IconDisc tone="muted" size={36} shape="square">
                        <UserCog className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                      </IconDisc>
                      <span className="text-[15px] font-semibold text-foreground">Guardian information</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="phone" className={LABEL_CLASSNAME}>Phone Number (Optional)</Label>
                        <Input
                          id="phone"
                          name="phone"
                          type="tel"
                          placeholder="10-digit phone number"
                          value={formData.phone}
                          onChange={handleInputChange}
                          maxLength={10}
                          inputMode="numeric"
                          className={FIELD_CLASSNAME}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className={LABEL_CLASSNAME}>Relationship to Student (Optional)</Label>
                        {/* Segmented pill toggle — 4 fixed options. Tap the active pill again to clear. */}
                        <div className="flex flex-wrap gap-2" role="group" aria-label="Relationship to student">
                          {[
                            { value: 'parent', label: 'Parent' },
                            { value: 'sister/brother', label: 'Sister/Brother' },
                            { value: 'grandparent', label: 'Grandparent' },
                            { value: 'other', label: 'Other' },
                          ].map((option) => {
                            const selected = formData.relationship_to_student === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                aria-pressed={selected}
                                onClick={() =>
                                  setFormData({
                                    ...formData,
                                    relationship_to_student: selected ? '' : option.value,
                                  })
                                }
                                className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                                  selected
                                    ? 'bg-brand-blue text-brand-blue-foreground'
                                    : 'bg-muted text-foreground hover:bg-accent'
                                }`}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
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
                  </AccordionContent>
                </AccordionItem>

                {/* Student details + subjects row — the guardian-specific machinery, kept intact
                    and restyled into the settings-list idiom rather than dropped. */}
                <AccordionItem value="student-details" className="px-4">
                  <AccordionTrigger className="min-h-[44px] gap-3 py-[14px] text-left hover:no-underline">
                    <span className="flex flex-1 items-center gap-3">
                      <IconDisc tone="muted" size={36} shape="square">
                        <GraduationCap className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                      </IconDisc>
                      <span className="text-[15px] font-semibold text-foreground">Student details &amp; subjects</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="student_name" className={LABEL_CLASSNAME}>Student Name (Optional)</Label>
                        <Input
                          id="student_name"
                          name="student_name"
                          type="text"
                          placeholder="Enter student's name"
                          value={formData.student_name}
                          onChange={handleInputChange}
                          className={FIELD_CLASSNAME}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="student_date_of_birth" className={LABEL_CLASSNAME}>Student Date of Birth (Optional)</Label>
                        <Input
                          id="student_date_of_birth"
                          name="student_date_of_birth"
                          type="text"
                          placeholder="DD-MM-YYYY (e.g., 15-03-2010)"
                          value={formData.student_date_of_birth}
                          onChange={handleInputChange}
                          maxLength={10}
                          className={`w-full ${FIELD_CLASSNAME}`}
                        />
                        {formData.student_date_of_birth && !isValidDateFormat(formData.student_date_of_birth) && (
                          <p className="text-sm text-destructive">Please enter a valid date in DD-MM-YYYY format</p>
                        )}
                        {profile.student_age && (
                          <p className="text-xs text-muted-foreground">Age: {profile.student_age} years</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="student_grade" className={LABEL_CLASSNAME}>Student Class/Grade (Optional)</Label>
                        <Select
                          value={formData.student_grade || "__none__"}
                          onValueChange={(value) => setFormData({ ...formData, student_grade: value === "__none__" ? "" : value })}
                        >
                          <SelectTrigger id="student_grade" className={FIELD_CLASSNAME}>
                            <SelectValue placeholder="Select class/grade" />
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
                            <SelectItem value="1st year">1st Year</SelectItem>
                            <SelectItem value="2nd year">2nd Year</SelectItem>
                            <SelectItem value="3rd year">3rd Year</SelectItem>
                            <SelectItem value="4th year">4th Year</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="student_school_board" className={LABEL_CLASSNAME}>Student School Board (Optional)</Label>
                        <Select
                          value={formData.student_school_board || "__none__"}
                          onValueChange={(value) => setFormData({ ...formData, student_school_board: value === "__none__" ? "" : value })}
                        >
                          <SelectTrigger id="student_school_board" className={FIELD_CLASSNAME}>
                            <SelectValue placeholder="Select school board" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {boards.map((board) => (
                              <SelectItem key={board} value={board}>
                                {board}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Subjects Selection */}
                    <div className="space-y-3 border-t border-border pt-4 mt-4">
                      <Label className={LABEL_CLASSNAME}>Subjects Interested In (Optional)</Label>
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
                              className="cursor-pointer text-sm font-normal text-warm-prose"
                            >
                              {subject.name}
                            </Label>
                          </div>
                        ))}
                      </div>
                      {subjects.length === 0 && (
                        <p className="text-sm text-warm-meta">No subjects available</p>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>

            {/* Save Button — pinned below the accordion so it saves whichever section is open */}
            <Button
              onClick={handleSave}
              disabled={saving}
              variant="primary"
              size={52}
              className="mt-4 w-full gap-2 sm:w-auto"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </BentoPanel>

          {/* Handoff GD-003: the student shelf stays honestly empty — there is no
              reader-progress table, so this section must not fabricate reading
              activity. It states the reason and offers a real way to start one. */}
          <BentoPanel fill="card">
            <SectionHeading icon={<BookOpen className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />}>
              Recently opened papers
            </SectionHeading>
            <ListEmpty line="No papers read yet. Pick one from your class and it lands on your shelf." />
            <Button asChild variant="muted" size={48} className="mt-4">
              <Link to="/past-papers">Browse past papers</Link>
            </Button>
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
