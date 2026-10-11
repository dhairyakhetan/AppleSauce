import * as React from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, MessageCircle, FileText, ChevronRight, IndianRupee, Users, Eye } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sticker } from "@/components/ui/sticker";
import { Eyebrow } from "@/components/ui/eyebrow";
import { IconDisc } from "@/components/ui/icon-disc";
import { PageContainer } from "@/components/layout/PageContainer";
import logoImage from "@/assets/shikshaq-logo.svg";
import { BROWSE_PATH, PAST_PAPERS_PATH } from "@/lib/nav-config";
import { getWhatsAppLink } from "@/utils/whatsapp";
import { useIntent } from "@/lib/intent-context";
import { intentCta } from "@/lib/intent/copy";

/* Redesign S5 — the pre-footer block family (design.md §6).

   Four variants, CHOSEN BY ROUTE, never hand-placed on a page:
     B1 full explainer   home, about, help
     B2 three-count strip browse, subject, board, profile
     B3 papers explainer  papers list, reader, school
     B4 one-liner         account, dashboards, admin, forms

   Counts (B2) are real or absent — design.md §0.10. The component takes them as
   optional props and drops any clause whose number is undefined rather than
   rendering a zero or a placeholder. */

export type PreFooterVariant = "B1" | "B2" | "B3" | "B4";

/** Route → variant. One place, so no page picks its own block. */
export function preFooterFor(pathname: string): PreFooterVariant {
  if (pathname === "/" || pathname === "/about" || pathname === "/more" || pathname === "/help")
    return "B1";
  if (pathname.startsWith(PAST_PAPERS_PATH)) return "B3";
  if (
    pathname === BROWSE_PATH ||
    pathname === "/browse" ||
    pathname.endsWith("-tuition-teachers-in-kolkata") ||
    pathname.startsWith("/tuition-teachers/")
  )
    return "B2";
  return "B4";
}

/* ---------- B1 · full explainer ---------- */

function B1() {
  // A known subject swaps both the label and the destination — "Find a
  // teacher" pointing at the unfiltered list is the correct default for a
  // reader the index knows nothing about, not a placeholder to always
  // upgrade away from, so this only overrides when intentCta has enough to
  // build a real filtered destination from.
  const { intent } = useIntent();
  const cta = intentCta(intent);

  return (
    <PageContainer>
    <div className="relative rounded-3xl bg-card p-6 shadow-border sm:p-8">
      <Sticker tone="brand" tilt={-3} size={30}>
        What is Shikshaq?
      </Sticker>
      {/* Rebuilt against prefooter-01-full-explainer.png. Four things were off:
          the headline did not name what this is or where ("A list of real
          teachers, and their numbers" says neither Kolkata nor tuition); the
          explanatory paragraph beneath it was absent entirely; each of the three
          points was one flat sentence where the mockup gives a bold claim with
          its evidence underneath; and all three icon discs were the same orange
          where the mockup colours them by what they mean — verification orange,
          WhatsApp green, money indigo. This block is the first real explanation
          of the product on the home page, so it is worth being exact about. */}
      <h2 className="mt-3 max-w-[26ch] font-display text-section-head font-extrabold leading-[1.05] text-foreground">
        A directory of Kolkata tuition teachers, and the papers their students sit.
      </h2>
      <p className="mt-4 max-w-prose text-body-secondary text-warm-prose">
        We verify each teacher, publish what they teach and charge, and hand you their
        WhatsApp. No fees, no commission, no middleman.
      </p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          {
            /* S-004: ShieldCheck, not BadgeCheck. BadgeCheck belongs to the
               product tour (OB-002) and nowhere else — this is a verification
               claim ("Verified before listing"), so it takes the same mark the
               teacher cards and the profile use. Two verification glyphs in
               one product is a bug, in that entry's own words. */
            icon: <ShieldCheck />,
            tone: "brand" as const,
            head: "Verified before listing",
            text: "Identity and teaching history checked by hand.",
          },
          {
            icon: <MessageCircle />,
            tone: "whatsapp" as const,
            head: "Straight to WhatsApp",
            text: "Message the teacher yourself, in one tap.",
          },
          {
            icon: <IndianRupee />,
            tone: "papers" as const,
            head: "Free for families",
            text: "Fees go to the teacher. We take nothing.",
          },
        ].map((p) => (
          <li key={p.head} className="flex items-start gap-3">
            <IconDisc tone={p.tone} size={36} shape="square" className="flex-none">
              {p.icon}
            </IconDisc>
            <div className="min-w-0">
              <p className="font-bold text-foreground">{p.head}</p>
              <p className="text-body-secondary text-warm-prose">{p.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild variant="primary" size={44}>
          <Link to={cta?.href ?? BROWSE_PATH}>{cta?.label ?? 'Find a teacher'}</Link>
        </Button>
        {/* Indigo, not muted — papers are the indigo half of the brand pair
            everywhere else on the site, and the mockup pairs the two CTAs as
            orange and indigo rather than primary and grey. */}
        <Button asChild variant="indigo" size={44}>
          <Link to={PAST_PAPERS_PATH}>Read papers</Link>
        </Button>
      </div>
    </div>
    </PageContainer>
  );
}

/* ---------- B2 · three-count strip ---------- */

export interface B2Counts {
  teachers?: number;
  reviews?: number;
}

function B2({ counts }: { counts?: B2Counts }) {
  /* Only render a counter whose number actually arrived AND is above zero.
     `!== undefined` alone let a real zero through: /more briefly painted
     "0 verified teachers" under the heading "Why this list is trustworthy",
     which is the exact opposite of the panel's job. Same rule as the About
     tiles and the sign-in badges - design.md §3.2, never advertise emptiness.
     The commission line is a fact, not a query, so it always shows. */
  const items = [
    (counts?.teachers ?? 0) > 0
      ? { value: String(counts!.teachers), label: "verified teachers" }
      : null,
    (counts?.reviews ?? 0) > 0
      ? { value: String(counts!.reviews), label: "student reviews" }
      : null,
    { value: "₹0", label: "commission, ever" },
  ].filter(Boolean) as { value: string; label: string }[];

  return (
    /* Tint, not full saturation. B3 (papers) sits on bg-brand-blue-subtle with
       deep ink; this one was the only panel in the row painted in the raw
       accent, with a glow shadow the flat pass (S-002/H-021) removed
       everywhere else — so the teachers half shouted while the papers half
       spoke. Same fill logic as B3, in orange. */
    /* DESIGN_SYSTEM.md §4, "full-bleed fill, contained content". This fill used
       to sit inside PreFooter's PageContainer, so the tint stopped at max-w-6xl
       and page ground ran down both sides of it -- on Browse that put an inset
       panel between a full-bleed results panel above and a full-bleed footer
       below, which is the drift §4 exists to prevent. The fill is now edge to
       edge and only the content is measured. */
    <div className="bg-brand-subtle py-6 sm:py-8">
      <PageContainer>
      {/* No /70. Composited on bg-brand-subtle that measured 2.73:1, and an
          11.5px 700 eyebrow is small text, not decoration.
          Dropping the alpha alone was NOT enough: solid --brand-deep at its
          old 35% lightness still only reached 4.45:1 on this tint. The token
          itself is now 32% (index.css), which is what actually clears the
          floor here and on every other -deep-on--subtle pair.
          The warm-label on the tiles below is left alone: the warm scale is
          one of DESIGN_SYSTEM.md's two approved exceptions. */}
      <Eyebrow className="text-brand-deep">Why this list is trustworthy</Eyebrow>
      {/* prefooter-02-three-count-strip.png carries a headline between the
          eyebrow and the tiles — "Verified teachers, real reviews, zero
          commission." It was missing, which left an all-caps label sitting
          straight on top of three bare numbers with nothing saying what the
          panel claims. */}
      <h2 className="mt-3 max-w-[22ch] font-display text-section-head font-extrabold leading-[1.05] tracking-[-0.03em] text-brand-deep">
        Verified teachers, real reviews, zero commission.
      </h2>
      {/* Counts become tiles, the shape stats already take on About and the
          teacher profile — three bare numbers with gap-6 stacked full-width on
          a phone, which is what made this panel read as a loose column rather
          than a stat block. flex-col-reverse, so the DOM keeps <dt> before its
          <dd> (a screen reader still hears "verified teachers, 147") while the
          number sits on top the way the mockup draws it. */}
      <dl className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.label}
            className="flex h-[104px] flex-col-reverse justify-center rounded-[18px] bg-card p-[14px]"
          >
            <dt className="mt-0.5 text-[13px] leading-[1.4] text-warm-label">{it.label}</dt>
            <dd className="font-display text-[24px] font-black tabular-nums tracking-[-0.04em] text-foreground">
              {it.value}
            </dd>
          </div>
        ))}
      </dl>
      {/* Was /80 — 3.21:1 on this fill, and this is body copy making the
          product's central promise about money. */}
      <p className="mt-4 max-w-prose text-[14px] leading-[1.6] text-brand-deep">
        Teachers keep every rupee of their fee. We never take a cut, and we never sell your
        number.
      </p>
      </PageContainer>
    </div>
  );
}

/* ---------- B3 · papers explainer ---------- */

function B3() {
  return (
    /* Full-bleed fill, contained content -- see the note on B2. */
    <div className="bg-brand-blue-subtle py-6 sm:py-8">
      <PageContainer>
      {/* Rebuilt against prefooter-03-papers-explainer.png, which this had
          drifted from in the same ways B1 had: no eyebrow, a headline that
          described the block ("Where these papers come from") rather than making
          its claim, three flat sentences sharing one repeated document icon, and
          only one of the two CTAs. */}
      {/* No /70, matching B1 above. The same alpha was removed there and
          not carried across to this panel. */}
      <Eyebrow className="text-brand-blue-deep">How the paper library works</Eyebrow>
      <h2 className="mt-3 max-w-[24ch] font-display text-section-head font-extrabold leading-[1.05] text-brand-blue-deep">
        Real school papers, shared by students, free to read.
      </h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: <Users />,
            head: "Shared by students.",
            /* The mockup says "from 24 Kolkata schools". There is no query
               behind that number and the library is currently empty, so the
               claim is made without it rather than invented (design.md §0.10). */
            text: "Real prelim and half-yearly papers, shared for free.",
          },
          {
            icon: <Eye />,
            head: "Read in the browser.",
            text: "Nothing to download, nothing to pay for.",
          },
          {
            icon: <FileText />,
            head: "Schools stay the owners.",
            text: "We host for reading only.",
          },
        ].map((p) => (
          <li key={p.head} className="flex items-start gap-3">
            <IconDisc tone="papers" size={36} shape="square" className="flex-none">
              {p.icon}
            </IconDisc>
            <p className="min-w-0 text-body-secondary text-brand-blue-deep/80">
              <span className="font-bold text-brand-blue-deep">{p.head}</span> {p.text}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild variant="indigo" size={44}>
          <Link to={PAST_PAPERS_PATH}>Browse papers</Link>
        </Button>
        {/* Second CTA was missing entirely. It points at the same WhatsApp
            request the papers page already uses, so there is one way to offer a
            paper rather than two that behave differently. */}
        <Button asChild variant="muted" size={44}>
          <a
            href={`${getWhatsAppLink("8240980312")}?text=${encodeURIComponent(
              "Hi! I'd like to share a past paper with Shikshaq.",
            )}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Share a paper
          </a>
        </Button>
      </div>
      </PageContainer>
    </div>
  );
}

/* ---------- B4 · one-liner ---------- */

function B4() {
  return (
    <PageContainer>
    <Link
      to="/about"
      className="flex items-center gap-4 rounded-2xl bg-card p-4 shadow-border transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-border-hover active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-6"
    >
      {/* Logo renders its own <Link>, so it must NOT be used inside this one —
          that produced nested anchors (invalid HTML, real console warning).
          The mark is decorative here; the row itself is the link. */}
      <img
        src={logoImage}
        alt=""
        aria-hidden
        width={252}
        height={92}
        loading="lazy"
        decoding="async"
        className="h-10 w-auto shrink-0"
      />
      {/* prefooter-04-one-liner.png sets this in two tones: the claim in full
          ink, "No commission, ever." dropped back. The build had different copy
          entirely ("Two people, one list of teachers, no commission") which says
          who we are rather than what is on the other side of the link — and this
          block's whole job is to pull someone from a form or a dashboard back
          into the directory. */}
      <span className="flex-1 text-body-secondary text-foreground">
        Verified tuition teachers in Kolkata, free to contact.{" "}
        <span className="text-warm-prose">No commission, ever.</span>
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-warm-label" />
    </Link>
    </PageContainer>
  );
}

export interface PreFooterProps {
  variant: PreFooterVariant;
  counts?: B2Counts;
  className?: string;
}

/** 32px above the footer (design.md §1). */
function PreFooter({ variant, counts, className }: PreFooterProps) {
  return (
    /* Not a PageContainer any more: B2 and B3 are fills and must reach the
       edges, so the measure moved inside each variant. B1 and B4 are cards
       (shadow-border, hover) and keep the gutter by wrapping themselves. */
    <section className={cn("pb-8", className)}>
      {variant === "B1" ? <B1 /> : null}
      {variant === "B2" ? <B2 counts={counts} /> : null}
      {variant === "B3" ? <B3 /> : null}
      {variant === "B4" ? <B4 /> : null}
    </section>
  );
}

export { PreFooter };
