/**
 * NOT ROUTED. Nothing imports this file, so it has no URL and Rollup leaves it
 * out of the bundle entirely -- verified by taking prose strings that appear in
 * this file and nowhere else in src/, then searching every built chunk for
 * them: none are present.
 *
 * It is kept on purpose, as a contacted-teachers list that may be wanted later, not
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
import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { X, ArrowRight } from 'lucide-react';
import { getTeachersByIds } from '@/lib/teachers';
import { TeacherCard } from '@/components/TeacherCard';
import { useAuth } from '@/lib/auth-context';
import { useStudiesWith } from '@/lib/studies-with-context';
import { useRequireRole } from '@/hooks/use-require-role';
import { Button } from '@/components/ui/button';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { ListLoading, ListError, ListEnd } from '@/components/ui/list-states';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useChromeConfig } from '@/components/layout/AppShell';

interface MyTeacher {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  subjects: { name: string; slug: string } | null;
  sirMaam?: string | null;
}

// Handoff LT-001 / H-005a rule 4 (also applied to this shelf page, per
// MT-001's shared-shell instruction): counts under ten are spelled out.
const SPELLED_COUNTS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function spellCount(n: number): string {
  const word = n < 10 ? SPELLED_COUNTS[n] : String(n);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export default function MyTeachers() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { studiesWithTeacherIds, loading: studiesWithLoading, toggleStudiesWith } = useStudiesWith();
  const [myTeachers, setMyTeachers] = useState<MyTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  // Ensure user has selected a role
  useRequireRole();

  // Handoff MT: this route renders its own eyes panel, replacing AppShell's
  // default pre-footer (same pattern as Account.tsx's AC-007).
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }

    async function fetchMyTeachers() {
      setError(false);

      // Don't wait for studiesWithLoading - fetch teachers immediately
      // We know these are teachers the student studies with since we're on the my teachers page
      if (studiesWithTeacherIds.size === 0 && !studiesWithLoading) {
        setMyTeachers([]);
        setLoading(false);
        return;
      }

      // If studies-with are still loading but we have some IDs, proceed anyway
      const teacherIds = Array.from(studiesWithTeacherIds);
      if (teacherIds.length === 0 && studiesWithLoading) {
        return; // Wait for studies-with to load
      }

      try {
        const teachersWithSirMaam = await getTeachersByIds(teacherIds);

        if (teachersWithSirMaam.length === 0) {
          setMyTeachers([]);
          setLoading(false);
          return;
        }

        setMyTeachers(teachersWithSirMaam);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error('Error fetching my teachers:', err);
        }
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchMyTeachers();
  }, [user, studiesWithTeacherIds, navigate, studiesWithLoading, retryToken]);

  if (!user) return null; // Redirect effect above handles navigation.

  const showSkeleton = loading && !error && myTeachers.length === 0;
  const count = myTeachers.length;
  // MT-002's review prompt names one teacher to review — the most recently
  // fetched entry on this list is the best available signal (there is no
  // "last contacted" timestamp on student_teachers to sort by).
  const reviewTarget = myTeachers[0];

  return (
    <div className="min-h-screen bg-background">
      <main>
        <BentoStack>
          {/* Handoff MT-001, adapted (see commit message): this route lists
              teachers the student has explicitly marked "studies with"
              (student_teachers, real Supabase data via useStudiesWith), not a
              WhatsApp-contacted history — that concept already lives on
              Account.tsx's own "Contacted" tab, backed by a different,
              device-local record (src/lib/contact-record.ts). Applying
              MT-001 literally here would relabel a real, working feature as
              something it factually is not, so the shared shelf-page shell
              (header/list/empty/eyes/footer) is kept but the copy and
              trailing action are adapted to what this page actually does. */}
          <BentoPanel fill="card" edge="top" className="pt-[14px] pb-5">
            <Link
              to="/dashboard/student"
              className="-mt-1 mb-3 inline-flex min-h-11 items-center text-[13px] font-semibold text-warm-secondary transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
            >
              {'←'} Back to dashboard
            </Link>
            <p className="text-[13px] font-medium text-warm-secondary">Teachers you study with</p>
            <h1 className="mt-1 font-display text-[27px] font-normal leading-[1.05] tracking-[-0.035em] text-foreground">
              {count > 0 ? (
                <>
                  {spellCount(count)} teacher{count === 1 ? '' : 's'} <span className="font-black">you study with</span>
                </>
              ) : (
                <>
                  No teachers <span className="font-black">yet</span>
                </>
              )}
            </h1>
            <p className="mt-1 text-[15px] text-warm-secondary">
              Mark a teacher as "studies with" from their profile and they turn up here.
            </p>
          </BentoPanel>

          {showSkeleton ? (
            <BentoPanel fill="card" className="px-4 py-[18px]">
              <ListLoading count={5} media={0} lines={3} />
            </BentoPanel>
          ) : error && myTeachers.length === 0 ? (
            <BentoPanel fill="card" className="px-4 py-[18px]">
              <ListError onRetry={() => setRetryToken((t) => t + 1)} />
            </BentoPanel>
          ) : myTeachers.length === 0 ? (
            // Empty state per LT-003's shape: one heading, one line, one action.
            <BentoPanel fill="brandTint" className="p-[26px_22px]">
              <p className="font-display text-[23px] font-extrabold tracking-[-0.04em] text-brand-deep">
                No teachers yet
              </p>
              <p className="mt-1.5 text-[15px] leading-[1.55] text-warm-prose">
                No saved teachers yet. Tap the mark on any card and they wait for you here.
              </p>
              <Button asChild variant="primary" size={52} className="mt-4">
                <Link to="/all-tuition-teachers-in-kolkata">Browse teachers</Link>
              </Button>
            </BentoPanel>
          ) : (
            <BentoPanel fill="card" className="px-4 py-[18px]">
              <ul className="flex flex-col gap-2.5">
                {myTeachers.map((teacher) => (
                  <li key={teacher.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <TeacherCard
                        id={teacher.id}
                        name={teacher.name}
                        slug={teacher.slug}
                        subject={teacher.subjects?.name || 'Tuition Teacher'}
                        imageUrl={teacher.image_url || undefined}
                        subjectSlug={teacher.subjects?.slug}
                        sirMaam={teacher.sirMaam}
                        variant="row"
                        hideFavourite
                      />
                    </div>
                    {/* Real trailing action for this real feature: un-mark
                        "studies with" (toggleStudiesWith), not a WhatsApp
                        reopen-chat disc — there is no chat to reopen from this
                        relationship. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleStudiesWith(teacher.id);
                      }}
                      aria-label={`Remove ${teacher.name} from my teachers`}
                      className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-card transition-transform duration-tap active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <X className="h-4 w-4 text-foreground" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <ListEnd count={myTeachers.length} />
            </BentoPanel>
          )}

          {/* Handoff MT-002, adapted: the review sheet (write-review-sheet.tsx)
              lives on the teacher's own profile page, gated there on a
              recorded WhatsApp contact (TeacherComments.tsx) — a gate this
              page has no way to evaluate for a whole list at once, and
              reimplementing it here would duplicate a submission handler
              outside this task's scope. This row instead points at the most
              relevant teacher's profile, where the real sheet already lives. */}
          {reviewTarget && (
            <BentoPanel fill="card">
              <Link
                to={`/tuition-teachers/${reviewTarget.slug}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-2xl transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span>
                  <span className="block text-[15px] font-bold text-foreground">How did it go?</span>
                  <span className="mt-0.5 block text-[14px] text-warm-secondary">
                    Leave a review so the next parent knows.
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 flex-none text-warm-meta" aria-hidden />
              </Link>
            </BentoPanel>
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
