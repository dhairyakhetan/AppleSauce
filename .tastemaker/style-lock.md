# Shikshaq style lock

NOT derived by tastemaker. This project already had a documented design
system before the skill ran, so this file RECORDS it and points at the real
sources. Do not regenerate a palette or type pairing for this project.

Sources of truth, in order:
- `DESIGN_SYSTEM.md`      the contract: colour, type, spacing, motion, states
- `VISUAL_DIRECTION.md`   crisp vs loud surfaces, the ruling on first folds
- `VISUAL_LANGUAGE.md`    the two-mode colour system
- `REFERENCE_DEVICES.md`  the owner's reference board as 19 lettered devices
- `tailwind.config.ts`    the tokens themselves

## Colour

Warm bone ground (`--background` #F9F5F1), card #FCFAF7, near-black panel
#1B1A18. Brand orange #FF8000 and brand indigo #4351FF are the two modes
(VISUAL_LANGUAGE 2.2). Subject colour comes only from `getSubjectPalette()`.
Never a new hex.

Binding contrast fact: white on #FF8000 measures 2.52:1 and is banned. Orange
always carries dark ink (#1F1F1F). `text-white/90` is the floor on
#4351FF (4.71:1); /85 fails.

## Type

Geist for text, Archivo (variable, wght 100-900 / wdth 62-125) as
`font-display` for display type. No third family.

## Structure

`BentoStack` + `BentoPanel` (`src/components/layout/PageContainer.tsx`), used
by 42 files. Panels touch at gap-0 and separate by fill change alone.
Full-bleed fill, contained content: the fill reaches the viewport edges, the
content goes through `PageContainer` (max-w-6xl).

`devices/PageHeader` is SUPERSEDED by BentoPanel for first folds and must not
be rolled out. The individual devices it composes (StarburstBadge, SpeechTag,
Polaroid, CutPaperShape, AnnotationArrow, TicketShape, CircularTextBadge,
NumberedIndex, PillRow, BentoTile, AngledBanner) were never rejected, only
unused, and are the sanctioned way to build a loud surface INSIDE a panel.

## Motion

DESIGN_SYSTEM 6 permits a short list and bans decorative or perpetual motion.
Hover and press are transitions, not animations. No GSAP, no scroll
storytelling: this is a utility site for parents choosing a tutor, and the
skill's default motion track does not apply here. Every animation degrades
under `prefers-reduced-motion`.

## Per-surface register (owner decision, this session)

- Footer: QUIET, editorial. One running sentence with live figures set inline.
  It sits under every page and must not shout. Reference: Adam Katz.
- About: LOUD, and it is about WHO MAKES THIS, not about teachers. Dark hero,
  torn-paper band, full-bleed coloured expandable rows, display-scale headings
  throughout. NO teacher photography anywhere on it (owner decision). The
  story is AquaTerra, an NGO whose team are students, and free for families.
  References: Radical Futures for the bands, Sociosphere for the cards.

  NOT claimed on that page, and not to be added without evidence: that it was
  built unpaid, that there is no revenue model, any headcount, any institution
  name, or any founding date. An earlier version asserted "Made by two people"
  with two invented avatars; it was removed as false.

## Assets

No stock photography and no generated illustration. Every face on the site is
a real Kolkata teacher from Supabase, and every figure is fetched. A count
that cannot be read is not drawn rather than filled in with a plausible
number. This overrides the skill's Step 3 asset-sourcing defaults entirely.

## Copy

No em or en dashes in site copy. Teacher reviews and question-paper text are
exempt: those are other people's words and are never altered.
