import { useLocation, Link } from 'react-router-dom';
import { useEffect } from 'react';
import { usePageMeta } from '@/hooks/usePageMeta';
import { BROWSE_PATH, PAST_PAPERS_PATH } from '@/lib/nav-config';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { useChromeConfig } from '@/components/layout/AppShell';

// Handoff NF-001/NF-002 (About Contact Help 404 Redesign.dc.html): one panel
// filling the viewport, the numeral as a decorative pale-band graphic behind
// the h1, and three ranked exits. Copy stays the existing product copy
// (NF-001: "copy unchanged") rather than the mockup's own placeholder text.
const NotFound = () => {
  const location = useLocation();

  usePageMeta(
    "This page isn't on the timetable | Shikshaq",
    'The link may be old. Try a subject, or start a new search.'
  );

  // Handoff NF-001: no generic pre-footer explainer on an error page — the
  // bottom nav and footer still render globally (NF-002's own accept line).
  useChromeConfig({ preFooter: 'none' });

  /* Soft-404 defence. vercel.json rewrites everything to index.html, so a
     garbage URL returns HTTP 200 and Google indexes it as thin content, then
     reports it under "Soft 404". A real 404 status is not available from a
     static SPA, so `noindex, follow` is the practical fix — follow, not
     nofollow, so the two working exits on this page still pass equity.

     This is paired with removing `Disallow: /404` from robots.txt: a page
     that cannot be fetched cannot have its noindex read. */
  useEffect(() => {
    const tag = document.createElement('meta');
    tag.name = 'robots';
    tag.content = 'noindex, follow';
    document.head.appendChild(tag);
    return () => tag.remove();
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.error('404 Error: User attempted to access non-existent route:', location.pathname);
    }
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex flex-1 flex-col">
        <BentoStack className="flex-1">
          <BentoPanel fill="card" edge="top" className="flex flex-1 flex-col justify-center pt-1 pb-[26px]">
            {/* `Desktop Layouts.dc.html` renders Home, Browse, Teacher profile
                and Past papers only — 404 is never drawn above 1024, so this
                measure is designed to the system rather than copied. It caps
                the column instead of adding a rule: D-001 says a page needing
                an eighth desktop rule has a defect in its own layout, and
                unconstrained this stack put a 52px pill across 1152px.
                NF-002's ranked stack and the left alignment are untouched. */}
            <div className="lg:max-w-[520px]">
            {/* Decorative numeral graphic — aria-hidden so the h1 is the
                first thing announced, not "404" (NF-001's accept line). */}
            <div aria-hidden="true" className="font-display text-[132px] font-black leading-[0.8] tracking-[-0.06em] text-[#E7DFD5]">
              404
            </div>
            <h1 className="mt-[18px] font-display text-[26px] font-black leading-[1.1] tracking-[-0.04em] text-foreground sm:text-[34px]">
              This page isn&rsquo;t on the timetable.
            </h1>
            <p className="mt-2.5 text-[15px] leading-[1.55] text-warm-secondary">
              The link may be old. Try a subject, or start a new search.
            </p>

            <div className="mt-5 flex flex-col gap-2">
              <Link
                to={BROWSE_PATH}
                className="flex h-[52px] items-center justify-center rounded-full bg-brand text-[15px] font-extrabold text-brand-foreground transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                Browse teachers
              </Link>
              <Link
                to={PAST_PAPERS_PATH}
                className="flex h-[52px] items-center justify-center rounded-full bg-brand-blue-subtle text-[15px] font-extrabold text-brand-blue-deep transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2"
              >
                Past papers
              </Link>
              <Link
                to="/"
                className="flex h-11 items-center justify-center text-[14px] font-semibold text-warm-secondary transition-colors duration-tap hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
              >
                Go home
              </Link>
            </div>
            </div>
          </BentoPanel>
        </BentoStack>
      </main>
    </div>
  );
};

export default NotFound;
