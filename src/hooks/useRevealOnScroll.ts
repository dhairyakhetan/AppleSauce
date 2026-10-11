import { useEffect, useRef, useState } from 'react';

/* Scroll-triggered entrance, once per element. The project's existing
   entrance keyframes (fade-slide-up, card-reveal, panel-fade) are all
   `animation ... both`, which plays to completion the instant the element
   mounts — fine for content already on the first fold, but a no-op for
   anything below it: by the time a reader scrolls that far the animation
   already finished, so there is nothing left to see. This drives a plain
   CSS transition off a class toggle instead, so the "reveal" actually
   happens when the element enters the viewport, not when the page mounts.

   Fires once (`unobserve` after first intersection) — a reader scrolling
   back up and down past the same panel does not re-trigger it every pass. */
export function useRevealOnScroll<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setRevealed(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.unobserve(node);
        }
      },
      { threshold, rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, revealed };
}
