import { Link, useNavigate } from 'react-router-dom';
import { Heart, ArrowUp, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useLikes } from '@/lib/likes-context';
import { useUpvotes } from '@/lib/upvotes-context';
import { useAuth } from '@/lib/auth-context';
import { memo, useState } from 'react';
import { imageAtWidth, validateImageSrc } from '@/utils/imageSanitizer';
import { getSubjectPalette } from '@/lib/subject-palette';
import { Chip } from '@/components/ui/chip';
import { StripePlaceholder } from '@/components/ui/stripe-placeholder';
import { Button } from '@/components/ui/button';
import { DebugId } from '@/components/DebugId';

/**
 * C1 — components.md §2 / design.md §2.1 + §2.5 (CONCENTRIC PHOTO, binding).
 *
 * The photo never carries type. The card is a padded frame (grid: 32px radius /
 * 8px mobile / 10px desktop padding / 24px mobile / 22px desktop inner radius;
 * row: 24px radius / 10px padding / 14px inner radius) with the photo inset in
 * it; name, verified mark, rating and meta sit BELOW the picture. The one
 * exception is the subject chip, which overlays the photo's bottom-left corner
 * (in the design system's solid per-subject colour, for contrast against any
 * photo) — never a gradient scrim, an overhanging sticker, a "Teacher of the
 * week"/"Featured" badge, or anything else overlapping a teacher's face. That
 * includes the favourite heart, which lives in the body row next to the name.
 */

/* 'grid-compact' is the home-rail card only (Index.tsx):
   no experience/area, fee only, upvote pill overlaid on the photo. Plain
   'grid' (Browse.tsx) keeps its own, opposite shape:
   location/years stay, fee is dropped from the meta line, upvote pill stays
   in the body. They used to be the same variant; the owner's live review
   asked for opposite treatment on each, so they split. */
export type TeacherCardVariant = 'grid' | 'grid-compact' | 'rail' | 'row';

interface TeacherCardProps {
  id: string;
  name: string;
  slug: string;
  subject: string;
  imageUrl?: string;
  subjectSlug?: string;
  isFeatured?: boolean; // Optional prop to indicate if this is a featured teacher
  /**
   * @deprecated Sharing is not part of the current components/TeacherCard.md spec (the card has
   * no share affordance). Kept so existing callers still compile; it is now a no-op.
   */
  showShareOnMobile?: boolean;
  sirMaam?: string | null; // Sir/Ma'am from Shikshaqmine
  isLiked?: boolean; // Unused: liked state always comes from the useLikes() hook for live updates
  hideFavourite?: boolean; // Hide heart/favourite button
  /**
   * @deprecated Sharing is not part of the current components/TeacherCard.md spec. Kept so
   * existing callers still compile; it is now a no-op.
   */
  hideShare?: boolean;
  meta?: string; // Secondary line below the name, e.g. "Class 9-12 · Ballygunge" (size 'md' only)
  /** Card size per components/TeacherCard.md. Defaults to 'md' (Browse, dashboards, Liked/My Teachers today). */
  size?: 'sm' | 'md';
  /**
   * C1 density (components.md §2, design.md §2.1). `grid` = 174px standard
   * card, `rail` = 172px narrow shelf card, `row` = horizontal list row.
   * Defaults from `size` when omitted so existing callers keep their current
   * layout: size="sm" -> rail, size="md" -> grid.
   */
  variant?: TeacherCardVariant;
  /** Show the read-only upvote-count pill (size 'md' only). Defaults to !isFeatured to match prior behaviour. */
  showUpvotes?: boolean;
  /**
   * Real rating only (design.md §0.10 — every count shown is real, never a
   * fabricated rating). Omitted entirely when absent; never defaulted.
   */
  rating?: number;
  /** Verified mark next to the name. Only rendered when explicitly true. */
  verified?: boolean;
  /**
   * Real data only (design.md §0.10) — each is entirely optional and the card
   * degrades cleanly (no line/pill, never a "₹0" or blank) when absent.
   */
  /** Accepted but unused since the card's WhatsApp CTA was removed — callers
   *  still pass it and TeacherProfile still needs it, so the prop stays rather
   *  than churning every call site. */
  whatsappLink?: string | null;
  experienceYears?: number | null; // derived from Shikshaqmine."Years they started teaching"
  minFees?: number | null; // Shikshaqmine."Min Fees"
  maxFees?: number | null; // Shikshaqmine."Max Fees"
  area?: string | null; // Shikshaqmine.Area / "LOCATION V2"
  /**
   * R3P6: the caller's own signal that this card is the LCP candidate --
   * above-the-fold on a cold landing (Browse's first row today). Defaults to
   * false so every existing call site keeps the current lazy/normal-priority
   * behaviour; a caller opts a card in rather than this card guessing its own
   * position from render order. Mirrors what TeacherProfile's hero photo
   * already does correctly (fetchpriority="high", loading="eager").
   */
  priority?: boolean;
}

// "₹1,800" / "₹1,200 - ₹1,800" / "₹1,200+" / "Up to ₹1,800". Null when neither is set.
function formatFeeLabel(minFees?: number | null, maxFees?: number | null): string | null {
  if (minFees != null && maxFees != null) {
    return minFees === maxFees ? `₹${minFees.toLocaleString()}` : `₹${minFees.toLocaleString()} - ₹${maxFees.toLocaleString()}`;
  }
  if (minFees != null) return `₹${minFees.toLocaleString()}+`;
  if (maxFees != null) return `Up to ₹${maxFees.toLocaleString()}`;
  return null;
}

// Formats "{name}, {honorific}" per components/TeacherCard.md. Omits the comma entirely when
// there's no recognisable honorific, so nothing is ever left trailing.
function formatDisplayName(name: string, sirMaam?: string | null): string {
  // Trimmed once here rather than assumed clean at the source — a trailing
  // space in Shikshaqmine's Name column ("Ritika Singh ") otherwise survived
  // straight into the joined string as a visible double space before the
  // honorific, and into the two-line name split below as a trailing gap on
  // the wrapped line.
  const trimmedName = name.trim();
  if (!sirMaam) return trimmedName;
  const lower = String(sirMaam).toLowerCase().trim();
  let honorific: string | null = null;
  if (lower === 'sir' || lower.includes('sir')) honorific = 'Sir';
  else if (lower === "ma'am" || lower === 'maam' || lower.includes("ma'am")) honorific = "Ma'am";
  return honorific ? `${trimmedName} ${honorific}` : trimmedName;
}

function TeacherCardComponent({
  id,
  name,
  slug,
  subject,
  imageUrl,
  isFeatured,
  sirMaam,
  hideFavourite = false,
  meta,
  size = 'md',
  variant,
  showUpvotes: showUpvotesProp,
  rating,
  verified,
  whatsappLink,
  experienceYears,
  minFees,
  maxFees,
  area,
  priority = false,
}: TeacherCardProps) {
  const isSm = size === 'sm';
  const resolvedVariant: TeacherCardVariant = variant ?? (isSm ? 'rail' : 'grid');
  const isRow = resolvedVariant === 'row';

  const displayName = formatDisplayName(name, sirMaam);
  const { user } = useAuth();
  const navigate = useNavigate();

  // Hook state drives the heart so likes update instantly everywhere; upvote count is read-only here.
  const { isLiked, toggleLike } = useLikes();
  const { getUpvoteCount } = useUpvotes();
  const liked = isLiked(id);
  const upvoteCount = getUpvoteCount(id);
  // One-shot "pop" on a successful save — see handleHeartClick/heartButton below.
  const [justLiked, setJustLiked] = useState(false);

  const showFavourite = !hideFavourite && resolvedVariant !== 'grid-compact';
  const showUpvotes = (showUpvotesProp ?? !isFeatured) && !isSm;
  const palette = getSubjectPalette(subject);
  // Handoff S-009: 56px on grid/rail, 32px on row.
  const placeholderInitialSize = isRow ? 32 : 56;

  // Bug 5 defence-in-depth: the real fix is at the data layer (each caller should
  // resolve a teacher's actual subject before handing it to this card — see
  // Index.tsx's featuredSubjectLabel and SchoolPage.tsx's basic.firstSubject,
  // both of which used to fetch the real comma-list subject text and then
  // silently discard it in favour of this generic string). But a record can
  // still genuinely have no subject data, and in that case a fake-looking
  // generic label ("Tuition Teacher") reads as real data when it isn't one —
  // so this card never shows it as if it were an actual subject chip.
  const hasRealSubject = !!subject && !/^tuition teachers?$/i.test(subject.trim());

  /* The WhatsApp gate machinery that lived here — the pending-continue effect,
     handleWhatsAppClick, and the ContactGateSheet it opened — went with the
     CTAs above. Nothing on a card can start a message any more, so keeping a
     sheet nothing opens (and a sessionStorage handshake nothing writes) would
     be dead weight. TeacherProfile still owns the full flow, gate and
     auto-continue included; this is only the card. */


  const feeLabel = formatFeeLabel(minFees, maxFees);
  // `grid-compact` (home rail, Index.tsx) and plain `grid` (Browse.tsx) now
  // show opposite halves of this line per two rounds of live review:
  //   grid-compact: fee only (no years, no location) — home rail decluttered.
  //   grid:         years + location only (no fee) — Browse dropped the price.
  const isCompact = resolvedVariant === 'grid-compact';
  const isRail = resolvedVariant === 'rail';
  const isPlainGrid = resolvedVariant === 'grid';
  // Handoff B-012: row no longer uses this joined text line at all — its
  // experience/fee facts moved into rowBadgeRow as separate pills/text
  // below. grid/grid-compact keep the joined-text line exactly as before.
  const factsParts = [
    !isCompact && !isRow && experienceYears != null ? `${experienceYears} yrs` : null,
    // Plain `grid` already shows area in metaRow ("Class range · Area") —
    // repeating it here read as the same fact printed twice on one card.
    !isCompact && !isPlainGrid && !isRow ? area || null : null,
    isPlainGrid || isRow ? null : feeLabel,
  ].filter(Boolean) as string[];
  const factsLine = factsParts.length > 0 ? factsParts.join(' · ') : null;


  const handleHeartClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!user) {
      toast('Sign in to save favourite teachers');
      navigate('/auth');
      return;
    }

    const wasLiked = liked;
    // Optimistic update happens in the hook - UI updates instantly
    await toggleLike(id);
    // Owner's ask: delight on the save moment, not the un-save — see the pop
    // comment on the Heart icon below.
    if (!wasLiked) {
      setJustLiked(true);
      window.setTimeout(() => setJustLiked(false), 400);
    }
  };

  const photo = imageUrl ? (
    <img
      /* 400, not the upload resolution. The card paints ~150-170px wide in
         the grid and 80px in the row variant, so 400 is comfortably 2x on a
         retina phone. One of these photos is 1.81 MB at source and 32 kB at
         w_400 -- and Browse renders up to 500 of them. */
      src={imageAtWidth(imageUrl, 400)}
      alt={area ? `${name}, ${subject} tutor in ${area}, Kolkata` : `${name}, ${subject} tutor in Kolkata`}
      /* R3P6: `priority` lets the caller mark this card as the LCP candidate
         (Browse's first row) -- eager + high fetch priority, same treatment
         TeacherProfile's hero photo already gets. Every other card keeps the
         existing lazy/auto behaviour. decoding="async" throughout so a
         decode never blocks the main thread regardless of priority.
         React 18 does not recognise `fetchPriority` as a prop (warns and
         drops it; React 19 added it) -- spread the lowercase HTML attribute,
         same workaround TeacherProfile.tsx already uses for its hero photo. */
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      {...(priority ? ({ fetchpriority: 'high' } as Record<string, string>) : {})}
      className="h-full w-full object-cover"
    />
  ) : (
    <StripePlaceholder name={name} initialSize={placeholderInitialSize} className="h-full w-full" />
  );

  // Bug 1 — a "Featured" marker on the card was removed per the release
  // checklist ("No teacher card has a sticker"). Featured teachers still sort
  // first wherever the caller orders its list; this card just never renders
  // anything to say so. `isFeatured` stays a prop only because it still feeds
  // showUpvotes' default above.

  const nameHeading = (
    <h3
      /* 700, not 600 — the card's name is the only thing on it competing with
         the photo for attention, and semibold lost that fight.
         Bug 3: dropped one step down the type scale (tailwind.config.ts
         fontSize) on every density — text-body-secondary (15px) throughout,
         text-card-title (16px) added back on desktop grid — for a visually
         smaller card, per the owner's live review. Was text-card-title
         (16px) on row/rail and arbitrary text-[16px]/sm:text-[19px] (not a
         scale token at all) on grid.
         Was a single-line `truncate`, which on the actual card widths (a
         3-up desktop grid, or a mobile row sharing space with the heart/
         WhatsApp column) clips real names mid-word ("Deepak Kumar Shaw, …")
         well before the container is genuinely out of room. The name is the
         one piece of text on the card that must survive intact, so it wraps
         onto a second line instead and only ellipsizes past that. */
      /* min-h reserves 2 lines' worth of height even when a name is short
         enough to fit one — without it, a row of cards where one name wraps
         to 2 lines (e.g. "Deepak Kumar Shaw") stood taller than its
         neighbours, so the row read as uneven card heights rather than a
         matched grid (bug 7). Grid already had this; row/rail did not, so a
         mobile results list could visibly step in height card to card —
         added here too rather than only on grid. */
      /* Owner call, reversing the two comments this replaces: names must
         ACTUALLY take up two lines, not a one-line name centred inside a
         reserved two-line box. Split after the first word so every name
         with 2+ words (every real name here) genuinely wraps onto a second
         line, instead of relying on natural CSS wrap only kicking in for
         the longest names. items-start now — the split makes every card's
         name block genuinely the same two-line height, so centring is no
         longer needed to hide a short one-liner. */
      /* D6.1: text-balance per CRAFT.md §3 ("Headings text-wrap: balance").
         Has no visible effect on the single-name-in-a-span case below (the
         first-word split above already forces the exact two-line break the
         owner asked for, so there's nothing left for the browser to balance)
         but costs nothing and keeps this h3 consistent with the rest of the
         site's headings. */
      className={`flex items-start gap-1 text-balance font-display font-extrabold tracking-[-0.03em] text-foreground ${isSm || isRow ? 'min-w-0 min-h-[2.4em] text-body-secondary leading-[1.3]' : 'min-w-0 min-h-[2.6em] text-body-secondary leading-[1.3] sm:text-card-title sm:leading-[1.35]'}`}
      title={displayName}
    >
      <span className="min-w-0 break-words">
        {(() => {
          const spaceAt = displayName.indexOf(' ');
          if (spaceAt === -1) return displayName;
          return (
            <>
              {/* Never clipped: a long word ("Mukhopadhyay", "Bhojnagarwala") a few
                  px wider than the column breaks onto an extra line instead of
                  losing its ending. Ordinary names keep the two-line split. */}
              <span className="block [overflow-wrap:anywhere]">{displayName.slice(0, spaceAt)}</span>
              <span className="block [overflow-wrap:anywhere]">{displayName.slice(spaceAt + 1)}</span>
            </>
          );
        })()}
      </span>
      {verified && (
        /* Handoff S-004: ShieldCheck is the only verification mark outside
           the product tour (which uses BadgeCheck) — two glyphs for one
           meaning would be a bug. text-brand-deep, no fill, on this light
           card surface; the word "Verified" is never rendered, only the
           aria-label.
           Phase 34 D-007 note: the changelog calls for flattening a tilted
           "Verified" sticker on this card at `lg` (S-003), but per the Bug 1
           comment below (release checklist: "No teacher card has a
           sticker"), that sticker treatment was already removed in an
           earlier phase — this is a plain inline ShieldCheck glyph with no
           `rotate()` at any width. Nothing to flatten; D-007 is a no-op
           here. */
        <ShieldCheck
          strokeWidth={2.25}
          className={`mt-0.5 shrink-0 text-brand-deep ${isRow ? 'h-[15px] w-[15px]' : 'h-4 w-4'}`}
          aria-label="Verified"
        />
      )}
    </h3>
  );

  // Upvote pill removed from every card per the owner's live review — void,
  // not conditionally shown, so the corner overlay / body-row callers below
  // render nothing rather than needing their own removal.
  const upvotePill = null;
  void showUpvotes;
  void upvoteCount;

  // Was `truncate` (single-line, hard-clip). On the actual card widths this
  // string can run longer than the column, and a single-line ellipsis chops
  // whichever field happens to sit at the cutoff mid-word (a location like
  // "Bh…" or a fee like "₹5,…"). line-clamp-2 lets it wrap at a word/space
  // boundary onto a second line first, and only ellipsizes past that.
  /* Owner call: the similar-teachers rail keeps the name and the heart and
     nothing else — no years, no area. That also settles the uneven heights
     reported alongside it: the cards differed by exactly one line because
     "29 yrs · Garia, Jadavpur" wrapped where "18 yrs · Salt Lake" did not. */
  const metaRow = meta && !isRail && (
    <p className={`mt-1 line-clamp-2 break-words text-muted-foreground ${isSm || isRow ? 'text-meta' : 'text-body-secondary'}`}>{meta}</p>
  );

  // Experience / area / fee — design.md §2.1 card facts line ("8 yrs · Ballygunge ·
  // ₹1,800"). Entirely optional per-part; the line itself drops when every part is
  // absent rather than rendering empty punctuation. Same line-clamp-2 fix as
  // metaRow above — the joined string was clipping mid-word inside whichever
  // part (area, fee) landed on the truncation boundary.
  /* No min-h reservation any more, on either grid or grid-compact: it used
     to hold this line's height even when factsLine was empty (a teacher
     missing experience/fee data), on the theory that a card stretched to
     match a taller row-sibling would otherwise dump that same dead space at
     its own bottom edge instead — "reserve it here so the stretch has
     nothing left to do." In practice a real fraction of teachers are
     missing this data, so a very visible number of cards were showing a
     blank strip directly under the name for nothing — repeatedly reported
     as "extra padding after the name" on both the home rail and Browse's
     grid. Letting the row's own stretch (grid items already default to
     align-items: stretch) push any gap to the true bottom of a shorter
     card reads as normal card-height variance, not a hole under the name.  */
  const factsRow = !isRail && factsLine && (
    <div className="mt-1">
      <p className={`line-clamp-2 break-words font-semibold tabular-nums text-foreground ${isSm || isRow ? 'text-meta' : 'text-body-secondary'}`}>
        {factsLine}
      </p>
    </div>
  );

  // Handoff S-003: the badge splits by variant. grid/rail keep it on the
  // photo's bottom-left corner, but neutral now (bg-card/shadow-border, no
  // subject colour) rather than the old subject-solid overlay — omitted
  // entirely when there's no real subject (see hasRealSubject above) rather
  // than showing a fake-looking generic label as if it were real data.
  const subjectBadgeOnPhoto = hasRealSubject ? (
    <Chip
      size={26}
      asChild
      className="absolute bottom-1.5 left-1.5 h-[24px] max-w-[calc(100%-12px)] truncate bg-card text-foreground shadow-border"
    >
      {subject}
    </Chip>
  ) : null;

  // row sits in the text block instead, in the subject's own tint/text
  // (tone="subject"'s default pastel pair — there is no arbitrary photo
  // behind it here, so the wash-out risk the on-photo badge avoids doesn't
  // apply).
  const subjectBadgeInline = hasRealSubject ? (
    <Chip tone="subject" subject={subject} size={26} asChild>
      {subject}
    </Chip>
  ) : null;

  // grid/rail only — row's rating (if any) moves into rowBadgeRow below.
  // Vanishes entirely when absent, rather than reserving empty space
  // (design.md §0.10 — never a fabricated/empty row).
  const chipsRow = !isRow && rating !== undefined ? (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-meta font-bold tabular-nums text-foreground">
        ★ {rating.toFixed(1)}
      </span>
    </div>
  ) : null;

  // Handoff B-012: row's badge row — subject badge, experience badge, fee,
  // fixed order, each optional. Replaces the old chipsRow/factsRow pairing
  // for this variant only.
  const experienceBadge = isRow && experienceYears != null ? (
    <span className="inline-flex h-[26px] items-center rounded-full bg-card px-[10px] text-[12px] font-semibold tabular-nums text-warm-secondary">
      {experienceYears} yrs
    </span>
  ) : null;
  const feeBadgeText = isRow && feeLabel ? (
    <span className="text-[13px] font-bold tabular-nums text-foreground">{feeLabel}</span>
  ) : null;
  const rowBadgeRow = isRow && (subjectBadgeInline || experienceBadge || feeBadgeText || rating !== undefined) ? (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {subjectBadgeInline}
      {experienceBadge}
      {feeBadgeText}
      {rating !== undefined && (
        <span className="inline-flex items-center gap-1 text-meta font-bold tabular-nums text-foreground">
          ★ {rating.toFixed(1)}
        </span>
      )}
    </div>
  ) : null;

  /* OWNER DECISION, overriding B-012 point 4 and the Browse mockup, both of
     which draw a trailing 44x44 #25D366 disc on the row card: "remove the
     WhatsApp button from the teacher card on the browse page ... the similar
     teacher and the home featured teachers". Contacting now happens from the
     teacher's own profile, so the card is a link and nothing else. Flagged
     because the design export does show the disc — this is a product call
     that supersedes it, the same way the contact email did. */

  // Favourite heart — real 44px hit target, now living beside the name instead
  // of overlapping the photo (design.md §2.5 binding rule).
  const heartButton = showFavourite && (
    <button
      type="button"
      onClick={handleHeartClick}
      aria-label={liked ? 'Remove from favourites' : 'Add to favourites'}
      aria-pressed={liked}
      /* Was active:scale-90 — every other tap target in this file (and the
         Button primitive) uses 0.97 as the floor, with a comment explaining
         anything smaller "feels exaggerated". This was the one outlier,
         nearly 3x past that floor, so the heart visibly overshot compared to
         its neighbours (the card link, the WhatsApp button) on the same tap.
         M23: standardised to 0.96 (CRAFT.md §2 "Press: scale(0.96)"), scoped
         to this file only — the rest of the site still reads 0.97 elsewhere,
         which is a separate, wider cleanup this stream doesn't own. */
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform duration-tap ease-tap active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted transition-colors duration-hover hover:bg-accent">
        {/* Owner's ask: a little delight at the save moment. No new keyframe —
            tailwind.config.ts's own comment says every keyframe beyond the
            permitted list was removed after a grep found no callers and
            "do not re-add" — so this reaches for the `pop`
            duration/easing tokens already on the theme (transitionDuration.pop
            = 400ms, transitionTimingFunction.pop = the overshoot cubic-bezier)
            and drives a plain scale transition from JS: `justLiked` flips true
            for one tick on a successful save, scale-125 kicks in, and removing
            the class 400ms later lets the same bouncy curve settle it back to
            1 — a one-shot pop with no loop and no new CSS. Unliking (the
            reverse toggle) gets no pop: the delight belongs to the "yes, keep
            this teacher" moment, not its undo. */}
        <Heart
          className={`h-4 w-4 ${justLiked ? 'scale-125' : 'scale-100'} ${
            liked ? 'fill-destructive text-destructive' : 'text-muted-foreground'
          } motion-reduce:transition-none motion-reduce:scale-100`}
          /* Two properties, two different feels: colour is the existing
             150ms ease-out tap transition (duration-tap's own value), scale
             is the theme's `pop` duration (400ms) and its overshoot
             cubic-bezier — an inline `transition` shorthand is the only way
             to give each property its own timing without a new Tailwind
             utility. */
          style={{ transition: 'color 150ms ease-out, transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}
        />
      </span>
    </button>
  );

  if (isRow) {
    return (
      <>
        <Link
          to={`/tuition-teachers/${slug}`}
          /* Was radius 20 / a 96x120 photo. Bug 8: corners read too sharp for
             the owner's live review — bumped one step up the approved radii
             scale (tailwind.config.ts borderRadius: 2xl 16 / 3xl 24 / 4xl 32)
             to 3xl (24px), rather than inventing a new arbitrary value.
             Bug 3: photo trimmed to 80x104 (was 96x120) for a smaller overall
             card footprint, same portrait aspect. Inner radius recomputed to
             stay concentric with the new outer radius (24 - padding 10 = 14),
             per the binding "photo radius = card radius − card padding" rule. */
          /* Handoff S-001: `row` is the only variant that always sits inside
             a bg-card panel, so it separates by fill (bg-muted) instead of
             a shadow — no shadow-border, no shadow-border-hover on hover. */
          className="group flex items-start gap-3 rounded-[24px] bg-muted p-2.5 outline-none transition-transform duration-hover ease-settle hover:-translate-y-0.5 active:scale-[0.96] active:duration-tap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100"
        >
          <div className="relative h-[104px] w-20 shrink-0 overflow-hidden rounded-[14px] bg-muted outline outline-1 -outline-offset-1 outline-black/10">
            {photo}
          </div>
          <div className="min-w-0 flex-1 py-1">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
              {/* min-w was 160px, which fit at exactly 360px and overflowed
                  below it. In the row variant this sits inside BentoPanel's
                  px-4, the card's p-2.5, a w-20 photo, two gap-3s and an h-11
                  heart column -- leaving the name block precisely 160px at
                  360px wide, and less on a 320px phone. The overflow never
                  showed as a scrollbar because html{overflow-x:hidden} clips
                  it, so it silently truncated the card instead.
                  120px still keeps the name and the upvote pill on one line at
                  common widths; below that they wrap, which is the intended
                  behaviour of the flex-wrap parent. */}
              <div className="min-w-[120px] flex-1">{nameHeading}<DebugId label="teacher" value={id} className="ml-1.5" /></div>
              {upvotePill}
            </div>
            {metaRow}
            {rowBadgeRow}
          </div>
          <div className="flex flex-none flex-col items-end gap-1">
            {heartButton}
          </div>
        </Link>
      </>
    );
  }

  return (
    <>
      {/* §5: depth from shadow-border alone — never border + shadow stacked.
         §7: one bold title, everything else text-sm text-muted-foreground.
         Bug 8: outer radius bumped one step up the approved radii scale
         (tailwind.config.ts borderRadius: 2xl 16 / 3xl 24 / 4xl 32) to 4xl
         (32px) — was an arbitrary 26/28px pair, not a scale token at all.
         Flattened to one value across breakpoints since padding is the only
         thing that still varies (8px mobile / 10px desktop). */}
      <Link
        to={`/tuition-teachers/${slug}`}
        /* No overflow-hidden here (was on this same element as shadow-border/
           shadow-border-hover) — overflow:hidden clips a box's OWN shadow,
           since the shadow paints outside the border box but the clip
           applies to this element's whole paint, so the card's border-shadow
           (and the lift-shadow on hover) were being cut off, especially
           bottom/right. Nothing here actually needs it: the photo already
           self-clips via its own overflow-hidden wrapper below, and every
           overlay (badge, heart, upvote pill) is a child of that wrapper,
           not of this Link. */
        className="group flex h-full flex-col rounded-[32px] bg-card p-2 shadow-border outline-none transition-transform duration-hover ease-settle hover:-translate-y-0.5 hover:shadow-border-hover active:scale-[0.96] active:duration-tap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 sm:p-2.5"
      >
        {/* §2.5 compact grid card (mockup "01 Start with the teachers parents pick"):
            shorter photo than the old 4/5 portrait, tighter body, so four cards read
            as a dense scannable row instead of large portrait tiles.
            Bug 3: trimmed from aspect-[4/5] to aspect-[5/6] (shorter relative
            to its width) for a smaller overall card footprint. */}
        {/* Handoff S-002: one flat radius at every width, not the prior
           concentric mobile/desktop pair. */}
        <div
        /* Concentric with the card: radius 32 minus the card's padding, which
           is 8px at base and 10px from sm. It was a flat 24px, so from sm the
           photo's corner was 2px tighter than the curve around it and the two
           arcs visibly disagreed. */
        className="relative aspect-[5/6] overflow-hidden rounded-[24px] bg-muted outline outline-1 -outline-offset-1 outline-black/10 sm:rounded-[24px]">
          {photo}
          {subjectBadgeOnPhoto}
          {/* Upvote pill moves onto the photo per the owner's live review —
              overlaid in a corner rather than sitting in the body row next
              to the heart. Only the grid variant does this; row/rail keep
              the pill in the body next to the name. */}
          {/* Owner call: on the rail the heart sits in a corner of the image
              rather than beside the name, so the body is just the name. */}
          {/* The heart lives on the photo for every variant now, not just the
              rail. In the body it sat in a wrap-enabled row beside the name,
              and at grid-card widths it wrapped onto a line of its own — a
              whole 40px band of dead space under every name, which is most of
              what made these cards feel empty. */}
          {heartButton && (
            <span className="absolute right-1 top-1 rounded-full bg-card/85 shadow-border backdrop-blur-sm">
              {heartButton}
            </span>
          )}
          {isCompact && upvotePill && (
            <span className="absolute right-1.5 top-1.5 rounded-full bg-card/90 shadow-border backdrop-blur-sm [&>span]:bg-transparent">
              {upvotePill}
            </span>
          )}
        </div>

        {/* Body — everything the photo used to carry now lives here. */}
        <div className="px-1 pb-0.5 pt-2">
          <div className="flex items-start justify-between gap-x-2">
            <div className="min-w-0 flex-1">{nameHeading}<DebugId label="teacher" value={id} className="ml-1.5" /></div>
            {!isCompact && upvotePill}
          </div>
          {metaRow}
          {chipsRow}
          {factsRow}
        </div>
      </Link>
    </>
  );
}

// Memoize component to prevent unnecessary re-renders
// Only re-renders when props change or hook state for this specific teacher changes
export const TeacherCard = memo(TeacherCardComponent);
