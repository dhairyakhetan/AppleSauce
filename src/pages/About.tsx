import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, GraduationCap, MessageCircle, Search, ShieldCheck } from 'lucide-react';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { useRevealOnScroll } from '@/hooks/useRevealOnScroll';
import { AnnotatedStatement, AnnotatedHighlight } from '@/components/marketing/annotated-statement';
import { IconDisc } from '@/components/ui/icon-disc';
import { Button } from '@/components/ui/button';
import { usePageMeta } from '@/hooks/usePageMeta';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useChromeConfig } from '@/components/layout/AppShell';
import { Logo } from '@/components/Logo';
import { NumberedHeading } from '@/components/ui/numbered-heading';

import { FREE_PREVIEW_WORD } from '@/lib/free-preview';
/* Fades a panel up into place the moment it actually enters the viewport
   (see useRevealOnScroll for why that has to be scroll-triggered rather
   than a mount-time keyframe on a page this long). Plain opacity/transform
   transition, not a keyframe — interruptible, and motion-reduce drops
   straight to the resting state with no animation at all. */
function Reveal({ children, delayMs = 0 }: { children: ReactNode; delayMs?: number }) {
  const { ref, revealed } = useRevealOnScroll<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`transition-[opacity,transform] duration-pop ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none motion-reduce:!opacity-100 motion-reduce:!translate-y-0 ${
        revealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}
      style={{ transitionDelay: revealed ? `${delayMs}ms` : '0ms' }}
    >
      {children}
    </div>
  );
}

// S21 — one typographic statement on a faint grid ground ("a straight line
// between a parent and a teacher"), three tilted annotation pills, an origin
// story paragraph, real stat tiles, and a near-black founders card. Replaces
// the previous hero+principles+CTA layout entirely (changelog C-058).
/* Full-bleed fill, contained content (DESIGN_SYSTEM.md section 4). */
const BAND_PAD =
  'px-[22px] py-9 lg:px-8 lg:py-14 [&>*:not([aria-hidden])]:mx-auto [&>*:not([aria-hidden])]:w-full [&>*:not([aria-hidden])]:max-w-6xl';

export default function About() {
  usePageMeta(
    'About Shikshaq | Free tuition teacher matching in Kolkata',
    'Shikshaq is a free platform connecting Kolkata students with verified tuition teachers directly, with no commission and no middlemen.'
  );

  // Handoff AB-001: this route renders its own eyes panel, replacing
  // AppShell's default pre-footer.
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();

  // Every stat is a real running query (design.md §0.10 / brief rule 5). A stat
  // whose count fails to fetch is dropped from the tile list entirely, never
  // hardcoded and never shown as a fabricated number — this is why there is no
  // "median reply time" tile here even though the mockup draws one: nothing in
  // the schema tracks first-reply latency, so it cannot be a real query.
  const [stats, setStats] = useState({
    teachers: null as number | null,
    papers: null as number | null,
  });

  useEffect(() => {
    let cancelled = false;
    async function fetchStats() {
      const [teachersRes, papersRes] = await Promise.all([
        supabase.from('teachers_list').select('id', { count: 'exact', head: true }),
        /* `bank_papers`, not `papers`. The two are different tables and this
           page was the only surface reading the old one: it advertised 18
           papers from 5 schools while the footer, the papers library and the
           blog all counted 619 from 155 out of bank_papers. Same site, same
           moment, two numbers off by a factor of thirty. */
        /* 2026-09-26: counts every listed paper, needs_review or not, by
           product-owner decision -- see 20260926030000_site_counts_include_needs_review.sql.
           The "Kolkata schools represented" tile that used to sit alongside
           this was removed the same day: the distinct-school count was not
           defensible as genuinely Kolkata (see the coordinator's audit --
           only ~38 of 190 raw values). */
        supabase.from('bank_papers').select('id', { count: 'exact', head: true })
          .eq('is_published', true).gt('question_count', 0),
      ]);
      if (cancelled) return;
      if (teachersRes.error) logger.error('About.fetchStats.teachers', teachersRes.error);
      if (papersRes.error) logger.error('About.fetchStats.papers', papersRes.error);
      setStats({
        teachers: teachersRes.count ?? null,
        papers: papersRes.count ?? null,
      });
    }
    fetchStats();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Guarded on > 0, not != null. `!= null` only hides these while they load, so
     with an empty papers table this page — the one page whose whole job is to
     say we are trustworthy — rendered "0 past papers, free to read" as if it
     were an achievement. design.md §3.2: never advertise emptiness. A zero
     drops its tile. */
  /* Each stat keeps its own fixed colour regardless of which subset actually
     renders (papers drops out on a failed query, per the "never advertise
     emptiness" rule below) — a real colour per tile instead of flat greys
     and one orange accent, so the row reads as a set of highlights rather
     than a plain data table.
     Was four tiles; the "N Kolkata schools represented" one was removed
     2026-09-26 — the distinct-school count was not defensible as genuinely
     Kolkata (see the coordinator's audit — only ~38 of 190 raw values). Three
     tiles still reads as a balanced row at every width; nothing here assumed
     exactly four. */
  const statTiles = [
    (stats.teachers ?? 0) > 0
      ? { value: stats.teachers!.toLocaleString('en-IN'), label: 'verified teachers listed', ink: 'text-brand-deep', tint: 'bg-brand-subtle' }
      : null,
    (stats.papers ?? 0) > 0
      ? { value: stats.papers!.toLocaleString('en-IN'), label: 'past papers, free to read', ink: 'text-brand-blue-deep', tint: 'bg-brand-blue-subtle' }
      : null,
    // A fact, not a query — always true, so it always shows (same reasoning
    // PreFooter's B2 uses for its commission line).
    { value: '₹0', label: 'commission taken from a fee', ink: 'text-foreground', tint: 'bg-mint' },
  ].filter(Boolean) as { value: string; label: string; ink: string; tint: string }[];

  const statement = (
    <>
      a straight{' '}
      {/* block-dark, not the original pill-brand: that highlight is a
          light brand-subtle tint meant to pop against a white panel — sat
          on the new solid-orange hero it would have all but disappeared,
          orange-on-orange. A dark block reads clearly against it instead. */}
      <AnnotatedHighlight tone="block-dark">line</AnnotatedHighlight>
      <br className="lg:hidden" />
      <span className="hidden lg:inline"> </span>between{' '}
      <br className="lg:hidden" />
      a parent and
      <br className="lg:hidden" /> a teacher.
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <main>
        <BentoStack>
          {/* Owner redesign, working from a reference screenshot of a
              creative-agency site: oversized display type on a bold
              colour-block hero, not a quiet statement on white — the old
              two-panel version (a brief dark logo intro, then the same
              statement at a fairly modest 38-44px on a flat card) read
              as reserved next to that reference. Kept the logo intro (it
              still earns its own brief dark moment) but folded the
              statement into one loud, solid-orange panel, pushed the
              type scale up near what Index.tsx's own hero numbers use
              (up to ~74px there), and added a floating stat chip — the
              reference's own floating "+260k"/"Save 15%" badges,
              translated into a real number this product actually has
              rather than an invented one. */}
          {/* First fold — already on screen at mount, so this plays as a
              real entrance (fade-slide-up) instead of the scroll-triggered
              Reveal everything below the fold uses. bob is the project's
              existing desktop-only ambient loop (VISUAL_LANGUAGE.md §7,
              hard-disabled under 1024px in index.css) — the same slow
              drift the two decorative blobs already use elsewhere, here
              giving the logo panel's own pair some life instead of sitting
              static behind a headline that now animates in over them. */}
          {/* ------------------------------------------------------------------
              The opening, rebuilt around who actually makes this.

              It used to open on a logo panel and a generic statement about
              tuition, which said nothing a hundred other listing sites do not.
              The real story is the one thing no competitor can copy: this is
              made by AquaTerra, an NGO whose team are students, and it is free
              for families to use.

              What is deliberately NOT claimed: that it was built unpaid, that
              there is no revenue model, or any headcount, institution or date.
              None of that is recorded anywhere in this repo and none of it is
              mine to assert on a public page about real people.

              Structure blends the two references: torn-paper bands between
              full-bleed colour (Radical Futures) for the story, colour-blocked
              cards (Sociosphere) for the concrete parts.
          ------------------------------------------------------------------ */}
          {/* [contain:paint], not overflow-hidden alone: the two bob-animated
              blobs below are `transform`-animated, and Chromium can fail to
              clip a transform-animated child to an overflow-hidden ancestor
              under GPU compositing even though overflow computes to `hidden`
              correctly — the blue blob bled straight through the torn-edge
              seam into the panel below it, confirmed live (its own rect sat
              80px past the panel's actual bottom edge). contain:paint is the
              property actually built for this guarantee ("nothing inside
              this box paints outside it"), where overflow-hidden is usually
              enough but was not here. */}
          <BentoPanel
            fill="dark"
            edge="top"
            className="relative animate-fade-slide-up overflow-hidden [contain:paint] px-[22px] pb-[46px] pt-[30px] text-center lg:px-8 lg:pb-[64px] lg:pt-[44px]"
          >
            <span aria-hidden className="pointer-events-none absolute -left-16 -top-16 h-[220px] w-[220px] animate-bob rounded-full bg-brand/25" />
            <span aria-hidden className="pointer-events-none absolute -bottom-20 -right-12 h-[240px] w-[240px] animate-bob rounded-full bg-brand-blue/30 [animation-delay:-3s]" />

            <div className="relative mx-auto max-w-4xl">
              {/* Logo renders its own inline <Link>, so mx-auto on it does
                  nothing. Centring has to happen on a block parent. */}
              <div className="flex justify-center">
                <Logo size="lg" onDark className="h-9 w-auto lg:h-11" ariaLabel="Shikshaq" priority />
              </div>
              <span className="mt-6 block text-label uppercase tracking-[0.06em] text-white/60">
                About Shikshaq
              </span>
              <h1 className="mx-auto mt-3 max-w-[16ch] text-balance font-display text-[clamp(34px,7vw,68px)] font-black leading-[0.94] tracking-[-0.045em] text-white">
                A student team, building the list Kolkata never had.
              </h1>
              <p className="mx-auto mt-5 max-w-[44ch] text-lede text-white/80">
                Shikshaq is made by{' '}
                <a
                  href="https://ngoaquaterra.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-white underline underline-offset-4 decoration-white/40 hover:decoration-white"
                >
                  AquaTerra
                </a>
                , an NGO whose team are students. It is free for families to use: you search, you
                read, and you message the teacher yourself.
              </p>
            </div>
          </BentoPanel>
          {/* Owner call: the torn-paper zigzag that used to sit here was the
              one hand-torn/scrapbook element on an otherwise clean, geometric
              site — every other seam on every other page is panels touching
              at 0 gap with their own rounding (BentoStack's own rule, see
              PageContainer.tsx), and this was the single exception. Removed
              rather than restyled: the panels below already flow straight
              into BentoStack, so they just touch like every other seam does. */}

          {/* What we do, in the home page's own section language.

              This was a borrowed device: three coloured accordion rows with
              the section label set sideways down a vertical bar. Three things
              were wrong with it. The label bar was indigo and so was the third
              row, so they merged into one L-shaped mass. The bar stopped the
              rows reaching the left edge while every other band on the site
              does. And sideways type is nobody's language here.

              Home opens each of its sections with NumberedHeading (an ordinal
              between two display lines) inside a card panel, then a grid of
              icon-disc cards. That is the house pattern, so this uses it. */}
          <Reveal>
            <BentoPanel fill="card" className={BAND_PAD}>
              <NumberedHeading
                size="compact"
                line1="What we"
                ordinal="01"
                line2="actually do"
                support="Three things, and then we get out of the way."
              />
              <div className="stagger-children mt-6 grid gap-4 sm:grid-cols-3">
                {[
                  {
                    tone: 'brand' as const,
                    icon: <ShieldCheck />,
                    tint: 'bg-brand-subtle',
                    title: 'We check who is on the list',
                    body: 'A teacher is verified before they appear, so the name, the subjects and the number you see are the ones we were given and could confirm.',
                  },
                  {
                    tone: 'papers' as const,
                    icon: <BookOpen />,
                    tint: 'bg-brand-blue-subtle',
                    title: 'We host the papers, free to read',
                    body: `Real question papers, kept as they were set. The first ${FREE_PREVIEW_WORD} questions of any open paper need no account at all.`,
                  },
                  {
                    tone: 'muted' as const,
                    icon: <MessageCircle />,
                    tint: 'bg-muted',
                    title: 'Then we stay out of it',
                    body: 'You message the teacher yourself on WhatsApp. We take no commission, because the moment we take one we start having opinions about who you should pick.',
                  },
                ].map((c) => (
                  <div
                    key={c.title}
                    className={`animate-card-reveal rounded-[18px] p-5 transition-transform duration-tap ease-tap hover:-translate-y-1 motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${c.tint}`}
                  >
                    <IconDisc tone={c.tone} size={40} className="mb-3">
                      {c.icon}
                    </IconDisc>
                    <p className="text-[15px] font-bold leading-[1.3] text-foreground">{c.title}</p>
                    <p className="mt-2 text-[14px] leading-[1.6] text-foreground/70">{c.body}</p>
                  </div>
                ))}
              </div>
            </BentoPanel>
          </Reveal>

          <Reveal>
            {/* Handoff AB-003: lede + stats grid. Trimmed to one sentence —
                the fuller version of this claim is the entire next panel,
                so this only needs to be the one-line version of it. */}
            <BentoPanel fill="card" className="px-[22px] py-9 lg:px-8 lg:py-14 [&>*:not([aria-hidden])]:mx-auto [&>*:not([aria-hidden])]:w-full [&>*:not([aria-hidden])]:max-w-6xl">
              <p className="text-[15px] leading-[1.6] text-warm-prose">
                We list teachers, verify who they say they are, then get out of the way. The fee
                you agree is the fee they keep.
              </p>
              {/* lg:grid-cols-3: unconditional grid-cols-2 gave each of these
                  compact number+label tiles a wide cell on a real desktop
                  panel — a 24px number stretched across most of that width
                  with nothing else to fill it. One row at lg instead (was
                  grid-cols-4 for four tiles; now three, after the "Kolkata
                  schools represented" tile was removed 2026-09-26).
                  stagger-children + animate-card-reveal: each tile pops in a
                  beat after the last instead of the whole grid landing as
                  one flat block; hover lift gives them the same tactility
                  the rest of the product's cards already have. */}
              <div className="stagger-children mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-3">
                {statTiles.map((st) => (
                  <div
                    key={st.label}
                    className={`flex h-[120px] animate-card-reveal flex-col justify-center rounded-[18px] p-[14px] transition-transform duration-tap ease-tap hover:-translate-y-1 motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${st.tint}`}
                  >
                    <div className={`font-display text-[24px] font-black tracking-[-0.04em] tabular-nums ${st.ink}`}>
                      {st.value}
                    </div>
                    <div className="mt-0.5 text-[13px] leading-[1.4] text-warm-label">{st.label}</div>
                  </div>
                ))}
              </div>
            </BentoPanel>
          </Reveal>

          {/* The story, told properly. The page opened on a statement, a
              paragraph and a stats grid, which says what Shikshaq is but never
              how it came to exist or why it is shaped the way it is. Three
              short movements: the problem as it actually is in Kolkata, the
              decision that follows from it, and who it is for. Every claim
              here is one the product already keeps elsewhere.
              fill="mint": the colour-block journey down the page (dark ->
              brand -> card -> mint -> ...) is the reference's whole visual
              language — panels now stack with zero gap between them (per
              owner correction elsewhere), so an unbroken run of flat white
              cards would have read as one long undifferentiated slab. */}
          <Reveal>
            <BentoPanel fill="mint" className="px-[22px] py-9 lg:px-8 lg:py-14 [&>*:not([aria-hidden])]:mx-auto [&>*:not([aria-hidden])]:w-full [&>*:not([aria-hidden])]:max-w-6xl">
              <NumberedHeading
                size="compact"
                line1="How this"
                ordinal="02"
                line2="started"
                support="Finding a tutor should not be a favour you ask around for."
              />
              {/* Three paragraphs (the hearsay problem, why directories and
                  aggregators made it worse, then the decision) cut to one —
                  the same three beats, said once each instead of explained. */}
              <p className="mt-3 max-w-prose text-[15px] leading-[1.65] text-warm-prose">
                In Kolkata, finding a teacher still runs on hearsay and a phone number that may not
                even work. Directories sold your enquiry to six centres; aggregators took a cut and
                made the teacher raise their fee to cover it. So we built the boring version
                instead: fee, boards and area written down before you contact anyone, then
                straight to WhatsApp. No commission, because the moment we take one we start having
                opinions about who you should pick.
              </p>
            </BentoPanel>
          </Reveal>

          <Reveal>
            <BentoPanel fill="card" className="px-[22px] py-9 lg:px-8 lg:py-14 [&>*:not([aria-hidden])]:mx-auto [&>*:not([aria-hidden])]:w-full [&>*:not([aria-hidden])]:max-w-6xl">
              <NumberedHeading
                size="compact"
                line1="Both sides of"
                ordinal="03"
                line2="the same conversation"
                support="Whether you are looking for a teacher or you are one."
              />
              {/* Two colour-matched cards, not two identical grey blocks —
                  each card's own tint (blue for the reader, orange for the
                  teacher) plus a SOLID disc in that same family, not the
                  subtle tone: a light disc on a light card of the same
                  colour would have gone flat again, same mistake the tinted
                  hero pill would have made. Copy trimmed to one line each —
                  the full mechanics (fee, verification, WhatsApp) are the
                  next two panels, this is just "which of these two are you". */}
              <div className="stagger-children mt-4 grid gap-4 sm:grid-cols-2">
                <div className="animate-card-reveal rounded-[18px] bg-brand-blue-subtle p-4 transition-transform duration-tap ease-tap hover:-translate-y-1 motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                  <IconDisc tone="papers" size={40} className="mb-2.5">
                    <Search />
                  </IconDisc>
                  <p className="text-[15px] font-bold text-brand-blue-deep">If you are looking</p>
                  <p className="mt-1.5 text-[14px] leading-[1.6] text-foreground/70">
                    Filter by subject, board and area, read real reviews, message the teacher
                    yourself. You never pay us, never in the middle.
                  </p>
                </div>
                <div className="animate-card-reveal rounded-[18px] bg-brand-subtle p-4 transition-transform duration-tap ease-tap hover:-translate-y-1 motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                  <IconDisc tone="brand" size={40} className="mb-2.5">
                    <GraduationCap />
                  </IconDisc>
                  <p className="text-[15px] font-bold text-brand-deep">If you teach</p>
                  <p className="mt-1.5 text-[14px] leading-[1.6] text-foreground/70">
                    Free to list. Set your own rate, keep all of it. Enquiries are real
                    people messaging you, not sold leads.
                  </p>
                  <Link
                    to="/join"
                    className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-[14px] font-bold text-brand-deep underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    List yourself as a teacher
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </BentoPanel>
          </Reveal>

          {/* How we work — the reasoning under the "no commission" pill in the
              header, spelled out. Every claim here is one the product already
              makes elsewhere (the fee line on every teacher profile, the
              WhatsApp CTA, the verification badge, the free-to-read papers);
              nothing is asserted that the app does not already do. */}
          {/* fill="brandTint": another beat in the colour-block sequence
              (dark -> orange -> white -> mint -> white -> orange-tint ->
              blue-tint -> dark -> white) rather than three flat white
              panels back to back. Blob colour swapped from the two
              brand/blue subtle tints (which matched the old white card,
              not this one — a brand-subtle blob on a brand-subtle panel
              would have all but vanished) to white/black translucent,
              which reads against any fill this page uses. */}
          <Reveal>
            {/* [contain:paint] — same fix as the hero panel above: a
                transform-animated (animate-bob) child can bleed past
                overflow-hidden under Chromium's compositing, this is the
                property actually built to guarantee it stays inside. */}
            <BentoPanel fill="brandTint" className="relative overflow-hidden [contain:paint] px-[22px] py-9 lg:px-8 lg:py-14 [&>*:not([aria-hidden])]:mx-auto [&>*:not([aria-hidden])]:w-full [&>*:not([aria-hidden])]:max-w-6xl">
              <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-[220px] w-[220px] animate-bob rounded-full bg-white/50" />
              <span aria-hidden className="pointer-events-none absolute -bottom-20 -left-14 h-[200px] w-[200px] animate-bob rounded-full bg-black/[0.06] [animation-delay:-4s]" />
              <div className="relative">
                <NumberedHeading
                  size="compact"
                  line1="How we"
                  ordinal="04"
                  line2="work"
                  support="Most tuition sites stand between you and the teacher. We took the other bet."
                />
              </div>
              {/* Bodies trimmed to one line each; stagger-children +
                  animate-card-reveal so the four points land one after
                  another instead of as one static block, and each gets a
                  small hover nudge to feel like a real row, not printed
                  text. */}
              <ul className="stagger-children mt-4 grid gap-2.5">
                {[
                  { head: 'The fee is the fee', body: 'No commission, so nobody here is steering you towards a pricier tutor.' },
                  { head: 'You message them, not us', body: 'Every profile ends in a WhatsApp thread. No call centre, no lead form.' },
                  { head: 'Verified means a person checked', body: 'No badge where we have not checked. We show less rather than imply more.' },
                  { head: 'Free stays free', body: 'Open past papers are free to read, always. There is no upgrade to bait you into.' },
                ].map((pt) => (
                  <li
                    key={pt.head}
                    className="flex animate-card-reveal gap-3 rounded-xl px-2 py-1.5 transition-colors duration-150 hover:bg-white/40 -mx-2"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[7px] h-2 w-2 flex-none rounded-[2px] bg-brand"
                    />
                    <span className="min-w-0">
                      <span className="block text-[15px] font-bold text-foreground">{pt.head}</span>
                      <span className="mt-0.5 block text-[14px] leading-[1.5] text-warm-secondary">
                        {pt.body}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </BentoPanel>
          </Reveal>

          {/* The papers network. This is the one part of Shikshaq that students
              built for each other rather than something we made for them, so it
              gets said in their terms, not ours. fill="papersTint" (was
              plain card with only the eyebrow text in indigo): papers are
              blue everywhere else in the product — the mode toggle, the
              covers, the reader — so the section about them gets an
              actual blue block instead of a white card with one blue
              line, closing out the colour-block sequence. */}
          <Reveal>
            <BentoPanel fill="papersTint" className="px-[22px] py-9 lg:px-8 lg:py-14 [&>*:not([aria-hidden])]:mx-auto [&>*:not([aria-hidden])]:w-full [&>*:not([aria-hidden])]:max-w-6xl">
              <NumberedHeading
                size="compact"
                line1="The papers came from"
                ordinal="05"
                line2="the people who sat them"
                support="Students helping students. Nobody here wrote a single question."
              />
              {/* Two paragraphs cut to one — nobody at Shikshaq wrote a
                  question here, every paper was sent in by a student who'd
                  already sat it. That's the whole mechanism; said once. */}
              <p className="mt-2.5 text-[15px] leading-[1.6] text-warm-prose">
                Nobody at Shikshaq wrote a single question on this site. Every past paper was sent
                in by a student who had already sat it: a prelim, a half-yearly, whatever never
                made it online otherwise, so the next batch would not have to hunt for it.
              </p>
              <div className="mt-4 rounded-[18px] bg-muted p-4 transition-colors duration-150 hover:bg-white/60">
                <p className="text-[14px] font-bold text-foreground">Where we draw the line</p>
                <p className="mt-1 text-[14px] leading-[1.6] text-warm-secondary">
                  The questions belong to the schools that set them. Free to read, not to download
                  or repost. Every one names the school that set it.
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2.5">
                {/* indigo, not primary: papers are blue in every other surface of
                    the product (the mode toggle, the covers, the reader), and an
                    orange CTA on the papers panel breaks that one association. */}
                <Button asChild variant="indigo" size={46}>
                  <Link to="/past-papers">
                    Read the papers
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="secondary" size={46}>
                  <Link to="/contact">Send us one you have</Link>
                </Button>
              </div>
            </BentoPanel>
          </Reveal>

          {/* Handoff AB-005: recommend CTA, identical to Home's H-020 row.
              Retained: the existing "recommend a teacher" flow isn't in the
              mockup, but it's real functionality (a live route + form the app
              depends on), so it stays — styled in the mockup's own language
              rather than dropped. */}
          <Reveal>
            <BentoPanel fill="card" className="px-[22px] !py-[18px] lg:!py-8 [&>*:not([aria-hidden])]:mx-auto [&>*:not([aria-hidden])]:w-full [&>*:not([aria-hidden])]:max-w-6xl">
              <Link
                to="/recommend-teacher"
                className="group flex items-center gap-[14px] transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <IconDisc tone="muted" size={44} className="transition-colors duration-150 group-hover:bg-brand-subtle group-hover:text-brand-deep">
                  <GraduationCap />
                </IconDisc>
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-semibold text-foreground">Know a good teacher?</p>
                  <p className="mt-0.5 text-[14px] leading-[1.45] text-warm-secondary">
                    Recommend them and we&rsquo;ll reach out to get them listed, free.
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 flex-none text-warm-label transition-transform duration-150 group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </BentoPanel>
          </Reveal>

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
      </main>
    </div>
  );
}
