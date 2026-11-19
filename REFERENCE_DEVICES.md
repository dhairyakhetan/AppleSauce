# Reference Devices — extracted from the owner's board

Companion to `VISUAL_DIRECTION.md`. That document says *where* character is allowed.
**This document says exactly WHAT to build.**

Every device below was read off an actual supplied reference. Each has a target surface. Agents
should implement these literally — not "something in this spirit."

Brand orange `#FF8000` and blue `#4351FF` are locked regardless of the colors in any reference.
Black is the third structural color.

---

## A. Marker highlight
**Seen in:** Lots Art ("ILLUSTRATION" on yellow, "YOUR BRAND" on green pill), Chuckle deck
("CREATIVE", "JOY"), Fusion.
**What it is:** a hand-drawn highlighter block sitting *behind* one or two words in a headline —
slightly larger than the text, subtly irregular edges, sometimes a rounded pill instead of a rect.
**Build:** an inline span utility that takes a color, with rect and pill variants and a slight
rotation option.
**Use on:** the emphasised word in every page's first-fold headline. This is the single highest-value
device on the board — it makes a plain headline feel art-directed at almost zero cost.

## B. Die-cut sticker
**Seen in:** flylane, Sand Studio kit, Creative Haus kit, PLAYBOOK, RIIZE.
**What it is:** a shape with a thick white keyline ring, a black outline outside that, and a soft
drop shadow, rotated a few degrees.
**Build:** already exists as `.sticker` + rotation variants. **It is barely used — apply it.**
**Use on:** "Featured" flags, counts, badges, the greeting, success moments, onboarding icons.

## C. Starburst / scalloped badge
**Seen in:** Glassdoor "WE WON" (blue starburst, yellow star), bitesized ("Sale!" blue starburst,
green ticket), ThriftHaus (scalloped circles), Classico (orange scalloped disc).
**What it is:** a burst or scallop-edged disc holding 1–3 words, tilted, often overlapping a corner.
**Build:** CSS clip-path or inline SVG; needs an 8–12 point burst and a scalloped-circle variant.
**Use on:** "Free", "New this week", "No commission", paper counts, teacher counts.

## D. Speech-bubble tag
**Seen in:** pltm ("Community", "This Month's Trends", "The Home Of Simple Strategy"), the
signpost/speech-bubble illustration, Linkedist.
**What it is:** a small rounded label with a tail, floating over or beside a headline, often with a
tiny colored dot before the text.
**Build:** rounded tag + CSS tail, tail direction configurable.
**Use on:** first-fold annotations — "247 teachers", "ICSE + CBSE", "no commission" — floated around
the headline instead of sitting in a boring subtitle line.

## E. Handwritten annotation arrow
**Seen in:** Linkedist (curved arrows to "Liutauras", "LIMA"), Gift Guide (dotted connectors to
numbered hotspots), Lots Art (looping arrow, red arrows), Glassdoor.
**What it is:** a hand-drawn curved or looping arrow, sometimes dotted, pointing from a label to a
thing, in a casual script or marker weight.
**Build:** a small set of inline SVG arrow paths (curve-left, curve-right, loop, dotted) as a
component taking direction and color.
**Use on:** onboarding, HowItWorks steps, empty-state guidance, pointing at the search field on first
visit.

## F. Polaroid / taped photo
**Seen in:** Linkedist (pinned polaroids with pushpins), Aiman portfolio (paperclipped photo),
Classico, RIIZE.
**What it is:** a photo in a thick white frame with a caption strip, rotated, held by tape or a pin.
**Use on:** teacher photos in **loud** contexts only — the home featured strip, About, success
moments. **Never** in the Browse grid (§4: comparison surface stays crisp).

## G. Torn-paper banner
**Seen in:** Coffee Rave (torn strip with title), RIIZE ("HELLO, RIIZE" on torn paper), Converse
(torn notebook edge), Skate the City (torn bottom edge).
**What it is:** a strip of paper with irregular torn top/bottom edges carrying a title or label.
**Build:** `.torn-edge` exists — extend it into a full banner treatment.
**Use on:** section headers on loud surfaces, the papers shelf header, the footer top edge.

## H. Halftone dot ground
**Seen in:** Glassdoor (green halftone), Converse (purple halftone), Indieground, Coffee Rave.
**What it is:** a regular dot screen over a flat color, giving a printed/riso feel.
**Build:** `.halftone-overlay` exists. **Apply it** — it is currently near-unused.
**Use on:** first-fold color bands, empty-state cards, footer, onboarding.

## I. Graph / grid paper ground
**Seen in:** pltm (fine graph grid), OVERFLOW (blue grid), My Confession, the green cutting mat.
**What it is:** a faint ruled or squared grid behind content — instantly reads "school exercise book",
which is *exactly* this product's domain.
**Build:** CSS repeating-linear-gradient, two densities (fine graph, wider ruled).
**Use on:** past-papers surfaces above all — it is the single most on-theme ground for an exam-paper
library. Also the hero and empty states.

## J. Wavy / scalloped divider
**Seen in:** bitesized (red-to-cream wave edge), Truus.
**What it is:** a section boundary that is a wave or scallop instead of a straight line.
**Build:** CSS mask or inline SVG; wave and scallop variants, flippable.
**Use on:** transitions between color bands on home, About, and the footer edge.

## K. Marquee ticker strip
**Seen in:** Skate the City ("Skate Park + Skate Park +" repeating), Mershe.
**What it is:** a thin saturated band of repeating text scrolling horizontally, with a separator glyph.
**Use on:** a band under the home hero cycling subjects or boards; the papers shelf.
**Constraint:** infinite motion is otherwise banned — this needs `prefers-reduced-motion` to freeze it,
and it must pause below `lg` or be static on mobile.

## L. Numbered index with per-item color
**Seen in:** Design Project Brief (01 Context, 02 Audience… each a different color), Gift Guide
(numbered hotspots), Chuckle.
**What it is:** a list where each item's number is oversized and individually colored.
**Use on:** HowItWorks steps, FAQ, Help, the JoinApply wizard steps.

## M. Colored pill row with leading badge
**Seen in:** Events Calendar (date badge + colored pill per row), BBBank, the marathon app.
**What it is:** a stack of full-width rounded pills, each a different color, each led by a small
contrasting badge holding a number or short code.
**Use on:** class/board pill walls on the papers shelf, subject lists, dashboard rows. Directly fixes
the flat `flex-wrap` pill wall flagged in the papers audit.

## N. Circular rotating text badge
**Seen in:** flylane ("LEARN WITHOUT LIMITS" around a pencil), Sand Studio ("Sand Studio & Co"),
Creative Haus ("GO TEAM!").
**What it is:** text set on a circular path around a central icon.
**Use on:** one per page maximum — a seal on the hero, About, or the footer.

## O. Signpost cluster
**Seen in:** the Hobbies/PASSIONS/Projects signpost, the road-sign sheets, the NYC traffic light.
**What it is:** several directional plates stacked on a post, each a different color, each pointing.
**This is the metaphor spine** (`VISUAL_DIRECTION.md` §2). `.signpost` exists at chip scale.
**Use on:** subject navigation on home, the 404, empty states, the papers taxonomy.
**Not skeuomorphic** — plate shapes and direction, not photographic road signs.

## P. Bento tile grid with oversized numerals
**Seen in:** BBBank, Stoken wallet, the saving-goal dashboard, the marathon app.
**What it is:** a tight grid of flat colored tiles, each with a small label and a very large tabular
number; pill toggles inside tiles; occasional notched/jigsaw edges.
**Use on:** all three dashboards, the home stat cluster, paper/teacher counts in first folds.

## Q. Ticket / coupon shape
**Seen in:** bitesized ("RESERVE YOUR SEAT" green ticket), Classico.
**What it is:** a rectangle with semicircular notches bitten out of opposite edges, often with a
dashed tear line.
**Use on:** the WhatsApp CTA, "request a paper", teacher application CTA.

## R. Angled outlined banner
**Seen in:** Design Flow (green and orange banners tilted, thick black outline), Bullet
(red angled strips), Mershe.
**What it is:** a solid color bar with a heavy black outline, rotated a few degrees, carrying display
type, often two stacked at opposing angles.
**Use on:** first-fold headline treatments — this is the fastest route to "eyecandy" on an otherwise
plain page header.

## S. Cut-paper shapes
**Seen in:** jazz spring, All That Jazz, dröm, PLAYBOOK, Fusion.
**What it is:** flat, irregular, hand-cut organic shapes — blobs, stars, squiggles, petals — in
saturated colors, often with a heavy outline and simple faces.
**Use on:** empty states, onboarding, 404, About, subject-card accents for subjects with no photo.

---

## Priority order for implementation

Highest value per unit of effort, given the current state:

1. **A — marker highlight** (transforms every headline)
2. **R — angled outlined banner** (transforms every first fold)
3. **I — graph/grid paper ground** (perfectly on-theme for papers)
4. **D — speech-bubble tag** (kills boring subtitle lines)
5. **C — starburst badge** and **B — sticker** (already built, just unused)
6. **P — bento tiles with big numerals** (fixes dead dashboards)
7. **M — colored pill rows** (fixes the flat pill walls)
8. **H — halftone** and **J — wavy divider** (ground and transitions)
9. **O — signpost cluster**, **G — torn banner**, **Q — ticket**, **L — numbered index**
10. **E, F, K, N, S** — as capacity allows

## Rules

- Devices are **composable and tokenized**, never one-off inline styles.
- Colors come from tokens or `getSubjectPalette()`. Never a new hex.
- On crisp surfaces (`VISUAL_DIRECTION.md` §4) only A, D, M, O, P are permitted. The rest are
  loud-surface devices.
- Every device must degrade under `prefers-reduced-motion` and must not reduce tap targets.
