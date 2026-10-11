import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileText, Search, X } from 'lucide-react';
import { WhatsAppIcon } from '@/components/BrandIcons';
import { getWhatsAppLink } from '@/utils/whatsapp';
import { useChromeConfig } from '@/components/layout/AppShell';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';

/**
 * C15 — LegalReader (handoff\components.md line 48).
 *
 * Built once, reused by Terms and Privacy (Help/FAQ moved off this onto their
 * own HelpFaqStack in the immediately-preceding phase — see the note on that
 * component; LegalReader still serves the actual legal pages).
 *
 * Handoff 09h (LG-001..LG-003) rebuilds this as a BentoStack: header → a
 * 4-card summary strip → a contents panel → flowing prose → a highlighted
 * "papers and copyright" callout (Terms only, LG-003) → a privacy/terms
 * cross-link row → a "still stuck" WhatsApp/email contact panel (kept — a
 * real, working way to reach us that the 09h geometry appendix doesn't
 * itemise but that LG-001..003 never asks to remove) → the shared eyes panel
 * → the global footer (now owned by AppShell, not self-rendered here — see
 * the removed <Footer>/<BottomNavSpacer> below).
 *
 * Pixel values below are transcribed literally from the L1/L2 mockup per the
 * owner's pixel-exact override — arbitrary Tailwind values throughout,
 * intentionally not rounded to the spacing scale.
 */

export type SummaryTone = 'bone' | 'brand' | 'blue' | 'muted' | 'mint';

export interface LegalSummaryCard {
  head: string;
  text: string;
  tone: SummaryTone;
}

export interface LegalSection {
  n: string;
  title: string;
  /** The bold one-line answer that opens every section. */
  short: string;
  body: ReactNode;
  bullets?: string[];
}

export interface LegalReaderProps {
  pill: string;
  pillTone: 'brand' | 'blue';
  h1: ReactNode;
  lede: string;
  updated: string;
  summary: LegalSummaryCard[];
  sections: LegalSection[];
  /** Accent used for the small bullet dots (matches the page's pill tone). */
  accent: 'brand' | 'blue';
  footHead: string;
  footBody: string;
  /** Extra content rendered after the contact panel — e.g. a page-specific closing line. */
  footerExtra?: ReactNode;
  /**
   * LG-003: `n` of the section that gets the indigo "papers and copyright"
   * callout treatment instead of the normal flowing-prose treatment. Omit
   * for a document with no such section (Privacy has none today).
   */
  copyrightSectionN?: string;
  /** LG-001 geometry appendix: the privacy/terms cross-link row. Omit to skip it. */
  crossLink?: { label: string; href: string };
}

const SUMMARY_TONE_CLASS: Record<SummaryTone, string> = {
  bone: 'bg-card',
  brand: 'bg-brand-subtle',
  blue: 'bg-brand-blue-subtle',
  muted: 'bg-muted',
  mint: 'bg-mint',
};

const SUMMARY_HEAD_CLASS: Record<SummaryTone, string> = {
  bone: 'text-foreground',
  brand: 'text-brand-deep',
  blue: 'text-brand-blue-deep',
  muted: 'text-foreground',
  mint: 'text-whatsapp-text',
};

const SUMMARY_BODY_CLASS: Record<SummaryTone, string> = {
  bone: 'text-warm-prose',
  brand: 'text-warm-prose',
  blue: 'text-warm-prose',
  muted: 'text-warm-prose',
  // Mockup uses a two-tone WhatsApp green (a near-black head, a lighter
  // sage body) with no token for the lighter body shade — nearest available
  // token (whatsapp-text) reused for both, reported as a mockup-color
  // substitution.
  mint: 'text-whatsapp-text',
};

export function LegalReader({
  pill,
  pillTone,
  h1,
  lede,
  updated,
  summary,
  sections,
  accent,
  footHead,
  footBody,
  footerExtra,
  copyrightSectionN,
  crossLink,
}: LegalReaderProps) {
  // This route renders its own eyes panel below, replacing AppShell's
  // default pre-footer — same convention every other BentoStack page uses
  // (PastPapers/SchoolsPage/SchoolPage). Owned here, once, so both real
  // callers (Terms, Privacy) get it automatically.
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();

  const pillClass =
    pillTone === 'blue'
      ? 'bg-brand-blue-subtle text-brand-blue-deep'
      : 'bg-brand-subtle text-brand-deep';
  const accentDotClass = accent === 'blue' ? 'bg-brand-blue' : 'bg-brand';

  const [activeIndex, setActiveIndex] = useState(0);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const searching = normalizedQuery.length > 0;
  // Only the guaranteed-plain-text fields — `body` is a ReactNode and isn't
  // reliably string-searchable, so this matches what a reader would actually
  // type (a clause name, not exact prose).
  const sectionMatches = (s: LegalSection) =>
    s.title.toLowerCase().includes(normalizedQuery) ||
    s.short.toLowerCase().includes(normalizedQuery) ||
    (s.bullets ?? []).some((b) => b.toLowerCase().includes(normalizedQuery));

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = sectionRefs.current.findIndex((el) => el === entry.target);
            if (idx !== -1) setActiveIndex(idx);
          }
        }
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 }
    );
    for (const el of sectionRefs.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections.length]);

  const copyrightSection = copyrightSectionN
    ? sections.find((s) => s.n === copyrightSectionN)
    : undefined;
  const proseSections = copyrightSection
    ? sections.filter((s) => s.n !== copyrightSectionN)
    : sections;

  return (
    <BentoStack>
      {/* LG-001 header: pill + h1 + lede + updated line. h1 drops the old
          38/60px display clamp for the 27px/800/-0.04em size every other
          migrated page's header uses (SchoolsPage, TeacherTermsAgreement). */}
      <BentoPanel fill="card" edge="top" className="px-[22px] pt-[14px] pb-[22px]">
        <span
          className={`inline-flex h-[32px] items-center gap-2 whitespace-nowrap rounded-full px-[14px] text-[12px] font-bold ${pillClass}`}
        >
          {pill}
        </span>
        <h1 className="mt-[14px] font-display text-[27px] font-extrabold leading-[1.1] tracking-[-0.04em] text-foreground">
          {h1}
        </h1>
        <p className="mt-2 max-w-[62ch] text-[15px] leading-[1.6] text-warm-prose">{lede}</p>
        <span className="mt-[10px] block text-[14px] text-warm-meta">{updated}</span>
      </BentoPanel>

      {/* Four-card summary strip — real authored content, kept from the
          previous build. 2-col at base, 4-col from lg:. */}
      <BentoPanel fill="card" className="p-[22px]">
        <div className="grid grid-cols-2 gap-[10px] lg:grid-cols-4">
          {summary.map((s) => (
            <div
              key={s.head}
              className={`flex flex-col gap-2 rounded-[18px] p-[16px] sm:rounded-[20px] sm:p-[18px] ${SUMMARY_TONE_CLASS[s.tone]}`}
            >
              <span
                className={`font-display text-[17px] font-black leading-[1.15] tracking-[-0.03em] sm:text-[19px] sm:leading-[1.1] ${SUMMARY_HEAD_CLASS[s.tone]}`}
              >
                {s.head}
              </span>
              <span className={`text-[14px] leading-[1.5] ${SUMMARY_BODY_CLASS[s.tone]}`}>{s.text}</span>
            </div>
          ))}
        </div>
      </BentoPanel>

      {/* LG-001 contents panel — numbered rows, hairline between them, no
          hairline after the last row. Derived from `sections`, never
          hardcoded, so every h2 in the document gets a jump-to row. */}
      <BentoPanel fill="card" className="p-[18px]">
        <span className="text-[12px] font-bold uppercase tracking-[.04em] text-warm-label">
          On this page
        </span>
        <div className="relative mt-[10px]">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-warm-secondary" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this document..."
            aria-label="Search this document"
            className="h-11 w-full rounded-full bg-muted pl-11 pr-11 text-base text-foreground placeholder:text-warm-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-warm-secondary transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        <nav aria-label="On this page" className="mt-2 grid grid-cols-1 sm:grid-cols-2 sm:gap-x-8">
          {sections.map((s, i) => {
            const isActive = i === activeIndex;
            const isLast = i === sections.length - 1;
            const matches = !searching || sectionMatches(s);
            return (
              <a
                key={s.n}
                href={`#legal-section-${s.n}`}
                className={`flex min-h-11 items-center gap-3 py-[9px] text-[15px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isLast ? '' : 'shadow-[inset_0_-1px_0_#F0EAE2]'
                } ${matches ? '' : 'hidden'}`}
              >
                <span className="w-[18px] flex-none text-[13px] font-bold tabular-nums text-warm-label">
                  {i + 1}
                </span>
                <span className={`flex-1 truncate font-semibold text-brand-blue ${isActive ? 'text-brand-blue-deep' : ''}`}>
                  {s.title}
                </span>
              </a>
            );
          })}
        </nav>
        {searching && !sections.some(sectionMatches) && (
          <p className="mt-2 text-[14px] text-warm-secondary">No section matches "{query}".</p>
        )}
      </BentoPanel>

      {/* LG-002 prose — 16px/1.7 measure, h2 19px/800/-0.03em with mt-[26px]
          (first has none). The copyright section (if any) is pulled out into
          its own callout below instead of rendering here. */}
      <BentoPanel fill="card" className="p-[24px_22px]">
        <div className="flex flex-col text-[16px] leading-[1.7] text-warm-prose">
          {proseSections.map((s, i) => (
            <div
              key={s.n}
              id={`legal-section-${s.n}`}
              ref={(el) => {
                const idx = sections.findIndex((sec) => sec.n === s.n);
                sectionRefs.current[idx] = el;
              }}
              /* Search filters visibility only (hidden, not unmounted) — the
                 full document stays in the DOM and crawlable regardless of
                 whatever a visitor happened to type. */
              className={`max-w-[62ch] scroll-mt-24 ${i === 0 ? '' : 'mt-[26px]'} ${
                searching && !sectionMatches(s) ? 'hidden' : ''
              }`}
            >
              <h2 className="m-0 font-display text-[19px] font-extrabold leading-[1.15] tracking-[-0.03em] text-foreground">
                {s.title}
              </h2>
              <p className="m-0 mt-3.5 font-bold text-foreground">{s.short}</p>
              <div className="mt-3.5" style={{textWrap:'pretty'}}>{s.body}</div>

              {s.bullets && s.bullets.length > 0 && (
                <div className="mt-3.5 flex flex-col gap-2">
                  {s.bullets.map((b) => (
                    <div key={b} className="flex items-start gap-[10px]">
                      <span className={`mt-[9px] h-[6px] w-[6px] flex-none rounded-full ${accentDotClass}`} />
                      <span className="text-[15px] leading-[1.6] text-warm-prose">{b}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </BentoPanel>

      {/* LG-003 — the papers/copyright section is called out in indigo,
          because it is the clause people arrive at this page for. */}
      {copyrightSection && (
        <BentoPanel
          fill="papersTint"
          id={`legal-section-${copyrightSection.n}`}
          ref={(el: HTMLDivElement | null) => {
            const idx = sections.findIndex((sec) => sec.n === copyrightSection.n);
            sectionRefs.current[idx] = el;
          }}
          className={`scroll-mt-24 p-[22px] ${searching && !sectionMatches(copyrightSection) ? 'hidden' : ''}`}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-xl bg-brand-blue">
              <FileText className="h-[19px] w-[19px] text-white" aria-hidden="true" />
            </span>
            <h2 className="m-0 font-display text-[19px] font-extrabold tracking-[-0.03em] text-brand-blue-deep">
              {copyrightSection.title}
            </h2>
          </div>
          <p className="m-0 mt-3 max-w-[62ch] text-[15px] leading-[1.65] text-warm-prose">
            {copyrightSection.short}
          </p>
          <div className="mt-4 max-w-[62ch] text-[15px] leading-[1.65] text-warm-prose" style={{textWrap:'pretty'}}>{copyrightSection.body}</div>
        </BentoPanel>
      )}

      {/* LG-001 geometry appendix: the privacy/terms cross-link row. */}
      {crossLink && (
        <BentoPanel fill="card" className="p-[18px_22px]">
          <a
            href={crossLink.href}
            className="flex min-h-11 items-center gap-3 text-[15px] font-semibold text-foreground transition-colors duration-150 hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="flex-1">{crossLink.label}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-warm-label">
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </a>
        </BentoPanel>
      )}

      {/* Dark "still stuck" contact panel — a real, working WhatsApp/email
          way to reach us. Kept from the previous build; the 09h geometry
          appendix doesn't itemise it but LG-001..003 never ask to remove it,
          and dropping a real contact channel would be exactly the kind of
          silent functionality loss the migration rules warn against. */}
      <BentoPanel fill="dark" className="p-[22px]">
        <span className="mb-3 inline-flex h-[26px] items-center whitespace-nowrap rounded-full bg-warm-card px-[11px] text-[12px] font-bold text-foreground">
          questions
        </span>
        <h2 className="m-0 mb-2 font-display text-[20px] font-extrabold leading-[1.15] tracking-[-0.03em] sm:text-[23px]">
          {footHead}
        </h2>
        <p className="m-0 mb-4 max-w-[62ch] text-[14px] leading-[1.65] text-white/80 sm:text-[15px]">{footBody}</p>
        <div className="flex flex-wrap gap-[10px]">
          <a
            href={getWhatsAppLink('8240980312')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[14px] bg-whatsapp px-[18px] text-[15px] font-extrabold text-whatsapp-text transition-transform duration-150 active:scale-[0.97] sm:w-auto"
          >
            <WhatsAppIcon className="h-[17px] w-[17px]" />
            WhatsApp us
          </a>
          <a
            href="mailto:ngo.aquaterra@gmail.com"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[14px] bg-white/10 px-[18px] text-[15px] font-bold text-white transition-colors duration-150 hover:bg-white/15 sm:w-auto"
          >
            ngo.aquaterra@gmail.com
          </a>
        </div>
      </BentoPanel>

      {footerExtra}

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
  );
}
