# ShikshAQ Visual Language

Companion to `DESIGN_SYSTEM.md`. The contract governs **rules** (tokens, scales, a11y,
mobile, QA). This file governs **look** — it is extracted from the client's own design
handoff and its values are exact.

**Precedence:** `DESIGN_SYSTEM.md` wins on rules. This file wins on appearance. Where they
genuinely conflict, **stop and report — do not decide.** See §0.

---

## 0. Conflict protocol (binding)

The source handoff contradicts itself in several known places. You MUST NOT resolve a
conflict on your own judgement. If you hit one:

1. Implement nothing for that item.
2. Continue with the rest of your work.
3. Report the conflict in your final message: what clashes, the options, your recommendation.

Known conflicts already logged (do not re-litigate, just follow the ruling):
- Handoff mandates inline styles and forbids CSS classes/token files. **VOID** — we use tokens.
- Handoff floor is 42px tap targets; contract says 44px. **44px wins.**
- Handoff screenshots show two search fields on one screen; its own spec forbids this.
  **Contract wins: one search control per screen.**
- Handoff's own facet pills and empty-state button fall below its 42px floor. **Use 44px.**
- Logo SVG uses `#FF8B16`; brand orange is `#FF8000`. **Report before changing the asset.**
- Step/FAQ body text uses `#666` (cool grey) where everything else is warm. **Use the warm
  secondary token instead.**

---

## 1. The five devices that carry the design

The live app felt bland because it had none of these. They are the priority.

### 1.1 Rounded saturated slabs
Full-width-**minus-gutter** panels punctuating a warm neutral page. `border-radius: 32px`,
inset by the page gutter so warm background stays visible down both sides. They read as
*objects*, not backgrounds — do not make them full-bleed on the home page.

Fills: brand orange, brand indigo, muted warm, near-black. Internal vertical padding
`clamp(32px, 4vw, 56px)`.

Home page rhythm — saturation arrives roughly every other section, alternating hue:
`neutral hero → neutral cards → ORANGE slab → neutral steps → INDIGO slab → neutral FAQ → NEAR-BLACK footer`

### 1.2 Warm bone ground, never white or grey
Page `#F9F5F1`, card `#FCFAF7`, muted `#F0EAE2`, hairline `#E7DFD5`. Every neutral is warm.
Pure white appears **only as text on saturated fills**. A cool-grey app will never feel like
this regardless of accents.

### 1.3 The eight-subject pastel system
See §3. A grid of subject or paper cards becomes a chromatic mosaic rather than a wall of
grey cards. This is the single biggest source of color on the site.

### 1.4 Diagonal-stripe placeholders
Every missing photo gets `repeating-linear-gradient(45deg, #F2ECE4 0 8px, #F9F5F1 8px 16px)`
with a giant low-alpha initial centred on it (38–64px, `rgba(31,31,31,.2)`). It reads as
intentional texture, not a broken image — and it is why the handoff's browse grid looks
designed with zero photography. **We have very little teacher photography, so this matters.**

### 1.5 Tilted overhanging stickers
`position:absolute; top:-11px; right:16px; transform:rotate(5deg)`, pill radius, `11px/700`,
white text on near-black or on an accent. It deliberately breaks the card's bounding box.
Rotations alternate `+5° / -5° / +4° / +6°`. One element, enormous personality. Use sparingly
— one per card at most, and never on more than a third of the cards in a grid.

---

## 2. Color

### 2.1 Surfaces and text
| Role | Hex |
|---|---|
| Page background | `#F9F5F1` |
| Card / raised surface | `#FCFAF7` |
| Muted fill (chips, tracks, callouts) | `#F0EAE2` |
| Stripe placeholder dark band | `#F2ECE4` |
| Hairline | `#E7DFD5` |
| Hairline, raised | `#E4DCD2` |
| Hairline, strong | `#D8CFC4` |
| Text primary | `#1F1F1F` |
| Text long-prose | `#4A443E` |
| Text secondary | `#7B736B` |
| Text tertiary / meta | `#8B837A` |
| Text quaternary (labels) | `#A39A90` |
| Dark panel (footer) | `#1B1A18` |

### 2.2 Mode colors
| | Teachers | Papers |
|---|---|---|
| Action | `#FF8000` | `#4351FF` |
| Deep / text-on-tint | `#B35900` | `#2E3AD6` |
| Tint background | `#FFF4E8` | `#EDEEFF` |
| Glow | `rgba(255,128,0,.3)` | `rgba(67,81,255,.3)` |
| Card drop glow | `0 14px 34px rgba(255,128,0,.28)` | `0 14px 34px rgba(67,81,255,.28)` |

### 2.3 Rings, not borders
Outlines are **never** `border:`. Always `box-shadow: 0 0 0 1px <color>`, usually paired with
a whisper-soft drop `0 2px 4px rgba(0,0,0,.04)`. In Tailwind use `ring-1` / `shadow-*`, and
keep using the existing `shadow-border` token where it fits.

---

## 3. The subject palette (implement as a token function)

Do **not** hardcode eight triples. Implement a generator so a new subject needs only
`{ h, s, l, dark }`:

```
tint      = hsl(h  s%  93%)     // card background
solid     = hsl(h  s%  l%)      // icon tile, badge fill
text      = hsl(h  45% 26%)     // title
meta      = hsl(h  28% 34%)     // sub-label
badgeText = dark ? #FFFFFF : #1F1F1F
```

| Subject | h s l | dark | tint | solid | text | meta |
|---|---|---|---|---|---|---|
| Maths | 28 85 65 | no | `#FCECDE` | `#F2A15A` | `#604024` | `#6F553E` |
| Science | 145 55 45 | yes | `#E3F7EC` | `#34B268` | `#24603D` | `#3E6F53` |
| English | 180 45 50 | no | `#E5F5F5` | `#46B9B9` | `#246060` | `#3E6F6F` |
| Commerce | 220 60 55 | yes | `#E2EAF8` | `#4775D1` | `#243860` | `#3E4F6F` |
| Computer | 280 50 55 | yes | `#F0E4F6` | `#9F53C6` | `#4C2460` | `#5F3E6F` |
| Hindi | 0 65 55 | yes | `#F9E2E2` | `#D74242` | `#602424` | `#6F3E3E` |
| History | 35 55 50 | no | `#F7EFE3` | `#C68B39` | `#604724` | `#6F5B3E` |
| Geography | 160 50 45 | yes | `#E4F6F0` | `#39AC86` | `#24604C` | `#3E6F5F` |

Unknown subject fallback: tint `#F0EAE2`, solid `#7B736B`, text `#1F1F1F`, meta `#7B736B`,
badgeText `#FFFFFF`.

Because tint is fixed at 93% and text at 26%, all subjects sit at identical perceived weight.

**Scope: apply everywhere** — subject cards, paper cards, badges, chips, filter pills, and
selected-facet states. Subject is the one facet that escapes the orange/indigo mode color.

---

## 4. Typography

Geist throughout. Every heading carries `letter-spacing: -0.05em` and `text-wrap: balance`.
Paragraphs carry `text-wrap: pretty`.

**Signature move — mixed-weight headlines.** Set the H1 at weight **400** with the payoff
phrase in a weight-**800** span inside the same sentence, at `-0.055em` tracking and `0.95`
line-height. This does most of the "designed" work and costs nothing.

**Signature move — the uppercase label.** `11.5px / 700 / 0.04em / uppercase`, used on every
stat, badge and section eyebrow.

| Role | Size | Weight |
|---|---|---|
| Home H1 | `clamp(34px, 5.6vw, 66px)`, lh `.95` | 400 + 800 span |
| Section H2 | `clamp(23px, 3vw, 34px)`, lh 1 | 700 |
| Subject card name | `23px`, `-.04em` | 700 |
| Paper card title | `20–21px`, `-.035em` | 700 |
| Lede paragraph | `17px`, lh 1.55 | 400 |
| Body | `15px`, lh 1.55–1.65 | 400 |
| Card meta | `13.5px` | 500 |
| Uppercase label | `11.5px`, `.04em` | 700 |

Sizes are deliberately off-grid (`13.5`, `12.5`, `11.5`, `14.5`). Do not snap them to a 4px scale.

---

## 5. Cards

**Subject card** — `padding:22px`, radius `20`, background = subject `tint`, **no ring, no
shadow** (the tint alone carries it). Order: 42×42 icon tile at radius `13` filled with subject
`solid` holding a 21px white stroked icon → **26px gap** (generous; gives the poster feel) →
name `23px/700/-.04em` in subject `text` → 5px → meta `13px/500` in subject `meta`.

**Paper card** — `padding:22px`, radius `20`, background = subject `tint`, relative. Order:
badge row (subject badge = `solid`/`badgeText`; level badge = `rgba(31,31,31,.07)`; both
`4px 10px`, radius 999, `11px/600`) → `14px` → title `20–21px/700/-.035em` → school line
`14px/500` in subject `meta` (tinted, **not** neutral grey) → stat row `12px/500`, gap 14 →
footer `Paper © {school}` separated by `inset 0 1px 0 rgba(31,31,31,.09)`.

**Teacher card** — radius `18–20`, background `#FCFAF7`, ring `0 0 0 1px rgba(0,0,0,.06)` plus
`0 2px 4px rgba(0,0,0,.04)`. Photo well `aspect-ratio: 4/5` using the §1.4 stripe placeholder
when there is no image. Subject badge inset `8–9px` from the top-left.

**Structural contrast is intentional:** tinted cards have no ring and no shadow; neutral cards
have a ring and no fill. Two logics on one page reads as deliberate, not inconsistent.

**Hover is lift only** — `translateY(-3px)` over `.2s ease` (footer tiles `-4px`). There are no
color-change hovers on cards anywhere in the design. Press is `scale(.96–.98)` at `.15s`.

---

## 6. Radii

`999px` pills/badges/chips · `12px` buttons, inputs, 40px icon tiles · `13px` 42px icon tiles ·
`16px` FAQ items, panels · `18px` teacher/school cards · `20px` subject cards, paper cards,
most content cards · `22px` promise cards, footer CTA tiles · `28px` the papers CTA tile ·
`32px` **saturated slabs**.

---

## 7. Motion

Permitted additions to the contract's §6 whitelist, and only these:

- **`heroSwap`** — `opacity 0, blur(9px), translateY(14px)` → clear, `.5s cubic-bezier(.16,1,.3,1)`,
  staggered `.04s`/`.08s` across eyebrow → headline → subtext. The hero's signature entrance.
- **`sparkle`** — three small accent squares (9/6/7px, radius 3/2/2px, opacity .55) above the
  headline: `0%,100% { opacity:0; scale(.5) rotate(0) } 45% { opacity:.95; scale(1) rotate(45deg) }`,
  `2.6s ease-in-out infinite`, delays `.1s / .55s / 1s`.
- **`fanIn`** — `opacity 0, translateY(18px) rotate(0) scale(.94)` → none. Hero stat cards on mount.
- **`bob`** — `translateY(0 → -9px → 0)` preserving each card's rotation. Hero stat cards only.

`prefers-reduced-motion: reduce` must kill all of it.

**Ambient infinite motion (`sparkle`, `bob`) is desktop-only** — it costs battery on the
mid-range Android phones that are our primary surface.

---

## 8. The hero stat cluster (designed but never built)

Two-column hero on `lg:` and up — copy, search and chips left; a 2×2 cluster of four stat
cards right. **Desktop only.** Mobile keeps the search-first stack from the contract's §11.

| Card | Fill | Rotation | Entry delay | Float period |
|---|---|---|---|---|
| papers count | brand indigo, white text | `-5deg` | `.05s` | `5.5s` |
| teachers count | brand orange | `3.5deg` | `.14s` | `6.5s` |
| ₹0 commission | bone `#FCFAF7` + ring | `-2.5deg` | `.23s` | `7.5s` |
| subjects count | mint `#E3F7EC` | `4.5deg` | `.32s` | `6s` |

Shadows: indigo `0 14px 34px rgba(67,81,255,.28)`, orange `0 14px 34px rgba(255,128,0,.28)`,
bone `0 0 0 1px #E7DFD5, 0 10px 26px rgba(0,0,0,.07)`, mint `0 10px 26px rgba(0,0,0,.06)`.

Counts must come from the existing live stats query — never hardcode them, and apply the
contract's §13 rule: never render a zero.

---

## 9. Other details worth copying

- **Nav track dissolve** — the pill group has a visible `rgba(240,234,226,.7)` track at rest
  that fades to transparent as it scrolls past 48px, while its padding collapses. `.28s`.
- **Active nav tab** — `#FCFAF7` fill, hairline ring, plus a `20×4px` orange underline nub at
  `bottom:-1px`, radius 999.
- **Empty states are designed, not apologetic** — radius 22, `#FCFAF7` + hairline ring, `23px/700`
  heading naming the *exact* failed query, a 15px explanation, then "relax a filter" pills
  offering concrete escapes with counts, plus one near-black action pill. Never a dead end.
- **404** — the numeral at `clamp(64px,12vw,132px)/800` in the hairline color `#E7DFD5`.
  Hairline color used as a giant graphic.
