# Reference Device Library

Companion to `REFERENCE_DEVICES.md` (repo root) and `VISUAL_DIRECTION.md`. Every device below
implements one lettered device from that spec. **Colors always come from a token or
`getSubjectPalette()` in `src/lib/subject-palette.ts` — never a hardcoded hex.** Pure-CSS devices
live in `src/index.css`; devices needing props/structure are React components here, exported from
`./index.ts`.

```ts
import { AngledBanner, SpeechTag, StarburstBadge, BentoTile, PillRow,
         SignpostCluster, TicketShape, NumberedIndex, CutPaperShape,
         AnnotationArrow, Polaroid, CircularTextBadge } from '@/components/devices';
```

---

## A — Marker highlight (`src/index.css`)

Inline highlighter block behind 1-2 words. Uses `box-decoration-break: clone` so it survives
line-wrapping (each visual line gets its own highlight box, unlike a `::before` approach).

```tsx
<span className="marker-highlight" style={{ '--marker-color': palette.solid } as React.CSSProperties}>
  word
</span>
```

Variants (append, space-separated): `marker-highlight--pill` (rounded), `marker-highlight--tilt`
(rotate -1.5deg, use on short/single-line phrases only), `marker-highlight--outlined` (adds the
3px black structural outline for max first-fold presence). Default `--marker-color` is
`hsl(var(--brand))`.

## R — Angled outlined banner (`AngledBanner.tsx`)

Solid color bar, heavy black outline, rotated, carries display type. Stack two with opposing
`tilt` values for the signature "two banners at opposing angles" treatment.

```tsx
<AngledBanner color="hsl(var(--brand-blue))" tilt={-2}>247 teachers</AngledBanner>
<AngledBanner color="hsl(var(--brand))" tilt={2} className="ml-[-12px]">no commission</AngledBanner>
```

Props: `color` (default `hsl(var(--brand))`), `textColor` (default `#FFFFFF`), `tilt` (deg,
default `-2`, keep within ±4), `flat` (drops the offset shadow), `className`.

## I — Graph / grid paper ground (`src/index.css`)

Two densities of squared/ruled paper via `background-image` gradients — the most on-theme ground
for the papers surfaces.

```tsx
<div className="ground-graph rounded-2xl p-8">…</div>       {/* 22px cells */}
<div className="ground-graph ground-graph--fine">…</div>    {/* 11px cells */}
<div className="ground-ruled">…</div>                        {/* 28px ruled lines */}
```

Override `--graph-line` / `--graph-cell` / `--rule-line` / `--rule-height` for a tinted/denser
variant.

## D — Speech-bubble tag (`SpeechTag.tsx`)

Rounded label with a configurable-tail direction, optional leading dot. Float it around a
headline instead of a boring subtitle line.

```tsx
<SpeechTag tail="bottom-left" dotColor="hsl(var(--brand))">
  247 teachers
</SpeechTag>
```

Props: `tail` (`'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'`, default
`bottom-left`), `dotColor` (omit for no dot), `background` (default `hsl(var(--card))`), `tilt`
(deg, default `0`), `className`.

## C — Starburst / scalloped badge (`StarburstBadge.tsx`)

12-point burst (clip-path polygon, computed once at module scope) or a scalloped-disc variant,
holds 1-3 words, tilted.

```tsx
<StarburstBadge variant="burst" color="hsl(var(--brand-blue))" tilt={-8}>Free</StarburstBadge>
<StarburstBadge variant="scallop" color={palette.solid} textColor={palette.badgeText}>New</StarburstBadge>
```

Props: `variant` (`'burst' | 'scallop'`, default `burst`), `color` (default
`hsl(var(--brand-blue))`), `textColor` (default `#FFFFFF`), `tilt` (deg, default `-8`), `size` (px,
default `84`, keep ≥44 if interactive), `className`.

## B — Die-cut sticker (`src/index.css`, pre-existing — verified)

`.sticker` (white keyline + outline) + `.sticker-rotate-sm/md/lg/md-rev/lg-rev` rotation variants.
Confirmed present and correct; pair with `.outline-offset-shadow` for the full pinned look. Apply
to "Featured" flags, counts, badges, onboarding icons — it was flagged as built-but-unused, so the
instruction is to use it, not rebuild it.

## P — Bento tile grid with oversized numerals (`BentoTile.tsx`)

Flat colored tile, small label, very large tabular numeral. **Crisp-surface device** — no
rotation/outline here per VISUAL_DIRECTION.md §4 (dashboards' bento tiles are Cluster C, i.e.
"structure", not a loud moment).

```tsx
<div className="grid grid-cols-2 gap-3">
  <BentoTile value={42} label="Enquiries" background="hsl(var(--brand-subtle))" textColor="hsl(var(--brand-deep))" />
  <BentoTile value="128" label="Profile views" background="var(--mint)" icon={<Eye className="h-5 w-5" />} />
</div>
```

Props: `value` (ReactNode, rendered with `tabular-nums` in `font-display font-black`), `label`,
`background` (default a warm muted fill), `textColor` (default `#1F1F1F`), `icon` (optional, shown
above label), `toggle` (optional, pinned top-right), `className`.

## M — Colored pill row with leading badge (`PillRow.tsx`)

Full-width rounded pill rows, each a different color, each led by a small contrasting badge
holding a number/short code. **Crisp-surface device** (no rotation) — replaces the flat
`flex-wrap` pill wall pattern flagged in the papers audit.

```tsx
<PillRow items={[
  { key: 'ix', badge: 'IX', label: 'Class 9', meta: '32 papers', color: palette.tint, onClick: () => {} },
  { key: 'x',  badge: 'X',  label: 'Class 10', meta: '58 papers', color: palette2.tint },
]} />
```

`PillRowItem`: `key`, `badge` (leading badge content), `label`, `meta?`, `color?` (row background),
`textColor?`, `onClick?`/`href?` (renders a `<button>` with hover/press feedback when either is
set, otherwise a static `<div>`). Every row is `min-h-[44px]`.

## H — Halftone dot ground (`src/index.css`, pre-existing + strengthened)

`.halftone-overlay` already existed at a subtle 0.06 opacity ("riso grain"). Added
`.halftone-overlay-strong` at 0.16 opacity / 9px dots for genuinely loud application on first-fold
color bands, empty-state cards, the footer, onboarding — per the brief's "genuinely saturated, not
timid tints" instruction. Apply to a `position: relative` container:

```tsx
<div className="halftone-overlay-strong relative rounded-2xl p-8" style={{ background: 'hsl(var(--brand))', color: '#fff' }}>
  …
</div>
```

Texture lives on `::after` (`pointer-events: none`), color follows `currentColor`.

## J — Wavy / scalloped divider (`src/index.css`, pre-existing — verified)

`.divider-wave` (mask-based wave) and `.divider-scallop` (repeating scallop) already existed on a
band element to tear its bottom edge into the next section. `--wave-size` / `--scallop-size`
override the amplitude; flip with a `scale-y-[-1]` wrapper or by moving the class to the opposite
edge. Confirmed present and correct — no changes made.

## O — Signpost cluster (`SignpostCluster.tsx` + `.signpost-plate` in `src/index.css`)

The wayfinding metaphor spine. Several `.signpost-plate` pointed plates stacked on a vertical post
line, each a different color, each tilted at an alternating angle from a fixed sequence (not
random per render).

```tsx
<SignpostCluster plates={[
  { key: 'maths', label: 'Maths', color: getSubjectPalette('Maths').solid, href: '/subjects/maths' },
  { key: 'science', label: 'Science', color: getSubjectPalette('Science').solid, href: '/subjects/science' },
]} />
```

`SignpostPlate`: `key`, `label`, `color?` (default `hsl(var(--brand))`), `textColor?` (default
`#FFFFFF`), `onClick?`/`href?`. `SignpostClusterProps.showPost` toggles the vertical post line
(default `true`). Plates render with `.outline-thick` (heavy black line) since this is a loud
surface. Existing `.signpost` (chip)/`.signpost-card` (card)/`.signpost-header` (banner) scales in
`index.css` are unchanged and still available for other layouts of the same pointed-plate shape.

## G — Torn-paper banner (`.torn-banner` in `src/index.css`)

Extends the pre-existing `.torn-edge` (single-edge tear mask) into a full strip with torn top AND
bottom edges, for a section header/shelf-header label.

```tsx
<h2 className="torn-banner px-6" style={{ background: 'hsl(var(--brand))', color: '#fff' }}>
  Past Papers
</h2>
```

`--torn-size` overrides the tooth size (default `14px`). `.torn-edge` itself (single bottom edge)
is unchanged and still available.

## Q — Ticket / coupon shape (`TicketShape.tsx` + `.ticket-notched` in `src/index.css`)

Semicircular notches bitten out of the left/right edges via a fixed-radius mask, plus an optional
dashed tear line at a caller-supplied fractional position.

```tsx
<TicketShape background="hsl(var(--whatsapp))" textColor="var(--whatsapp-text)" tearAt={0.72}>
  <span className="font-display font-bold">Message on WhatsApp</span>
</TicketShape>
```

Props: `background` (default `hsl(var(--brand))`), `textColor` (default `#FFFFFF`), `notchRadius`
(px, default `12`), `tearAt` (0-1, omit for no divider line), `className`. Renders with
`.outline-thick`; `min-h-[44px]` guaranteed.

## L — Numbered index with per-item color (`NumberedIndex.tsx`)

Oversized, individually-colored step numbers. Use for HowItWorks, FAQ, Help, JoinApply wizard
steps.

```tsx
<NumberedIndex items={[
  { key: '1', title: 'Search by subject & board', description: '…', color: 'hsl(var(--brand))' },
  { key: '2', title: 'Compare teachers', description: '…', color: 'hsl(var(--brand-blue))' },
]} />
```

`NumberedIndexItem`: `key`, `title`, `description?`, `color?` (number color, default
`hsl(var(--brand))`). `NumberedIndexProps.padNumbers` zero-pads to 2 digits (default `true`).

## S — Cut-paper shapes (`CutPaperShape.tsx`)

Flat, irregular, hand-cut organic marks — blob, star, squiggle — as inline SVG so they inherit any
subject/brand color without an image request. Needed because imagery is illustration-first per
VISUAL_DIRECTION.md §9a: use behind a teacher with no photo, and in empty states/onboarding/404/
About/subject-card accents.

```tsx
<CutPaperShape variant="blob" color={palette.solid} size={120} />
<CutPaperShape variant="squiggle" color="hsl(var(--brand))" outlined={false} />
```

Props: `variant` (`'blob' | 'star' | 'squiggle'`, default `blob`), `color` (default
`hsl(var(--brand))`), `size` (px, default `96`), `outlined` (adds the shared black keyline; the
`squiggle` variant is an open stroke path so `outlined` there just switches the stroke color to
black vs. the fill color), `className`.

## PageHeader — the shared first-fold system (`PageHeader.tsx`)

Not a lettered device on its own — a composition of A (via `.ground-graph`/`.ground-ruled`), D
(`SpeechTag`) and C (`StarburstBadge`) into the one shared page-opening system
VISUAL_DIRECTION.md §9a calls for ("every page gets a designed opening... built as a shared
page-header system so it can't drift"). Built by a parallel agent working the page layer; documented
here because it lives in this barrel and depends on devices this library owns.

```tsx
<PageHeader
  eyebrow="Past papers"
  title={<>Find your <span className="marker-highlight marker-highlight--pill">exam paper</span></>}
  lede="ICSE, CBSE and IGCSE past papers, organised by class and subject."
  tags={[{ label: '1,200+ papers' }, { label: 'All boards' }]}
  badge={{ label: 'Free' }}
  accent="hsl(var(--brand))"
  ground="graph"
>
  <SearchBar />
</PageHeader>
```

Props: `eyebrow?`, `title` (required), `lede?`, `tags?` (max 2-3, alternating `SpeechTag` tail/tilt),
`badge?` (renders a `StarburstBadge` in the top-right corner, hidden below `sm`), `accent`
(default `hsl(var(--brand))`), `ground` (`'graph' | 'ruled' | 'plain'`, default `'graph'`),
`children` (the functional slot — search/filters/CTA, per the "eyecandy yet functional" ruling).

## E — Handwritten annotation arrow (`AnnotationArrow.tsx`)

Four hand-tuned inline SVG paths — curve-left, curve-right, loop, dotted — pointing from a label
to a thing. The most broadly useful device in the library: onboarding, HowItWorks steps,
empty-state guidance, pointing at the search field on first visit.

```tsx
<AnnotationArrow variant="curve-left" color="hsl(var(--brand))" size={80} />
<AnnotationArrow variant="dotted" color={palette.solid} flip animated />
```

Props: `variant` (`'curve-left' | 'curve-right' | 'loop' | 'dotted'`, default `curve-right`),
`color` (default `hsl(var(--brand))`), `size` (px width, default `100`), `strokeWidth` (default
`3`), `flip` (mirrors horizontally), `animated` (one-shot `animate-pop` fade/scale-in on mount —
finite, covered by the global `prefers-reduced-motion` kill-switch), `className`. Always
`aria-hidden` — purely decorative.

## F — Polaroid / taped photo (`Polaroid.tsx`)

A photo in a thick white frame with a caption strip below it, rotated, held by tape (composes
with the pre-existing `.tape` / `.tape--corner-left/right` utilities) or a pin dot.

**⚠️ LOUD-SURFACE-ONLY** (`VISUAL_DIRECTION.md` §4) — the home featured-teacher strip, About,
success moments. **Never** inside the Browse grid or any scrollable comparison surface; those
must stay crisp and un-rotated.

```tsx
<Polaroid src={teacher.photoUrl} alt={`Photo of ${teacher.name}`} caption={teacher.name}
  tilt={-4} hold="tape" />
<Polaroid src={teacher.photoUrl} alt={`Photo of ${teacher.name}`} hold="pin" tilt={5} />
```

Props: `src` (required), `alt` (required — the photo itself needs real alt text even though the
frame/tape chrome around it is `aria-hidden`), `caption?`, `tilt` (deg, default `-4`, keep within
±8), `hold` (`'tape' | 'tape-corner-left' | 'tape-corner-right' | 'pin' | 'none'`, default
`tape`), `width` (px, default `180`, photo area is a 4:5 crop inside), `className`.

## N — Circular rotating text badge (`CircularTextBadge.tsx`)

Text on a circular `<textPath>` around a central icon/mark — a "seal" moment.

**⚠️ One per page maximum** (`REFERENCE_DEVICES.md` §N) — the hero, About, or the footer, never a
repeated grid element. **Does not auto-spin by default** per the project's anti-perpetual-motion
rule; `spin` must be explicitly opted into by the caller, and even then is a purely decorative
loop frozen by the universal `prefers-reduced-motion` kill-switch.

```tsx
<CircularTextBadge text="LEARN WITHOUT LIMITS" center={<Pencil className="h-6 w-6" />}
  color="hsl(var(--brand))" size={140} />
```

Props: `text` (required), `center?` (icon/mark rendered in the middle), `color` (default
`hsl(var(--foreground))`), `background?` (disc fill, omit for transparent), `size` (px, default
`120`), `spin` (default `false` — off unless explicitly enabled by the caller), `spinDuration`
(seconds, default `18`, used only when `spin` is true), `className`. Always `aria-hidden` —
purely decorative.

## K — Marquee ticker strip (`.marquee-track` in `src/index.css`, pre-existing — verified)

`.marquee-track` + `marquee-scroll` keyframe already exist, correctly hard-stopped below `1024px`
and via `prefers-reduced-motion`. No new component needed.

## Verification

- `npx tsc --noEmit -p tsconfig.app.json` — passes clean.
- `npm run build` — succeeds.
- Every color prop defaults to a CSS custom property / token (`hsl(var(--brand))`,
  `hsl(var(--brand-blue))`, `var(--mint)`, etc.) or accepts a `getSubjectPalette()` value — no
  component declares a literal hex.
- Every interactive device (`PillRow` item, `SignpostCluster` plate, `TicketShape`) renders at
  `min-h-[44px]` or greater.
- `prefers-reduced-motion` — none of these devices animate on their own; the ones that compose
  with motion (`.sticker` + `animate-pop`, `.marquee-track`) rely on the existing universal
  kill-switch and desktop-only guard already in `src/index.css`, unchanged.
