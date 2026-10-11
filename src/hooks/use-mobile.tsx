import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Subscribe to a media query.
 *
 * Returns false on the first render, before the effect runs, so a component
 * using this renders its WIDE variant first and then corrects. That order is
 * deliberate: the wide variant is the fuller one, so a slow correction shows
 * too much rather than too little, and it matches what the prerendered HTML
 * contains.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    /* Read mql.matches, not window.innerWidth. The two disagree: innerWidth
       includes the scrollbar, and inside an emulated or embedded viewport it
       can report a different number entirely -- 518 where the layout is
       actually 375. The media query is the same source CSS breakpoints use,
       so JS and CSS cannot drift apart. */
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}
