# ShikshAQ — Visual Direction

**Status:** governing spec for the 2026-08-16 overhaul.
**Authority:** where this conflicts with `DESIGN_SYSTEM.md` or `VISUAL_LANGUAGE.md`, **this document wins on
intent and surface assignment.** `DESIGN_SYSTEM.md` still wins on hard rules (a11y minimums, token
discipline, QA gates). `VISUAL_LANGUAGE.md` is now historical reference for exact handoff values.

Read this before touching any user-facing surface.

---

## 0. Why this document exists

The previous redesign failed the same way twice, and the cause is documented: there were **two implemented
typography scales** (a conservative Tailwind-class one and an expressive inline-`clamp()` one) and **three
parallel color systems** (`index.css`, `searchFacets.ts`, and two duplicate subject-palette generators).
Nothing said *which surface gets which treatment*, so every agent chose, and every page drifted.

The color systems are now collapsed to one. The type scales are being collapsed to one. This document
supplies the missing third thing: **a surface-by-surface assignment, so nobody has to choose.**

---

## 1. What the product actually is

Understand this before styling it, because the visual system exists to serve it.

ShikshAQ is **two catalogues wearing one coat**:

- **Teacher discovery** — a Kolkata tuition-teacher directory. Success = *message a teacher on WhatsApp*.
- **Past papers** — a school exam-paper library. Success = *read a paper*.

They share the navbar, footer, search facet vocabulary and auth. They share **no foreign key**. The only
links are two one-way "see the other thing with these filters" buttons.

Two audiences, equal weight: **parents finding tutors** and **students finding papers**. The home page must
fork them, not blur them.

The account layer is currently near-decorative: browsing and contacting both work signed-out; only paper
reading is gated. A student's stated subjects and board personalize nothing. **The design should stop
pretending the account does more than it does, and where possible give it something real to do.**

---

## 2. The organizing metaphor: wayfinding

**Approved as the spine, not a decoration.**

ShikshAQ is a directory — a product whose entire job is *getting someone from "I need help with Class 9
Physics" to a specific human or a specific paper*. That is wayfinding. So:

| Concept | Wayfinding form |
|---|---|
| Subject | **Signpost** — directional chip/card with a pointer end |
| Board (ICSE/CBSE/IGCSE/IB/State) | **Route marker** — badge-shaped, secondary to subject |
| Class / grade | **Distance marker** — numeric, tabular, high-contrast |
| A teacher | **Destination** |
| A paper | **Milestone** — something you pass through, and can pass again |
| Search | **The map** |
| Browse | **The road** |

This is why the metaphor was chosen over pure decoration: it makes the two catalogues feel like *one
journey with two destinations* rather than two apps sharing a navbar. Use it to connect them, not just to
decorate them.

**Do not** take the metaphor literally into skeuomorphism. No photographic road signs, no asphalt textures,
no traffic-light imagery. It is a structural logic — direction, sequence, progress — expressed through the
existing brand language.

---

## 3. The reference clusters, and where each one is allowed

~55 references were supplied. They are **not one style** and cannot all be applied everywhere; doing so
reproduces the "broken and random without intent" failure. They resolve into four clusters:

| Cluster | Grammar | Where it leads |
|---|---|---|
| **A — Sticker/collage** | Thick black outlines, die-cut stickers with white keylines, offset solid shadows, tape, torn paper, halftone/riso grain, rotation 3–8°, mascots | **Moments only** (§4) |
| **B — Bold type + color block** | One heavy grotesk carrying the message, highlighter-marker spans, rounded saturated slabs, numbers as graphics | **Voice — everywhere**, at appropriate volume |
| **C — Modular bento product UI** | Tight colored tiles on a grid, huge tabular numerals, pill/segmented controls, per-tile category color | **Structure — all scannable surfaces** |
| **D — Editorial data-viz** | Big honest numbers, annotated, no chartjunk | Stats, counts, dashboards |

**The governing rule:**

> **Crisp skeleton, loud moments.**
> Where the user is *comparing*, the design gets out of the way. Where the user is *arriving, finishing, or
> stuck*, the design performs.

Clusters A and C cannot both be the system. C is the skeleton. A is the skin, applied at moments. B is the
voice throughout. This is a deliberate, owner-approved decision — do not relitigate it per-component.

---

## 4. Surface assignment — the part that prevents drift

### Crisp (Cluster C + B). No stickers, no rotation, no grain, no tape.

Scanning and comparison happen here. Noise directly costs the user.

- Browse teacher grid and teacher cards
- Paper results grid and paper cards
- All filters, facets, chips, dropdowns, the filter sheet
- Search field, search dropdown, recent searches
- All forms — auth, JoinApply, profile editing, admin
- Dashboards (tiles may be bento-colored and use big tabular numbers — that *is* Cluster C)
- Legal, FAQ, Help body copy

Permitted here: bold grotesk headings, color-blocked tiles, signpost chip shapes, tabular numbers,
pill/segmented controls, subject color as a category signal.

**Outline ruling (owner, 2026-08-16).** The thick black outline is the most consistent element across the
reference set, but `DESIGN_SYSTEM.md` §5 forbids stacking a border with a shadow. Resolution:

> **Thick outlines are permitted on LOUD surfaces only.** Crisp surfaces — anything in a scrollable grid of
> comparable items — keep the existing soft `shadow-border` and do **not** stack an outline on it.

So: hero, empty states, onboarding, footer, stickers, 404, and single-instance CTA panels may use
`.outline-thick` / `.outline-offset-shadow`. Teacher cards and paper cards in a grid may not. §5 stands
unamended for the surfaces it was written to protect.

### Loud (Cluster A, full permission)

The user is not comparing anything. Character is free.

- Home hero
- Onboarding / first-visit modal
- **Every empty state** — no results, no papers yet, no saved teachers, no reviews yet
- **Every success moment** — enquiry sent, application submitted, review posted, paper finished
- Error and 404 pages
- Footer
- About page
- Section transitions on the home page

Empty states are the single highest-leverage surface in the app: they are frequent (the papers catalogue is
sparse, filters often over-narrow), they are currently where users dead-end, and they are the one place
where being charming costs the user nothing.

### Never

- Rotation, tape, or grain on anything inside a scrollable list of comparable items
- Decorative texture behind body copy
- More than **one** sticker per card, and never on more than a third of the cards in a grid
- Any collage treatment that reduces tap-target size or obscures a label

---

## 5. Typography

**Display: Archivo** (variable, width + weight axes) — the wide-heavy grotesk of the Chuckle / dröm /
bitesized / Mershe references. **Body: Geist**, unchanged.

One scale, defined as real Tailwind tokens with paired line-height and tracking. Fluid via `clamp()` where
needed, so **no inline font styles are ever required again** — that was the drift vector and it is closed.

Rules:
- Display face is for display: hero, section heads, big numbers, stat values, sticker labels. Never body.
- Tight negative tracking on display sizes; body stays neutral.
- Numbers that are compared (counts, fees, years, class numbers) use `tabular-nums`.
- Mixed-weight headlines (the approved character device) are built with weight and width axes on one
  family — not by mixing families.
- Never below `font-normal` (400) for body text.

---

## 6. Color

Brand orange `#FF8000` and brand blue `#4351FF` are **locked** and unaffected by any reference image.

- `index.css` + `tailwind.config.ts` are the **single source of truth**. No component declares a hex.
- Subject color comes from `getSubjectPalette()` in `src/lib/subject-palette.ts` — the one canonical
  generator. Inline `style` with those values is the single sanctioned exception to the no-inline-style rule.
- **Black is now a structural color**, not just text. The thick-outline treatment is what makes orange and
  blue read as deliberate rather than default. Use it.
- Warm bone ground stays the canvas. Dark panel (`#1B1A18`) stays the contrast surface.

**Accepted accessibility exceptions — owner-approved twice, do not "fix":** white on `#FF8000` (~2.1:1),
and the warm text ramp `#7B736B` / `#8B837A` / `#A39A90`. Everything else meets 4.5:1.

---

## 7. Motion

The app currently has almost no interaction vocabulary — shimmer skeletons, two entrance fades, one
desktop-only flourish. Three separate scroll-reveal abstractions were built and never wired up; they have
been deleted. Motion has to be **built**, not extended.

Principles:
- Every interactive element acknowledges touch. Press feedback is not optional.
- Entrances are choreographed, not simultaneous — staggered reveal for lists and grids.
- Stickers and badges *pop* in; they don't fade.
- Durations and easings come from tokens. No magic numbers in components.
- Fast. 375px on a mid-range Android is the target, not a desktop browser.
- **No infinite decorative loops**, except the already-approved desktop-only `sparkle` and `bob`.
- `prefers-reduced-motion` kills everything. Ambient motion stays disabled below `lg`.

---

## 8. Mobile model

**375px is the primary canvas. Mobile is the design, not a breakpoint of it.**

- Bottom nav is primary navigation (dark floating pill, four tabs). Navbar's sheet is overflow.
- Minimum 44px tap targets. Two known exceptions remain and should be fixed: the 40px logo and a 38px
  footer link.
- Horizontal scrollers need a visible affordance — the search facet row currently hides its own scroll.
- Filters must be reachable and reversible with one thumb.
- Never require a horizontal page scroll. Wide content scrolls inside its own container.

---

## 9. Known product gaps the design must not paper over

These are real and were found in audit. Design around them honestly; do not fake them.

1. **Teacher dashboard has two permanently inert stat tiles** (Profile views, Enquiries) and an always-empty
   enquiries list. Either remove them or make them real — the WhatsApp interstitial is a natural capture point.
2. **Papers has no reading state at all** — no progress, no history, no offline, no resume. Do not design a
   shelf that implies "continue reading" exists.
3. **The account gives browsing nothing.** Stated subjects and board personalize nothing anywhere.
4. **Nothing gives any user a reason to return tomorrow.** No notifications, messages, or activity.
5. **Paper access is not actually gated** — `file_url` is a public bucket URL. Copy must not claim otherwise.

---

## 9a. Owner rulings — 2026-08-16, second review

After seeing the first overhaul wave running, the owner's verdict was: *inconsistent, incomplete, and
the first fold of every page is boring.* These rulings follow. See `REFERENCE_DEVICES.md` for the
concrete devices to build.

| Question | Ruling |
|---|---|
| First folds | **Every page gets a designed opening.** Eyecandy *and* functional — it must still search, orient, or navigate. Built as a shared page-header system so it can't drift. |
| Card volume | **Cards stay crisp; section framing goes loud.** Comparison surfaces stay calm; the shelves around them get colored bands, oversized headers, signpost dividers, sticker accents. |
| Reference fidelity | **Bold typography and color first**, texture and collage as accents layered after. |
| Imagery | **Illustration-first, photos secondary.** Build a cut-paper/blob vocabulary (device S) plus subject-colored graphic marks so a teacher with no photo looks intentional, not broken. Photography is a bonus, never a requirement. |
| Copy voice | **Personality in moments only.** Empty states, 404, onboarding and success moments get real voice. Functional and transactional copy — fees, safety, verification, forms — stays plain and honest. |
| Dark surfaces | **Light stays dominant. Dark footer only.** No alternating dark bands. First folds must achieve impact on the warm bone ground using color-blocking, marker highlight, angled banners and graph-paper grounds. |
| SEO subject/board pages | **One templated fold**, reading color/icon/copy from the subject or board, so all ~35 feel bespoke but are built once. |

**Implication to keep in mind:** because the ground stays light, saturated color and heavy display type
carry nearly all the impact. Slabs, bands and marker highlights must be genuinely saturated — timid
tints will read as the same boring page the owner already rejected.

---

## 10. Rules for agents

1. Consult §4 before styling anything. If the surface is crisp, stay crisp. Do not negotiate per-component.
2. Never introduce a hex color. If you need a color that doesn't exist, it becomes a token first.
3. Never write an inline font size. The scale is tokenized; if something is missing, extend the scale.
4. Preserve all data-fetching, routing, and auth behavior unless the task explicitly says otherwise.
5. Verify with `npx tsc --noEmit -p tsconfig.app.json` **and** `npm run build`. Plain `tsc --noEmit` is a
   silent no-op in this repo.
6. Verify at **375 / 768 / 1280**.
7. If two governing documents conflict, **stop and report**. Do not resolve it yourself. That instruction
   has been in force since the first handoff and remains.
