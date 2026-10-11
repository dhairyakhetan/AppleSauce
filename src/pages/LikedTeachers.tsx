/**
 * NOT ROUTED. Nothing imports this file, so it has no URL and Rollup leaves it
 * out of the bundle entirely -- verified by taking prose strings that appear in
 * this file and nowhere else in src/, then searching every built chunk for
 * them: none are present.
 *
 * It is kept on purpose, as a saved-teachers list that may be wanted later, not
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
import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { getTeachersByIds } from '@/lib/teachers';
import { TeacherCard } from '@/components/TeacherCard';
import { useAuth } from '@/lib/auth-context';
import { useLikes } from '@/lib/likes-context';
import { useRequireRole } from '@/hooks/use-require-role';
import { Button } from '@/components/ui/button';
import { adminToast } from '@/components/AdminConsole';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { ListLoading, ListError, ListEnd } from '@/components/ui/list-states';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useChromeConfig } from '@/components/layout/AppShell';

interface LikedTeacher {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  subjects: { name: string; slug: string } | null;
  sirMaam?: string | null;
}

// Handoff LT-001 / H-005a rule 4: counts under ten are spelled out, ten and
// above are numerals.
const SPELLED_COUNTS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function spellCount(n: number): string {
  const word = n < 10 ? SPELLED_COUNTS[n] : String(n);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export default function LikedTeachers() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { likedTeacherIds, loading: likesLoading, toggleLike } = useLikes();
  // Every teacher we've ever fetched details for this session, keyed by id. Never pruned on
  // unlike, so an unlike is an instant local filter (optimistic) and Undo is instant too, since
  // the restored teacher's data is already sitting in this cache — no re-fetch needed either way.
  const [teacherCache, setTeacherCache] = useState<Map<string, LikedTeacher>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  // Ensure user has selected a role
  useRequireRole();

  // Handoff LT: this route renders its own eyes panel, replacing AppShell's
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

    async function fetchMissingTeachers() {
      setError(false);
      const missingIds = Array.from(likedTeacherIds).filter((id) => !teacherCache.has(id));

      if (missingIds.length === 0) {
        if (!likesLoading) setLoading(false);
        return;
      }

      try {
        const teachersWithSirMaam = await getTeachersByIds(missingIds);

        if (teachersWithSirMaam.length === 0) {
          setLoading(false);
          return;
        }

        setTeacherCache((prev) => {
          const next = new Map(prev);
          teachersWithSirMaam.forEach((t) => next.set(t.id, t));
          return next;
        });
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error('Error fetching liked teachers:', err);
        }
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchMissingTeachers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, likedTeacherIds, likesLoading, navigate, retryToken]);

  // Tapping the heart on a card unlikes through useLikes() directly (the same hook this page
  // reads from), so the grid below already drops the card the instant likedTeacherIds shrinks —
  // that's the "optimistic" removal. This effect only adds the Undo affordance on top: it diffs
  // likedTeacherIds against the previous render to notice a removal, then shows a toast whose
  // Undo button re-likes the same teacher (already cached above, so it reappears instantly too).
  const prevIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const prev = prevIdsRef.current;
    if (prev) {
      prev.forEach((id) => {
        if (!likedTeacherIds.has(id)) {
          const teacher = teacherCache.get(id);
          adminToast(teacher ? `Removed ${teacher.name} from favourites` : 'Removed from favourites', {
            undo: () => {
              toggleLike(id);
            },
          });
        }
      });
    }
    prevIdsRef.current = new Set(likedTeacherIds);
  }, [likedTeacherIds, teacherCache, toggleLike]);

  const likedTeachers = Array.from(likedTeacherIds)
    .map((id) => teacherCache.get(id))
    .filter((t): t is LikedTeacher => Boolean(t));

  if (!user) return null; // Redirect effect above handles navigation.

  // Show loading only if we don't have any teachers yet — real emptiness (likedCount === 0 once
  // both this page's own fetch and the shared likes context have settled) skips straight to the
  // empty state below instead of skeletons that would never resolve into cards.
  const showSkeleton = (loading || likesLoading) && !error && likedTeachers.length === 0;
  const count = likedTeachers.length;

  return (
    <div className="min-h-screen bg-background">
      <main>
        <BentoStack>
          {/* Handoff LT-001: header states the count in words. */}
          <BentoPanel fill="card" edge="top" className="pt-[14px] pb-5">
            <p className="text-[13px] font-medium text-warm-secondary">Your shortlist</p>
            <h1 className="mt-1 font-display text-[27px] font-normal leading-[1.05] tracking-[-0.035em] text-foreground">
              {count > 0 ? (
                <>
                  {spellCount(count)} teacher{count === 1 ? '' : 's'} <span className="font-black">you saved</span>
                </>
              ) : (
                <>
                  Nothing saved <span className="font-black">yet</span>
                </>
              )}
            </h1>
            <p className="mt-1 text-[15px] text-warm-secondary">
              Saved teachers stay here until you remove them. Tap the heart on any profile to add one.
            </p>
          </BentoPanel>

          {showSkeleton ? (
            <BentoPanel fill="card" className="px-4 py-[18px]">
              <ListLoading count={5} media={0} lines={3} />
            </BentoPanel>
          ) : error && likedTeachers.length === 0 ? (
            <BentoPanel fill="card" className="px-4 py-[18px]">
              <ListError onRetry={() => setRetryToken((t) => t + 1)} />
            </BentoPanel>
          ) : likedTeachers.length === 0 ? (
            // Handoff LT-003: empty state is the page — one heading, one line,
            // exactly one action. No second action, no apology.
            <BentoPanel fill="brandTint" className="p-[26px_22px]">
              <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-brand">
                <Heart className="h-5 w-5 fill-brand-foreground text-brand-foreground" />
              </span>
              <p className="mt-[18px] font-display text-[23px] font-extrabold tracking-[-0.04em] text-brand-deep">
                Tap the heart on any teacher
              </p>
              <p className="mt-1.5 text-[15px] leading-[1.55] text-warm-prose">
                Save a teacher's profile and it shows up here.
              </p>
              <Button asChild variant="primary" size={52} className="mt-4">
                <Link to="/all-tuition-teachers-in-kolkata">Browse teachers</Link>
              </Button>
            </BentoPanel>
          ) : (
            // Handoff LT-002: list, rows in bg-muted (TeacherCard row variant),
            // trailing action is the 44x44 bg-card filled-heart unsave button.
            <BentoPanel fill="card" className="px-4 py-[18px]">
              <ul className="flex flex-col gap-2.5">
                {likedTeachers.map((teacher) => (
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
                        showUpvotes={false}
                        hideFavourite
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleLike(teacher.id)}
                      aria-label={`Remove ${teacher.name} from favourites`}
                      className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-card transition-transform duration-tap active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <Heart className="h-4 w-4 fill-destructive text-destructive" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <ListEnd count={likedTeachers.length} />
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
