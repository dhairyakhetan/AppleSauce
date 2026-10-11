import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, FileText, Heart, GraduationCap } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLikes } from '@/lib/likes-context';
import { TeacherCard } from '@/components/TeacherCard';
import { getRecentlyVisited, type RecentVisit } from '@/lib/recently-visited';
import { getTeachersByIds, type TeacherCardLite } from '@/lib/teachers';

// Small relative-time label for a Recently Visited row's `ts` field.
// No new dependency — just enough granularity to be useful ("2h ago",
// "Yesterday", "3d ago"), falling back to a short date beyond a week.
function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return 'Just now';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 2 * day) return 'Yesterday';
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// Bug 5 fix: this used to be its own supabase query selecting only the
// teachers_list `subjects` FK relation, with no fallback for the (common)
// case where that relation is null but the teacher has real subject data in
// Shikshaqmine — every such favourite fell straight to TeacherCard's generic
// "Tuition Teacher" fallback below. `getTeachersByIds` (used by LikedTeachers/
// MyTeachers/StudentDashboard/GuardianDashboard already) resolves that
// fallback correctly, so this section now reuses it instead of duplicating a
// half-working version of the same query.
type FavouriteTeacher = TeacherCardLite;

/* No container padding: this section is rendered only from Index.tsx, inside
   a <BentoPanel className="p-[22px]">, which already supplies the max-width
   column and the inset. Keeping `px-4 sm:px-6 lg:px-8` here stacked a second
   16px on top of the panel's 22px, so this block's content started at x=38
   while every other panel on the page started at x=22. */
const CONTAINER = 'w-full';
// Sits directly under the hero/greeting and right above the featured-teachers
// grid — a hero-scale gap here reads as dead air between two content blocks
// rather than a deliberate section break. One step down the §4 scale.
/* Matches the home page's section rhythm. Every other section on the route
   is py-8 sm:py-12; this one was py-12 sm:py-16 lg:py-20, so it sat in a
   visibly deeper well than its neighbours — measured 48/48 against everyone
   else's 32/32. */
const SECTION = '';

// Cap how many favourites the card-stack cycles through — matches the "peek a couple
// cards behind" device from the monday.com reference (04-monday-recently-visited-
// favourites.png), not meant to be a full paginator for every saved teacher.
const STACK_CAP = 4;

/**
 * Card-stack preview for Favourites (VISUAL_UPGRADE_PLAN.md row 1, ref 04) — one full,
 * interactive TeacherCard up front with 1-2 decorative cards peeking out behind it at a
 * slight offset/angle, plus pagination dots to bring a different favourite to the front.
 * Only the front card is a real link; the peeking cards are aria-hidden decoration so no
 * new, oddly-ordered tab stops get introduced.
 */
function FavouritesStack({ favourites }: { favourites: FavouriteTeacher[] }) {
  const [frontIndex, setFrontIndex] = useState(0);
  const shown = useMemo(() => favourites.slice(0, STACK_CAP), [favourites]);

  // Rotate the array so `frontIndex` is first — front card + up to 2 peeking behind it.
  const ordered = useMemo(() => {
    const i = frontIndex % shown.length;
    return [...shown.slice(i), ...shown.slice(0, i)];
  }, [shown, frontIndex]);

  const front = ordered[0];
  const backLayers = ordered.slice(1, 3);
  const overflowCount = favourites.length - shown.length;

  return (
    <div>
      <div className="relative mx-auto w-full max-w-[220px] sm:mx-0">
        {backLayers.map((t, i) => {
          const depth = i + 1; // 1 = closest peek, 2 = furthest
          return (
            <div
              key={t.id}
              aria-hidden="true"
              className="absolute inset-0 rounded-2xl bg-card shadow-border transition-transform duration-300 motion-reduce:transition-none"
              style={{
                transform: `translate(${depth * 10}px, ${depth * -10}px) rotate(${depth % 2 ? 5 : -5}deg) scale(${1 - depth * 0.05})`,
                zIndex: 10 - depth,
              }}
            />
          );
        })}
        <div className="relative" style={{ zIndex: 10 }}>
          <TeacherCard
            key={front.id}
            id={front.id}
            name={front.name}
            slug={front.slug}
            subject={front.subjects?.name || 'Tuition Teacher'}
            subjectSlug={front.subjects?.slug}
            imageUrl={front.image_url ?? undefined}
            size="sm"
          />
        </div>
      </div>

      {shown.length > 1 && (
        <div className="mt-4 flex items-center justify-center gap-1.5 sm:justify-start">
          {shown.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFrontIndex(i)}
              aria-label={`Show ${t.name} in favourites preview`}
              aria-current={ordered[0].id === t.id}
              /* M28: was transition-[width,background-color] -- width is not
                 composited, so this pill-grow animated on the main thread on
                 every tap. Fixed w-4 box + scale-x gets the same visual grow
                 from the compositor instead; origin-left keeps it anchored to
                 the same edge width used to. */
              className={`h-1.5 w-4 origin-left rounded-full transition-[transform,background-color] duration-150 motion-reduce:transition-colors ${
                ordered[0].id === t.id ? 'scale-x-100 bg-brand' : 'scale-x-[0.375] bg-hairline'
              }`}
            />
          ))}
          {overflowCount > 0 && (
            <span className="ml-1 text-xs text-warm-secondary">+{overflowCount} more</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "Your activity" — Favourites (account-linked via likes-context, same
 * Supabase + localStorage cache pattern as LikedTeachers.tsx) and Recently
 * visited (device-local only, see src/lib/recently-visited.ts — a fresh
 * device/browser starts empty even for a signed-in user; there is no
 * account-level sync for this yet).
 */
export function HomeActivitySection() {
  const { user } = useAuth();
  const { likedTeacherIds, loading: likesLoading, isLiked, toggleLike } = useLikes();
  const [favourites, setFavourites] = useState<FavouriteTeacher[]>([]);
  const [favouritesLoading, setFavouritesLoading] = useState(true);
  const [recent, setRecent] = useState<RecentVisit[]>([]);

  useEffect(() => {
    setRecent(getRecentlyVisited());
  }, []);

  useEffect(() => {
    if (!user || likedTeacherIds.size === 0) {
      setFavouritesLoading(false);
      return;
    }

    let cancelled = false;
    async function fetchFavourites() {
      const ids = Array.from(likedTeacherIds).slice(0, 6);
      // getTeachersByIds throws on a query error (the old inline supabase call
      // here just read `data` and ignored `error`) — caught so a transient
      // failure degrades to an empty favourites section instead of an
      // unhandled rejection on the home page.
      let data: FavouriteTeacher[] = [];
      try {
        data = await getTeachersByIds(ids);
      } catch {
        /* leave data empty — favourites section shows its empty state */
      }
      if (!cancelled) {
        setFavourites(data);
        setFavouritesLoading(false);
      }
    }
    fetchFavourites();
    return () => {
      cancelled = true;
    };
  }, [user, likedTeacherIds]);

  if (!user && recent.length === 0) {
    // Nothing to show for a signed-out visitor with no browsing history yet —
    // skip the section entirely rather than rendering two empty states.
    return null;
  }

  return (
    <section className={`${CONTAINER} ${SECTION}`}>
      {/* min-w-0 on the columns AND on each row below: grid items default to
          min-width:auto, so the truncating spans inside a row contributed their
          FULL untruncated text width to the column min-content. At 390px that
          computed a 429px column inside a 358px container and pushed the page
          56px wider than the viewport — invisible because html{overflow-x:hidden}
          silently cut it rather than letting it scroll. Only reproduced once the
          device had recently-visited history, which is why an empty first load
          looked fine. */}
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-6">
        {/* Favourites */}
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-brand" strokeWidth={2} aria-hidden="true" />
            <h2 className="text-subsection font-display font-bold">Favourites</h2>
          </div>

          {!user ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-hairline bg-warm-card p-6">
              <p className="text-sm text-warm-secondary">
                Sign in to save teachers you like and find them here.
              </p>
              <Link
                to="/auth"
                className="inline-flex h-11 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground transition-colors duration-150 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                Sign in
              </Link>
            </div>
          ) : favouritesLoading || likesLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="aspect-[4/5] animate-shimmer rounded-2xl bg-gradient-to-r from-muted via-background to-muted bg-[length:200%_100%]" />
              ))}
            </div>
          ) : favourites.length > 1 ? (
            <FavouritesStack favourites={favourites} />
          ) : favourites.length === 1 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <TeacherCard
                id={favourites[0].id}
                name={favourites[0].name}
                slug={favourites[0].slug}
                subject={favourites[0].subjects?.name || 'Tuition Teacher'}
                subjectSlug={favourites[0].subjects?.slug}
                imageUrl={favourites[0].image_url ?? undefined}
                size="sm"
              />
            </div>
          ) : (
            <div className="flex flex-col items-start gap-1 rounded-2xl border border-hairline bg-warm-card p-6">
              <p className="text-sm font-medium">No favourites yet</p>
              <p className="text-sm text-warm-secondary">
                Tap the heart on a teacher's profile to save them here.
              </p>
            </div>
          )}
        </div>

        {/* Recently visited */}
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-brand-blue" strokeWidth={2} aria-hidden="true" />
            <h2 className="text-subsection font-display font-bold">Recently visited</h2>
          </div>

          {recent.length > 0 ? (
            <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-warm-card">
              {recent.map((item) => {
                const Icon = item.type === 'teacher' ? GraduationCap : FileText;
                const teacherLiked = item.type === 'teacher' && user ? isLiked(item.id) : false;
                return (
                  <li key={`${item.type}-${item.id}`} className="flex min-w-0 items-center">
                    <Link
                      to={item.path}
                      className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-warm-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                    >
                      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-warm-muted">
                        <Icon className="h-4 w-4 text-warm-secondary" strokeWidth={1.75} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.title}</span>
                        {item.subtitle && (
                          <span className="block truncate text-xs text-warm-secondary">{item.subtitle}</span>
                        )}
                      </span>
                      <span className="flex-none whitespace-nowrap text-xs text-warm-secondary">
                        {formatRelativeTime(item.ts)}
                      </span>
                    </Link>
                    {item.type === 'teacher' && (
                      <button
                        type="button"
                        onClick={() => toggleLike(item.id)}
                        aria-label={teacherLiked ? `Remove ${item.title} from favourites` : `Add ${item.title} to favourites`}
                        aria-pressed={teacherLiked}
                        className="mr-2 flex h-11 w-11 flex-none items-center justify-center rounded-full transition-colors duration-150 hover:bg-warm-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <Heart
                          className={`h-4 w-4 transition-colors duration-150 ${
                            teacherLiked ? 'fill-destructive text-destructive' : 'text-warm-secondary'
                          }`}
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-start gap-1 rounded-2xl border border-hairline bg-warm-card p-6">
              <p className="text-sm font-medium">Nothing viewed yet</p>
              <p className="text-sm text-warm-secondary">
                Teachers and papers you open will show up here for quick access.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
