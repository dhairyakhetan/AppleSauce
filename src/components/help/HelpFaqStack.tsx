import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Mail, Search, X } from 'lucide-react';

import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { NumberedHeading } from '@/components/ui/numbered-heading';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useChromeConfig } from '@/components/layout/AppShell';
import { BROWSE_PATH, PAST_PAPERS_PATH } from '@/lib/nav-config';
import { iconDiscVariants } from '@/components/ui/icon-disc';
import { WhatsAppIcon, InstagramIcon } from '@/components/BrandIcons';
import { getWhatsAppLink } from '@/utils/whatsapp';
import { cn } from '@/lib/utils';

/* Handoff HP-001..HP-005 (About Contact Help 404 Redesign.dc.html).

   Help.tsx and FAQ.tsx used to each render a <LegalReader> (pill + lede +
   four-card summary + numbered prose sections) — neither had accordions,
   category chips, or a guides section, so there was no existing disclosure
   markup to preserve. This is a new shared layout built to the handoff's
   literal spec, used by both routes so they read as one product ("Both
   routes share this layout" — HP-001). `<LegalReader>` itself is untouched
   and still serves the legal pages (privacy policy, terms). */

export type HelpFaqCategory = 'finding' | 'papers' | 'teachers' | 'general';

export interface HelpFaqQuestion {
  question: string;
  answer: string;
  /** 'general' questions only surface under the "All" chip — they don't map
   *  cleanly to one of the three filterable categories in the mockup. */
  category: HelpFaqCategory;
}

const CATEGORY_CHIPS: { key: HelpFaqCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'finding', label: 'Finding a teacher' },
  { key: 'papers', label: 'Past papers' },
  { key: 'teachers', label: 'Teachers' },
];

/** HP-004's four tint/ink pairs, cycled across however many real guide
 *  topics exist (the source data is the live, admin-editable `page_content`
 *  table — see `useHelpTopics()` — not a fixed four, so this can't be a
 *  static 4-item array without silently dropping real content). */
const GUIDE_TINTS = [
  { tint: 'bg-brand-subtle', ink: 'text-brand-deep' },
  { tint: 'bg-mint', ink: 'text-[#24603D]' },
  { tint: 'bg-brand-blue-subtle', ink: 'text-brand-blue-deep' },
  { tint: 'bg-muted', ink: 'text-foreground' },
] as const;

/** HP-004 names a tint for four specific topics by title, not by position —
 *  keying on the index alone breaks the moment the live topic count isn't a
 *  multiple of four (it wraps "Joining as a teacher" onto "Contacting a
 *  teacher"'s mint). Match by title first; anything the entry doesn't name
 *  (an admin-added topic) falls back to cycling through the same four. */
const GUIDE_TINT_BY_TITLE: Record<string, (typeof GUIDE_TINTS)[number]> = {
  'Finding a teacher': GUIDE_TINTS[0],
  'Contacting a teacher': GUIDE_TINTS[1],
  'Reading past papers': GUIDE_TINTS[2],
  'Joining as a teacher': GUIDE_TINTS[3],
};

/* HP-004's Accept line requires "all four link targets unchanged" but,
   traced through git history, neither this component nor its pre-redesign
   predecessor (the old LegalReader-based Help.tsx) ever had real link
   targets on these — there is nothing to restore. Each of the four named
   guides gets the closest real in-app destination for what it describes;
   "Contacting a teacher" has no standalone page of its own (contacting
   happens per-teacher, from that teacher's own profile) so it filters this
   same page's question list to the closest matching category instead. An
   admin-added fifth topic (not in this map) falls back to the same
   in-page behaviour, keeping every card real and clickable rather than
   guessing a destination for content that doesn't exist yet. */
type GuideLink = { kind: 'route'; href: string } | { kind: 'category'; category: HelpFaqCategory | 'all' };

const GUIDE_LINK_BY_TITLE: Record<string, GuideLink> = {
  'Finding a teacher': { kind: 'route', href: BROWSE_PATH },
  'Contacting a teacher': { kind: 'category', category: 'teachers' },
  'Reading past papers': { kind: 'route', href: PAST_PAPERS_PATH },
  'Joining as a teacher': { kind: 'route', href: '/join' },
};
const GUIDE_LINK_FALLBACK: GuideLink = { kind: 'category', category: 'all' };

export interface HelpFaqGuide {
  title: string;
  body: string;
}

export interface HelpFaqStackProps {
  heading: { line1: string; ordinal: string; line2: string };
  questionsHeading: string;
  questions: HelpFaqQuestion[];
  guides: HelpFaqGuide[];
  contactHeading: string;
  contactBody: string;
  /** Help.tsx's "Tell us here" feedback link, rendered under the contact CTA. */
  footerExtra?: ReactNode;
}

export function HelpFaqStack({ heading, questionsHeading, questions, guides, contactHeading, contactBody, footerExtra }: HelpFaqStackProps) {
  // Handoff HP-001: this route renders its own eyes panel, replacing
  // AppShell's default pre-footer.
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();

  const [activeCategory, setActiveCategory] = useState<HelpFaqCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const questionsRef = useRef<HTMLDivElement>(null);

  const goToCategory = (category: HelpFaqCategory | 'all') => {
    setActiveCategory(category);
    questionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Client-side only — the whole question set is a few dozen items at most,
  // nowhere near needing a server round-trip. Matches question OR answer
  // text, so "fee" still surfaces "Do I pay through Shikshaq..." even though
  // the word isn't in the question itself.
  const normalizedQuery = query.trim().toLowerCase();
  const searching = normalizedQuery.length > 0;
  const matchesQuery = (q: HelpFaqQuestion) =>
    q.question.toLowerCase().includes(normalizedQuery) || q.answer.toLowerCase().includes(normalizedQuery);

  return (
    <BentoStack>
      {/* Handoff HP-002: header + category chips. */}
      <BentoPanel fill="card" edge="top" className="px-[22px] pt-[14px] pb-[22px]">
        <NumberedHeading as="h1" line1={heading.line1} ordinal={heading.ordinal} line2={heading.line2} />

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-warm-secondary" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a question..."
            aria-label="Search questions"
            className="h-12 w-full rounded-full bg-muted pl-11 pr-11 text-base text-foreground placeholder:text-warm-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-warm-secondary transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        <div className={`-mx-5 mt-3 overflow-x-auto px-5 scrollbar-hide lg:-mx-8 lg:px-8 ${searching ? 'pointer-events-none opacity-40' : ''}`}>
          <div className="flex w-max gap-2">
            {CATEGORY_CHIPS.map((c) => {
              const on = activeCategory === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setActiveCategory(c.key)}
                  aria-pressed={on}
                  className={`flex h-11 flex-none items-center whitespace-nowrap rounded-full px-[18px] text-[15px] transition-colors duration-tap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    on ? 'bg-panel font-bold text-background' : 'bg-muted font-semibold text-foreground'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      </BentoPanel>

      {/* Handoff HP-003: question accordions — native <details>/<summary>, so
          disclosure semantics and keyboard operability come from the browser,
          not custom state. Every question stays in the DOM regardless of the
          active chip (HP-002's crawler requirement) — filtering only toggles
          a `hidden` class. */}
      <BentoPanel ref={questionsRef} fill="card" className="p-[22px]">
        <h2 className="text-[21px] font-extrabold tracking-[-0.03em] text-foreground">
          {searching ? `Results for "${query}"` : questionsHeading}
        </h2>
        {/* Two columns from lg. As one column each question was a 1150px-wide
            bar holding forty characters of text and a chevron a whole screen
            away from it, and the list ran far past the fold for no reason.
            Accordions in a grid open within their own column, so nothing
            jumps. */}
        <div className="mt-3.5 grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-start lg:gap-x-3">
          {questions.map((q) => {
            // Search overrides the category chips rather than ANDing with
            // them — searching "fee" while the "Teachers" chip is still
            // active from an earlier tap shouldn't hide a match filed under
            // "general".
            const visible = searching ? matchesQuery(q) : activeCategory === 'all' || activeCategory === q.category;
            return (
              <details
                key={q.question}
                data-category={q.category}
                className={`disclosure group rounded-2xl bg-card p-[16px_18px] shadow-[inset_0_0_0_1px_hsl(var(--border))] [&[open]]:bg-muted [&[open]]:shadow-none ${
                  visible ? '' : 'hidden'
                }`}
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
                  <span className="text-balance text-[16px] font-bold tracking-[-0.02em] text-foreground">{q.question}</span>
                  <ChevronDown className="mt-0.5 h-[18px] w-[18px] flex-none text-warm-secondary transition-transform duration-200 group-open:rotate-180" strokeWidth={2.25} aria-hidden="true" />
                </summary>
                <p className="mt-2.5 text-[14px] leading-[1.6] text-warm-prose">{q.answer}</p>
              </details>
            );
          })}
        </div>
        {searching && !questions.some(matchesQuery) && (
          <p className="mt-3.5 text-[14px] text-warm-secondary">
            No questions match "{query}" — try Contact us below instead.
          </p>
        )}
      </BentoPanel>

      {/* Handoff HP-004: guides. Copy unchanged — sourced from the live,
          admin-editable page_content table (see useHelpTopics()), not
          hardcoded, so an owner edit still shows up here. Each card is a
          real link/button now (GUIDE_LINK_BY_TITLE) — see that map's
          comment for why "link targets unchanged" couldn't be satisfied
          literally. */}
      <BentoPanel fill="card" className="p-[22px]">
        <h2 className="text-[21px] font-extrabold tracking-[-0.03em] text-foreground">Guides</h2>
        {/* D-005: the stack becomes a grid at lg. Left as a flex-col these
            83px cards each ran the full 1201px panel — the exact shape D-005
            calls out ("one-column stacks become grids"). gap-2 is HP-004's
            own spacing and carries over to both axes. */}
        <div className="mt-3.5 flex flex-col gap-2 lg:grid lg:grid-cols-2">
          {guides.map((g, i) => {
            const { tint, ink } = GUIDE_TINT_BY_TITLE[g.title] ?? GUIDE_TINTS[i % GUIDE_TINTS.length];
            const link = GUIDE_LINK_BY_TITLE[g.title] ?? GUIDE_LINK_FALLBACK;
            /* M26: the focus ring is a box-shadow-based utility, which was
               left out of `transition-transform` — tabbing to a card made
               the ring snap in instantly while the hover-lift transform was
               still animating over duration-tap, two motion paths finishing
               at different times on the same gesture. Both now transition
               together. */
            const cardClassName = `block w-full rounded-[18px] p-[16px_18px] text-left transition-[transform,box-shadow] duration-tap hover:-translate-y-0.5 active:scale-[0.96] motion-reduce:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${tint}`;
            const content = (
              <>
                <div className={`text-balance text-[16px] font-bold tracking-[-0.02em] ${ink}`}>{g.title}</div>
                <p className="mt-1.5 text-[14px] leading-[1.55] text-warm-prose">{g.body}</p>
              </>
            );
            return link.kind === 'route' ? (
              <Link key={g.title} to={link.href} className={cardClassName}>
                {content}
              </Link>
            ) : (
              <button key={g.title} type="button" onClick={() => goToCategory(link.category)} className={cardClassName}>
                {content}
              </button>
            );
          })}
        </div>
      </BentoPanel>

      {/* Handoff HP-005: contact CTA. */}
      <BentoPanel fill="dark" className="p-[22px]">
        <h2 className="text-[19px] font-extrabold tracking-[-0.03em]">{contactHeading}</h2>
        <p className="mt-2 text-[14px] leading-[1.55] text-background/70">{contactBody}</p>
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <Link
            to="/contact"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-5 text-[15px] font-extrabold text-brand-foreground transition-[transform,box-shadow] duration-tap hover:-translate-y-0.5 active:scale-[0.96] motion-reduce:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            Contact us
            <ArrowRight className="h-[15px] w-[15px]" aria-hidden="true" />
          </Link>
          <a
            href={getWhatsAppLink('8240980312')}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Shikshaq on WhatsApp"
            className={cn(iconDiscVariants({ tone: 'whatsapp', size: 44 }), 'active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2')}
          >
            <WhatsAppIcon />
          </a>
          <a
            href="https://instagram.com/shikshaq.in"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Shikshaq on Instagram"
            className={cn(iconDiscVariants({ tone: 'on-dark', size: 44 }), 'active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2')}
          >
            <InstagramIcon />
          </a>
          <a
            href="mailto:ngo.aquaterra@gmail.com"
            aria-label="Email Shikshaq"
            className={cn(iconDiscVariants({ tone: 'on-dark', size: 44 }), 'active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2')}
          >
            <Mail strokeWidth={1.8} aria-hidden />
          </a>
        </div>
        {footerExtra}
      </BentoPanel>

      {/* Shared tail. */}
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
