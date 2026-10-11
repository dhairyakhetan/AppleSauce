import { BentoStack, BentoPanel } from "@/components/layout/PageContainer";

/* A shimmer bar, sized like the piece of real copy it stands in for —
   same "shaped like what it replaces" rule list-states.tsx's SkeletonCard
   follows, not a generic grey box. */
const Bar = ({ w, h = 14 }: { w: string; h?: number }) => (
  <div
    className="rounded-full bg-warm-band motion-safe:animate-shimmer"
    style={{ width: w, height: h }}
  />
);

/* Every lazy route (everything but Home) showed this while its chunk
   downloaded and parsed — route-prefetch.ts already warms that chunk on
   hover so the wait is usually short, but on a cold load (direct link,
   first tap, slow connection) the reader sat on a blank page with a
   pulsing "Loading..." for however long that took. Shaped like a real page
   instead: BentoStack/BentoPanel are the actual shell every route already
   renders into, so the panel geometry does not jump when the real content
   swaps in — only the shimmer bars resolve into real copy. Not a spinner
   and not per-route (Suspense's fallback has no way to know which lazy
   chunk is loading without more plumbing than a loading state warrants) —
   one generic hero-plus-cards shape close enough to most destinations that
   the swap reads as content arriving, not as the page changing shape.
   No entrance animation on the swap itself: M-014 above still applies —
   this fallback simply stops rendering the instant Suspense resolves. */
export const PageLoader = () => (
  <div className="min-h-screen bg-background" aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading…</span>
    <BentoStack>
      <BentoPanel fill="card" edge="top" className="flex flex-col gap-3 px-[22px] pb-[46px] pt-[56px] lg:px-8 lg:pt-[72px]">
        <Bar w="35%" h={11} />
        <Bar w="70%" h={26} />
        <Bar w="50%" h={26} />
        <Bar w="90%" h={14} />
      </BentoPanel>
      <BentoPanel fill="muted" className="grid grid-cols-1 gap-3 px-[22px] py-9 sm:grid-cols-2 lg:grid-cols-3 lg:px-8">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col gap-3 rounded-2xl bg-card p-4">
            <div className="aspect-[4/3] w-full rounded-2xl bg-warm-band motion-safe:animate-shimmer" />
            <Bar w="80%" />
            <Bar w="55%" h={11} />
          </div>
        ))}
      </BentoPanel>
    </BentoStack>
  </div>
);
