# ShikshAQ Design Contract

**This file is binding.** Every agent working on UI reads this first and conforms to it exactly.
Do not invent values. If a value you need is not here, use the nearest one that is.

**Companion spec: `VISUAL_LANGUAGE.md`.** This file governs RULES — tokens, scales,
accessibility, mobile, QA. That file governs LOOK, extracted from the client's own design
handoff with exact values. Read both. Where they genuinely conflict, **stop and report; do
not decide** (see VISUAL_LANGUAGE §0).

Direction: keep the existing warm-cream palette and restraint. Borrow **structure** from bold
editorial references — a wider type scale, bento tile grids, pill chips, generous rounded
cards, card stacking — but **not** their saturated color blocks. Bold layout, calm color.

**ShikshAQ is a mobile app that also works on desktop.** 375px is the design target, not an
afterthought. See §11.

---

## 1. Absolute rules

1. **No raw hex or rgb() in `src/pages/**` or `src/components/**`.** Ever. Use token classes.
   The only files allowed to contain color literals are `src/index.css` and `tailwind.config.ts`.
2. **No inline `style={{...}}` for anything expressible in Tailwind.** Inline styles are reserved
   for genuinely dynamic values (a computed width %, a CSS custom property).
3. **Visual only.** Do not touch data fetching, Supabase queries, routing, auth, or any handler
   logic. Do not rename props or change component APIs unless purely presentational.
4. **Preserve all existing behavior.** Same elements, same interactions, same text — restyled.
5. Accessibility is not optional: every interactive element keeps a visible focus ring, hit
   targets are >= 44px on touch, and text meets 4.5:1 contrast.

**Two owner-approved exceptions to rule 5.** Both were raised, measured, and deliberately
accepted in favour of handoff fidelity. Do not "fix" them, and do not raise them again:
- Primary action: white on brand orange `#FF8000` (~2.1:1).
- Warm text scale: secondary `#7B736B` (4.34:1), tertiary `#8B837A`, quaternary `#A39A90`.

Everything not listed above still must meet 4.5:1.

---

## 2. Color

Semantic tokens only. These already exist in `src/index.css`.

| Use | Class |
|---|---|
| Page background | `bg-background` |
| Card / raised surface | `bg-card` |
| Primary text | `text-foreground` |
| Secondary / meta text | `text-muted-foreground` |
| Subtle fill (chips, wells) | `bg-muted` |
| Hairline / divider | `border-border` |
| Destructive | `bg-destructive` / `text-destructive` |
| Brand accent (CTA, active) | `bg-brand` / `text-brand` / `border-brand` |
| Brand secondary (links, info) | `bg-brand-blue` / `text-brand-blue` |

Brand orange `#FF8000` and brand blue `#4351FF` are **accents, not surfaces**.

**Accent budget: at most two accented elements per viewport.** A page with five orange
things has no hierarchy. The primary CTA gets the accent. Everything else earns attention
through size, weight, and whitespace — not color.

Never use `shikshaq-orange` / `shikshaq-blue` / `shikshaq-beige` / `shikshaq-dark` legacy
classes. They are being removed.

---

## 3. Typography

One scale. Geist throughout. Use exactly these combinations — no other size/weight pairs.

| Role | Classes |
|---|---|
| Display (hero h1) | `text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight` |
| Page title (h1) | `text-3xl sm:text-4xl font-semibold tracking-tight` |
| Section (h2) | `text-2xl sm:text-3xl font-semibold tracking-tight` |
| Subsection (h3) | `text-lg font-semibold` |
| Card title (h4) | `text-base font-semibold` |
| Body | `text-base text-foreground` |
| Secondary body | `text-sm text-muted-foreground` |
| Meta / caption | `text-xs text-muted-foreground` |
| Label / eyebrow | `text-xs font-medium uppercase tracking-wide text-muted-foreground` |

Rules:
- **Exactly one h1 per page.**
- Never skip heading levels.
- Body copy blocks get `max-w-prose`. Long lines are the most common readability failure here.
- Numbers in stats/tables use `tabular-nums`.
- Never set a weight below `font-normal`.

---

## 4. Spacing

Only these steps: `1, 2, 3, 4, 6, 8, 12, 16, 20, 24`. No `p-5`, `gap-7`, `mt-9`, no arbitrary
`[13px]` values.

| Context | Value |
|---|---|
| Page section vertical rhythm | `py-16 sm:py-20 lg:py-24` |
| Gap between sections' inner blocks | `space-y-8` |
| Card interior padding | `p-4 sm:p-6` |
| Grid/flex gap between cards | `gap-4 sm:gap-6` |
| Related items (label→field, icon→text) | `gap-2` |
| Page horizontal container | `mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8` |

**Full-bleed fill, contained content.** This rule used to read "Every page uses that same
container", which stopped being true and contradicted the code: the redesigned pages stack
`BentoPanel`s that run edge to edge with zero gap, and wrapping those in `max-w-6xl` would
put page ground down both sides of every panel and destroy the seam-by-fill language the
whole system rests on (see §11 and `PageContainer.tsx`). The owner's decision is
edge-to-edge; this doc was the thing that was wrong.

So the container applies to **content, not to fills**:

- A panel's **background** goes full-bleed. `BentoStack` is `gap-0`, panels touch, and
  separation comes from the fill change at the seam.
- A panel's **content** still goes through `PageContainer` (or an equivalent `max-w`
  wrapper) so text never renders at a 1400px measure. At 1440 an uncontained paragraph is
  roughly 220 characters per line.
- Two saturated fills must never be adjacent. With separation coming from fill alone, an
  orange panel touching an indigo one has nothing to separate them.

Narrow reading pages (legal, FAQ, help) may use `max-w-3xl` instead. Inconsistent *content*
width is still a top source of the "random" feeling; inconsistent *fill* width is not, because
fills are meant to be edge to edge.

Proximity rule: spacing between related items must be visibly smaller than spacing to the
next group. If a label sits as far from its input as from the next field, the grouping is broken.

---

## 5. Elevation, radius, borders

- Radius: `rounded-lg` (controls, inputs, buttons), `rounded-2xl` (cards, panels),
  `rounded-full` (pills, avatars, icon buttons). Nothing else.
- **Depth comes from `shadow-border`, not from `border` + `shadow` stacked.** Use the existing
  `--shadow-border` token. A card should have either a hairline border or a shadow — never both.
- Hover elevation on cards: `hover:-translate-y-0.5` plus `shadow-border-hover`. Nothing more.

---

## 6. Motion

The current 33 keyframes are the problem, not the solution. Permitted animations only:

| Purpose | Class |
|---|---|
| Content entering on load | `animate-fade-slide-up` |
| Card/grid item entering | `animate-card-reveal` (stagger 40ms, cap at 6 items) |
| Route transition | `route-fade` |
| Loading placeholder | `animate-shimmer` |
| Accordion | `animate-accordion-down` / `-up` |

Everything else is banned in page/component code: no `float-subtle`, `glow-pulse`,
`ring-pulse`, `avatar-reveal`, `rating-star-fill`, `icon-bounce`, `badge-bounce`,
`testimonial-slide`, `pulse-ring`, `icon-spin`, `underline-grow`, `stat-reveal`, `count-up`.

Hover/press are transitions, not animations:
- Hover: `transition-colors duration-150` (or `transition-transform` for cards)
- Press: `active:scale-[0.97] transition-transform duration-150`
- Never animate anything infinitely. No decorative perpetual motion.

---

## 7. Hierarchy (the "everything screams" fix)

Per page, in order:
1. **One** primary action, styled `bg-brand text-white` — the single thing you want clicked.
2. Secondary actions are `variant="outline"` or `bg-muted`. Never accent-colored.
3. Tertiary actions are plain text links in `text-brand-blue`.

If a screen has two primary buttons, one of them is wrong. Demote it.

Cards: one bold title, everything else `text-sm text-muted-foreground`. Do not bold three
things in a card — bolding everything bolds nothing.

---

## 8. Responsive

- Mobile-first. Write the base classes for 375px, then add `sm:` / `lg:`.
- Test at **375, 768, 1280**. No horizontal scroll at any width.
- Grids: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — never a fixed multi-column grid at base.
- Long strings (emails, subject lists, teacher names) need `truncate` or `break-words`.
- No fixed pixel heights on text-bearing containers; content reflows and will overflow.
- Inputs are `text-base` (16px) minimum on mobile, or iOS zooms on focus.

---

## 9. States — required, not optional

Every list/data surface must handle all four:
- **Loading** — skeleton with `animate-shimmer` matching the real content's shape. Not a spinner.
- **Empty** — icon, one-line explanation, one action. Use `EmptyResults`.
- **Error** — plain message plus a retry affordance.
- **Populated** — the normal case.

Every form field: label, focus ring, inline error under the field in `text-sm text-destructive`,
and a disabled/pending state on submit.

---

## 11. Mobile is the design

375px is the primary canvas. Design it first, then let it breathe at `sm:` and `lg:`.

- **Thumb zone.** Primary actions live in the bottom third of the screen. Nothing critical
  sits in the top corners on mobile.
- **Hit targets: 44px minimum.** Icon buttons get `h-11 w-11` (or `p-3` around a 20px icon).
- **Modals become sheets on mobile.** Bottom-anchored, `rounded-t-2xl`, full width, with a
  drag-handle affordance. Centered dialogs are desktop-only (`sm:` and up).
- **Cards go full-bleed-ish on mobile.** `rounded-2xl` with `px-4` page gutters — not a
  narrow card floating in a wide margin.
- **Horizontal scroll rows** (`overflow-x-auto scrollbar-hide snap-x snap-mandatory`) are the
  correct mobile pattern for chip sets and card carousels. Never wrap chips into 4 ragged rows.
- **Sticky headers must be short.** Max `h-14` on mobile; the content is the point.
- **No hover-only affordances.** Anything revealed on `:hover` must also be reachable by tap.
- Inputs stay `text-base` (16px) minimum, always.

### Bottom navigation

A fixed bottom tab bar is the primary navigation on mobile (`lg:hidden`). Four tabs:

| Tab | Route | Icon intent |
|---|---|---|
| Home | `/` | house |
| Browse | `/browse` | search |
| Papers | `/past-papers` | document |
| Account | role-aware dashboard, or `/auth` when logged out | user |

Rules:
- `fixed bottom-0 inset-x-0 z-50`, `bg-card`, top hairline via `border-t border-border`.
- Respect the iOS home indicator: `pb-[env(safe-area-inset-bottom)]`.
- Each tab: icon above an `text-xs` label, full height `h-16`, `flex-1`.
- Active tab uses `text-brand` + filled/solid icon. Inactive is `text-muted-foreground`.
- Every page that renders below it needs bottom padding (`pb-20 lg:pb-0`) so the bar never
  covers content or a page's own CTA.
- On `lg:` and up the bar is hidden and the existing top navbar is the navigation.

### Home hero (search-first)

The hero's job is to get a user into a teacher search in one tap. Structure, top to bottom:

1. Short headline — `text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight`, two lines
   max on mobile. Says what ShikshAQ does, not a slogan.
2. One supporting line, `text-base text-muted-foreground max-w-prose`.
3. **The search field — visually dominant.** Full width, `h-14`, `rounded-2xl`, `shadow-border`,
   leading search icon, `text-base`. This is the largest interactive element on the screen.
4. **Quick chips directly beneath it** — popular subjects / boards / classes as tappable pills.
   Horizontal scroll row on mobile, wrapped rows on desktop. Most users will tap, not type;
   these must look tappable and be at least 44px tall.

The hero must fit within the first viewport at 375×812 including the chips. If it doesn't,
cut the supporting line before shrinking the search field.

---

## 12. Intent — what every screen is for

Design decisions get settled by this section, not by taste. If a choice doesn't serve the
intent below, it's the wrong choice regardless of how it looks.

### Two audiences, equal weight

1. **Parents / guardians finding a tutor.** Decision-makers. Low patience, on a phone.
   They need *reassurance*: verification, real photos, review counts, clear subjects and
   location. They are choosing whom to trust with their child.
2. **Students finding past papers.** Repeat, task-focused visitors. They need *speed*:
   find the paper, open it, done. Every extra step is friction.

These are different jobs. **Do not blur them into one generic funnel.** Where both are
present — most importantly the home page — the UI must fork clearly and early, so each
audience knows within seconds which path is theirs.

### The success action: WhatsApp a teacher

Contact is conversion. On every teacher-bearing surface there is exactly one obvious action
and it is the WhatsApp contact. It is the primary accented button (§7). Nothing competes
with it. Saving, sharing, and upvoting are secondary and must be visually quieter.

The papers funnel earns its keep by returning students to teacher discovery — but never at
the cost of slowing the paper task down.

### The bounce problem: "unclear what it is"

This is the single biggest failure to fix. A first-time visitor must understand what
ShikshAQ is **within three seconds, above the fold, at 375px, without scrolling.**

Requirements:
- The headline states plainly what the product does. Not a slogan, not a value proposition
  in the abstract — a sentence a parent would recognise as describing their problem.
- The two paths (find a teacher / find past papers) are both visible and distinguishable
  above the fold.
- Concrete proof appears early: real teacher faces, counts, subjects, boards. Abstract
  illustration does not build trust; specifics do.
- If a section doesn't help a visitor understand or act, it goes below the fold or gets cut.

---

## 13. Alignment & consistency QA

Contract compliance is not the same as *looking* right. A page can use every correct token
and still look broken. These are the failures that survive a token audit, so they get their
own pass — measured in a real browser, not eyeballed from the code.

**Sibling alignment.** Any two elements presented as a pair or a set must agree:
- Same top edge, same height, same internal baselines.
- Never centre a stack (`justify-center`) inside a fixed-height row when its children can
  wrap — one item wrapping shifts everything and the set goes ragged. Use a fixed row
  structure and anchor variable-length text with `mt-auto`.
- Icons in a set share one size and one optical position.
- Cards in a grid share one height; their titles, metadata, and actions each share a baseline.

**Text-length robustness.** Every string that comes from data must be tested at its extremes:
the longest real teacher name, the longest subject list, a two-line title next to a one-line
title, a zero count, a null count. If a layout only looks right with the seed data, it's broken.

**Optical, not just mathematical.** Equal padding values can still look unequal — icons next
to text usually need a small optical nudge; a circular badge next to a square one reads smaller
at the same box size.

**Never advertise emptiness.** A `0` count, an empty list, or a null field must fall back to
useful copy rather than rendering a literal zero on a trust-building surface.

### Required final pass

Before any wave of work is called done, run a dedicated QA pass over every touched page at
**375, 768, and 1280**, in a real browser, checking:

- [ ] No horizontal overflow at any width
- [ ] Paired/grid items share top, height, and baselines
- [ ] No element overlaps the bottom tab bar or a sticky bar
- [ ] Long and empty data values don't break any layout
- [ ] Tap targets >= 44px everywhere
- [ ] Focus ring visible on every interactive element
- [ ] Loading, empty, and error states all render correctly
- [ ] No console errors

Findings get fixed, not filed.

---

## 10. Definition of done (per file)

- [ ] Zero hex/rgb literals
- [ ] Zero off-scale spacing values
- [ ] Type classes drawn only from §3
- [ ] Standard container from §4
- [ ] Exactly one h1, headings in order
- [ ] One primary action, accent budget <= 2
- [ ] Only §6 animations
- [ ] Clean at 375 / 768 / 1280
- [ ] Loading / empty / error states present where data is rendered
- [ ] `npx tsc --noEmit -p tsconfig.app.json` passes
